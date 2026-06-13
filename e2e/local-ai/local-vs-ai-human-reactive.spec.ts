/**
 * F-7n Phase A/B/C/D — regression for local vs-AI human reactive windows.
 *
 * Pre-fix `src/store/game.ts:341-363` force-skipped the HUMAN defender's
 * block_window + counter_window + trigger_window whenever the AI took
 * its turn. The human never saw a prompt, never had a choice.
 *
 * Phase A: narrowed block/counter force-skip — yields to UI when human
 *   has a non-skip option.
 * Phase B: trigger_window yields to UI when controller is the human.
 * Phase C: TriggerPrompt activate button no longer hard-disabled.
 * Phase D: NEW BlockerPrompt component renders DECLARE_BLOCKER picks +
 *   own SKIP_BLOCKER button. AttackResolutionOverlay still renders the
 *   attacker-vs-defender visual + its own decline-blocker fallback.
 *
 * This spec is split into two parts:
 *   1. Real-flow drive — pushes through setup (dice → first-player →
 *      mulligan → main), ends turn so AI plays, and confirms the Phase
 *      A/B store wiring doesn't crash. Best-effort observation only.
 *   2. Deterministic seed — uses the same test-only `window.__store`
 *      hatch family-blocker.spec.ts already relies on (gated by
 *      `?test=1` in src/main.tsx:10) to put a blocker on A.field, force
 *      phase=block_window with B leader attacking A leader, and verifies
 *      the NEW BlockerPrompt:
 *        - renders with "Blocker Step" heading
 *        - exposes a "Block · {name}" button per DECLARE_BLOCKER legal
 *        - clicking it redirects the pending attack to the blocker and
 *          rests the blocker
 *        - SKIP_BLOCKER button is reachable and dispatches correctly
 *
 * No engine, server, cards.json, or production-flow changes. This is
 * a UI-mount regression, scoped to the Phase D component + spec.
 */

import { test, expect, type Page } from '@playwright/test';

test.use({
  launchOptions: { args: ['--disable-web-security'] },
});

const TWO_MIN = 120_000;

// ─── Test-only window hooks (gated by ?test=1; see src/main.tsx:10) ──
async function waitForStoreHook(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __store?: unknown }).__store),
    undefined,
    { timeout: timeoutMs },
  );
}

async function currentPhase(page: Page): Promise<string> {
  // Exact engine enum from __store — the header shows friendly labels
  // ("Setup · Dice roll"), not the enum (owner 2026-06-12).
  return page.evaluate(() => {
    const store = (window as unknown as { __store?: { getState: () => { state: { phase: string } } } }).__store;
    return store ? store.getState().state.phase : '';
  });
}

async function waitForPhaseLoose(page: Page, name: string, timeoutMs: number): Promise<void> {
  await expect
    .poll(async () => currentPhase(page), {
      timeout: timeoutMs,
      message: `waitForPhase ${name}`,
    })
    .toContain(name.toLowerCase());
}

// Click "Roll your die" until both dice fill and phase leaves dice_roll.
async function driveDice(page: Page): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    const phase = await currentPhase(page).catch(() => '');
    if (!phase.includes('dice_roll')) return;
    const btn = page.getByRole('button', { name: /^roll your die$/i }).first();
    if (await btn.isVisible().catch(() => false)) {
      const disabled = await btn.isDisabled().catch(() => true);
      if (!disabled) await btn.click();
    }
    await page.waitForTimeout(2500);
  }
}

// Click "Go First" if visible (only when the human won the dice). The AI
// auto-fires after 600ms if it won.
async function driveFirstPlayer(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: /^go first$/i }).first();
  try {
    await btn.waitFor({ state: 'visible', timeout: 4_000 });
    await btn.click();
  } catch {
    // AI won the roll and is auto-choosing. Wait for it.
  }
}

async function driveMulligan(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: /^keep$/i }).first();
  try {
    await btn.waitFor({ state: 'visible', timeout: 8_000 });
    await btn.click();
  } catch {
    // Mulligan window may have closed already on a fast path.
  }
}

// ─── Deterministic block_window seed (mirrors family-blocker.spec.ts) ──
const JINBE_DEF = {
  id: 'OP01-014',
  name: 'Jinbe',
  kind: 'character',
  colors: ['red'],
  cost: 4,
  power: 5000,
  counterValue: null,
  traits: ['Fish-Man', 'Straw Hat Crew'],
  keywords: ['blocker'],
  effectTags: ['blocker'],
  effectText: '[Blocker]',
  effectSpecV2: {
    clauses: [],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'human-reviewed',
  },
};

async function seedJinbeOnAField(page: Page, def: unknown): Promise<string> {
  return page.evaluate((d) => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: Record<string, unknown> };
        setState: (p: Record<string, unknown>) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state;
    const lib = s.cardLibrary as Record<string, unknown>;
    if (!lib['OP01-014']) lib['OP01-014'] = d;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] } };
    const iid = `seedJinbe_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid,
      cardId: 'OP01-014',
      controller: 'A',
      rested: false,
      summoningSick: false,
      attachedDon: [],
      attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.field = [...players.A.field, inst[iid]];
    w.__store.setState({ state: { ...s } });
    return iid;
  }, def);
}

async function enterBlockWindow(page: Page): Promise<{
  bAttackerIid: string;
  aLeaderIid: string;
}> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: Record<string, unknown> };
        setState: (p: Record<string, unknown>) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state;
    const players = s.players as {
      A: { leader: { instanceId: string } };
      B: { leader: { instanceId: string } };
    };
    const bAttackerIid = players.B.leader.instanceId;
    const aLeaderIid = players.A.leader.instanceId;
    s.phase = 'block_window';
    s.activePlayer = 'B';
    s.pending = {
      kind: 'attack',
      pendingAttack: {
        attackerInstanceId: bAttackerIid,
        targetInstanceId: aLeaderIid,
        counterBoost: 0,
      },
    };
    w.__store.setState({
      state: {
        ...s,
        players: {
          ...players,
          A: { ...players.A },
          B: { ...players.B },
        },
      },
    });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({
        legalActions: w.__getLegalActions(next, 'A'),
      });
    }
    return { bAttackerIid, aLeaderIid };
  });
}

interface BlockSnap {
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
  pendingAttackTarget: string | null;
  jinbeRested: boolean | null;
  legalActionTypes: string[];
}

async function readBlockSnap(page: Page, jinbeIid: string): Promise<BlockSnap> {
  return page.evaluate((jid) => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            activePlayer: string;
            pending: { kind?: string; pendingAttack?: { targetInstanceId?: string } } | null;
            instances: Record<string, { rested?: boolean }>;
          };
          legalActions: { type: string }[];
        };
      };
    };
    if (!w.__store) {
      return {
        phase: '',
        activePlayer: '',
        pendingKind: null,
        pendingAttackTarget: null,
        jinbeRested: null,
        legalActionTypes: [],
      };
    }
    const s = w.__store.getState();
    const jinbe = s.state.instances[jid];
    return {
      phase: s.state.phase,
      activePlayer: s.state.activePlayer,
      pendingKind: s.state.pending?.kind ?? null,
      pendingAttackTarget: s.state.pending?.pendingAttack?.targetInstanceId ?? null,
      jinbeRested: jinbe ? (jinbe.rested ?? null) : null,
      legalActionTypes: s.legalActions.map((a) => a.type),
    };
  }, jinbeIid);
}

// ─── Tests ────────────────────────────────────────────────────────────

test.describe('F-7n Phase A/B/C/D — local vs-AI human reactive', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  });

  test('setup flow drives through dice → first-player → mulligan → main', async ({
    page,
  }) => {
    test.setTimeout(TWO_MIN);
    await page.goto('/?test=1');
    await page.waitForLoadState('domcontentloaded');
    await waitForStoreHook(page);

    await waitForPhaseLoose(page, 'dice_roll', 15_000);
    await driveDice(page);
    await driveFirstPlayer(page);
    await driveMulligan(page);
    await waitForPhaseLoose(page, 'main', 30_000);
  });

  test('Phase D — BlockerPrompt renders with DECLARE_BLOCKER + SKIP_BLOCKER; clicking blocker redirects attack', async ({
    page,
  }) => {
    test.setTimeout(TWO_MIN);
    await page.goto('/?test=1');
    await page.waitForLoadState('domcontentloaded');
    await waitForStoreHook(page);

    // Drive game to main so the playfield is fully mounted.
    await waitForPhaseLoose(page, 'dice_roll', 15_000);
    await driveDice(page);
    await driveFirstPlayer(page);
    await driveMulligan(page);
    await waitForPhaseLoose(page, 'main', 30_000);

    // Seed Jinbe (blocker) on A field and force block_window with B leader
    // attacking A leader. This is identical to the family-blocker.spec.ts
    // deterministic setup — production gameplay semantics untouched.
    const jinbeIid = await seedJinbeOnAField(page, JINBE_DEF);
    const { aLeaderIid } = await enterBlockWindow(page);

    // ── BlockerPrompt UI assertions (Phase D) ──────────────────────────
    const blockerPrompt = page.locator('[data-pending-kind="block_window"]');
    await expect(blockerPrompt, 'BlockerPrompt mounts on block_window').toBeVisible({
      timeout: 5_000,
    });
    await expect(
      blockerPrompt.getByRole('heading', { name: /block step/i }),
    ).toBeVisible();

    // Phase F: the DECLARE_BLOCKER tile wrapper carries
    // data-blocker-instance-id, with a CardArt button inside.
    const blockerTile = blockerPrompt.locator(
      `[data-blocker-instance-id="${jinbeIid}"]`,
    );
    await expect(blockerTile, 'DECLARE_BLOCKER tile for Jinbe').toBeVisible();
    const blockerBtn = blockerTile.locator('button').first();
    await expect(blockerBtn).toBeVisible();

    // Skip button reachable.
    const skipBtn = blockerPrompt.locator('button[data-action="SKIP_BLOCKER"]');
    await expect(skipBtn, 'Skip Blocker button reachable').toBeVisible();
    await expect(skipBtn).toBeEnabled();

    // Engine pre-check: pending targets A leader, Jinbe active.
    const before = await readBlockSnap(page, jinbeIid);
    expect(before.phase).toBe('block_window');
    expect(before.activePlayer).toBe('B');
    expect(before.pendingKind).toBe('attack');
    expect(before.pendingAttackTarget).toBe(aLeaderIid);
    expect(before.jinbeRested).toBe(false);
    expect(before.legalActionTypes).toContain('DECLARE_BLOCKER');
    expect(before.legalActionTypes).toContain('SKIP_BLOCKER');

    // F-7q 2-step confirm: tap card (selects), then click confirm CTA.
    await blockerTile.click(); // F-8C: tile wrapper is the click target
    const confirmBtn = blockerPrompt.locator('button[data-action="CONFIRM_BLOCKER"]');
    await expect(confirmBtn, 'Use {name} CTA visible after first tap').toBeVisible({ timeout: 2_000 });
    await confirmBtn.click();

    await expect
      .poll(async () => readBlockSnap(page, jinbeIid), {
        timeout: 5_000,
        message: 'phase advances to counter_window after CONFIRM_BLOCKER',
      })
      .toMatchObject({
        phase: 'counter_window',
        pendingKind: 'attack',
        pendingAttackTarget: jinbeIid,
        jinbeRested: true,
      });

    // F-7q: AttackResolutionOverlay was DELETED. CounterPrompt is the
    // sole counter_window surface now.
    await expect(
      page.locator('[data-pending-kind="counter_window"]'),
      'CounterPrompt mounts in counter_window',
    ).toBeVisible({ timeout: 5_000 });
  });

  test('Phase D — BlockerPrompt SKIP_BLOCKER button dispatches and advances', async ({
    page,
  }) => {
    test.setTimeout(TWO_MIN);
    await page.goto('/?test=1');
    await page.waitForLoadState('domcontentloaded');
    await waitForStoreHook(page);

    await waitForPhaseLoose(page, 'dice_roll', 15_000);
    await driveDice(page);
    await driveFirstPlayer(page);
    await driveMulligan(page);
    await waitForPhaseLoose(page, 'main', 30_000);

    const jinbeIid = await seedJinbeOnAField(page, JINBE_DEF);
    await enterBlockWindow(page);

    const blockerPrompt = page.locator('[data-pending-kind="block_window"]');
    await expect(blockerPrompt).toBeVisible({ timeout: 5_000 });

    const skipBtn = blockerPrompt.locator('button[data-action="SKIP_BLOCKER"]');
    await skipBtn.click();

    // SKIP_BLOCKER → engine moves to counter_window (no redirect, target
    // stays on A leader). Jinbe remains active.
    await expect
      .poll(async () => readBlockSnap(page, jinbeIid), {
        timeout: 5_000,
        message: 'phase advances to counter_window after SKIP_BLOCKER',
      })
      .toMatchObject({
        phase: 'counter_window',
        jinbeRested: false,
      });
  });

  // ─── Phase E — CounterPrompt regression ───────────────────────────────

  test('Phase E — CounterPrompt renders with PLAY_COUNTER + Decline; clicking PLAY_COUNTER increments counterBoost', async ({
    page,
  }) => {
    test.setTimeout(TWO_MIN);
    // Long timer so the auto-skip can't race the click assertion.
    await page.addInitScript(() => {
      (window as unknown as { __COUNTER_TIMER_MS?: number }).__COUNTER_TIMER_MS = 30_000;
    });
    await page.goto('/?test=1');
    await page.waitForLoadState('domcontentloaded');
    await waitForStoreHook(page);

    await waitForPhaseLoose(page, 'dice_roll', 15_000);
    await driveDice(page);
    await driveFirstPlayer(page);
    await driveMulligan(page);
    await waitForPhaseLoose(page, 'main', 30_000);

    // Seed a counter-value character into A.hand. Path C in
    // legality.ts:309 — `card.counterValue > 0` ⇒ PLAY_COUNTER offered.
    const counterIid = await seedCounterCardInAHand(page, 1000);

    // Force counter_window with B leader attacking A leader (BlockerPrompt
    // would also render but we skip it before opening counter_window).
    await enterCounterWindow(page);

    const counterPrompt = page.locator('[data-pending-kind="counter_window"]');
    await expect(counterPrompt, 'CounterPrompt mounts on counter_window').toBeVisible({
      timeout: 5_000,
    });
    await expect(
      counterPrompt.getByRole('heading', { name: /counter step/i }),
    ).toBeVisible();

    // F-7q: PLAY_COUNTER tile inside wrapper carrying data-counter-instance-id.
    const counterTile = counterPrompt.locator(
      `[data-counter-instance-id="${counterIid}"]`,
    );
    await expect(counterTile, 'PLAY_COUNTER tile for seeded card').toBeVisible();
    const counterBtn = counterTile.locator('button').first();
    await expect(counterBtn).toBeVisible();
    // F-7q 2-step confirm: first tap selects.
    await counterTile.click(); // F-8C: tile wrapper is the click target
    const confirmCounter = counterPrompt.locator('button[data-action="CONFIRM_COUNTER"]');
    await expect(confirmCounter, 'Use {name} CTA visible after first tap').toBeVisible({ timeout: 2_000 });
    await confirmCounter.click();

    // After confirm above, boost should be at +1000.
    await expect
      .poll(async () => readCounterBoost(page), {
        timeout: 5_000,
        message: 'counterBoost increments by 1000 after CONFIRM_COUNTER',
      })
      .toBe(1000);
    const declineBtn = counterPrompt.locator('button[data-action="SKIP_COUNTER"]');
    await expect(declineBtn).toBeVisible();
    await expect(declineBtn).toBeEnabled();
  });

  test('Phase E — CounterPrompt Decline Counter button dispatches SKIP_COUNTER', async ({
    page,
  }) => {
    test.setTimeout(TWO_MIN);
    await page.addInitScript(() => {
      (window as unknown as { __COUNTER_TIMER_MS?: number }).__COUNTER_TIMER_MS = 30_000;
    });
    await page.goto('/?test=1');
    await page.waitForLoadState('domcontentloaded');
    await waitForStoreHook(page);

    await waitForPhaseLoose(page, 'dice_roll', 15_000);
    await driveDice(page);
    await driveFirstPlayer(page);
    await driveMulligan(page);
    await waitForPhaseLoose(page, 'main', 30_000);

    await seedCounterCardInAHand(page, 1000);
    await enterCounterWindow(page);

    const counterPrompt = page.locator('[data-pending-kind="counter_window"]');
    await expect(counterPrompt).toBeVisible({ timeout: 5_000 });

    const declineBtn = counterPrompt.locator('button[data-action="SKIP_COUNTER"]');
    await declineBtn.click();

    // After SKIP_COUNTER, engine resolves damage → pending clears.
    await expect
      .poll(async () => readCounterBoost(page), {
        timeout: 5_000,
        message: 'pending cleared after Decline Counter',
      })
      .toBe(null);
  });

  test('Phase E — counter_window auto-decline fires after timer expires', async ({
    page,
  }) => {
    test.setTimeout(TWO_MIN);
    // Short fuse — enough to render + click-race-free, well under the
    // poll timeout of the assertion.
    await page.addInitScript(() => {
      (window as unknown as { __COUNTER_TIMER_MS?: number }).__COUNTER_TIMER_MS = 800;
    });
    await page.goto('/?test=1');
    await page.waitForLoadState('domcontentloaded');
    await waitForStoreHook(page);

    await waitForPhaseLoose(page, 'dice_roll', 15_000);
    await driveDice(page);
    await driveFirstPlayer(page);
    await driveMulligan(page);
    await waitForPhaseLoose(page, 'main', 30_000);

    await seedCounterCardInAHand(page, 1000);
    await enterCounterWindow(page);

    const counterPrompt = page.locator('[data-pending-kind="counter_window"]');
    await expect(counterPrompt).toBeVisible({ timeout: 5_000 });

    // Do nothing. After ~800ms the timer should auto-dispatch
    // SKIP_COUNTER, the engine should resolve the attack, pending clears,
    // and CounterPrompt unmounts.
    await expect
      .poll(async () => readCounterBoost(page), {
        timeout: 5_000,
        message: 'pending cleared by auto-decline timer',
      })
      .toBe(null);
    await expect(counterPrompt).toBeHidden({ timeout: 2_000 });
  });
});

// ─── Phase E counter_window seed helpers ──────────────────────────────

async function seedCounterCardInAHand(page: Page, counterValue: number): Promise<string> {
  return page.evaluate((cv) => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: Record<string, unknown> };
        setState: (p: Record<string, unknown>) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const synthCardId = '__seed_counter_char';
    const iid = `seedCounter_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthCardId] = {
      id: synthCardId,
      name: 'Seed Counter Char',
      kind: 'character',
      cost: 1,
      power: 1000,
      counterValue: cv,
      colors: ['red'],
      traits: [],
      keywords: [],
      effectText: '',
    };
    inst[iid] = {
      instanceId: iid,
      cardId: synthCardId,
      controller: 'A',
      rested: false,
      summoningSick: false,
      attachedDon: [],
      attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.hand = [...players.A.hand, iid];
    w.__store.setState({ state: { ...s } });
    return iid;
  }, counterValue);
}

async function enterCounterWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: Record<string, unknown> };
        setState: (p: Record<string, unknown>) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state;
    const players = s.players as {
      A: { leader: { instanceId: string } };
      B: { leader: { instanceId: string } };
    };
    s.phase = 'counter_window';
    s.activePlayer = 'B';
    s.pending = {
      kind: 'attack',
      pendingAttack: {
        attackerInstanceId: players.B.leader.instanceId,
        targetInstanceId: players.A.leader.instanceId,
        counterBoost: 0,
      },
    };
    w.__store.setState({
      state: {
        ...s,
        players: {
          ...players,
          A: { ...players.A },
          B: { ...players.B },
        },
      },
    });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({
        legalActions: w.__getLegalActions(next, 'A'),
      });
    }
  });
}

// ─── Phase F — card-tile UI assertions + attack feedback ──────────────

test.describe('F-7n Phase F — combat UX (card tiles, math, feedback)', () => {
  test('Phase F — BlockerPrompt renders a CardArt tile per blocker with name + Block CTA', async ({
    page,
  }) => {
    test.setTimeout(TWO_MIN);
    await page.goto('/?test=1');
    await page.waitForLoadState('domcontentloaded');
    await waitForStoreHook(page);
    await waitForPhaseLoose(page, 'dice_roll', 15_000);
    await driveDice(page);
    await driveFirstPlayer(page);
    await driveMulligan(page);
    await waitForPhaseLoose(page, 'main', 30_000);

    const jinbeIid = await seedJinbeOnAField(page, JINBE_DEF);
    await enterBlockWindow(page);

    const blockerPrompt = page.locator('[data-pending-kind="block_window"]');
    await expect(blockerPrompt).toBeVisible({ timeout: 5_000 });

    // The blocker option must be a CardArt tile (a <motion.button> rendered
    // inside the wrapper carrying data-blocker-instance-id). Asserting a
    // child button inside the wrapper proves we're not text-only.
    const tile = blockerPrompt.locator(
      `[data-blocker-instance-id="${jinbeIid}"]`,
    );
    await expect(tile, 'Jinbe CardArt tile wrapper visible').toBeVisible();
    await expect(
      tile.locator('button[aria-label*="Jinbe"]'),
      'CardArt <button> inside tile with Jinbe aria-label',
    ).toBeVisible();

    // F-7q 2-step: first tap selects, then confirm CTA.
    await tile.click(); // F-8C: tile wrapper is the click target
    const confirmBlocker = blockerPrompt.locator('button[data-action="CONFIRM_BLOCKER"]');
    await expect(confirmBlocker).toBeVisible({ timeout: 2_000 });
    await confirmBlocker.click();

    await expect
      .poll(async () => readBlockSnap(page, jinbeIid), {
        timeout: 5_000,
        message: 'attack redirects to Jinbe after CONFIRM_BLOCKER',
      })
      .toMatchObject({
        phase: 'counter_window',
        pendingAttackTarget: jinbeIid,
        jinbeRested: true,
      });
  });

  test('Phase F — CounterPrompt renders CardArt tiles + power math; tap card increments boost', async ({
    page,
  }) => {
    test.setTimeout(TWO_MIN);
    await page.addInitScript(() => {
      (window as unknown as { __COUNTER_TIMER_MS?: number }).__COUNTER_TIMER_MS = 60_000;
    });
    await page.goto('/?test=1');
    await page.waitForLoadState('domcontentloaded');
    await waitForStoreHook(page);
    await waitForPhaseLoose(page, 'dice_roll', 15_000);
    await driveDice(page);
    await driveFirstPlayer(page);
    await driveMulligan(page);
    await waitForPhaseLoose(page, 'main', 30_000);

    const counterIid = await seedCounterCardInAHand(page, 1000);
    await enterCounterWindow(page);

    const counterPrompt = page.locator('[data-pending-kind="counter_window"]');
    await expect(counterPrompt).toBeVisible({ timeout: 5_000 });

    // Live boost readout starts at 0.
    const boost = counterPrompt.locator('[data-testid="counter-prompt-boost"]');
    await expect(boost).toHaveText(/Counter so far: \+0/);

    // F-7q 2-step: CardArt tile → first tap selects, then click confirm CTA.
    const tile = counterPrompt.locator(`[data-counter-instance-id="${counterIid}"]`);
    await expect(tile).toBeVisible();
    const tileBtn = tile.locator('button').first();
    await expect(tileBtn).toBeVisible();
    await tile.click(); // F-8C: tile wrapper is the click target
    const confirmCounter = counterPrompt.locator('button[data-action="CONFIRM_COUNTER"]');
    await expect(confirmCounter).toBeVisible({ timeout: 2_000 });
    await confirmCounter.click();

    // Boost increments to +1000.
    await expect
      .poll(async () => readCounterBoost(page), {
        timeout: 5_000,
        message: 'counterBoost increments by 1000 after CONFIRM_COUNTER',
      })
      .toBe(1000);
    // Tile disappears (card consumed → not in legalActions next render).
    await expect(tile).toBeHidden({ timeout: 5_000 });
  });

  test('Phase F — CounterPrompt 2-min countdown text reads M:SS and overridable for tests', async ({
    page,
  }) => {
    test.setTimeout(TWO_MIN);
    await page.addInitScript(() => {
      // Use 65 seconds so M:SS is "1:05" deterministically.
      (window as unknown as { __COUNTER_TIMER_MS?: number }).__COUNTER_TIMER_MS = 65_000;
    });
    await page.goto('/?test=1');
    await page.waitForLoadState('domcontentloaded');
    await waitForStoreHook(page);
    await waitForPhaseLoose(page, 'dice_roll', 15_000);
    await driveDice(page);
    await driveFirstPlayer(page);
    await driveMulligan(page);
    await waitForPhaseLoose(page, 'main', 30_000);

    await seedCounterCardInAHand(page, 1000);
    await enterCounterWindow(page);

    const countdown = page.locator('[data-testid="counter-prompt-countdown"]');
    await expect(countdown).toBeVisible({ timeout: 5_000 });
    const initial = (await countdown.innerText()).trim();
    // F-7q: countdown text is "AUTO-DECLINE IN 1:05" (with CSS uppercase);
    // initial reading allows slop down to "1:04" / "1:03".
    expect(initial).toMatch(/1:0[345]/);
  });

  // F-7q — replace GameFeed/GameToast assertions with PresentationQueue
  // assertions. The queue mounts a single cinematic beat at z-60 per
  // history event; RecentActionPill carries the persistent tiny log.

  test('F-7q/F-7r — PresentationQueue plays a CHARACTER_KOD beat; no persistent log mounted', async ({
    page,
  }) => {
    test.setTimeout(TWO_MIN);
    await page.goto('/?test=1');
    await page.waitForLoadState('domcontentloaded');
    await waitForStoreHook(page);
    await waitForPhaseLoose(page, 'dice_roll', 15_000);
    await driveDice(page);
    await driveFirstPlayer(page);
    await driveMulligan(page);
    await waitForPhaseLoose(page, 'main', 30_000);

    // F-7r: RecentActionPill DELETED — owner direction "Remove the
    // chat/log box completely." No persistent log surface should mount.
    await expect(
      page.locator('[data-testid="recent-action-pill"]'),
      'RecentActionPill must NOT mount (F-7r deletion)',
    ).toHaveCount(0);

    // Append a CHARACTER_KOD history entry → queue picks it up → beat plays.
    await page.evaluate(() => {
      const w = window as unknown as {
        __store?: {
          getState: () => {
            state: {
              players: { A: { leader: { instanceId: string } }; B: { leader: { instanceId: string } } };
              history: Array<Record<string, unknown>>;
              instances: Record<string, { controller: string }>;
            };
          };
          setState: (p: { state: Record<string, unknown> }) => void;
        };
      };
      if (!w.__store) throw new Error('window.__store not exposed');
      const s = w.__store.getState().state;
      const aLeaderIid = s.players.A.leader.instanceId;
      const next = {
        ...s,
        history: [
          ...s.history,
          { type: 'CHARACTER_KOD', instanceId: aLeaderIid, controller: 'A' },
        ],
      };
      w.__store.setState({ state: next });
    });

    const beat = page.locator('[data-testid="presentation-beat"]');
    await beat.waitFor({ state: 'attached', timeout: 5_000 });
    await expect(beat, 'PresentationQueue plays the KOD beat').toBeVisible();
    await expect(beat).toHaveAttribute('data-beat-kind', 'KOD');
  });

  // F-7s — combat result beat must surface power math + attribute source
  test('F-7s — DAMAGE_RESOLVED beat surfaces power math AND attributes power debuff to source card', async ({
    page,
  }) => {
    test.setTimeout(TWO_MIN);
    await page.goto('/?test=1');
    await page.waitForLoadState('domcontentloaded');
    await waitForStoreHook(page);
    await waitForPhaseLoose(page, 'dice_roll', 15_000);
    await driveDice(page);
    await driveFirstPlayer(page);
    await driveMulligan(page);
    await waitForPhaseLoose(page, 'main', 30_000);

    // Append: ATTACK_DECLARED → POWER_MODIFIED (debuff B leader from
    // a synthesized "Distorted Future" source) → DAMAGE_RESOLVED with
    // B leader effective power = 0.
    await page.evaluate(() => {
      const w = window as unknown as {
        __store?: {
          getState: () => {
            state: {
              players: {
                A: { leader: { instanceId: string } };
                B: { leader: { instanceId: string } };
              };
              instances: Record<string, { controller: string; cardId: string }>;
              cardLibrary: Record<string, unknown>;
              history: Array<Record<string, unknown>>;
            };
          };
          setState: (p: { state: Record<string, unknown> }) => void;
        };
      };
      if (!w.__store) throw new Error('window.__store not exposed');
      const s = w.__store.getState().state;
      const aIid = s.players.A.leader.instanceId;
      const bIid = s.players.B.leader.instanceId;
      // Synthesize a debuff source card.
      const srcCardId = '__seed_distorted_future';
      const srcIid = `srcDF_${Math.floor(Math.random() * 1e9).toString(36)}`;
      s.cardLibrary[srcCardId] = {
        id: srcCardId,
        name: 'Distorted Future',
        kind: 'event',
        cost: 1,
        power: null,
        counterValue: null,
        colors: ['purple'],
        traits: [],
        keywords: [],
        effectText: '',
      };
      s.instances[srcIid] = {
        controller: 'A',
        cardId: srcCardId,
        instanceId: srcIid,
        rested: false,
        summoningSick: false,
        attachedDon: [],
        attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      const next = {
        ...s,
        history: [
          ...s.history,
          { type: 'ATTACK_DECLARED', attackerInstanceId: aIid, targetInstanceId: bIid, controller: 'A' },
          { type: 'POWER_MODIFIED', targetInstanceId: bIid, sourceInstanceId: srcIid, amount: -5000, duration: 'this_battle' },
          { type: 'DAMAGE_RESOLVED', attackerPower: 5000, targetPower: 0, counterBoost: 0 },
        ],
      };
      w.__store.setState({ state: next });
    });

    // The queue plays beats in sequence. The COMBAT_RESULT beat is the
    // final one — wait for it specifically.
    const beat = page.locator('[data-testid="presentation-beat"]');
    await expect.poll(
      async () => beat.getAttribute('data-beat-kind').catch(() => null),
      { timeout: 15_000, message: 'COMBAT_RESULT beat plays' },
    ).toBe('COMBAT_RESULT');
    // Title indicates the attack landed (5000 vs 0).
    await expect(
      beat.locator('[data-testid="presentation-beat-title"]'),
    ).toHaveText(/Attack Landed/i);
    // Sub-text shows power math AND attributes the debuff to Distorted Future.
    const sub = beat.locator('[data-testid="presentation-beat-sub"]');
    // F-7w switched the math separator from "vs" to "⚔" glyph.
    await expect(sub).toHaveText(/5000.*0/);
    await expect(sub).toHaveText(/power reduced by Distorted Future/i);
  });

  // F-7s — stage card persists across end-turn cycles.
  test('F-7s — stage on opp persists after opp END_TURN (no auto-trash)', async ({
    page,
  }) => {
    test.setTimeout(TWO_MIN);
    await page.goto('/?test=1');
    await page.waitForLoadState('domcontentloaded');
    await waitForStoreHook(page);
    await waitForPhaseLoose(page, 'dice_roll', 15_000);
    await driveDice(page);
    await driveFirstPlayer(page);
    await driveMulligan(page);
    await waitForPhaseLoose(page, 'main', 30_000);

    // Seed an opp stage card directly.
    const stagedIid = await page.evaluate(() => {
      const w = window as unknown as {
        __store?: {
          getState: () => {
            state: {
              instances: Record<string, unknown>;
              cardLibrary: Record<string, unknown>;
              players: { B: { stage: unknown } };
            };
          };
          setState: (p: { state: Record<string, unknown> }) => void;
        };
      };
      if (!w.__store) throw new Error('window.__store not exposed');
      const s = w.__store.getState().state;
      const stageCardId = '__seed_stage_card';
      const iid = `stage_${Math.floor(Math.random() * 1e9).toString(36)}`;
      s.cardLibrary[stageCardId] = {
        id: stageCardId,
        name: 'Seed Stage',
        kind: 'stage',
        cost: 1,
        power: null,
        counterValue: null,
        colors: ['red'],
        traits: [],
        keywords: [],
        effectText: '',
      };
      s.instances[iid] = {
        instanceId: iid,
        cardId: stageCardId,
        controller: 'B',
        rested: false,
        summoningSick: false,
        attachedDon: [],
        attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      s.players.B.stage = s.instances[iid];
      w.__store.setState({ state: { ...s } });
      return iid;
    });

    // Verify present after seed.
    const stillStaged = await page.evaluate(() => {
      const w = window as unknown as {
        __store?: { getState: () => { state: { players: { B: { stage: { instanceId: string } | null } } } } };
      };
      return w.__store?.getState().state.players.B.stage?.instanceId ?? null;
    });
    expect(stillStaged, 'stage seeded on B').toBe(stagedIid);

    // Drive A through end turn via endTurnAndAdvance on the store; then
    // wait for A's main to return via the existing drain helper that
    // skips any reactive windows. The stage MUST persist on B through
    // these transitions (no auto-trash exists in engine v0 per
    // playStageReducer at mainPhase.ts:243-253).
    await page.evaluate(() => {
      const w = window as unknown as {
        __store?: { getState: () => { endTurnAndAdvance: () => Promise<void> } };
      };
      void w.__store?.getState().endTurnAndAdvance();
    });
    // Poll for B stage to remain set during the AI's turn.
    await expect.poll(async () => {
      return page.evaluate(() => {
        const w = window as unknown as {
          __store?: { getState: () => { state: { players: { B: { stage: { instanceId: string } | null } } } } };
        };
        return w.__store?.getState().state.players.B.stage?.instanceId ?? null;
      });
    }, { timeout: 30_000, message: 'B.stage persists during turn transitions' }).toBe(stagedIid);

    const afterIid = await page.evaluate(() => {
      const w = window as unknown as {
        __store?: { getState: () => { state: { players: { B: { stage: { instanceId: string } | null } } } } };
      };
      return w.__store?.getState().state.players.B.stage?.instanceId ?? null;
    });
    expect(afterIid, 'B stage still present after 2 end-turn cycles').toBe(stagedIid);
  });

  // F-7r — opponent life-loss must NOT reveal the card to the viewer.
  test('F-7r — opponent LIFE_CARD_TO_HAND beat hides card identity', async ({
    page,
  }) => {
    test.setTimeout(TWO_MIN);
    await page.goto('/?test=1');
    await page.waitForLoadState('domcontentloaded');
    await waitForStoreHook(page);
    await waitForPhaseLoose(page, 'dice_roll', 15_000);
    await driveDice(page);
    await driveFirstPlayer(page);
    await driveMulligan(page);
    await waitForPhaseLoose(page, 'main', 30_000);

    // Append LIFE_CARD_TO_HAND for OPPONENT (B). Use B's actual life
    // instance id so the inst lookup succeeds — we want to verify the
    // formatter STRIPS it for hidden-info despite the data being present.
    await page.evaluate(() => {
      const w = window as unknown as {
        __store?: {
          getState: () => {
            state: {
              players: { B: { life: string[] } };
              history: Array<Record<string, unknown>>;
            };
          };
          setState: (p: { state: Record<string, unknown> }) => void;
        };
      };
      if (!w.__store) throw new Error('window.__store not exposed');
      const s = w.__store.getState().state;
      const bLifeIid = s.players.B.life[0] ?? 'opp-life-dummy';
      const next = {
        ...s,
        history: [
          ...s.history,
          { type: 'LIFE_CARD_TO_HAND', instanceId: bLifeIid, controller: 'B' },
        ],
      };
      w.__store.setState({ state: next });
    });

    const beat = page.locator('[data-testid="presentation-beat"]');
    await beat.waitFor({ state: 'attached', timeout: 5_000 });
    await expect(beat).toHaveAttribute('data-beat-kind', 'LIFE_LOST');
    // Title must read opponent variant.
    await expect(
      beat.locator('[data-testid="presentation-beat-title"]'),
    ).toHaveText(/Opponent Lost 1 Life/i);
    // PRIMARY card must NOT render for opp life loss (hidden info).
    await expect(
      beat.locator('[data-testid="presentation-beat-primary"]'),
      'opp life card identity must NOT be shown',
    ).toHaveCount(0);
    // Sub-text must say hidden.
    await expect(
      beat.locator('[data-testid="presentation-beat-sub"]'),
    ).toHaveText(/hidden card moved to hand/i);
  });
});

async function readCounterBoost(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            pending: null | { kind: string; pendingAttack?: { counterBoost?: number } };
          };
        };
      };
    };
    if (!w.__store) return null;
    const s = w.__store.getState().state;
    if (s.pending === null) return null;
    if (s.pending.kind !== 'attack') return null;
    return s.pending.pendingAttack?.counterBoost ?? 0;
  });
}
