// family-cost-reduction — Stage A representative anchor for the
// cost_reduction mechanic family. Verifies OP02-106 Tsuru's on_play
// clause:
//   `[On Play] Give up to 1 of your opponent's Characters -2 cost
//    during this turn.`
//
// Engine sources:
//   - removal_cost_reduce handler writes negative costModifierOneShot
//     to each target and sets costModifierExpiresInTurns per duration.
//     Source: shared/engine-v2/registry/handlers/actions3.ts:497-510.
//   - End-of-turn tick clears costModifierOneShot when
//     expiresInTurns===0. Source:
//     shared/engine-v2/phases/PhaseScheduler.ts:262-266.
//   - opp_character resolver picks first eligible opp char (V0
//     deterministic). Source:
//     shared/engine-v2/registry/handlers/targets.ts:87-92.
//
// UI cost display: CardArt aria-label `cost ${card.cost}` and the
// visual cost square at src/components/CardArt.tsx:214 / :426 read
// STATIC `card.cost`. No runtime `costModifierOneShot` rendering. UI
// effective cost display is **NOT_EXPOSED** for field characters.
// Same static-read pattern as the pre-STEP1 power display bug (which
// was fixed via effectivePowerForDisplay). Cost display has not been
// migrated to a runtime equivalent yet — engine modifier is correct;
// UI parity is missing. Documented here as a latent UI follow-up, not
// classified as a PRODUCT_BUG against this Stage A anchor.
//
// Anchor pre-check: no OP01 cost_reduction card; OP02-106 Tsuru is the
// cleanest in the corpus (single clause, no cost / cond / opt, V0
// deterministic target resolver).
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
  return { drv, pageErrors, invariantErrors };
}

const OP02_106_DEF = {
  id: 'OP02-106',
  name: 'Tsuru',
  kind: 'character',
  colors: ['black'],
  cost: 1,
  power: 0,
  counterValue: 2000,
  traits: ['Navy'],
  keywords: ['on_play'],
  effectTags: ['removal_cost_reduce'],
  effectText: "[On Play] Give up to 1 of your opponent's Characters -2 cost during this turn.",
  effectSpecV2: {
    clauses: [
      {
        trigger: 'on_play',
        action: { kind: 'removal_cost_reduce', magnitude: 2, duration: 'this_turn' },
        target: { kind: 'opp_character' },
        verified: 'auto',
      },
    ],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'human-reviewed',
  },
};

async function seedTsuruInHand(page: Page, def: unknown): Promise<string> {
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
    if (!lib['OP02-106']) lib['OP02-106'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedTsuru_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP02-106', controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.hand = [...players.A.hand, iid];
    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, def);
}

// Seed a B character with given cost + tag for ordering.
async function seedOppFieldChar(page: Page, cost: number, tag: string): Promise<string> {
  return page.evaluate(({ cost, tag }) => {
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
    const players = s.players as { B: { field: unknown[] } };
    const synthId = `__seed_cr_b_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedCRb_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: `CR B ${tag}`, kind: 'character',
      cost, power: 3000, counterValue: 1000,
      colors: ['red'],
      traits: [],
      keywords: [],
      effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: 'B',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.B.field = [...players.B.field, inst[iid]];
    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, { cost, tag });
}

async function playFromHand(page: Page, iid: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as {
      __store?: { getState: () => { dispatch: (a: unknown) => void } };
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    w.__store.getState().dispatch({ type: 'PLAY_CARD', instanceId: id, replaceTargetId: null });
  }, iid);
  await page.waitForTimeout(400);
}

interface InstSnap {
  exists: boolean;
  costModifierOneShot: number | null;
  costModifierExpiresInTurns: number | null;
  cardCost: number | null;
  effectiveCost: number;
}

async function readInst(page: Page, iid: string): Promise<InstSnap> {
  return page.evaluate((id) => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            instances: Record<string, {
              cardId: string;
              costModifierOneShot?: number | null;
              costModifierExpiresInTurns?: number | null;
            }>;
            cardLibrary: Record<string, { cost?: number | null }>;
          };
        };
      };
    };
    if (!w.__store) return { exists: false, costModifierOneShot: null, costModifierExpiresInTurns: null, cardCost: null, effectiveCost: -1 };
    const inst = w.__store.getState().state.instances[id];
    if (!inst) return { exists: false, costModifierOneShot: null, costModifierExpiresInTurns: null, cardCost: null, effectiveCost: -1 };
    const card = w.__store.getState().state.cardLibrary[inst.cardId];
    const cardCost = card?.cost ?? null;
    const mod = inst.costModifierOneShot ?? 0;
    const effective = (cardCost ?? 0) + mod;
    return {
      exists: true,
      costModifierOneShot: inst.costModifierOneShot ?? null,
      costModifierExpiresInTurns: inst.costModifierExpiresInTurns ?? null,
      cardCost,
      effectiveCost: effective,
    };
  }, iid);
}

interface Snap {
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
  turn: number;
  aFieldIds: string[];
  aHandIds: string[];
}

async function readSnap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            activePlayer: string;
            pending: { kind?: string } | null;
            turn: number;
            players: { A: { hand: string[]; field: { instanceId: string }[] } };
          };
        };
      };
    };
    if (!w.__store) return { phase: '', activePlayer: '', pendingKind: null, turn: -1, aFieldIds: [], aHandIds: [] };
    const s = w.__store.getState().state;
    return {
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
      turn: s.turn,
      aFieldIds: s.players.A.field.map((i) => i.instanceId),
      aHandIds: [...s.players.A.hand],
    };
  });
}

// UI cost from CardArt aria-label `cost N`. Note: this is STATIC
// `card.cost` per CardArt.tsx:214; does not reflect runtime
// costModifierOneShot. Used here to verify UI shows the STATIC value
// even after the engine modifier applies (classification: NOT_EXPOSED
// for effective cost).
async function readDomCost(page: Page, iid: string): Promise<number | null> {
  return page.evaluate((id) => {
    const btn = document.querySelector(`button[data-instance-id="${id}"]`);
    if (!btn) return null;
    const m = (btn.getAttribute('aria-label') ?? '').match(/cost\s+(\d+)/i);
    return m ? parseInt(m[1]!, 10) : null;
  }, iid);
}

test.describe('family-cost-reduction (Stage A)', () => {
  test('OP02-106 Tsuru on_play: -2 cost (this_turn) to first opp char; UI cost STATIC (NOT_EXPOSED for effective); expires at end of turn', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);

    // ── Seed scene ───────────────────────────────────────────────────
    // B target char (first in B.field, picked by opp_character resolver).
    const bTargetIid = await seedOppFieldChar(page, 4, 'target');
    // B control char (second in B.field, untouched).
    const bControlIid = await seedOppFieldChar(page, 4, 'control');
    // Tsuru in A.hand.
    const tsuruIid = await seedTsuruInHand(page, OP02_106_DEF);

    // ── BEFORE ──────────────────────────────────────────────────────
    const pre = await readSnap(page);
    expect(pre.phase, 'phase=main').toBe('main');
    expect(pre.activePlayer, 'A turn').toBe('A');
    expect(pre.pendingKind, 'no pending').toBeNull();
    expect(pre.aHandIds, 'Tsuru in A hand').toContain(tsuruIid);
    const turnBefore = pre.turn;

    const targetBefore = await readInst(page, bTargetIid);
    const controlBefore = await readInst(page, bControlIid);
    expect(targetBefore.cardCost, 'B target printed cost = 4').toBe(4);
    expect(targetBefore.costModifierOneShot, 'B target costModifierOneShot = null before').toBeNull();
    expect(targetBefore.effectiveCost, 'B target effective cost = 4 before').toBe(4);
    expect(controlBefore.cardCost, 'B control printed cost = 4').toBe(4);
    expect(controlBefore.effectiveCost, 'B control effective cost = 4 before').toBe(4);

    const targetDomBefore = await readDomCost(page, bTargetIid);
    const controlDomBefore = await readDomCost(page, bControlIid);
    expect(targetDomBefore, 'B target DOM cost = 4 before').toBe(4);
    expect(controlDomBefore, 'B control DOM cost = 4 before').toBe(4);

    // ── Play Tsuru ──────────────────────────────────────────────────
    await playFromHand(page, tsuruIid);

    // ── AFTER ───────────────────────────────────────────────────────
    const after = await readSnap(page);

    // Engine: Tsuru on A.field.
    expect(after.aFieldIds, 'Tsuru on A field').toContain(tsuruIid);
    expect(after.aHandIds, 'Tsuru no longer in A hand').not.toContain(tsuruIid);
    expect(after.pendingKind, 'no pending after on_play').toBeNull();
    expect(after.phase, 'phase still main').toBe('main');
    expect(after.activePlayer, 'still A turn').toBe('A');

    // Engine: B target costModifierOneShot = -2, expires this_turn (0).
    const targetAfter = await readInst(page, bTargetIid);
    expect(targetAfter.costModifierOneShot, 'B target costModifierOneShot = -2').toBe(-2);
    expect(targetAfter.costModifierExpiresInTurns, 'expiresInTurns = 0 (this_turn)').toBe(0);
    expect(targetAfter.effectiveCost, 'B target effective cost = 2').toBe(2);

    // Scope: B control unchanged (resolver picked first eligible only).
    const controlAfter = await readInst(page, bControlIid);
    expect(controlAfter.costModifierOneShot, 'B control unchanged').toBeNull();
    expect(controlAfter.effectiveCost, 'B control effective cost = 4').toBe(4);

    // UI: cost display still shows STATIC card.cost (NOT_EXPOSED for
    // effective cost). Verify aria-label still reads `cost 4` even
    // after engine modifier applies.
    const targetDomAfter = await readDomCost(page, bTargetIid);
    const controlDomAfter = await readDomCost(page, bControlIid);
    expect(targetDomAfter, 'B target DOM cost STATIC = 4 (NOT_EXPOSED for effective)').toBe(4);
    expect(controlDomAfter, 'B control DOM cost = 4').toBe(4);

    // ── End A's turn → tick clears costModifierOneShot ─────────────
    await drv.endTurn();
    await expect.poll(
      async () => {
        const s = await readSnap(page);
        if (s.activePlayer === 'B') return 'B';
        if (s.turn > turnBefore) return 'cycledBackToA';
        return s.activePlayer + '/' + s.turn;
      },
      { timeout: 30_000 },
    ).toMatch(/^B$|^cycledBackToA$/);

    // Engine: modifier cleared.
    const targetExpired = await readInst(page, bTargetIid);
    expect(targetExpired.costModifierOneShot, 'B target costModifierOneShot cleared at end of turn').toBeNull();
    expect(targetExpired.effectiveCost, 'B target effective cost back to 4').toBe(4);

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
