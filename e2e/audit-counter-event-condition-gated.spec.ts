// audit-counter-event-condition-gated — Manual-review-backlog Group 1B + 1A + 1D
// targeted audit (8 cards).
//
// Goal: per-card empirical capture of whether each condition-gated /
// cost-gated counter event causes a magnitude mismatch or double-count
// pattern analogous to Group 1C, and recommend per-card remediation
// (or LEAVE_AS_IS).
//
// Engine paths exercised:
//   - playCounterReducer at shared/engine-v2/reducers/attackFlow.ts:317-411
//     pays card cost, hand→trash, ADDs counterEventBoost to
//     pendingAttack.counterBoost, then dispatches on_play clauses.
//   - Clause-level cost canPay gating at
//     shared/engine-v2/effects/EffectDispatcher.ts (skip if !canPay).
//   - Cost handlers: discardHand at costs2.ts:131-148 (canPay =
//     hand.length ≥ N, pay = shift head N times); donCostReturnToDeck;
//     donCost.
//   - Leader-condition handlers at conditions.ts:55-62 — read
//     leaderCard.traits from cardLibrary (so swapping
//     cardLibrary[A.leader.cardId].traits drives FALSE/TRUE).
//   - V0 deterministic target resolver `your_leader_or_character` at
//     targets.ts:75-86 picks leader FIRST with count=1.
//   - Store wrapper auto-SKIP_COUNTER at src/store/game.ts:511-520 fires
//     when reactive A has zero PLAY_COUNTER opts — handled by reading
//     post-resolution history instead of mid-state pending.
//
// Cards audited (8):
//   OP03-055 Gum-Gum Giant Gavel — cost=1, boost=4000; clause[0] cost=discardHand:1 mag=4000 target=your_leader; clause[1] cost=discardHand:1 action=mill_self:2
//   OP03-072 Gum-Gum Jet Gatling — cost=0, boost=3000; 1 clause cost=discardHand:1 mag=3000
//   OP03-097 Six King Pistol — cost=0, boost=3000; 1 clause cost=discardHand:1 mag=3000
//   OP05-037 Because the Side of Justice — cost=0, boost=3000; 1 clause cost=discardHand:1 mag=3000
//   OP06-115 You're the One Who Should Disappear — cost=0, boost=3000; 1 clause cost=discardHand:1 mag=3000
//   OP07-076 Slow-Slow Beam Sword — cost=2, boost=2000; clause[0] cost=donCostReturnToDeck:1 mag=2000; clause[1] cost=donCostReturnToDeck:1 action=rest_target opp_character
//   OP08-115 The Earth Will Not Lose! — cost=1, boost=3000; clause[0] condition=if_leader_has_trait:Shandian Warrior mag=3000; clause[1] same condition action=play_for_free Upper Yard
//   OP14-078 Bullet String — cost=2, boost=4000; clause[0] cost=donCost:1 condition=if_leader_has_type:Donquixote Pirates mag=2000 this_battle; clause[1] cost=donCost:1 condition=if_leader_has_type:Donquixote Pirates mag=2000 this_turn
//
// AUDIT semantics:
//   - PASSES on clean data capture; classification is the result.
//   - FAILS only on infra/product crash.
// Classifications per directive:
//   VERIFIED_INTENT             — observed FALSE/TRUE totals == printed
//   DOUBLE_COUNT_CONDITIONAL    — engine over-applies when gate passes (boost + clause stack)
//   COST_GATED_INTENT           — duplicate path is blocked by unpaid cost (engine matches printed)
//   LEADER_GATED_INTENT         — gated tier behaves correctly under matching leader only
//   ENCODING_GAP                — encoding cannot match printed intent
//
// Per directive 2026-06-07: harness-only, no engine / UI / cards.json /
// scenarioFactory edits. Audit-only. Test runs <5 min.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const FIVE_MIN = 5 * 60_000;

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
// Harness bootstrap
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

interface ResetOpts {
  donCount: number;
  /** Number of plain (non-counter) filler character cards in A.hand. */
  aHandSize?: number; // default 5
  /** Seed a guard counter event so that A.hand still has a PLAY_COUNTER
   *  option after the audited card resolves (prevents store auto-skip).
   *  Set false to drive cost-unpaid scenarios where hand should be empty
   *  post-PLAY (and accept the resulting auto-skip — captured via history). */
  seedGuardCounter?: boolean; // default true
  /** Override A.leader's traits in cardLibrary (drives if_leader_has_trait /
   *  if_leader_has_type). Pass undefined to leave the existing traits. */
  aLeaderTraits?: string[];
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
    // Clear game-over state — boost=0 FALSE subcases let attacks through,
    // each flipping 1 A life card. After enough subcases A.life reaches 0
    // and state.result sets, after which getLegalActions returns []
    // (legality.ts:43). Without this clear, every subsequent subcase
    // reports "PLAY_COUNTER not offered". Must also refill A.life below.
    (s as Record<string, unknown>).result = null;
    const players = s.players as {
      A: {
        donDeck: string[]; donCostArea: string[]; donRested: string[];
        leader: { instanceId: string; cardId: string; powerModifierThisBattle?: number; powerModifierContinuous?: number; powerModifierOneShot?: number; powerModifierExpiresInTurns?: number };
        field: unknown[]; hand: string[]; trash: string[]; life: string[]; deck: string[];
      };
      B: { leader: { instanceId: string }; field: unknown[]; life: string[]; deck: string[] };
    };
    const instances = s.instances as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    // Clear leader transient modifiers.
    players.A.leader.powerModifierThisBattle = undefined;
    players.A.leader.powerModifierContinuous = undefined;
    players.A.leader.powerModifierOneShot = undefined;
    players.A.leader.powerModifierExpiresInTurns = undefined;
    // Reset A.field + B.field.
    players.A.field = [];
    players.B.field = [];
    // Override A leader's traits if requested.
    if (opts.aLeaderTraits !== undefined) {
      const leaderCard = lib[players.A.leader.cardId] as { traits?: string[] } | undefined;
      if (leaderCard !== undefined) leaderCard.traits = opts.aLeaderTraits.slice();
    }
    // Rebuild A.hand to known shape: aHandSize filler chars (counterValue=null),
    // optionally + 1 guard counter event (counterEventBoost=1000, cost=0).
    const targetHand = opts.aHandSize ?? 5;
    players.A.hand = [];
    for (let i = 0; i < targetHand; i++) {
      const synthId = `__fillerHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `fillerH_${Math.floor(Math.random() * 1e9).toString(36)}`;
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
    const seedGuard = opts.seedGuardCounter ?? true;
    if (seedGuard) {
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
    // A.life — TOP UP to 5 placeholder cards if depleted by prior FALSE
    // subcases. The engine reads life.length on damage; placeholders are
    // sufficient (no need for real card data).
    const TARGET_A_LIFE = 5;
    while (players.A.life.length < TARGET_A_LIFE) {
      const synthId = `__seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: 'Life Placeholder', kind: 'character',
        cost: 1, power: 1000, counterValue: 1000,
        colors: ['red'], traits: [], keywords: [], effectText: '',
      };
      instances[iid] = {
        instanceId: iid, cardId: synthId, controller: 'A',
        rested: false, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      players.A.life.push(iid);
    }
    while (players.A.life.length > TARGET_A_LIFE) players.A.life.pop();
    // B.life — leave at default; B isn't being attacked.
    // A.donCostArea — top up to opts.donCount.
    const allDon = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
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

async function seedCardInAHand(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedAud1bCEv_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
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
  await page.waitForTimeout(80);
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

async function readALife(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { life: string[] } } } } } };
    return w.__store!.getState().state.players.A.life.length;
  });
}

async function readPhase(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { phase: string } } } };
    return w.__store!.getState().state.phase;
  });
}

async function readPendingKind(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { pending: { kind?: string } | null } } } };
    return w.__store!.getState().state.pending?.kind ?? null;
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

// ── Snap (mid + history-derived). Resilient to store auto-skip. ───────

interface MidSnap {
  counterBoost: number; // pendingAttack.counterBoost if pending=attack still
  aLeaderModBattle: number;
  aLeaderModOneShot: number;
  aFieldModBattleSum: number;
  aFieldModOneShotSum: number;
  phase: string;
  pendingKind: string | null;
}

async function readMidSnap(page: Page): Promise<MidSnap> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: { getState: () => { state: {
        phase: string;
        pending: { kind?: string; pendingAttack?: { counterBoost?: number } } | null;
        players: { A: { field: { instanceId: string }[]; leader: { powerModifierThisBattle?: number; powerModifierOneShot?: number } } };
        instances: Record<string, { powerModifierThisBattle?: number; powerModifierOneShot?: number }>;
      } } };
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

interface HistorySnap {
  /** COUNTER_PLAYED.boost for the audited card (= counterEventBoost contribution). */
  counterPlayedBoost: number | null;
  /** DAMAGE_RESOLVED for THIS audited card's attack (last DAMAGE_RESOLVED in history). */
  damageResolvedCounterBoost: number | null;
  damageResolvedTargetPower: number | null;
  damageResolvedAttackerPower: number | null;
  /** Count of CLAUSE_FIRED entries for the audited card. */
  clausesFired: number;
  /** Indices of clauses fired (action kinds extracted). */
  clauseActionKinds: string[];
  /** Whether attack resolved (DAMAGE_RESOLVED in tail after COUNTER_PLAYED). */
  attackResolved: boolean;
}

async function readHistorySnap(page: Page, cardIid: string): Promise<HistorySnap> {
  return page.evaluate((cardIid) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: { history: ReadonlyArray<Record<string, unknown>> } } };
    };
    const s = w.__store!.getState().state;
    // Find the most recent COUNTER_PLAYED for cardIid.
    let counterPlayedIdx = -1;
    for (let i = s.history.length - 1; i >= 0; i--) {
      const h = s.history[i]!;
      if (h.type === 'COUNTER_PLAYED' && h.instanceId === cardIid) { counterPlayedIdx = i; break; }
    }
    if (counterPlayedIdx === -1) {
      return {
        counterPlayedBoost: null,
        damageResolvedCounterBoost: null,
        damageResolvedTargetPower: null,
        damageResolvedAttackerPower: null,
        clausesFired: 0, clauseActionKinds: [],
        attackResolved: false,
      };
    }
    const counterPlayed = s.history[counterPlayedIdx]!;
    let damageResolved: Record<string, unknown> | null = null;
    const clauseKinds: string[] = [];
    for (let i = counterPlayedIdx + 1; i < s.history.length; i++) {
      const h = s.history[i]!;
      if (h.type === 'CLAUSE_FIRED' && h.sourceInstanceId === cardIid) {
        clauseKinds.push(String(h.actionKind ?? '?'));
      }
      if (h.type === 'DAMAGE_RESOLVED' && damageResolved === null) {
        damageResolved = h;
      }
    }
    return {
      counterPlayedBoost: typeof counterPlayed.boost === 'number' ? counterPlayed.boost : null,
      damageResolvedCounterBoost: damageResolved !== null && typeof damageResolved.counterBoost === 'number' ? damageResolved.counterBoost as number : null,
      damageResolvedTargetPower: damageResolved !== null && typeof damageResolved.targetPower === 'number' ? damageResolved.targetPower as number : null,
      damageResolvedAttackerPower: damageResolved !== null && typeof damageResolved.attackerPower === 'number' ? damageResolved.attackerPower as number : null,
      clausesFired: clauseKinds.length,
      clauseActionKinds: clauseKinds,
      attackResolved: damageResolved !== null,
    };
  }, cardIid);
}

// ────────────────────────────────────────────────────────────────────
// Per-card subcase descriptors
// ────────────────────────────────────────────────────────────────────

type Classification =
  | 'VERIFIED_INTENT'
  | 'DOUBLE_COUNT_CONDITIONAL'
  | 'COST_GATED_INTENT'
  | 'LEADER_GATED_INTENT'
  | 'ENCODING_GAP';

type Remediation =
  | 'leave as-is'
  | 'counterEventBoost -> unconditional tier'
  | 'counterEventBoost -> 0'
  | 'manual redesign required';

interface SubcaseSetup {
  name: string;
  /** Expected gate outcome under engine. TRUE = condition+cost both pass. */
  gateExpected: 'TRUE' | 'FALSE';
  /** Printed-text-expected total boost on defender (leader). */
  printedTotalBoost: number;
  reset: ResetOpts;
  prePlay?: (page: Page) => Promise<void>;
}

interface CardSpec {
  id: string;
  name: string;
  cost: number;
  counterEventBoost: number;
  /** Compact gate description for the report. */
  gate: string;
  subcases: SubcaseSetup[];
  def: Record<string, unknown>;
}

// Shared cost-gated discardHand:1 shape used by 4 cards (OP03-072,
// OP03-097, OP05-037, OP06-115). Card cost=0, boost=3000, clause
// cost=discardHand:1, mag=3000.
function discardHandShape(id: string, name: string): CardSpec {
  return {
    id, name, cost: 0, counterEventBoost: 3000, gate: 'discardHand:1',
    def: corpusDef(id),
    subcases: [
      {
        name: 'FALSE: hand empty post-play (cost unpayable)',
        gateExpected: 'FALSE', printedTotalBoost: 0, // printed: cost-unpaid → no boost
        // No fillers, no guard. After PLAY_COUNTER, hand=0. discardHand:1 fails.
        reset: { donCount: 0, aHandSize: 0, seedGuardCounter: false },
      },
      {
        name: 'TRUE: 1 filler + guard in hand (cost payable; discards filler)',
        gateExpected: 'TRUE', printedTotalBoost: 3000,
        reset: { donCount: 0, aHandSize: 1, seedGuardCounter: true },
      },
    ],
  };
}

const CARDS: CardSpec[] = [
  // ── OP03-055 Gum-Gum Giant Gavel — cost=1, boost=4000; clauses cost=discardHand:1
  //     clause[0] mag=4000 target=your_leader; clause[1] action=mill_self:2
  {
    id: 'OP03-055', name: 'Gum-Gum Giant Gavel', cost: 1, counterEventBoost: 4000,
    gate: 'discardHand:1 (both clauses)',
    def: corpusDef('OP03-055'),
    subcases: [
      {
        name: 'FALSE: hand empty post-play (cost unpayable)',
        gateExpected: 'FALSE', printedTotalBoost: 0,
        reset: { donCount: 1, aHandSize: 0, seedGuardCounter: false },
      },
      {
        name: 'TRUE: 2 fillers + guard (cost payable for both clauses)',
        gateExpected: 'TRUE', printedTotalBoost: 4000,
        reset: { donCount: 1, aHandSize: 2, seedGuardCounter: true },
      },
    ],
  },
  // ── OP03-072 / OP03-097 / OP05-037 / OP06-115 — identical shape
  discardHandShape('OP03-072', 'Gum-Gum Jet Gatling'),
  discardHandShape('OP03-097', 'Six King Pistol'),
  discardHandShape('OP05-037', 'Because the Side of Justice Will Be Whichever Side Wins!!'),
  discardHandShape('OP06-115', "You're the One Who Should Disappear."),
  // ── OP07-076 Slow-Slow Beam Sword — cost=2, boost=2000; clauses cost=donCostReturnToDeck:1
  //     clause[0] mag=2000; clause[1] action=rest_target opp_character
  //     Need: donCostArea ≥ 3 for cost-paid (2 for card + 1 for clause).
  //     For cost-unpaid: donCostArea = 2 (only card cost payable).
  {
    id: 'OP07-076', name: 'Slow-Slow Beam Sword', cost: 2, counterEventBoost: 2000,
    gate: 'donCostReturnToDeck:1 (both clauses)',
    def: corpusDef('OP07-076'),
    subcases: [
      {
        name: 'FALSE: donCostArea=2 (card cost only; clause cost unpaid)',
        gateExpected: 'FALSE', printedTotalBoost: 0,
        reset: { donCount: 2, aHandSize: 3, seedGuardCounter: true },
      },
      {
        name: 'TRUE: donCostArea=3 (card cost + clause cost payable)',
        gateExpected: 'TRUE', printedTotalBoost: 2000,
        reset: { donCount: 3, aHandSize: 3, seedGuardCounter: true },
      },
    ],
  },
  // ── OP08-115 The Earth Will Not Lose — cost=1, boost=3000;
  //     clauses gated by if_leader_has_trait:"Shandian Warrior" (no cost on clauses)
  //     FALSE: leader does not have trait; TRUE: leader has trait.
  {
    id: 'OP08-115', name: 'The Earth Will Not Lose!', cost: 1, counterEventBoost: 3000,
    gate: 'if_leader_has_trait:"Shandian Warrior"',
    def: corpusDef('OP08-115'),
    subcases: [
      {
        name: 'FALSE: leader does NOT have Shandian Warrior trait',
        gateExpected: 'FALSE', printedTotalBoost: 0, // printed needs leader match for boost
        reset: { donCount: 1, aHandSize: 3, seedGuardCounter: true, aLeaderTraits: ['Straw Hat Crew'] },
      },
      {
        name: 'TRUE: leader HAS Shandian Warrior trait',
        gateExpected: 'TRUE', printedTotalBoost: 3000,
        reset: { donCount: 1, aHandSize: 3, seedGuardCounter: true, aLeaderTraits: ['Shandian Warrior'] },
      },
    ],
  },
  // ── OP14-078 Bullet String — cost=2, boost=4000;
  //     clauses[0,1] cost=donCost:1 + condition=if_leader_has_type:"Donquixote Pirates"
  //     clause[0] mag=2000 this_battle; clause[1] mag=2000 this_turn
  //     4 subcases per directive: cost-paid×leader-MATCH, cost-paid×leader-NO-MATCH,
  //     cost-unpaid×leader-MATCH, cost-unpaid×leader-NO-MATCH.
  {
    id: 'OP14-078', name: 'Bullet String', cost: 2, counterEventBoost: 4000,
    gate: 'donCost:1 + if_leader_has_type:"Donquixote Pirates"',
    def: corpusDef('OP14-078'),
    subcases: [
      {
        name: 'cost-PAID + leader-MATCH (gate fully open; donCount=8 so BOTH clauses pay)',
        gateExpected: 'TRUE', printedTotalBoost: 4000,
        // donCount=8: generous to ensure both clauses pay; 2 for card cost +
        // 1 for clause[0] donCost:1 + 1 for clause[1] donCost:1 (minimum 4);
        // extra buffer in case some other cost handler path I missed.
        reset: { donCount: 8, aHandSize: 3, seedGuardCounter: true, aLeaderTraits: ['Donquixote Pirates'] },
      },
      {
        name: 'cost-PAID + leader-NO-MATCH (condition false)',
        gateExpected: 'FALSE', printedTotalBoost: 0,
        reset: { donCount: 4, aHandSize: 3, seedGuardCounter: true, aLeaderTraits: ['Straw Hat Crew'] },
      },
      {
        name: 'cost-UNPAID + leader-MATCH (cost canPay false)',
        gateExpected: 'FALSE', printedTotalBoost: 0,
        reset: { donCount: 2, aHandSize: 3, seedGuardCounter: true, aLeaderTraits: ['Donquixote Pirates'] },
      },
      {
        name: 'cost-UNPAID + leader-NO-MATCH (both fail)',
        gateExpected: 'FALSE', printedTotalBoost: 0,
        reset: { donCount: 2, aHandSize: 3, seedGuardCounter: true, aLeaderTraits: ['Straw Hat Crew'] },
      },
    ],
  },
];

interface SubcaseResult {
  cardId: string;
  cardName: string;
  subcase: string;
  cardBoost: number;
  gate: string;
  gateExpected: 'TRUE' | 'FALSE';
  printedTotal: number;
  playable: boolean;
  dispatchErr: string | null;
  // Mid-state (if pending=attack still after dispatch).
  midCounterBoost: number;
  midLeaderModBattle: number;
  midLeaderModOneShot: number;
  midFieldBattle: number;
  midFieldOneShot: number;
  midPhase: string;
  midPendingKind: string | null;
  // History-derived (resilient to auto-skip).
  histCounterPlayedBoost: number | null;
  histDamageCounterBoost: number | null;
  histDamageTargetPower: number | null;
  histClausesFired: number;
  histClauseKinds: string[];
  histAttackResolved: boolean;
  /** Final observed total boost on defender (mid+history). */
  totalObservedBoost: number;
  /** Whether gate FIRED (per CLAUSE_FIRED count). */
  gateFired: boolean;
  /** Combat outcome. */
  combatLifeDelta: number;
  classification: Classification;
  remediation: Remediation;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes: string;
}

function classifySubcase(_card: CardSpec, sub: SubcaseSetup, obs: { totalObservedBoost: number; midClauseSum: number; histClausesFired: number; midCounterBoost: number; }): { c: Classification; r: Remediation; conf: 'HIGH' | 'MEDIUM' | 'LOW'; notes: string } {
  const expectedTrue = sub.gateExpected === 'TRUE';
  const printed = sub.printedTotalBoost;
  // Observed vs printed.
  if (obs.totalObservedBoost === printed) {
    return { c: 'VERIFIED_INTENT', r: 'leave as-is', conf: 'HIGH', notes: `observed ${obs.totalObservedBoost} == printed ${printed}` };
  }
  const over = obs.totalObservedBoost - printed;
  // Over-application when gate is open AND both boost+clauses fire ⇒ DOUBLE_COUNT_CONDITIONAL.
  if (expectedTrue && over > 0 && obs.midCounterBoost > 0 && obs.midClauseSum > 0) {
    return { c: 'DOUBLE_COUNT_CONDITIONAL', r: 'counterEventBoost -> 0', conf: 'HIGH', notes: `gate open (clauses fired ${obs.histClausesFired}); engine stacks counterEventBoost (${obs.midCounterBoost}) on top of clause power_buff (${obs.midClauseSum}); total ${obs.totalObservedBoost} vs printed ${printed}` };
  }
  // Over-application when gate is closed BUT counterEventBoost still applies ⇒ engine
  // surfaces counterEventBoost as unconditional even when printed says boost requires gate.
  if (!expectedTrue && obs.midCounterBoost > 0 && obs.midClauseSum === 0) {
    return { c: 'COST_GATED_INTENT', r: 'counterEventBoost -> 0', conf: 'MEDIUM', notes: `gate closed (clauses skipped); only counterEventBoost (${obs.midCounterBoost}) fired; engine surfaces counter-value even when printed gate is unmet ⇒ either set boost=0 (printed-strict) or accept (counter-value semantic)` };
  }
  // Gate-open but observed lower than expected ⇒ encoding may not be capturing tier.
  if (expectedTrue && over < 0) {
    return { c: 'ENCODING_GAP', r: 'manual redesign required', conf: 'LOW', notes: `gate open but observed ${obs.totalObservedBoost} UNDER printed ${printed} — clause may not be reaching defender` };
  }
  // Edge: gate closed but observed exceeds printed (shouldn't happen given above branches).
  return { c: 'ENCODING_GAP', r: 'manual redesign required', conf: 'LOW', notes: `unexpected combination — observed ${obs.totalObservedBoost}, printed ${printed}, midBoost ${obs.midCounterBoost}, midClauseSum ${obs.midClauseSum}` };
}

test.describe('audit-counter-event-condition-gated (Group 1B+1A+1D)', () => {
  test('8 cards × 2-4 subcases — capture observed boost + gate-fired + classification', async ({ page }) => {
    test.setTimeout(FIVE_MIN);
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

        const lifeBefore = await readALife(page);
        const offered = await legalCounterIds(page);
        const playable = offered.includes(cardIid);

        if (!playable) {
          results.push({
            cardId: card.id, cardName: card.name, subcase: sub.name,
            cardBoost: card.counterEventBoost, gate: card.gate,
            gateExpected: sub.gateExpected, printedTotal: sub.printedTotalBoost,
            playable: false, dispatchErr: null,
            midCounterBoost: 0, midLeaderModBattle: 0, midLeaderModOneShot: 0, midFieldBattle: 0, midFieldOneShot: 0,
            midPhase: await readPhase(page), midPendingKind: await readPendingKind(page),
            histCounterPlayedBoost: null, histDamageCounterBoost: null, histDamageTargetPower: null,
            histClausesFired: 0, histClauseKinds: [], histAttackResolved: false,
            totalObservedBoost: 0, gateFired: false, combatLifeDelta: 0,
            classification: 'ENCODING_GAP', remediation: 'manual redesign required',
            confidence: 'LOW', notes: 'PLAY_COUNTER not offered (counter-legality gate)',
          });
          continue;
        }

        const playRes = await dispatchAs(page, { type: 'PLAY_COUNTER', instanceId: cardIid });
        const mid = await readMidSnap(page);
        const hist = await readHistorySnap(page, cardIid);

        // If pending still attack (no auto-skip), dispatch SKIP_COUNTER to resolve.
        const postKind = await readPendingKind(page);
        if (postKind === 'attack') {
          await dispatchAs(page, { type: 'SKIP_COUNTER' });
        }
        const lifeAfter = await readALife(page);

        // Determine the authoritative observed boost.
        // Preference: mid-state snap (if pending was still attack) — but if
        // auto-skip happened, the history's COUNTER_PLAYED.boost is
        // counterEventBoost contribution. Total = counterBoost + leader
        // power-modifier added by clauses (= midSnap's leader modifiers).
        // Auto-skip happens AFTER clauses fire on PLAY_COUNTER reducer, so
        // by the time the snap is taken, the leader's powerModifierThisBattle
        // reflects clause contributions. However mid.counterBoost is read
        // from pendingAttack which is cleared on damage resolve.
        //
        // Net-net: use mid.aLeaderModBattle + mid.aLeaderModOneShot for
        // clause contribution. For counterEventBoost contribution, fall back
        // to history's COUNTER_PLAYED.boost when mid.counterBoost==0 (auto-skipped).
        const counterContrib = mid.counterBoost > 0 ? mid.counterBoost : (hist.counterPlayedBoost ?? 0);
        const clauseSum = mid.aLeaderModBattle + mid.aLeaderModOneShot + mid.aFieldModBattleSum + mid.aFieldModOneShotSum;
        const total = counterContrib + clauseSum;

        const cls = classifySubcase(card, sub, {
          totalObservedBoost: total,
          midClauseSum: clauseSum,
          histClausesFired: hist.clausesFired,
          midCounterBoost: counterContrib,
        });

        results.push({
          cardId: card.id, cardName: card.name, subcase: sub.name,
          cardBoost: card.counterEventBoost, gate: card.gate,
          gateExpected: sub.gateExpected, printedTotal: sub.printedTotalBoost,
          playable: true, dispatchErr: playRes.ok ? null : playRes.err,
          midCounterBoost: mid.counterBoost, midLeaderModBattle: mid.aLeaderModBattle, midLeaderModOneShot: mid.aLeaderModOneShot,
          midFieldBattle: mid.aFieldModBattleSum, midFieldOneShot: mid.aFieldModOneShotSum,
          midPhase: mid.phase, midPendingKind: mid.pendingKind,
          histCounterPlayedBoost: hist.counterPlayedBoost,
          histDamageCounterBoost: hist.damageResolvedCounterBoost,
          histDamageTargetPower: hist.damageResolvedTargetPower,
          histClausesFired: hist.clausesFired, histClauseKinds: hist.clauseActionKinds,
          histAttackResolved: hist.attackResolved,
          totalObservedBoost: total, gateFired: hist.clausesFired > 0,
          combatLifeDelta: lifeAfter - lifeBefore,
          classification: cls.c, remediation: cls.r, confidence: cls.conf,
          notes: cls.notes,
        });
      }
    }

    // ── Report ────────────────────────────────────────────────────────
    console.log('\n=== Group 1B+1A+1D — counter-event condition-gated AUDIT ===');
    const cols = ['id', 'subcase', 'cardBoost', 'gateExp', 'gateFired', 'printed', 'midCB', 'leadBat', 'leadOS', 'fldBat', 'fldOS', 'total', 'lifeΔ', 'class', 'remed', 'conf'];
    console.log(cols.join('\t'));
    for (const r of results) {
      console.log([
        r.cardId, r.subcase, r.cardBoost, r.gateExpected, r.gateFired,
        r.printedTotal, r.midCounterBoost, r.midLeaderModBattle, r.midLeaderModOneShot,
        r.midFieldBattle, r.midFieldOneShot, r.totalObservedBoost, r.combatLifeDelta,
        r.classification, r.remediation, r.confidence,
      ].join('\t'));
      console.log('    note:', r.notes);
      console.log('    hist:', JSON.stringify({ cpBoost: r.histCounterPlayedBoost, drCounterBoost: r.histDamageCounterBoost, drTargetPower: r.histDamageTargetPower, clauses: r.histClausesFired, kinds: r.histClauseKinds }));
    }
    console.log('\n— Per-card consolidated classification + remediation —');
    const byCard = new Map<string, SubcaseResult[]>();
    for (const r of results) {
      const list = byCard.get(r.cardId) ?? [];
      list.push(r); byCard.set(r.cardId, list);
    }
    for (const [id, list] of byCard) {
      const classes = new Set(list.map((r) => r.classification));
      const remed = new Set(list.map((r) => r.remediation));
      const minConf = list.some((r) => r.confidence === 'LOW') ? 'LOW' : list.some((r) => r.confidence === 'MEDIUM') ? 'MEDIUM' : 'HIGH';
      const cClassif = classes.size === 1 ? Array.from(classes)[0]! : `MIXED:${Array.from(classes).join('|')}`;
      const cRemed = remed.size === 1 ? Array.from(remed)[0]! : `MIXED:${Array.from(remed).join('|')}`;
      console.log(`${id}\tclassif=${cClassif}\tremed=${cRemed}\tconf=${minConf}`);
    }
    console.log('=== END AUDIT ===\n');
    /* eslint-enable no-console */

    // Audit invariants — PASS iff data captured cleanly + no infra crash.
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
    const totalSubcases = CARDS.reduce((a, c) => a + c.subcases.length, 0);
    expect(results.length, `all ${totalSubcases} subcases iterated`).toBe(totalSubcases);

    // Guard assertion — prevent legality over-broadening.
    //
    // Seed a non-counter event control card: kind=event, counterEventBoost=0,
    // counterValue=null, effectTags has NO 'counter_event', no defensive
    // power_buff clause. Under the engine's counter-legality logic (Path
    // A OR (B AND C) at shared/engine-v2/rules/legality.ts), this card
    // MUST NOT be offered as PLAY_COUNTER:
    //   - Path A fails (boost=0)
    //   - Path B fails (no on_play power_buff targeting defender-side)
    //   - Path C fails (no 'counter_event' in effectTags)
    // If this guard fails, the legality logic has over-broadened.
    await resetForSubcase(page, { donCount: 1, aHandSize: 1, seedGuardCounter: true });
    const ctrlIid = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
      const s = w.__store!.getState().state as Record<string, unknown>;
      const lib = s.cardLibrary as Record<string, unknown>;
      const inst = s.instances as Record<string, unknown>;
      const players = s.players as { A: { hand: string[] } };
      const synthId = `__nonCounterControl_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `nonCtrl_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: 'Non-Counter Control', kind: 'event',
        cost: 1, power: null, counterValue: null,
        counterEventBoost: 0,
        colors: ['red'], traits: [], keywords: [],
        effectTags: ['draw'], // NO 'counter_event'
        effectText: '',
        effectSpecV2: {
          clauses: [
            // Non-defensive action — draw. Not a defensive power_buff.
            { trigger: 'on_play', action: { kind: 'draw', magnitude: 1 }, verified: 'human-reviewed' },
          ],
          continuous: [], replacements: [], schemaVersion: 2, verified: 'human-reviewed',
        },
      };
      inst[iid] = {
        instanceId: iid, cardId: synthId, controller: 'A',
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
    });
    await enterCounterWindow(page);
    const ctrlOffered = await legalCounterIds(page);
    /* eslint-disable no-console */
    console.log('\n[GUARD] non-counter event control iid:', ctrlIid, 'offered PLAY_COUNTER?', ctrlOffered.includes(ctrlIid));
    /* eslint-enable no-console */
    expect(ctrlOffered, 'non-counter event MUST NOT be offered as PLAY_COUNTER (over-broadening guard)').not.toContain(ctrlIid);
    // Drain pending so the audit-end no-stuck-pending check passes.
    if (await readPendingKind(page) === 'attack') {
      await dispatchAs(page, { type: 'SKIP_COUNTER' });
    }

    // ── Safety check (engine fix at EffectDispatcher.ts:270) ─────────
    // Confirms that the patched dispatcher STILL suspends clause iteration
    // when a clause action creates a NON-attack interactive pending. We
    // construct a synthetic 2-clause counter event:
    //   clause[0] action: add_to_own_life_top with position='controller_choice'
    //                     → suspendLifePositionChoice → pending.kind='choose_one'
    //   clause[1] action: power_buff +5000 this_battle target=your_leader_or_character
    //                     (would be observable as leader.powerModifierThisBattle = 5000)
    // If the dispatcher correctly breaks on pending.kind='choose_one',
    // clause[1] MUST NOT fire and leader's powerModifierThisBattle stays 0.
    // (If the patch had been overzealous and skipped the break on every
    // pending kind, clause[1] would fire and leader mod would be 5000.)
    await resetForSubcase(page, { donCount: 0, aHandSize: 0, seedGuardCounter: true });
    const safetyCardId = `__safetyCounter_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const safetyIid = await page.evaluate(({ cardId }) => {
      const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
      const s = w.__store!.getState().state as Record<string, unknown>;
      const lib = s.cardLibrary as Record<string, unknown>;
      const inst = s.instances as Record<string, unknown>;
      const players = s.players as { A: { hand: string[]; deck: string[] } };
      lib[cardId] = {
        id: cardId, name: 'Safety Suspending Counter', kind: 'event',
        cost: 0, power: null, counterValue: null, counterEventBoost: 0,
        colors: ['red'], traits: [], keywords: [],
        effectTags: ['counter_event'],
        effectText: '',
        effectSpecV2: {
          clauses: [
            {
              trigger: 'on_play',
              action: { kind: 'add_to_own_life_top', from: 'top_of_deck', position: 'controller_choice' },
              verified: 'human-reviewed',
            },
            {
              trigger: 'on_play',
              action: { kind: 'power_buff', magnitude: 5000, duration: 'this_battle' },
              target: { kind: 'your_leader_or_character' },
              verified: 'human-reviewed',
            },
          ],
          continuous: [], replacements: [], schemaVersion: 2, verified: 'human-reviewed',
        },
      };
      const iid = `safetyCEv_${Math.floor(Math.random() * 1e9).toString(36)}`;
      inst[iid] = {
        instanceId: iid, cardId, controller: 'A',
        rested: false, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      players.A.hand = [...players.A.hand, iid];
      // Ensure A.deck has at least 1 card for add_to_own_life_top to pull from.
      if (players.A.deck.length === 0) {
        const synthCardId = `__safetyDeckCard_${Math.floor(Math.random() * 1e9).toString(36)}`;
        const synthIid = `safetyDeck_${Math.floor(Math.random() * 1e9).toString(36)}`;
        lib[synthCardId] = {
          id: synthCardId, name: 'Safety Deck Card', kind: 'character',
          cost: 1, power: 1000, counterValue: 1000,
          colors: ['red'], traits: [], keywords: [], effectText: '',
        };
        inst[synthIid] = {
          instanceId: synthIid, cardId: synthCardId, controller: 'A',
          rested: false, summoningSick: false,
          attachedDon: [], attachedDonRested: [],
          perTurn: { hasAttacked: false, effectsUsed: [] },
        };
        players.A.deck = [...players.A.deck, synthIid];
      }
      w.__store!.setState({ state: { ...s } });
      if (w.__getLegalActions) {
        const next = w.__store!.getState().state as { activePlayer: string };
        w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
      }
      return iid;
    }, { cardId: safetyCardId });
    await enterCounterWindow(page);
    const safetyOffered = await legalCounterIds(page);
    expect(safetyOffered, 'safety synthetic counter must be offered as PLAY_COUNTER').toContain(safetyIid);
    await dispatchAs(page, { type: 'PLAY_COUNTER', instanceId: safetyIid });
    const safetyState = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: { phase: string; pending: { kind?: string } | null; players: { A: { leader: { powerModifierThisBattle?: number; powerModifierOneShot?: number } } } } } } };
      const s = w.__store!.getState().state;
      return {
        phase: s.phase,
        pendingKind: s.pending?.kind ?? null,
        leaderModBattle: s.players.A.leader.powerModifierThisBattle ?? 0,
        leaderModOneShot: s.players.A.leader.powerModifierOneShot ?? 0,
      };
    });
    /* eslint-disable no-console */
    console.log('\n[SAFETY] post-PLAY_COUNTER state:', JSON.stringify(safetyState));
    /* eslint-enable no-console */
    expect(safetyState.pendingKind, 'safety: clause[0] suspends on choose_one pending').toBe('choose_one');
    expect(safetyState.leaderModBattle, 'safety: clause[1] +5000 power_buff MUST NOT fire (dispatcher must still break on non-attack pending)').toBe(0);
    expect(safetyState.leaderModOneShot, 'safety: no this_turn buff either').toBe(0);
    // Clean up: drain remaining pending. The choose_one option may
    // re-suspend or transition through phases; iterate up to 5 times.
    for (let i = 0; i < 5; i++) {
      const pk = await readPendingKind(page);
      if (pk === null) break;
      if (pk === 'attack') await dispatchAs(page, { type: 'SKIP_COUNTER' });
      else if (pk === 'choose_one') await dispatchAs(page, { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 });
      else if (pk === 'trigger') await dispatchAs(page, { type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null });
      else break;
    }
    // Final force-clean if still stuck (safety-check cleanup only; the
    // assertion above already verified the patched dispatcher behavior).
    if (await readPendingKind(page) !== null) {
      await page.evaluate(() => {
        const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown }) => void } };
        const s = w.__store!.getState().state as Record<string, unknown>;
        (s as { pending: unknown }).pending = null;
        (s as { phase: string }).phase = 'main';
        w.__store!.setState({ state: { ...s } });
      });
    }

    expect(await readPendingKind(page), 'no stuck pending at audit end').toBeNull();
  });
});
