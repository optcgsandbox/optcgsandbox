// family-blocker — Stage A representative anchor for the blocker
// mechanic family. Verifies OP01-014 Jinbe's `blocker` keyword:
//   `[Blocker] (After your opponent declares an attack, you may rest
//    this card to make it the new target of the attack.)`
//
// Engine path:
//   - `blocker` keyword is part of card.keywords; legality.ts:259-264
//     enumerates DECLARE_BLOCKER actions for every active blocker on
//     the defender's field.
//   - declareBlockerReducer redirects pendingAttack.targetInstanceId →
//     blocker, rests the blocker, transitions phase to counter_window.
//     Source: shared/engine-v2/reducers/attackFlow.ts:260-295.
//   - skipCounterReducer drives resolveDamage; CR §7-2 rule
//     `attackerPower >= targetPower` means 5000 vs 5000 ⇒ success.
//     Source: shared/engine-v2/reducers/attackFlow.ts:437-509.
//   - Block_window auto-skip in store/game.ts:501-510 ONLY fires when
//     reactive is AI; reactive=A (human) ⇒ flow halts at block_window
//     and the BlockerPrompt / AttackResolutionOverlay mounts.
//
// Anchor card data (OP01-014):
//   character, red, cost 4, power 5000, keywords:['blocker'].
//   Also has a [DON x1] on_block bonus clause (play_for_free) gated
//   by `if_attached_don_min:1` — NOT exercised here (Jinbe has 0
//   DON attached in this scenario), so the bonus stays quiet.
//
// Per directive 2026-06-06: harness-only. No engine / UI / card-data /
// scenarioFactory changes. Test runs <2 min.

import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const TWO_MIN = 2 * 60_000;

test.use({
  launchOptions: {
    args: ['--disable-renderer-backgrounding', '--no-sandbox'],
  },
});

interface Bootstrap {
  drv: PlayerDriver;
  pageErrors: string[];
  invariantErrors: string[];
}

async function bootstrap(page: Page): Promise<Bootstrap> {
  const pageErrors: string[] = [];
  const invariantErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('InvariantError') || t.includes('invariant')) invariantErrors.push(t);
  });
  const drv = new PlayerDriver(page);
  await drv.open();
  await drv.waitForPhase('dice_roll');
  await drv.rollDice();
  try { await drv.waitForPhase('first_player_choice', 15_000); await drv.chooseGoFirst(); } catch {}
  try { await drv.waitForPhase('mulligan', 8_000); await drv.keepMulliganHand(); } catch {}
  await expect.poll(
    async () => {
      const s = await drv.getState();
      return { phase: s.phase, activePlayer: s.activePlayer };
    },
    { timeout: 60_000, message: 'A did not reach main' },
  ).toMatchObject({ phase: 'main', activePlayer: 'A' });
  // Normalize dice RNG variance — see helpers/player.ts::normalizeToATurn1Main.
  await drv.normalizeToATurn1Main();
  return { drv, pageErrors, invariantErrors };
}

const OP01_014_DEF = {
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
  effectText: '[Blocker] ...',
  effectSpecV2: {
    clauses: [],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'human-reviewed',
  },
};

// Seed Jinbe on A.field with the real OP01-014 card def (injected if
// not already in cardLibrary). keywords:['blocker'] is sufficient for
// legality.ts:261's hasKeyword check; the continuous grant clause is
// a duplicate path, not required here.
async function seedJinbeOnField(page: Page, def: unknown): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: unknown };
        setState: (p: { state: unknown } | { legalActions: unknown }) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    if (!lib['OP01-014']) lib['OP01-014'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] } };
    const iid = `seedJinbe_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-014', controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.field = [...players.A.field, inst[iid]];
    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, def);
}

async function seedNonBlockerOnField(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: unknown };
        setState: (p: { state: unknown } | { legalActions: unknown }) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] } };
    const synthId = `__seed_nonblocker_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedNonBlocker_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: 'NonBlocker A', kind: 'character',
      cost: 1, power: 3000, counterValue: 1000,
      colors: ['red'],
      traits: [],
      keywords: [],
      effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.field = [...players.A.field, inst[iid]];
    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  });
}

// Engineer block_window with B leader attacking A leader. Bypasses
// END_TURN→AI cycle so the test is deterministic.
async function enterBlockWindow(page: Page): Promise<{
  bAttackerIid: string;
  aLeaderIid: string;
}> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: unknown };
        setState: (p: { state: unknown } | { legalActions: unknown }) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state as Record<string, unknown>;
    const players = s.players as {
      A: { leader: { instanceId: string } };
      B: { leader: { instanceId: string } };
    };
    const bAttackerIid = players.B.leader.instanceId;
    const aLeaderIid = players.A.leader.instanceId;
    (s as Record<string, unknown>).phase = 'block_window';
    (s as Record<string, unknown>).activePlayer = 'B';
    (s as Record<string, unknown>).pending = {
      kind: 'attack',
      pendingAttack: {
        attackerInstanceId: bAttackerIid,
        targetInstanceId: aLeaderIid,
        counterBoost: 0,
      },
    };
    // New ref so Zustand selectors re-render the overlay + prompts.
    w.__store.setState({ state: { ...s, players: { ...players, A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      // F-7q fix: in block_window the REACTIVE player is the defender,
      // not the active (attacker) player. Pre-fix this passed
      // next.activePlayer ('B'), which returns just [CONCEDE]. The new
      // BlockerPrompt reads store.legalActions directly to decide whether
      // to mount, exposing the bug — old AttackResolutionOverlay didn't
      // care because it gated on phase alone.
      const next = w.__store.getState().state as { activePlayer: string };
      const reactive = next.activePlayer === 'A' ? 'B' : 'A';
      w.__store.setState({ legalActions: w.__getLegalActions(next, reactive) });
    }
    return { bAttackerIid, aLeaderIid };
  });
}

async function legalActionsFor(page: Page, player: 'A' | 'B'): Promise<unknown[]> {
  return page.evaluate((p) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown } };
      __getLegalActions?: (s: unknown, p: string) => unknown[];
    };
    if (!w.__store || !w.__getLegalActions) return [];
    const s = w.__store.getState().state;
    return w.__getLegalActions(s, p);
  }, player);
}

async function dispatchAs(page: Page, action: object): Promise<void> {
  await page.evaluate((a) => {
    const w = window as unknown as {
      __store?: { getState: () => { dispatch: (a: unknown) => void } };
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    w.__store.getState().dispatch(a);
  }, action);
  await page.waitForTimeout(200);
}

interface FullSnap {
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
  pendingAttackTarget: string | null;
  aFieldIds: string[];
  aTrashIds: string[];
  aLeaderLife: number;
  jinbeRested: boolean | null;
}

async function readSnap(page: Page, jinbeIid: string): Promise<FullSnap> {
  return page.evaluate((jid) => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            activePlayer: string;
            pending: { kind?: string; pendingAttack?: { targetInstanceId?: string } } | null;
            players: {
              A: {
                field: { instanceId: string }[];
                trash: string[];
                life: string[];
                leader: { instanceId: string };
              };
            };
            instances: Record<string, { rested?: boolean }>;
          };
        };
      };
    };
    if (!w.__store) {
      return { phase: '', activePlayer: '', pendingKind: null, pendingAttackTarget: null, aFieldIds: [], aTrashIds: [], aLeaderLife: -1, jinbeRested: null };
    }
    const s = w.__store.getState().state;
    const jinbe = s.instances[jid];
    return {
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
      pendingAttackTarget: s.pending?.pendingAttack?.targetInstanceId ?? null,
      aFieldIds: s.players.A.field.map((i) => i.instanceId),
      aTrashIds: [...s.players.A.trash],
      aLeaderLife: s.players.A.life.length,
      jinbeRested: jinbe ? (jinbe.rested ?? null) : null,
    };
  }, jinbeIid);
}

async function readAttackOverlayVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return Boolean(document.querySelector('[aria-label="Attack resolution"]'));
  });
}

async function isOnYourField(page: Page, iid: string): Promise<boolean> {
  return page.evaluate((id) => {
    const btns = Array.from(document.querySelectorAll(`button[data-instance-id="${id}"]`));
    for (const b of btns) {
      let el: Element | null = b.parentElement;
      let inField = false;
      let inYourHalf = false;
      let depth = 0;
      while (el && depth < 20) {
        const label = el.getAttribute('aria-label') ?? '';
        if (label.startsWith('Character area')) inField = true;
        if (label === 'Your half') inYourHalf = true;
        el = el.parentElement;
        depth += 1;
      }
      if (inField && inYourHalf) return true;
    }
    return false;
  }, iid);
}

async function readYourLifeUi(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[aria-label]'));
    for (const el of els) {
      const m = (el.getAttribute('aria-label') ?? '').match(/Your life:\s*(\d+)/i);
      if (m) return parseInt(m[1]!, 10);
    }
    return null;
  });
}

test.describe('family-blocker (Stage A)', () => {
  test('OP01-014 Jinbe blocker keyword: redirects attack from leader → Jinbe, Jinbe rests then KO\'d', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // ── Seed scene ───────────────────────────────────────────────────
    const jinbeIid = await seedJinbeOnField(page, OP01_014_DEF);
    const nonBlockerIid = await seedNonBlockerOnField(page);

    // ── Enter block_window with B leader → A leader attack ─────────
    const { bAttackerIid, aLeaderIid } = await enterBlockWindow(page);

    // ── BEFORE block ────────────────────────────────────────────────
    const before = await readSnap(page, jinbeIid);
    expect(before.phase, 'phase=block_window').toBe('block_window');
    expect(before.activePlayer, 'B is attacker').toBe('B');
    expect(before.pendingKind, 'attack pending').toBe('attack');
    expect(before.pendingAttackTarget, 'pending attack targets A leader').toBe(aLeaderIid);
    expect(before.aFieldIds, 'Jinbe on A field').toContain(jinbeIid);
    expect(before.aFieldIds, 'non-blocker on A field').toContain(nonBlockerIid);
    expect(before.jinbeRested, 'Jinbe active before block').toBe(false);
    const lifeBefore = before.aLeaderLife;
    const trashBefore = before.aTrashIds.length;
    const lifeUiBefore = await readYourLifeUi(page);

    // Legality enumeration for A (reactive). Must include
    // DECLARE_BLOCKER for Jinbe only, plus SKIP_BLOCKER.
    const aLegal = await legalActionsFor(page, 'A') as { type: string; blockerInstanceId?: string }[];
    const blockerActions = aLegal.filter((a) => a.type === 'DECLARE_BLOCKER');
    const blockerIds = blockerActions.map((a) => a.blockerInstanceId);
    expect(blockerIds, 'Jinbe offered as blocker').toContain(jinbeIid);
    expect(blockerIds, 'non-blocker NOT offered as blocker').not.toContain(nonBlockerIid);
    expect(aLegal.some((a) => a.type === 'SKIP_BLOCKER'), 'SKIP_BLOCKER offered').toBe(true);
    expect(bAttackerIid, 'B leader is attacker').toBeTruthy();

    // F-7q UI surface change: AttackResolutionOverlay was deleted;
    // BlockerPrompt is the sole block_window surface now.
    await expect.poll(
      async () => Boolean(await page.locator('[data-pending-kind="block_window"]').count()),
      { timeout: 5_000, message: 'BlockerPrompt mounts in block_window' },
    ).toBe(true);

    // ── Dispatch DECLARE_BLOCKER for Jinbe ──────────────────────────
    await dispatchAs(page, { type: 'DECLARE_BLOCKER', blockerInstanceId: jinbeIid });

    // Engine: target redirected, Jinbe rested, phase counter_window.
    const mid = await readSnap(page, jinbeIid);
    expect(mid.phase, 'phase = counter_window after block').toBe('counter_window');
    expect(mid.pendingKind, 'pending still attack').toBe('attack');
    expect(mid.pendingAttackTarget, 'pending target redirected to Jinbe').toBe(jinbeIid);
    expect(mid.jinbeRested, 'Jinbe rested after declare').toBe(true);
    expect(mid.aLeaderLife, 'A leader life unchanged at block').toBe(lifeBefore);

    // ── Skip counter → damage resolves on Jinbe ─────────────────────
    await dispatchAs(page, { type: 'SKIP_COUNTER' });

    // Engine: 5000 (B leader) >= 5000 (Jinbe) → Jinbe KO'd → A.trash.
    const after = await readSnap(page, jinbeIid);
    expect(after.aFieldIds, 'Jinbe no longer on A field').not.toContain(jinbeIid);
    expect(after.aFieldIds, 'non-blocker still on A field').toContain(nonBlockerIid);
    expect(after.aTrashIds, 'Jinbe in A trash').toContain(jinbeIid);
    expect(after.aTrashIds.length, 'A trash +1').toBe(trashBefore + 1);
    expect(after.aLeaderLife, 'A leader life UNCHANGED (block saved leader)').toBe(lifeBefore);
    expect(after.pendingKind, 'pending cleared').toBeNull();
    expect(after.phase, 'phase restored to main').toBe('main');

    // ── UI ───────────────────────────────────────────────────────────
    // BlockerPrompt gone after pending clears.
    await expect.poll(
      async () => Boolean(await page.locator('[data-pending-kind="block_window"]').count()),
      { timeout: 5_000, message: 'BlockerPrompt dismissed after damage resolves' },
    ).toBe(false);

    // Jinbe gone from field UI; non-blocker still present.
    await expect.poll(
      async () => isOnYourField(page, jinbeIid),
      { timeout: 5_000, message: 'Jinbe removed from your field UI' },
    ).toBe(false);
    expect(await isOnYourField(page, nonBlockerIid), 'non-blocker still on your field').toBe(true);

    // Life UI unchanged.
    const lifeUiAfter = await readYourLifeUi(page);
    if (lifeUiBefore !== null && lifeUiAfter !== null) {
      expect(lifeUiAfter, 'A leader life UI unchanged').toBe(lifeUiBefore);
    }

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
