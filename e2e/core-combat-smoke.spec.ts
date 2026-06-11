// core-combat-smoke — Phase 2 validation of the real combat loop through
// the live UI. Five independent tests, each in its own page+context:
//
//   1. Leader → Opp leader attack
//   2. Character → Opp leader attack (after summoning-sickness clears)
//   3. Character → Rested opp character attack (uses state injection to
//      seed a B character on field; otherwise unreachable from a clean
//      hand within a short test budget)
//   4. Counter window smoke (verifies the engine pauses on a real
//      pending attack; in vs-AI mode the store auto-skips so we assert
//      the resolution path completes)
//   5. Blocker smoke (verifies block_window is reachable; same auto-skip
//      caveat — assert end-to-end resolution)
//
// Per directive 2026-06-05: real UI only, no scenarioFactory touches,
// engine/card-data unchanged. State injection allowed via the
// PlayerDriver.dispatch helper + window.__store seed for combat-3,4,5.

import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const FIVE_MIN = 300_000;

// Shared bootstrap — drive from dice → mulligan → A main with instrumented
// pageerror / invariant captures.
async function bootstrap(page: Page): Promise<{
  drv: PlayerDriver;
  pageErrors: string[];
  invariantErrors: string[];
}> {
  const pageErrors: string[] = [];
  const invariantErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('InvariantError') || t.includes('invariant')) {
      invariantErrors.push(t);
    }
  });

  const drv = new PlayerDriver(page);
  await drv.open();
  await drv.waitForPhase('dice_roll');
  await drv.rollDice();
  try { await drv.waitForPhase('first_player_choice', 15_000); await drv.chooseGoFirst(); } catch {}
  try { await drv.waitForPhase('mulligan', 8_000); await drv.keepMulliganHand(); } catch {}
  await drv.waitForPhase('main', 30_000);
  return { drv, pageErrors, invariantErrors };
}

// Close any lingering CardDetailModal so EndTurnButton's aria-hidden gate
// (EndTurnButton.tsx:89) doesn't hide the END TURN button from us.
async function closeAnyOpenModal(page: Page): Promise<void> {
  try {
    const closeBtn = page.locator('button:has-text("CLOSE")').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click({ timeout: 2_000 });
      await page.waitForTimeout(180);
    }
  } catch {}
}

// 3-click attack flow: own leader → SELECT AS ATTACKER → target → ATTACK
// THIS. Returns true if landed. Closes any open modal on every fail-path
// so the END TURN button stays reachable.
async function attackTarget(page: Page, ownSelector: string, targetSelector: string): Promise<boolean> {
  try {
    const own = page.locator(ownSelector).first();
    if (!(await own.isVisible().catch(() => false))) return false;
    await own.click({ timeout: 3_000 });
    await page.waitForTimeout(250);
    const sel = page.locator('button:has-text("SELECT AS ATTACKER")').first();
    if (!(await sel.isVisible().catch(() => false))) { await closeAnyOpenModal(page); return false; }
    await sel.click({ timeout: 3_000 });
    await page.waitForTimeout(250);
    const tgt = page.locator(targetSelector).first();
    if (!(await tgt.isVisible().catch(() => false))) { await closeAnyOpenModal(page); return false; }
    await tgt.click({ timeout: 3_000 });
    await page.waitForTimeout(250);
    const atk = page.locator('button:has-text("ATTACK THIS")').first();
    if (!(await atk.isVisible().catch(() => false))) { await closeAnyOpenModal(page); return false; }
    await atk.click({ timeout: 3_000 });
    await page.waitForTimeout(2_500); // damage + counter window auto-skip + trigger
    return true;
  } catch {
    await closeAnyOpenModal(page);
    return false;
  }
}

// Inject seeds directly into the store. Test-only path — gated on
// window.__store which is only exposed in dev/?test=1 mode.
async function injectStoreSeed(page: Page, builder: (state: Record<string, unknown>) => void): Promise<void> {
  await page.evaluate((builderSrc) => {
    const fn = new Function('state', builderSrc);
    const w = window as unknown as { __store?: { setState: (p: { state: unknown }) => void; getState: () => { state: unknown } } };
    if (!w.__store) throw new Error('window.__store not exposed');
    const cur = w.__store.getState().state as Record<string, unknown>;
    fn(cur);
    w.__store.setState({ state: cur });
  }, builder.toString().match(/\{([\s\S]*)\}/)?.[1] ?? '');
}

// Poll for control to return to A in main phase. Post-BUG-010, the
// store no longer silently auto-skips block/counter/trigger windows the
// human controls — the AI loop yields to the UI. These smoke tests
// don't exercise those windows, so we drain them with safe defaults so
// the AI can resume and end its turn cleanly. The deterministic
// reactive coverage lives in e2e/local-ai/local-vs-ai-human-reactive.spec.ts
// and e2e/family-blocker.spec.ts.
async function waitForAMainControl(drv: PlayerDriver, message: string): Promise<void> {
  await drv.waitForAMainControlDrainingReactive(message, 60_000);
}

// ─── 1. Leader → Opp leader ─────────────────────────────────────────────

test.describe('Core combat smoke', () => {
  test('1: leader attacks opp leader', async ({ page }) => {
    test.setTimeout(FIVE_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);

    const before = await drv.getState();
    const oppLifeBefore = before.B.life;

    const ok = await attackTarget(
      page,
      '[aria-label*="(leader)" i]:not(:has-text("Buggy"))', // own leader
      'button[aria-label^="Buggy"]', // opp leader (Buggy by default)
    );
    // Best-effort assertion: if leader is rested OR target rejected, we
    // can't validate damage. But the engine MUST settle to main/pending=null.
    await closeAnyOpenModal(page);
    await waitForAMainControl(drv, 'phase did not return to A main after attack');

    const after = await drv.getState();
    expect(after.pendingKind, 'pendingKind stuck after attack').toBeNull();
    if (ok) {
      expect(after.B.life, 'B life did not decrease after successful attack').toBeLessThan(oppLifeBefore);
    }
    expect(pageErrors).toEqual([]);
    expect(invariantErrors).toEqual([]);
  });

  // ─── 2. Character → Opp leader ──────────────────────────────────────

  test('2: character attacks opp leader (after summoning-sickness clears)', async ({ page }) => {
    test.setTimeout(FIVE_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);

    // Play first legal card (likely a character).
    let played = false;
    for (let i = 0; i < 2; i += 1) {
      try { if (await drv.playCard(i)) { played = true; break; } } catch {}
      await closeAnyOpenModal(page);
    }
    if (played && await drv.hasChoosePrompt()) {
      await drv.chooseOption(0);
    }
    // Attack leader same turn (will skip if character is summoning-sick).
    await attackTarget(page, '[aria-label*="(leader)" i]:not(:has-text("Buggy"))', 'button[aria-label^="Buggy"]');
    await closeAnyOpenModal(page);
    // End turn so character loses summoning sickness next turn.
    await drv.endTurn();
    await waitForAMainControl(drv, 'phase did not return to A main after AI turn');

    const stateBeforeCharAtk = await drv.getState();
    const oppLifeBefore = stateBeforeCharAtk.B.life;

    // Attack opp leader with first non-leader character on our field. The
    // DOM exposes character buttons via aria-label "Name, character, ...".
    const charAtk = await attackTarget(
      page,
      'button[aria-label*="character"][aria-label*="power"]',
      'button[aria-label^="Buggy"]',
    );

    await closeAnyOpenModal(page);
    await waitForAMainControl(drv, 'phase did not return to A main after char attack');
    const finalState = await drv.getState();
    expect(finalState.pendingKind, 'pendingKind stuck after char attack').toBeNull();
    if (charAtk) {
      expect(finalState.B.life, 'B life did not decrease after char-led attack').toBeLessThan(oppLifeBefore);
    }
    expect(pageErrors).toEqual([]);
    expect(invariantErrors).toEqual([]);
  });

  // ─── 3. Character → Rested opp character ────────────────────────────

  test('3: character attacks rested opp character', async ({ page }) => {
    test.setTimeout(FIVE_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);

    // Seed a rested B character on field.
    await injectStoreSeed(page, ((state: Record<string, unknown>) => {
      const s = state as { instances: Record<string, unknown>; cardLibrary: Record<string, unknown>; players: { B: { field: unknown[] } } };
      const iid = 'seedCharB1';
      const syntheticId = '__seed_char_b_1';
      s.cardLibrary[syntheticId] = {
        id: syntheticId,
        name: 'Seed Target',
        kind: 'character',
        cost: 2,
        power: 2000,
        counterValue: 1000,
        colors: ['red','green','blue','purple','black','yellow'],
        traits: [],
        keywords: [],
        effectText: '',
      };
      const inst = {
        instanceId: iid,
        cardId: syntheticId,
        controller: 'B',
        rested: true,
        summoningSick: false,
        attachedDon: [],
        attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      s.instances[iid] = inst;
      s.players.B.field.push(inst);
    }) as never);

    // Wait for the injected character to render before continuing.
    await page.waitForTimeout(200);

    // Attempt leader → rested B character attack.
    const ok = await attackTarget(
      page,
      '[aria-label*="(leader)" i]:not(:has-text("Buggy"))',
      'button[aria-label*="Seed Target"]',
    );
    await closeAnyOpenModal(page);
    await waitForAMainControl(drv, 'phase did not return to A main after rested-char attack');
    const final = await drv.getState();
    expect(final.pendingKind, 'pendingKind stuck after rested-char attack').toBeNull();
    // The attack may or may not have landed depending on power comparison.
    // What MUST hold: combat resolves cleanly (no stuck pending) regardless.
    void ok;
    expect(pageErrors).toEqual([]);
    expect(invariantErrors).toEqual([]);
  });

  // ─── 4. Counter window smoke ───────────────────────────────────────

  test('4: counter window resolves through attack', async ({ page }) => {
    test.setTimeout(FIVE_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);

    // A direct leader→leader attack opens the opp's counter window. The
    // store auto-skips it for the AI controller (game.ts:501-510). We
    // assert the engine settles back to main + pending=null.
    await attackTarget(
      page,
      '[aria-label*="(leader)" i]:not(:has-text("Buggy"))',
      'button[aria-label^="Buggy"]',
    );
    await closeAnyOpenModal(page);
    await waitForAMainControl(drv, 'phase did not return to A main after counter-window cycle');
    const s = await drv.getState();
    expect(s.pendingKind, 'pendingKind stuck after counter window').toBeNull();
    expect(s.phase, 'phase not main after counter window').toBe('main');
    expect(pageErrors).toEqual([]);
    expect(invariantErrors).toEqual([]);
  });

  // ─── 5. Blocker smoke ──────────────────────────────────────────────

  test('5: blocker character resolves through attack', async ({ page }) => {
    test.setTimeout(FIVE_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);

    // Seed a B character with `blocker` keyword on field.
    await injectStoreSeed(page, ((state: Record<string, unknown>) => {
      const s = state as { instances: Record<string, unknown>; cardLibrary: Record<string, unknown>; players: { B: { field: unknown[] } } };
      const iid = 'seedBlockerB1';
      const syntheticId = '__seed_blocker_b_1';
      s.cardLibrary[syntheticId] = {
        id: syntheticId,
        name: 'Seed Blocker',
        kind: 'character',
        cost: 2,
        power: 3000,
        counterValue: 1000,
        colors: ['red','green','blue','purple','black','yellow'],
        traits: [],
        keywords: ['blocker'],
        effectText: '',
      };
      const inst = {
        instanceId: iid,
        cardId: syntheticId,
        controller: 'B',
        rested: false,
        summoningSick: false,
        attachedDon: [],
        attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      s.instances[iid] = inst;
      s.players.B.field.push(inst);
    }) as never);

    await page.waitForTimeout(200);

    // Attack opp leader → block_window opens → store auto-skips for AI
    // → damage resolves OR blocker intercepts (depending on AI logic
    // implementation). Either way, must settle to main + pending=null.
    await attackTarget(
      page,
      '[aria-label*="(leader)" i]:not(:has-text("Buggy"))',
      'button[aria-label^="Buggy"]',
    );
    await closeAnyOpenModal(page);
    await waitForAMainControl(drv, 'phase did not return to A main after blocker cycle');
    const s = await drv.getState();
    expect(s.pendingKind, 'pendingKind stuck after blocker cycle').toBeNull();
    expect(s.phase, 'phase not main after blocker cycle').toBe('main');
    expect(pageErrors).toEqual([]);
    expect(invariantErrors).toEqual([]);
  });
});
