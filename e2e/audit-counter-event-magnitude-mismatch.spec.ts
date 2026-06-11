// audit-counter-event-magnitude-mismatch — Manual-review-backlog Group 1C.
//
// Goal: per-card empirical capture of how each magnitude-mismatch
// counter event behaves in
//   1. condition-FALSE state (where a condition exists)
//   2. condition-TRUE state (where a condition exists)
//   3. cost-payable state (always — these cards have no clause cost,
//      but the card cost itself must be payable to enter PLAY_COUNTER)
// and recommend the correct card-data remediation per card.
//
// Engine path (per Stage A + Stage B audits):
//   - playCounterReducer: pay DON, hand→trash, ADD counterEventBoost
//     to pendingAttack.counterBoost, then dispatch on_play clauses.
//     `shared/engine-v2/reducers/attackFlow.ts:317-411`.
//   - on_play `power_buff` (alias of `give_power`) with
//     `duration:'this_battle'` writes target.powerModifierThisBattle;
//     `duration:'this_turn'` writes target.powerModifierOneShot.
//     `shared/engine-v2/registry/handlers/actions.ts:75-103`,
//     `shared/engine-v2/registry/handlers/actions3.ts:67-69`.
//   - effectivePower at damage = baseTargetPower (incl. *all* modifier
//     slots) + counterBoost. `attackFlow.ts:437-465`.
//   - V0 deterministic resolver for `your_leader_or_character` picks
//     leader FIRST when count=1, then characters in field order.
//     `shared/engine-v2/registry/handlers/targets.ts:75-86`.
//
// Group 1C cards audited (10):
//   OP01-029 Radical Beam!!         — boost 4000, clauses 2000 + 2000 (if_own_life_max:2)
//   OP04-095 Barrier!!              — boost 4000, clauses 2000 + 2000 (if_trash_min:15)
//   OP05-114 El Thor                — boost 4000, clauses 2000 + 2000 (if_opp_life_max:2)
//   OP06-038 Trichil                — boost 4000, clauses 2000 (UNCONDITIONAL ONLY)
//   OP07-035 Karmic Punishment      — boost 3000, clauses 2000 + 1000 (if_own_chars_min:3)
//   OP07-095 Iron Body              — boost 6000, clauses 4000 + 2000 (if_trash_min:10)
//   OP11-019 Glorp Web!!            — boost 2000, clauses 1000 this_turn (if_opp_chars_min_power:6000)
//   OP11-020 X Calibur              — boost 2000, clauses 1000 this_turn (if_opp_chars_min_power:6000)
//   OP11-059 Gum-Gum King Cobra     — boost 4000, clauses 2000 + 2000 (if_hand_max:4)
//   OP12-098 Hair Removal Fist      — boost 4000, clauses 2000 + 2000 (if_own_chars_min_cost:8) target your_character/Rev Army
//
// AUDIT semantics:
//   - Test PASSES when data captured cleanly per subcase.
//   - Test FAILS only on infra/product crash: pageerror, InvariantError,
//     stuck pending.
//   - Per-subcase classification per directive taxonomy:
//       SHOULD_SET_COUNTER_EVENT_BOOST_TO_0
//       SHOULD_REDUCE_COUNTER_EVENT_BOOST_TO_UNCONDITIONAL_TIER
//       SHOULD_REMOVE_DUPLICATE_CLAUSE
//       NEEDS_PRINTED_TEXT_REVIEW
//       LEAVE_AS_IS
//
// Per directive 2026-06-07: harness-only, no engine / UI / cards.json /
// scenarioFactory edits. Audit-only. Run <8 min.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const EIGHT_MIN = 8 * 60_000;

test.use({
  launchOptions: {
    args: ['--disable-renderer-backgrounding', '--no-sandbox'],
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORPUS_PATH = resolve(__dirname, '../shared/data/cards.json');
const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;
function corpusDef(id: string): Record<string, unknown> {
  const found = CORPUS.find((c) => (c as { id?: string }).id === id);
  if (!found) throw new Error(`corpus missing ${id}`);
  return found;
}

// ────────────────────────────────────────────────────────────────────
// Harness bootstrap (same shape as audit-own-chars-filter + family-cev*)
// ────────────────────────────────────────────────────────────────────

async function bootstrap(page: Page): Promise<{ drv: PlayerDriver; pageErrors: string[]; invariantErrors: string[] }> {
  const pageErrors: string[] = [];
  const invariantErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    const t = m.text();
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
    { timeout: 60_000 },
  ).toMatchObject({ phase: 'main', activePlayer: 'A' });
  await drv.normalizeToATurn1Main();
  return { drv, pageErrors, invariantErrors };
}

// Reset transient battle state, A.field, B.field, A.trash, A.hand,
// A.life size, B.life size, A.donCostArea size. Restores phase=main.
interface ResetOpts {
  donCount: number;
  aLifeCount?: number; // default 5
  bLifeCount?: number; // default 5
  aTrashCount?: number; // default 0
  /** Force A.hand to exactly this many filler cards before the counter
   *  is seeded. Default 5 (matches T1 post-mulligan+draw). When the
   *  counter card is played → hand → trash, the post-play hand size
   *  equals exactly aHandSize. Use 0 to drive `if_hand_max:N` TRUE. */
  aHandSize?: number;
}

async function resetForSubcase(page: Page, opts: ResetOpts): Promise<void> {
  await page.evaluate((opts) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    const players = s.players as {
      A: {
        donDeck: string[]; donCostArea: string[]; donRested: string[];
        leader: { instanceId: string; powerModifierThisBattle?: number; powerModifierContinuous?: number; powerModifierOneShot?: number; powerModifierExpiresInTurns?: number };
        field: unknown[]; hand: string[]; trash: string[]; life: string[]; deck: string[];
      };
      B: {
        leader: { instanceId: string };
        field: unknown[]; life: string[]; deck: string[];
      };
    };
    // ── Clear leader transient modifiers
    players.A.leader.powerModifierThisBattle = undefined;
    players.A.leader.powerModifierContinuous = undefined;
    players.A.leader.powerModifierOneShot = undefined;
    players.A.leader.powerModifierExpiresInTurns = undefined;
    // ── Clear A.field + B.field
    players.A.field = [];
    players.B.field = [];
    const instances = s.instances as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    // ── Hand — always rebuild to exactly aHandSize "non-counter" filler
    //    cards (default 5). Prevents state-pollution from prior subcase.
    //    Fillers are character cards with counterValue=null so they are
    //    NOT offered as PLAY_COUNTER.
    //
    // CRITICAL: also seed a no-cost "guard" counter event so that AFTER
    //    the audited counter plays, A.hand still has at least 1
    //    PLAY_COUNTER option. Without the guard, the store wrapper at
    //    src/store/game.ts:511-520 auto-dispatches SKIP_COUNTER when the
    //    reactive player has no counter options, which resolves damage
    //    BEFORE our readMidSnap. The guard keeps opts.length > 0 so the
    //    store waits for our manual SKIP_COUNTER dispatch.
    const targetHand = opts.aHandSize ?? 5;
    players.A.hand = [];
    for (let i = 0; i < targetHand; i++) {
      const synthId = `__fillerHandReset_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `fillerHReset_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: `FillerHand ${i}`, kind: 'character',
        cost: 1, power: 1000, counterValue: null,
        colors: ['red'], traits: [], keywords: [], effectText: '',
      };
      instances[iid] = {
        instanceId: iid, cardId: synthId, controller: 'A',
        rested: false, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      players.A.hand.push(iid);
    }
    // Guard counter event — no clauses, no cost, counterEventBoost=1000.
    {
      const synthId = `__guardCEv_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `guardCEv_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: 'Guard Counter Event', kind: 'event',
        cost: 0, power: null, counterValue: null,
        colors: ['red'], traits: [], keywords: [], effectText: '',
        counterEventBoost: 1000,
        effectSpecV2: { clauses: [], continuous: [], replacements: [], schemaVersion: 2, verified: 'human-reviewed' },
      };
      instances[iid] = {
        instanceId: iid, cardId: synthId, controller: 'A',
        rested: false, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      players.A.hand.push(iid);
    }
    // ── A.life
    const targetLife = opts.aLifeCount ?? 5;
    while (players.A.life.length > targetLife) {
      const id = players.A.life.pop();
      if (id !== undefined) players.A.trash.push(id);
    }
    // ── B.life
    const targetBLife = opts.bLifeCount ?? 5;
    while (players.B.life.length > targetBLife) {
      players.B.life.pop();
    }
    // ── A.trash count (seed placeholders to reach target count)
    const targetTrash = opts.aTrashCount ?? 0;
    while (players.A.trash.length > targetTrash) {
      players.A.trash.pop();
    }
    while (players.A.trash.length < targetTrash) {
      const synthId = `__seedTrashCard_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedTrashInst_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: 'Trash Placeholder', kind: 'character',
        cost: 1, power: 1000, counterValue: 1000,
        colors: ['red'], traits: [], keywords: [], effectText: '',
      };
      instances[iid] = {
        instanceId: iid, cardId: synthId, controller: 'A',
        rested: false, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      players.A.trash.push(iid);
    }
    // ── A.donCostArea — top up to opts.donCount
    const allDon = [
      ...players.A.donDeck,
      ...players.A.donCostArea,
      ...players.A.donRested,
    ];
    players.A.donDeck = allDon.slice(opts.donCount);
    players.A.donCostArea = allDon.slice(0, opts.donCount);
    players.A.donRested = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, opts);
  await page.waitForTimeout(120);
}

async function seedCharOnField(page: Page, side: 'A' | 'B', overrides: Partial<{ cost: number; power: number; traits: string[]; tag: string }>): Promise<string> {
  const cost = overrides.cost ?? 1;
  const power = overrides.power ?? 3000;
  const traits = overrides.traits ?? [];
  const tag = overrides.tag ?? 'gen';
  return page.evaluate(({ side, cost, power, traits, tag }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] }; B: { field: unknown[] } };
    const synthId = `__seedAud1c_${side}_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedAud1c_${side}_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: `Aud1c ${side} ${tag}`, kind: 'character',
      cost, power, counterValue: 1000,
      colors: ['red'], traits, keywords: [], effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: side,
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players[side].field = [...players[side].field, inst[iid]];
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, { side, cost, power, traits, tag });
}

async function seedCardInAHand(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedAud1cCEv_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: def['id'], controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.hand = [...players.A.hand, iid];
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, def);
}

async function enterCounterWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { leader: { instanceId: string } }; B: { leader: { instanceId: string } } };
    (s as Record<string, unknown>).phase = 'counter_window';
    (s as Record<string, unknown>).activePlayer = 'B';
    (s as Record<string, unknown>).pending = {
      kind: 'attack',
      pendingAttack: {
        attackerInstanceId: players.B.leader.instanceId,
        targetInstanceId: players.A.leader.instanceId,
        counterBoost: 0,
      },
    };
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  });
  await page.waitForTimeout(100);
}

async function dispatchAs(page: Page, action: object): Promise<{ ok: boolean; err: string | null }> {
  const res = await page.evaluate((a) => {
    try {
      const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
      w.__store!.getState().dispatch(a);
      return { ok: true, err: null };
    } catch (e) {
      return { ok: false, err: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    }
  }, action);
  await page.waitForTimeout(200);
  return res;
}

interface DeepDiag {
  phase: string;
  pendingKind: string | null;
  pending: unknown;
  aHandLen: number;
  aHandIds: string[];
  aTrashLen: number;
  aTrashTail: string[];
  aDonCost: number;
  aFieldLen: number;
  bFieldLen: number;
  aFieldChars: Array<{ iid: string; cardId: string; traits: string[]; cost: number; power: number; modBattle: number; modOneShot: number }>;
  bFieldChars: Array<{ iid: string; cardId: string; traits: string[]; cost: number; power: number }>;
  counterBoost: number;
  aLeaderModBattle: number;
  aLeaderModOneShot: number;
  historyTail: Array<{ type?: string; reason?: string; instanceId?: string }>;
  legalForA: Array<{ type: string; instanceId?: string }>;
  legalForB: Array<{ type: string; instanceId?: string }>;
}

async function readDeepDiag(page: Page): Promise<DeepDiag> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: { getState: () => { state: Record<string, unknown> } };
      __getLegalActions?: (s: unknown, p: string) => unknown[];
    };
    const s = w.__store!.getState().state as Record<string, unknown> & {
      phase: string;
      pending: { kind?: string; pendingAttack?: { counterBoost?: number } } | null;
      players: {
        A: { hand: string[]; trash: string[]; donCostArea: string[]; field: { instanceId: string }[]; leader: { powerModifierThisBattle?: number; powerModifierOneShot?: number } };
        B: { field: { instanceId: string }[] };
      };
      instances: Record<string, { cardId: string; powerModifierThisBattle?: number; powerModifierOneShot?: number }>;
      cardLibrary: Record<string, { traits?: string[]; cost?: number; power?: number }>;
      history: ReadonlyArray<{ type?: string; reason?: string; instanceId?: string }>;
    };
    const dumpField = (side: 'A' | 'B'): DeepDiag['aFieldChars'] => {
      return s.players[side].field.map((inst) => {
        const i = s.instances[inst.instanceId];
        const card = i ? s.cardLibrary[i.cardId] : undefined;
        return {
          iid: inst.instanceId,
          cardId: i?.cardId ?? '?',
          traits: card?.traits ?? [],
          cost: card?.cost ?? 0,
          power: card?.power ?? 0,
          modBattle: i?.powerModifierThisBattle ?? 0,
          modOneShot: i?.powerModifierOneShot ?? 0,
        };
      });
    };
    const legalA = w.__getLegalActions ? (w.__getLegalActions(s, 'A') as Array<{ type: string; instanceId?: string }>) : [];
    const legalB = w.__getLegalActions ? (w.__getLegalActions(s, 'B') as Array<{ type: string; instanceId?: string }>) : [];
    return {
      phase: s.phase,
      pendingKind: s.pending?.kind ?? null,
      pending: s.pending,
      aHandLen: s.players.A.hand.length,
      aHandIds: [...s.players.A.hand],
      aTrashLen: s.players.A.trash.length,
      aTrashTail: s.players.A.trash.slice(-3),
      aDonCost: s.players.A.donCostArea.length,
      aFieldLen: s.players.A.field.length,
      bFieldLen: s.players.B.field.length,
      aFieldChars: dumpField('A'),
      bFieldChars: dumpField('B').map(({ iid, cardId, traits, cost, power }) => ({ iid, cardId, traits, cost, power })),
      counterBoost: s.pending?.pendingAttack?.counterBoost ?? 0,
      aLeaderModBattle: s.players.A.leader.powerModifierThisBattle ?? 0,
      aLeaderModOneShot: s.players.A.leader.powerModifierOneShot ?? 0,
      historyTail: s.history.slice(-8),
      legalForA: legalA.map((a) => ({ type: a.type, instanceId: a.instanceId })),
      legalForB: legalB.map((a) => ({ type: a.type, instanceId: a.instanceId })),
    };
  });
}

interface BeforeSnap {
  aHandLen: number;
  aTrashLen: number;
  aLifeLen: number;
  bLifeLen: number;
  aDonCost: number;
  aFieldLen: number;
  bFieldLen: number;
  counterBoost: number;
  aLeaderModBattle: number;
  aLeaderModOneShot: number;
}

interface MidSnap {
  counterBoost: number;
  aLeaderModBattle: number;
  aLeaderModOneShot: number;
  /** Sum across A.field char modifierThisBattle. */
  aFieldModBattleSum: number;
  /** Sum across A.field char modifierOneShot. */
  aFieldModOneShotSum: number;
  phase: string;
  pendingKind: string | null;
}

async function readBeforeSnap(page: Page): Promise<BeforeSnap> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: { getState: () => {
        state: {
          pending: { kind?: string; pendingAttack?: { counterBoost?: number } } | null;
          players: {
            A: { hand: string[]; trash: string[]; life: string[]; donCostArea: string[]; field: { instanceId: string }[]; leader: { powerModifierThisBattle?: number; powerModifierOneShot?: number } };
            B: { life: string[]; field: { instanceId: string }[] };
          };
        };
      } };
    };
    const s = w.__store!.getState().state;
    return {
      aHandLen: s.players.A.hand.length,
      aTrashLen: s.players.A.trash.length,
      aLifeLen: s.players.A.life.length,
      bLifeLen: s.players.B.life.length,
      aDonCost: s.players.A.donCostArea.length,
      aFieldLen: s.players.A.field.length,
      bFieldLen: s.players.B.field.length,
      counterBoost: s.pending?.pendingAttack?.counterBoost ?? 0,
      aLeaderModBattle: s.players.A.leader.powerModifierThisBattle ?? 0,
      aLeaderModOneShot: s.players.A.leader.powerModifierOneShot ?? 0,
    };
  });
}

async function readMidSnap(page: Page): Promise<MidSnap> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: { getState: () => {
        state: {
          phase: string;
          pending: { kind?: string; pendingAttack?: { counterBoost?: number } } | null;
          players: {
            A: { field: { instanceId: string }[]; leader: { powerModifierThisBattle?: number; powerModifierOneShot?: number } };
          };
          instances: Record<string, { powerModifierThisBattle?: number; powerModifierOneShot?: number }>;
        };
      } };
    };
    const s = w.__store!.getState().state;
    let fieldBattle = 0;
    let fieldOneShot = 0;
    for (const inst of s.players.A.field) {
      const i = s.instances[inst.instanceId];
      if (i) {
        fieldBattle += i.powerModifierThisBattle ?? 0;
        fieldOneShot += i.powerModifierOneShot ?? 0;
      }
    }
    return {
      counterBoost: s.pending?.pendingAttack?.counterBoost ?? 0,
      aLeaderModBattle: s.players.A.leader.powerModifierThisBattle ?? 0,
      aLeaderModOneShot: s.players.A.leader.powerModifierOneShot ?? 0,
      aFieldModBattleSum: fieldBattle,
      aFieldModOneShotSum: fieldOneShot,
      phase: s.phase,
      pendingKind: s.pending?.kind ?? null,
    };
  });
}

async function legalCounterIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown } }; __getLegalActions?: (s: unknown, p: string) => unknown[] };
    if (!w.__getLegalActions) return [];
    const s = w.__store!.getState().state;
    return (w.__getLegalActions(s, 'A') as { type: string; instanceId?: string }[])
      .filter((a) => a.type === 'PLAY_COUNTER')
      .map((a) => a.instanceId ?? '');
  });
}

async function readALife(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { life: string[] } } } } } };
    return w.__store!.getState().state.players.A.life.length;
  });
}

async function readPhase(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { phase: string; pending: { kind?: string } | null } } } };
    return w.__store!.getState().state.phase;
  });
}

async function readPendingKind(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { pending: { kind?: string } | null } } } };
    return w.__store!.getState().state.pending?.kind ?? null;
  });
}

// ────────────────────────────────────────────────────────────────────
// Per-card setup descriptors
// ────────────────────────────────────────────────────────────────────

type Classification =
  | 'VERIFIED_INTENT'
  | 'MAGNITUDE_MISMATCH'
  | 'DOUBLE_COUNT'
  | 'ENCODING_GAP'
  | 'ENGINE_BUG'
  | 'INCONCLUSIVE';

type Remediation =
  | 'counterEventBoost -> unconditional tier'
  | 'counterEventBoost -> 0; keep clauses'
  | 'drop duplicate clause'
  | 'leave as-is'
  | 'manual owner decision required';

interface SubcaseSetup {
  subcaseName: string;
  /** Expected condition outcome per printed text (TRUE/FALSE), or N/A
   *  if no condition exists in encoded clauses. */
  expectedCondition: 'TRUE' | 'FALSE' | 'N/A';
  /** Expected printed-text effective boost on the defender (leader)
   *  per printed text. */
  printedExpectedTotalBoost: number;
  /** Engineer state required for the condition to evaluate this way. */
  reset: ResetOpts;
  /** Seed-extra steps (chars on A.field / B.field, etc.). Optional. */
  prePlay?: (page: Page) => Promise<void>;
}

interface CardSpec {
  id: string;
  name: string;
  cost: number;
  counterEventBoost: number;
  subcases: SubcaseSetup[];
  def: Record<string, unknown>;
  /** True iff encoded clauses don't fully model the printed-text tiers
   *  (e.g. OP06-038 has 1 encoded clause but printed has 2 tiers). */
  hasEncodingGap?: boolean;
}

const CARDS: CardSpec[] = [
  // ── OP01-029 Radical Beam (if_own_life_max:2) ────────────────────
  {
    id: 'OP01-029', name: 'Radical Beam!!', cost: 1, counterEventBoost: 4000,
    def: corpusDef('OP01-029'),
    subcases: [
      {
        subcaseName: 'FALSE: life=5 (>2)',
        expectedCondition: 'FALSE',
        printedExpectedTotalBoost: 2000,
        reset: { donCount: 1, aLifeCount: 5 },
      },
      {
        subcaseName: 'TRUE: life=2 (≤2)',
        expectedCondition: 'TRUE',
        printedExpectedTotalBoost: 4000,
        reset: { donCount: 1, aLifeCount: 2 },
      },
    ],
  },
  // ── OP04-095 Barrier!! (if_trash_min:15) ─────────────────────────
  {
    id: 'OP04-095', name: 'Barrier!!', cost: 1, counterEventBoost: 4000,
    def: corpusDef('OP04-095'),
    subcases: [
      {
        subcaseName: 'FALSE: trash=0 (<15)',
        expectedCondition: 'FALSE',
        printedExpectedTotalBoost: 2000,
        reset: { donCount: 1, aTrashCount: 0 },
      },
      {
        subcaseName: 'TRUE: trash=15 (≥15)',
        expectedCondition: 'TRUE',
        printedExpectedTotalBoost: 4000,
        reset: { donCount: 1, aTrashCount: 15 },
      },
    ],
  },
  // ── OP05-114 El Thor (if_opp_life_max:2) ─────────────────────────
  {
    id: 'OP05-114', name: 'El Thor', cost: 1, counterEventBoost: 4000,
    def: corpusDef('OP05-114'),
    subcases: [
      {
        subcaseName: 'FALSE: B.life=5 (>2)',
        expectedCondition: 'FALSE',
        printedExpectedTotalBoost: 2000,
        reset: { donCount: 1, bLifeCount: 5 },
      },
      {
        subcaseName: 'TRUE: B.life=2 (≤2)',
        expectedCondition: 'TRUE',
        printedExpectedTotalBoost: 4000,
        reset: { donCount: 1, bLifeCount: 2 },
      },
    ],
  },
  // ── OP06-038 Trichil (encoded: 1 unconditional clause only;
  //     printed: +2000 base, +2000 if rested ≥ 8 — second clause MISSING)
  {
    id: 'OP06-038', name: 'The Billion-fold World Trichiliocosm', cost: 1, counterEventBoost: 4000,
    def: corpusDef('OP06-038'),
    hasEncodingGap: true,
    subcases: [
      {
        subcaseName: 'UNCONDITIONAL-only encoded (printed second clause missing)',
        expectedCondition: 'N/A',
        printedExpectedTotalBoost: 2000,
        reset: { donCount: 1 },
      },
    ],
  },
  // ── OP07-035 Karmic Punishment (if_own_chars_min:3) ──────────────
  {
    id: 'OP07-035', name: 'Karmic Punishment', cost: 1, counterEventBoost: 3000,
    def: corpusDef('OP07-035'),
    subcases: [
      {
        subcaseName: 'FALSE: A.field empty (<3 chars)',
        expectedCondition: 'FALSE',
        printedExpectedTotalBoost: 2000,
        reset: { donCount: 1 },
      },
      {
        subcaseName: 'TRUE: 3 own chars on A.field',
        expectedCondition: 'TRUE',
        printedExpectedTotalBoost: 3000,
        reset: { donCount: 1 },
        prePlay: async (page) => {
          await seedCharOnField(page, 'A', { tag: 'c1' });
          await seedCharOnField(page, 'A', { tag: 'c2' });
          await seedCharOnField(page, 'A', { tag: 'c3' });
        },
      },
    ],
  },
  // ── OP07-095 Iron Body (if_trash_min:10) ─────────────────────────
  {
    id: 'OP07-095', name: 'Iron Body', cost: 2, counterEventBoost: 6000,
    def: corpusDef('OP07-095'),
    subcases: [
      {
        subcaseName: 'FALSE: trash=0 (<10)',
        expectedCondition: 'FALSE',
        printedExpectedTotalBoost: 4000,
        reset: { donCount: 2, aTrashCount: 0 },
      },
      {
        subcaseName: 'TRUE: trash=10 (≥10)',
        expectedCondition: 'TRUE',
        printedExpectedTotalBoost: 6000,
        reset: { donCount: 2, aTrashCount: 10 },
      },
    ],
  },
  // ── OP11-019 Glorp Web!! (if_opp_chars_min_power:n=1, minPower=6000) — clause this_turn
  {
    id: 'OP11-019', name: 'Glorp Web!!', cost: 2, counterEventBoost: 2000,
    def: corpusDef('OP11-019'),
    subcases: [
      {
        subcaseName: 'FALSE: B.field empty (no 6000+-power opp char)',
        expectedCondition: 'FALSE',
        printedExpectedTotalBoost: 2000,
        reset: { donCount: 2 },
      },
      {
        subcaseName: 'TRUE: 1 B char with 6000 power',
        expectedCondition: 'TRUE',
        printedExpectedTotalBoost: 3000,
        reset: { donCount: 2 },
        prePlay: async (page) => {
          await seedCharOnField(page, 'B', { cost: 5, power: 6000, tag: 'bigchar' });
        },
      },
    ],
  },
  // ── OP11-020 X Calibur — same shape as OP11-019
  {
    id: 'OP11-020', name: 'X Calibur', cost: 2, counterEventBoost: 2000,
    def: corpusDef('OP11-020'),
    subcases: [
      {
        subcaseName: 'FALSE: B.field empty (no 6000+-power opp char)',
        expectedCondition: 'FALSE',
        printedExpectedTotalBoost: 2000,
        reset: { donCount: 2 },
      },
      {
        subcaseName: 'TRUE: 1 B char with 6000 power',
        expectedCondition: 'TRUE',
        printedExpectedTotalBoost: 3000,
        reset: { donCount: 2 },
        prePlay: async (page) => {
          await seedCharOnField(page, 'B', { cost: 5, power: 6000, tag: 'bigchar' });
        },
      },
    ],
  },
  // ── OP11-059 Gum-Gum King Cobra (if_hand_max:4)
  // Condition is evaluated AFTER the counter card is moved hand→trash, so
  // for FALSE we need post-play hand > 4 (≥5); for TRUE we need ≤4.
  {
    id: 'OP11-059', name: 'Gum-Gum King Cobra', cost: 1, counterEventBoost: 4000,
    def: corpusDef('OP11-059'),
    subcases: [
      {
        subcaseName: 'FALSE: post-play A.hand=5 (>4)',
        expectedCondition: 'FALSE',
        printedExpectedTotalBoost: 2000,
        // aHandSize=5 fillers + counter card seeded; after play hand=5 fillers ⇒ 5>4 ⇒ FALSE.
        reset: { donCount: 1, aHandSize: 5 },
      },
      {
        subcaseName: 'TRUE: post-play A.hand=0 (≤4)',
        expectedCondition: 'TRUE',
        printedExpectedTotalBoost: 4000,
        // aHandSize=0 + counter seeded; after play hand=0 ⇒ 0≤4 ⇒ TRUE.
        reset: { donCount: 1, aHandSize: 0 },
      },
    ],
  },
  // ── OP12-098 Hair Removal Fist (if_own_chars_min_cost:n=1, minCost=8)
  // clause[1] target: your_character filter typeIncludes Revolutionary Army
  {
    id: 'OP12-098', name: 'Hair Removal Fist', cost: 1, counterEventBoost: 4000,
    def: corpusDef('OP12-098'),
    subcases: [
      {
        subcaseName: 'FALSE: A.field empty (no cost≥8 char)',
        expectedCondition: 'FALSE',
        printedExpectedTotalBoost: 2000,
        reset: { donCount: 1 },
      },
      {
        subcaseName: 'TRUE: 1 cost-8 Rev Army char (condition+target)',
        expectedCondition: 'TRUE',
        printedExpectedTotalBoost: 4000,
        reset: { donCount: 1 },
        prePlay: async (page) => {
          // single char satisfies BOTH the condition (cost≥8) and the
          // clause[1] target filter (Revolutionary Army trait).
          await seedCharOnField(page, 'A', { cost: 8, power: 6000, traits: ['Revolutionary Army'], tag: 'rev8' });
        },
      },
    ],
  },
];

interface SubcaseResult {
  cardId: string;
  cardName: string;
  subcase: string;
  counterEventBoost: number;
  expectedCondition: 'TRUE' | 'FALSE' | 'N/A';
  printedExpectedTotalBoost: number;
  /** Was PLAY_COUNTER offered? */
  playable: boolean;
  /** Did PLAY_COUNTER dispatch throw? */
  dispatchError: string | null;
  /** Engine-applied counterBoost (from counterEventBoost field). */
  observedCounterBoost: number;
  /** Sum of leader+field powerModifierThisBattle (clauses w/ this_battle). */
  observedThisBattleSum: number;
  /** Sum of leader+field powerModifierOneShot (clauses w/ this_turn). */
  observedOneShotSum: number;
  /** Total engine-applied boost on defender side. */
  totalEffectiveBoost: number;
  /** Combat outcome (life delta). */
  lifeDelta: number;
  /** Final phase (sanity). */
  phaseAfter: string;
  /** Did observed boost match printed text? (a) unconditional tier;
   *  (b) conditional tier; (c) sum of both; (d) other / anomalous. */
  boostMatchProfile: 'unconditional_tier' | 'conditional_tier' | 'sum_of_both' | 'other_anomalous';
  /** Classification per directive taxonomy. */
  classification: Classification;
  /** Remediation per directive taxonomy. */
  remediation: Remediation;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes: string;
}

interface ClassifyInput {
  totalEffectiveBoost: number;
  observedCounterBoost: number;
  observedClauseSum: number; // this_battle + this_turn on leader+field
  printed: number;
  cardBoost: number;
  dispatchError: string | null;
  hasEncodingGap: boolean;
}

interface ClassifyOutput {
  classification: Classification;
  remediation: Remediation;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes: string;
  boostMatchProfile: 'unconditional_tier' | 'conditional_tier' | 'sum_of_both' | 'other_anomalous';
}

function classifySubcase(input: ClassifyInput): ClassifyOutput {
  const { totalEffectiveBoost: total, observedCounterBoost: ce, observedClauseSum: cs, printed, cardBoost, dispatchError, hasEncodingGap } = input;

  // Boost-match profile: which printed-text source does total match.
  let profile: ClassifyOutput['boostMatchProfile'];
  if (total === printed) profile = total === cardBoost ? 'sum_of_both' : 'conditional_tier';
  else if (total === cardBoost) profile = 'sum_of_both';
  else profile = 'other_anomalous';

  // Hard fails first.
  if (dispatchError !== null) {
    return { classification: 'ENGINE_BUG', remediation: 'manual owner decision required', confidence: 'HIGH', notes: `dispatch threw: ${dispatchError}`, boostMatchProfile: 'other_anomalous' };
  }
  if (ce === 0 && cs === 0 && total === 0) {
    return { classification: 'INCONCLUSIVE', remediation: 'manual owner decision required', confidence: 'LOW', notes: 'engine produced 0 boost — PLAY_COUNTER either didn’t fire or pending overwritten before snap', boostMatchProfile: 'other_anomalous' };
  }
  // Encoding gap (missing clause) overrides other classifications when present.
  if (hasEncodingGap) {
    if (total > printed) {
      return { classification: 'ENCODING_GAP', remediation: 'counterEventBoost -> unconditional tier', confidence: 'MEDIUM', notes: `encoded clauses incomplete (missing conditional tier); engine still over-applies in encoded state by ${total - printed}; reducing boost to unconditional matches printed unconditional and a follow-up adds missing clause`, boostMatchProfile: profile };
    }
    return { classification: 'ENCODING_GAP', remediation: 'manual owner decision required', confidence: 'MEDIUM', notes: 'encoded clauses incomplete; owner must add missing clause + decide boost target', boostMatchProfile: profile };
  }
  // Observed matches printed exactly.
  if (total === printed) {
    return { classification: 'VERIFIED_INTENT', remediation: 'leave as-is', confidence: 'HIGH', notes: `observed ${total} == printed ${printed}`, boostMatchProfile: profile };
  }
  // Under-application without an encoding gap.
  if (total < printed) {
    return { classification: 'MAGNITUDE_MISMATCH', remediation: 'manual owner decision required', confidence: 'LOW', notes: `observed ${total} UNDER printed ${printed}; clause may not be reaching defender (target resolver may have routed elsewhere)`, boostMatchProfile: profile };
  }
  // Over-application — diagnose.
  // DOUBLE_COUNT signature: counterEventBoost is non-zero AND clause sum is non-zero
  // AND total ≈ cardBoost + cs (boost field is ADDED to clause output).
  if (ce > 0 && cs > 0 && Math.abs(total - (ce + cs)) <= 0) {
    // True double-count. Two valid remediations:
    //  - boost -> unconditional tier (boost still surfaces an "always-on" amount; clauses model tiers)
    //  - boost -> 0; keep clauses (clauses fully model both tiers)
    // If cardBoost equals printed unconditional, the cleaner fix is to drop
    // the duplicate unconditional clause. If cardBoost equals the sum of
    // unconditional + conditional (most common in this batch), reduce
    // boost to unconditional and drop unconditional clause.
    if (cardBoost === printed) {
      return { classification: 'DOUBLE_COUNT', remediation: 'drop duplicate clause', confidence: 'HIGH', notes: `counterEventBoost (${cardBoost}) already matches printed (${printed}); clauses add an extra ${cs}`, boostMatchProfile: profile };
    }
    // Default: boost was set to sum-of-clauses; reduce to unconditional tier.
    return { classification: 'DOUBLE_COUNT', remediation: 'counterEventBoost -> unconditional tier', confidence: 'HIGH', notes: `engine adds counterEventBoost (${cardBoost}) AND clauses (this_battle+this_turn = ${cs}); total over-applies by ${total - printed}; reduce boost to printed unconditional and drop unconditional clause`, boostMatchProfile: profile };
  }
  if (ce > 0 && cs === 0) {
    // counterEventBoost alone over-applies — clause didn't land on defender.
    return { classification: 'MAGNITUDE_MISMATCH', remediation: 'counterEventBoost -> unconditional tier', confidence: 'MEDIUM', notes: `only counterEventBoost ${ce} fired; clauses did NOT contribute to defender (target may have routed away); boost still > printed by ${total - printed}`, boostMatchProfile: profile };
  }
  // ce==0 with cs>0 — boost didn't fire but clauses did. Anomalous.
  return { classification: 'MAGNITUDE_MISMATCH', remediation: 'manual owner decision required', confidence: 'LOW', notes: `counterEventBoost did not fire (ce=0) but clauses did (sum=${cs})`, boostMatchProfile: profile };
}

test.describe('audit-counter-event-magnitude-mismatch (Group 1C)', () => {
  test('10 cards × 1-2 subcases — capture observed boost + recommend remediation', async ({ page }) => {
    test.setTimeout(EIGHT_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    const results: SubcaseResult[] = [];

    /* eslint-disable no-console */
    for (const card of CARDS) {
      for (const sub of card.subcases) {
        await resetForSubcase(page, sub.reset);
        if (sub.prePlay) await sub.prePlay(page);
        const cardIid = await seedCardInAHand(page, card.def);
        await enterCounterWindow(page);

        const before = await readBeforeSnap(page);
        const lifeBefore = before.aLifeLen;
        const offered = await legalCounterIds(page);
        const playable = offered.includes(cardIid);
        const preDiag = await readDeepDiag(page);

        if (!playable) {
          console.log(`\n[DIAG] ${card.id} ${sub.subcaseName} — PLAY_COUNTER not offered`);
          console.log('  pre-dispatch:', JSON.stringify({ phase: preDiag.phase, pendingKind: preDiag.pendingKind, aHandLen: preDiag.aHandLen, aDonCost: preDiag.aDonCost, legalCounterIds: preDiag.legalForA.filter((a) => a.type === 'PLAY_COUNTER').map((a) => a.instanceId) }));
          results.push({
            cardId: card.id, cardName: card.name, subcase: sub.subcaseName,
            counterEventBoost: card.counterEventBoost,
            expectedCondition: sub.expectedCondition,
            printedExpectedTotalBoost: sub.printedExpectedTotalBoost,
            playable: false, dispatchError: null,
            observedCounterBoost: 0, observedThisBattleSum: 0, observedOneShotSum: 0,
            totalEffectiveBoost: 0, lifeDelta: 0,
            phaseAfter: await readPhase(page),
            boostMatchProfile: 'other_anomalous',
            classification: 'INCONCLUSIVE', remediation: 'manual owner decision required',
            confidence: 'LOW', notes: 'PLAY_COUNTER not offered (counter-legality gate)',
          });
          await dispatchAs(page, { type: 'SKIP_COUNTER' });
          continue;
        }

        const playRes = await dispatchAs(page, { type: 'PLAY_COUNTER', instanceId: cardIid });
        const mid = await readMidSnap(page);
        const totalBoost = mid.counterBoost + mid.aLeaderModBattle + mid.aLeaderModOneShot + mid.aFieldModBattleSum + mid.aFieldModOneShotSum;

        // Deep-diag dump for failed dispatches OR suspicious-low boost.
        if (!playRes.ok || totalBoost === 0) {
          const postDiag = await readDeepDiag(page);
          console.log(`\n[DIAG] ${card.id} ${sub.subcaseName} — ${!playRes.ok ? 'DISPATCH ERROR' : 'ZERO BOOST'}`);
          if (!playRes.ok) console.log('  err:', playRes.err);
          console.log('  pre:', JSON.stringify({ phase: preDiag.phase, pendingKind: preDiag.pendingKind, aHand: preDiag.aHandIds, aDonCost: preDiag.aDonCost, aField: preDiag.aFieldChars, bField: preDiag.bFieldChars }));
          console.log('  post:', JSON.stringify({ phase: postDiag.phase, pendingKind: postDiag.pendingKind, counterBoost: postDiag.counterBoost, aLeaderMods: { battle: postDiag.aLeaderModBattle, oneShot: postDiag.aLeaderModOneShot }, aField: postDiag.aFieldChars, aTrashTail: postDiag.aTrashTail, historyTail: postDiag.historyTail }));
        }

        // Drain counter window (only if pending=attack; some dispatch failures may leave odd state).
        const postPendingKind = await readPendingKind(page);
        if (postPendingKind === 'attack') {
          await dispatchAs(page, { type: 'SKIP_COUNTER' });
        }
        const lifeAfter = await readALife(page);
        const phaseAfter = await readPhase(page);
        const pendingKindAfter = await readPendingKind(page);

        const cls = classifySubcase({
          totalEffectiveBoost: totalBoost,
          observedCounterBoost: mid.counterBoost,
          observedClauseSum: mid.aLeaderModBattle + mid.aLeaderModOneShot + mid.aFieldModBattleSum + mid.aFieldModOneShotSum,
          printed: sub.printedExpectedTotalBoost,
          cardBoost: card.counterEventBoost,
          dispatchError: playRes.ok ? null : playRes.err,
          hasEncodingGap: card.hasEncodingGap === true,
        });

        results.push({
          cardId: card.id, cardName: card.name, subcase: sub.subcaseName,
          counterEventBoost: card.counterEventBoost,
          expectedCondition: sub.expectedCondition,
          printedExpectedTotalBoost: sub.printedExpectedTotalBoost,
          playable: true, dispatchError: playRes.ok ? null : playRes.err,
          observedCounterBoost: mid.counterBoost,
          observedThisBattleSum: mid.aLeaderModBattle + mid.aFieldModBattleSum,
          observedOneShotSum: mid.aLeaderModOneShot + mid.aFieldModOneShotSum,
          totalEffectiveBoost: totalBoost,
          lifeDelta: lifeAfter - lifeBefore,
          phaseAfter: pendingKindAfter ? `${phaseAfter}+pending:${pendingKindAfter}` : phaseAfter,
          boostMatchProfile: cls.boostMatchProfile,
          classification: cls.classification, remediation: cls.remediation, confidence: cls.confidence,
          notes: cls.notes,
        });
      }
    }
    /* eslint-enable no-console */

    // ── Report ────────────────────────────────────────────────────────
    /* eslint-disable no-console */
    console.log('\n=== Group 1C — counter-event magnitude-mismatch AUDIT ===');
    const cols = ['id', 'subcase', 'cardBoost', 'expCond', 'printed', 'obsCBoost', 'thisBattle', 'thisTurn', 'totalEff', 'lifeΔ', 'phase', 'profile', 'classif', 'remed', 'conf'];
    console.log(cols.join('\t'));
    for (const r of results) {
      console.log([
        r.cardId, r.subcase, r.counterEventBoost,
        r.expectedCondition, r.printedExpectedTotalBoost,
        r.observedCounterBoost, r.observedThisBattleSum, r.observedOneShotSum,
        r.totalEffectiveBoost, r.lifeDelta, r.phaseAfter,
        r.boostMatchProfile, r.classification, r.remediation, r.confidence,
      ].join('\t'));
      console.log('    note:', r.notes);
    }
    console.log('\n— Per-card consolidated classification + remediation —');
    const byCard = new Map<string, SubcaseResult[]>();
    for (const r of results) {
      const list = byCard.get(r.cardId) ?? [];
      list.push(r);
      byCard.set(r.cardId, list);
    }
    for (const [id, list] of byCard) {
      const classes = new Set(list.map((r) => r.classification));
      const remed = new Set(list.map((r) => r.remediation));
      const minConf = list.some((r) => r.confidence === 'LOW') ? 'LOW' : list.some((r) => r.confidence === 'MEDIUM') ? 'MEDIUM' : 'HIGH';
      const classifConsolidated = classes.size === 1 ? Array.from(classes)[0]! : `MIXED:${Array.from(classes).join('|')}`;
      const remedConsolidated = remed.size === 1 ? Array.from(remed)[0]! : `MIXED:${Array.from(remed).join('|')}`;
      console.log(`${id}\tclassif=${classifConsolidated}\tremed=${remedConsolidated}\tconf=${minConf}`);
    }
    console.log('=== END AUDIT ===\n');
    /* eslint-enable no-console */

    // Audit invariants: PASS iff data captured cleanly + no infra crash.
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
    const totalSubcases = CARDS.reduce((a, c) => a + c.subcases.length, 0);
    expect(results.length, `all ${totalSubcases} subcases iterated`).toBe(totalSubcases);
    expect(await readPendingKind(page), 'no stuck pending at audit end').toBeNull();
  });
});
