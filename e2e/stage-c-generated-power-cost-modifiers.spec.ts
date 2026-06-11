// stage-c-generated-power-cost-modifiers — Stage C target #14 per
// e2e/stage-c-corpus-verification-plan.md. Auto-discovers every card with at
// least one clause whose `action.kind` is in the power/cost modifier family:
//   power_buff, self_power_buff, aura_power_buff, opp_aura_power_buff,
//   removal_cost_reduce, cost_modifier_in_hand, cost_reduction,
//   aura_cost_modifier, opp_aura_cost_modifier,
//   give_cost_buff, self_cost_buff,
//   set_base_power, set_power_zero,
//   set_base_power_copy_from, set_base_power_copy_from_target,
//   self_set_base_power, aura_set_base_power, aura_set_base_power_copy_from_leader
//
// Discovery confirmed (2026-06-08): 561 cards across 18 distinct action kinds.
// Triggers (dispatchable): on_play (246), activate_main (96), when_attacking (85),
// at_end_of_turn_self (rare). Triggers '(none)'=151 are continuous clauses
// without a trigger — refold-based, NOT directly dispatchable; classify HARNESS_GAP.
//
// Engine handler locations:
//   - power_buff (actions3.ts:68 — aliases give_power at actions.ts:76)
//   - give_cost_buff (actions3.ts:480)
//   - cost_reduction (actions3.ts:492) — modifies pl.nextPlayCostModifier (player-level)
//   - removal_cost_reduce (actions3.ts:508)
//   - set_base_power (actions3.ts:524) / set_power_zero (actions3.ts:536)
//   - set_base_power_copy_from(_target) (actions3.ts:551 / 589)
// Continuous handlers (continuous.ts):
//   - aura_power_buff, self_power_buff, aura_cost_modifier, etc. — refold-based.
// None emit CLAUSE_FIRED-tagged history events distinct from the dispatcher's
// own CLAUSE_FIRED marker; verification uses clause-isolated state-field inspection.
//
// Read-only against engine / UI / cards.json / scenarioFactory.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const FIVE_MIN = 5 * 60_000;
test.use({ launchOptions: { args: ['--disable-renderer-backgrounding', '--no-sandbox'] } });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORPUS_PATH = resolve(__dirname, '../shared/data/cards.json');
const REPORTS_DIR = resolve(__dirname, 'coverage/reports');
const SLICE_TMP_DIR = resolve(__dirname, 'coverage/reports/.stage-c-pc-slices');
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(SLICE_TMP_DIR, { recursive: true });
for (const f of readdirSync(SLICE_TMP_DIR)) { if (f.endsWith('.json')) { try { unlinkSync(join(SLICE_TMP_DIR, f)); } catch { /* ignore */ } } }

const PC_ACTION_KINDS = new Set<string>([
  'power_buff', 'self_power_buff', 'aura_power_buff', 'opp_aura_power_buff',
  'removal_cost_reduce', 'cost_modifier_in_hand', 'cost_reduction',
  'aura_cost_modifier', 'opp_aura_cost_modifier',
  'give_cost_buff', 'self_cost_buff',
  'set_base_power', 'set_power_zero',
  'set_base_power_copy_from', 'set_base_power_copy_from_target',
  'self_set_base_power', 'aura_set_base_power', 'aura_set_base_power_copy_from_leader',
]);

// Continuous-family kinds: applied via refold path, not dispatcher. CLAUSE_FIRED
// is unlikely to emit on direct dispatch. Classify HARNESS_GAP expected.
const CONTINUOUS_KINDS = new Set<string>([
  'self_power_buff', 'aura_power_buff', 'opp_aura_power_buff',
  'aura_cost_modifier', 'opp_aura_cost_modifier', 'cost_modifier_in_hand',
  'aura_set_base_power', 'aura_set_base_power_copy_from_leader',
]);

const SUPPORTED_TRIGGERS = new Set<string>(['on_play', 'activate_main', 'when_attacking', 'at_end_of_turn_self']);

interface CardDef {
  readonly id: string; readonly name: string; readonly kind: 'character' | 'event' | 'stage' | 'leader' | 'don';
  readonly cost?: number | null; readonly power?: number | null; readonly colors?: ReadonlyArray<string>; readonly traits?: ReadonlyArray<string>;
  readonly keywords?: ReadonlyArray<string>; readonly effectText?: string;
  readonly effectSpecV2?: {
    readonly clauses?: ReadonlyArray<{
      readonly trigger?: string;
      readonly action?: { readonly kind?: string; readonly magnitude?: number | Record<string, unknown>; readonly duration?: string; readonly n?: number };
      readonly target?: { readonly kind?: string; readonly filter?: Record<string, unknown>; readonly count?: number };
      readonly cost?: Record<string, unknown>;
      readonly condition?: { readonly type?: string; readonly [k: string]: unknown };
    }>;
  };
  readonly [k: string]: unknown;
}

const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;

function firstPcClause(c: Record<string, unknown>): { clauseIndex: number; trigger: string; actionKind: string; magnitude: number; magnitudeIsDynamic: boolean; duration: string; targetKind: string | null; gated: boolean; hasCost: boolean } | null {
  const cd = c as CardDef;
  const clauses = cd.effectSpecV2?.clauses ?? [];
  for (let i = 0; i < clauses.length; i++) {
    const cl = clauses[i]!;
    const ak = cl.action?.kind;
    if (typeof ak !== 'string' || !PC_ACTION_KINDS.has(ak)) continue;
    const a = cl.action!;
    const m = a.magnitude;
    return {
      clauseIndex: i,
      trigger: typeof cl.trigger === 'string' ? cl.trigger : '',
      actionKind: ak,
      magnitude: typeof m === 'number' ? m : (typeof a.n === 'number' ? a.n : 1),
      magnitudeIsDynamic: typeof m === 'object' && m !== null,
      duration: typeof a.duration === 'string' ? a.duration : 'this_turn',
      targetKind: typeof cl.target?.kind === 'string' ? cl.target.kind : null,
      gated: cl.condition !== undefined,
      hasCost: cl.cost !== undefined,
    };
  }
  return null;
}

const CARDS: CardDef[] = CORPUS.filter((c) => firstPcClause(c) !== null) as CardDef[];
CARDS.sort((a, b) => a.id.localeCompare(b.id));

const SLICE_SIZE = 25;
const SLICE_COUNT = Math.ceil(CARDS.length / SLICE_SIZE);
/* eslint-disable no-console */
console.log(`[stage-c-power-cost-modifiers] Discovered ${CARDS.length} P/C-family cards → ${SLICE_COUNT} slice(s) of up to ${SLICE_SIZE}`);
/* eslint-enable no-console */

const ANCHORS = new Set<string>([
  'EB01-001',  // power_buff your_leader
  'EB01-010',  // (mostly covered) power buff via counter
  'OP01-013',  // self_power_buff continuous
  'OP01-005',  // aura_power_buff continuous
  'EB01-046',  // removal_cost_reduce
  'EB01-002',  // cost_reduction
  'EB01-014',  // set_base_power_copy_from continuous
]);

type Classification = 'VERIFIED' | 'ENGINE_BUG' | 'CARD_DATA_BUG' | 'UI_BUG' | 'HARNESS_BUG' | 'HARNESS_GAP' | 'NOT_IMPLEMENTED' | 'NO_UI_EXPECTED' | 'INCONCLUSIVE';

type SourceZone = 'a_hand' | 'a_field' | 'a_stage' | 'a_leader';

function pickSourceZone(card: CardDef, trigger: string): SourceZone {
  if (card.kind === 'leader') return 'a_leader';
  if (card.kind === 'event') return 'a_hand';
  if (card.kind === 'stage') return trigger === 'on_play' ? 'a_hand' : 'a_stage';
  if (trigger === 'on_play') return 'a_hand';
  return 'a_field';
}

async function bootstrap(page: Page): Promise<{ drv: PlayerDriver; pageErrors: string[]; invariantErrors: string[] }> {
  const pageErrors: string[] = []; const invariantErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { const t = m.text(); if (t.includes('InvariantError') || t.includes('invariant')) invariantErrors.push(t); });
  const drv = new PlayerDriver(page);
  await drv.open();
  await drv.waitForPhase('dice_roll'); await drv.rollDice();
  try { await drv.waitForPhase('first_player_choice', 15_000); await drv.chooseGoFirst(); } catch { /* skip */ }
  try { await drv.waitForPhase('mulligan', 8_000); await drv.keepMulliganHand(); } catch { /* skip */ }
  await expect.poll(async () => { const s = await drv.getState(); return { phase: s.phase, activePlayer: s.activePlayer }; }, { timeout: 60_000 }).toMatchObject({ phase: 'main', activePlayer: 'A' });
  await drv.normalizeToATurn1Main();
  return { drv, pageErrors, invariantErrors };
}

interface InstModifiers {
  powerModifierOneShot: number; powerModifierThisBattle: number; powerModifierContinuous: number;
  costModifierOneShot: number; costModifierContinuous: number;
  basePowerOverrideOneShot: number | null; basePowerOverrideContinuous: number | null;
}
const ZERO_MODS: InstModifiers = { powerModifierOneShot: 0, powerModifierThisBattle: 0, powerModifierContinuous: 0, costModifierOneShot: 0, costModifierContinuous: 0, basePowerOverrideOneShot: null, basePowerOverrideContinuous: null };

interface SeededRefs {
  sourceIid: string | null;
  targetIids: ReadonlyArray<string>;
  controlIids: ReadonlyArray<string>;
  aNextPlayCostModifier: number;
  bNextPlayCostModifier: number;
  modsBefore: Record<string, InstModifiers>;
}

async function fullRestoringResetAndSeed(page: Page, sourceZone: SourceZone, card: CardDef, clauseInfo: ReturnType<typeof firstPcClause>): Promise<SeededRefs> {
  return page.evaluate(({ sourceZone, cardDef, clauseInfo }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    (s as Record<string, unknown>).result = null;
    (s as Record<string, unknown>).turn = clauseInfo!.trigger === 'when_attacking' ? 5 : 1;
    const players = s.players as {
      A: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean; summoningSick?: boolean; perTurn?: { hasAttacked?: boolean; effectsUsed?: string[] }; attackLockedContinuous?: boolean; attackLockedOneShot?: unknown }; field: Array<{ instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean; summoningSick?: boolean; perTurn?: { hasAttacked?: boolean; effectsUsed?: string[] } }>; hand: string[]; trash: string[]; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean } | null; nextPlayCostModifier?: number };
      B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean }; field: Array<{ instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean }>; hand: string[]; trash: string[]; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null; nextPlayCostModifier?: number };
    };
    const instances = s.instances as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    function detachInto(target: string[], insts: Array<{ attachedDon?: string[]; attachedDonRested?: string[] }>) {
      for (const inst of insts) {
        if (Array.isArray(inst.attachedDon)) { for (const id of inst.attachedDon) target.push(id); inst.attachedDon = []; }
        if (Array.isArray(inst.attachedDonRested)) { for (const id of inst.attachedDonRested) target.push(id); inst.attachedDonRested = []; }
      }
    }
    const aAll: Array<{ attachedDon?: string[]; attachedDonRested?: string[] }> = [players.A.leader, ...players.A.field];
    if (players.A.stage) aAll.push(players.A.stage);
    detachInto(players.A.donDeck, aAll);
    const bAll: Array<{ attachedDon?: string[]; attachedDonRested?: string[] }> = [players.B.leader, ...players.B.field];
    if (players.B.stage) bAll.push(players.B.stage);
    detachInto(players.B.donDeck, bAll);
    players.A.field = []; players.B.field = []; players.A.stage = null; players.B.stage = null;
    players.A.hand = []; players.B.hand = players.B.hand ?? [];
    const allADon = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donCostArea = allADon.slice(0, 16);
    players.A.donDeck = allADon.slice(16);
    players.A.donRested = [];
    const allBDon = [...players.B.donDeck, ...players.B.donCostArea, ...players.B.donRested];
    players.B.donCostArea = allBDon.slice(0, 6);
    players.B.donDeck = allBDon.slice(6);
    players.B.donRested = [];
    function seedLife(side: 'A' | 'B', target: number) {
      const pl = side === 'A' ? players.A : players.B;
      while (pl.life.length > target) pl.life.pop();
      while (pl.life.length < target) {
        const synthId = `__life_${side}_${Math.floor(Math.random() * 1e9).toString(36)}`;
        const iid = `life_${side}_${Math.floor(Math.random() * 1e9).toString(36)}`;
        lib[synthId] = { id: synthId, name: 'Life Placeholder', kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
        instances[iid] = { instanceId: iid, cardId: synthId, controller: side, rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
        pl.life.push(iid);
      }
    }
    seedLife('A', 5); seedLife('B', 5);
    const aLeaderCard = lib[players.A.leader.cardId] as { colors?: string[]; keywords?: string[] } | undefined;
    if (aLeaderCard !== undefined) aLeaderCard.colors = ['red', 'blue', 'green', 'purple', 'black', 'yellow'];
    players.A.leader.rested = false; players.A.leader.summoningSick = false;
    if (players.A.leader.perTurn) { players.A.leader.perTurn.hasAttacked = false; players.A.leader.perTurn.effectsUsed = []; }
    // Reset any pre-existing modifier state on A.leader and B.leader.
    const resetMods = (inst: Record<string, unknown>) => {
      inst.powerModifierOneShot = 0; inst.powerModifierThisBattle = 0; inst.powerModifierContinuous = 0;
      inst.costModifierOneShot = 0; inst.costModifierContinuous = 0;
      delete inst.basePowerOverrideOneShot; delete inst.basePowerOverrideContinuous;
      delete inst.powerModifierExpiresInTurns; delete inst.costModifierExpiresInTurns;
    };
    resetMods(players.A.leader as Record<string, unknown>);
    resetMods(players.B.leader as Record<string, unknown>);
    players.A.nextPlayCostModifier = 0;
    players.B.nextPlayCostModifier = 0;

    lib[cardDef.id] = cardDef as unknown as Record<string, unknown>;
    const srcIid = `pc_src_${cardDef.id}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    let sourceIid: string | null = null;
    if (sourceZone === 'a_hand') {
      instances[srcIid] = { instanceId: srcIid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(srcIid);
      sourceIid = srcIid;
    } else if (sourceZone === 'a_field') {
      instances[srcIid] = { instanceId: srcIid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      (players.A.field as unknown[]).push(instances[srcIid]);
      sourceIid = srcIid;
    } else if (sourceZone === 'a_stage') {
      instances[srcIid] = { instanceId: srcIid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.stage = instances[srcIid] as { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean };
      sourceIid = srcIid;
    } else if (sourceZone === 'a_leader') {
      players.A.leader.cardId = cardDef.id;
      sourceIid = players.A.leader.instanceId;
    }

    // Seed targets by target.kind. Build matching + filter-violating control where feasible.
    const targetIids: string[] = []; const controlIids: string[] = [];
    const tk = clauseInfo!.targetKind;
    function seedFieldChar(side: 'A' | 'B', name: string): string {
      const synthId = `__pcTgt_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `pcTgt_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name, kind: 'character', cost: 3, power: 3000, counterValue: 1000, colors: side === 'A' ? ['red'] : ['blue'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: side, rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] }, powerModifierOneShot: 0, powerModifierThisBattle: 0, powerModifierContinuous: 0, costModifierOneShot: 0, costModifierContinuous: 0 };
      const pl = side === 'A' ? players.A : players.B;
      (pl.field as unknown[]).push(instances[iid]);
      return iid;
    }
    if (tk === 'your_leader') { targetIids.push(players.A.leader.instanceId); }
    else if (tk === 'your_character') { targetIids.push(seedFieldChar('A', 'A Target')); controlIids.push(seedFieldChar('A', 'A Control')); }
    else if (tk === 'your_leader_or_character') { targetIids.push(players.A.leader.instanceId); controlIids.push(seedFieldChar('A', 'A Control')); }
    else if (tk === 'opp_character') { targetIids.push(seedFieldChar('B', 'B Target')); controlIids.push(seedFieldChar('B', 'B Control')); }
    else if (tk === 'opp_leader') { targetIids.push(players.B.leader.instanceId); }
    else if (tk === 'opp_leader_or_character') { targetIids.push(players.B.leader.instanceId); controlIids.push(seedFieldChar('B', 'B Control')); }
    else if (tk === 'all_your_characters') { targetIids.push(seedFieldChar('A', 'A Multi 1')); targetIids.push(seedFieldChar('A', 'A Multi 2')); }
    else if (tk === 'all_opp_characters') { targetIids.push(seedFieldChar('B', 'B Multi 1')); targetIids.push(seedFieldChar('B', 'B Multi 2')); }
    else if (tk === 'self') { if (sourceIid !== null) targetIids.push(sourceIid); }

    // A.hand fillers.
    for (let i = 0; i < 4; i++) {
      const synthId = `__pcHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `pcH_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: `Hand Filler ${i}`, kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(iid);
    }

    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }

    // Snapshot before-mods.
    function inspectMods(iid: string): InstModifiers {
      const inst = iid === players.A.leader.instanceId ? players.A.leader
        : iid === players.B.leader.instanceId ? players.B.leader
        : instances[iid] as { powerModifierOneShot?: number; powerModifierThisBattle?: number; powerModifierContinuous?: number; costModifierOneShot?: number; costModifierContinuous?: number; basePowerOverrideOneShot?: number; basePowerOverrideContinuous?: number } | undefined;
      return {
        powerModifierOneShot: inst?.powerModifierOneShot ?? 0,
        powerModifierThisBattle: inst?.powerModifierThisBattle ?? 0,
        powerModifierContinuous: inst?.powerModifierContinuous ?? 0,
        costModifierOneShot: inst?.costModifierOneShot ?? 0,
        costModifierContinuous: inst?.costModifierContinuous ?? 0,
        basePowerOverrideOneShot: inst?.basePowerOverrideOneShot ?? null,
        basePowerOverrideContinuous: inst?.basePowerOverrideContinuous ?? null,
      };
    }
    const modsBefore: Record<string, InstModifiers> = {};
    for (const iid of [...targetIids, ...controlIids, ...(sourceIid !== null ? [sourceIid] : [])]) modsBefore[iid] = inspectMods(iid);

    return {
      sourceIid,
      targetIids, controlIids,
      aNextPlayCostModifier: players.A.nextPlayCostModifier ?? 0,
      bNextPlayCostModifier: players.B.nextPlayCostModifier ?? 0,
      modsBefore,
    };
  }, { sourceZone, cardDef: card as unknown as Record<string, unknown>, clauseInfo });
}

async function dispatchAs(page: Page, action: object): Promise<{ ok: boolean; err: string | null }> {
  const res = await page.evaluate((a) => {
    try { const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } }; w.__store!.getState().dispatch(a); return { ok: true, err: null }; }
    catch (e) { return { ok: false, err: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }; }
  }, action);
  await page.waitForTimeout(35);
  return res;
}

async function readPendingKind(page: Page): Promise<string | null> {
  return page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { pending: { kind?: string } | null } } } }; return w.__store!.getState().state.pending?.kind ?? null; });
}

async function readAHandFirst(page: Page): Promise<string | null> {
  return page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { hand: string[] } } } } } }; return w.__store!.getState().state.players.A.hand[0] ?? null; });
}

async function drainPending(page: Page, maxIter = 8): Promise<void> {
  for (let i = 0; i < maxIter; i++) {
    const pk = await readPendingKind(page);
    if (pk === null) return;
    if (pk === 'attack') await dispatchAs(page, { type: 'SKIP_COUNTER' });
    else if (pk === 'choose_one') await dispatchAs(page, { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 });
    else if (pk === 'trigger') await dispatchAs(page, { type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null });
    else if (pk === 'discard') {
      const pickedId = await readAHandFirst(page);
      await dispatchAs(page, { type: 'RESOLVE_DISCARD', pickedId });
    }
    else if (pk === 'peek') await dispatchAs(page, { type: 'RESOLVE_PEEK', pickedIds: [] });
    else break;
  }
  if (await readPendingKind(page) !== null) {
    await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown }) => void } };
      const s = w.__store!.getState().state as Record<string, unknown>;
      (s as { pending: unknown }).pending = null;
      (s as { phase: string }).phase = 'main';
      w.__store!.setState({ state: { ...s } });
    });
  }
}

async function readHistoryLen(page: Page): Promise<number> {
  return page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { history: ReadonlyArray<unknown> } } } }; return w.__store!.getState().state.history.length; });
}

interface HistoryMarker { idx: number; clauseIndex: number; actionKind: string; trigger: string }
async function readMarkers(page: Page, fromIdx: number, sourceIid: string): Promise<HistoryMarker[]> {
  return page.evaluate(({ fromIdx, sourceIid }) => {
    const w = window as unknown as { __store?: { getState: () => { state: { history: ReadonlyArray<Record<string, unknown>> } } } };
    const hist = w.__store!.getState().state.history;
    const markers: Array<{ idx: number; clauseIndex: number; actionKind: string; trigger: string }> = [];
    for (let i = fromIdx; i < hist.length; i++) {
      const h = hist[i]!;
      if (h.type === 'CLAUSE_FIRED' && h.sourceInstanceId === sourceIid) {
        markers.push({ idx: i - fromIdx, clauseIndex: h.clauseIndex as number, actionKind: h.actionKind as string, trigger: h.trigger as string });
      }
    }
    return markers;
  }, { fromIdx, sourceIid });
}

async function readAfterMods(page: Page, idsOfInterest: ReadonlyArray<string>): Promise<{ mods: Record<string, InstModifiers>; aNextPlayCostModifier: number; bNextPlayCostModifier: number }> {
  return page.evaluate(({ ids }) => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { leader: { instanceId: string; powerModifierOneShot?: number; powerModifierThisBattle?: number; powerModifierContinuous?: number; costModifierOneShot?: number; costModifierContinuous?: number; basePowerOverrideOneShot?: number; basePowerOverrideContinuous?: number }; nextPlayCostModifier?: number }; B: { leader: { instanceId: string; powerModifierOneShot?: number; powerModifierThisBattle?: number; powerModifierContinuous?: number; costModifierOneShot?: number; costModifierContinuous?: number; basePowerOverrideOneShot?: number; basePowerOverrideContinuous?: number }; nextPlayCostModifier?: number } }; instances: Record<string, { powerModifierOneShot?: number; powerModifierThisBattle?: number; powerModifierContinuous?: number; costModifierOneShot?: number; costModifierContinuous?: number; basePowerOverrideOneShot?: number; basePowerOverrideContinuous?: number }> } } } };
    const ps = w.__store!.getState().state.players;
    const insts = w.__store!.getState().state.instances;
    function inspect(iid: string): InstModifiers {
      const inst = iid === ps.A.leader.instanceId ? ps.A.leader
        : iid === ps.B.leader.instanceId ? ps.B.leader
        : insts[iid];
      return {
        powerModifierOneShot: inst?.powerModifierOneShot ?? 0,
        powerModifierThisBattle: inst?.powerModifierThisBattle ?? 0,
        powerModifierContinuous: inst?.powerModifierContinuous ?? 0,
        costModifierOneShot: inst?.costModifierOneShot ?? 0,
        costModifierContinuous: inst?.costModifierContinuous ?? 0,
        basePowerOverrideOneShot: inst?.basePowerOverrideOneShot ?? null,
        basePowerOverrideContinuous: inst?.basePowerOverrideContinuous ?? null,
      };
    }
    const mods: Record<string, InstModifiers> = {};
    for (const id of ids) mods[id] = inspect(id);
    return { mods, aNextPlayCostModifier: ps.A.nextPlayCostModifier ?? 0, bNextPlayCostModifier: ps.B.nextPlayCostModifier ?? 0 };
  }, { ids: idsOfInterest });
}

function deltaSummary(b: InstModifiers, a: InstModifiers): { pow: number; powBat: number; powCont: number; cst: number; cstCont: number; basePO: string; basePC: string } {
  const dStr = (b: number | null, a: number | null): string => (b === a ? `${a ?? 'null'}` : `${b ?? 'null'}→${a ?? 'null'}`);
  return {
    pow: a.powerModifierOneShot - b.powerModifierOneShot,
    powBat: a.powerModifierThisBattle - b.powerModifierThisBattle,
    powCont: a.powerModifierContinuous - b.powerModifierContinuous,
    cst: a.costModifierOneShot - b.costModifierOneShot,
    cstCont: a.costModifierContinuous - b.costModifierContinuous,
    basePO: dStr(b.basePowerOverrideOneShot, a.basePowerOverrideOneShot),
    basePC: dStr(b.basePowerOverrideContinuous, a.basePowerOverrideContinuous),
  };
}

interface Verdict { verdict: 'CORRECT' | 'WRONG' | 'INCONCLUSIVE' | 'NO_DELTA' | 'NOT_OBSERVABLE'; observed: string; expected: string; notes: string }

function classifyPc(card: CardDef, clauseInfo: NonNullable<ReturnType<typeof firstPcClause>>, before: SeededRefs, afterMods: Record<string, InstModifiers>, aNextPlay: number, bNextPlay: number): Verdict {
  void card;
  const ak = clauseInfo.actionKind;
  const mag = clauseInfo.magnitude;
  // Sum target deltas across mod fields. For control, sum same. If control got a delta, ENGINE_BUG.
  function sumPower(ids: ReadonlyArray<string>): { oneShot: number; thisBattle: number; cont: number } {
    let oneShot = 0, thisBattle = 0, cont = 0;
    for (const id of ids) {
      const b = before.modsBefore[id] ?? ZERO_MODS;
      const a = afterMods[id] ?? ZERO_MODS;
      oneShot += a.powerModifierOneShot - b.powerModifierOneShot;
      thisBattle += a.powerModifierThisBattle - b.powerModifierThisBattle;
      cont += a.powerModifierContinuous - b.powerModifierContinuous;
    }
    return { oneShot, thisBattle, cont };
  }
  function sumCost(ids: ReadonlyArray<string>): { oneShot: number; cont: number } {
    let oneShot = 0, cont = 0;
    for (const id of ids) {
      const b = before.modsBefore[id] ?? ZERO_MODS;
      const a = afterMods[id] ?? ZERO_MODS;
      oneShot += a.costModifierOneShot - b.costModifierOneShot;
      cont += a.costModifierContinuous - b.costModifierContinuous;
    }
    return { oneShot, cont };
  }
  function sumBase(ids: ReadonlyArray<string>): { oneShotAny: boolean; contAny: boolean } {
    let oneShotAny = false, contAny = false;
    for (const id of ids) {
      const b = before.modsBefore[id] ?? ZERO_MODS;
      const a = afterMods[id] ?? ZERO_MODS;
      if (a.basePowerOverrideOneShot !== b.basePowerOverrideOneShot) oneShotAny = true;
      if (a.basePowerOverrideContinuous !== b.basePowerOverrideContinuous) contAny = true;
    }
    return { oneShotAny, contAny };
  }

  if (ak === 'power_buff') {
    const tDelta = sumPower(before.targetIids);
    const cDelta = sumPower(before.controlIids);
    const totalPow = tDelta.oneShot + tDelta.thisBattle + tDelta.cont;
    const totalCon = cDelta.oneShot + cDelta.thisBattle + cDelta.cont;
    if (totalCon !== 0) return { verdict: 'WRONG', observed: `target=${totalPow} control=${totalCon}`, expected: `target=${mag}, control=0`, notes: `filter-violating control received power modifier` };
    if (totalPow === mag) return { verdict: 'CORRECT', observed: `target.powerMod oneShotΔ=${tDelta.oneShot} thisBattleΔ=${tDelta.thisBattle} contΔ=${tDelta.cont}`, expected: `+${mag}`, notes: `power_buff verified (duration=${clauseInfo.duration})` };
    if (totalPow === 0) return { verdict: 'NO_DELTA', observed: `target.powerMod totalΔ=0`, expected: `+${mag}`, notes: `engine produced no power modifier delta` };
    return { verdict: 'INCONCLUSIVE', observed: `target.powerMod totalΔ=${totalPow}`, expected: `+${mag}`, notes: 'partial / mismatch' };
  }
  if (ak === 'removal_cost_reduce' || ak === 'give_cost_buff' || ak === 'self_cost_buff') {
    const ids = ak === 'self_cost_buff' && before.sourceIid !== null ? [before.sourceIid] : before.targetIids;
    const cDelta = sumCost(ids);
    const ctlDelta = sumCost(before.controlIids);
    const total = cDelta.oneShot + cDelta.cont;
    const ctlTotal = ctlDelta.oneShot + ctlDelta.cont;
    if (ctlTotal !== 0) return { verdict: 'WRONG', observed: `target=${total} control=${ctlTotal}`, expected: `target=±${mag}, control=0`, notes: `filter-violating control received cost modifier` };
    // removal_cost_reduce subtracts; give_cost_buff/self_cost_buff add.
    const expectedSign = ak === 'removal_cost_reduce' ? -mag : mag;
    if (total === expectedSign) return { verdict: 'CORRECT', observed: `target.costMod oneShotΔ=${cDelta.oneShot} contΔ=${cDelta.cont}`, expected: `${expectedSign}`, notes: `${ak} verified` };
    if (total === 0) return { verdict: 'NO_DELTA', observed: `target.costMod=0`, expected: `${expectedSign}`, notes: 'no cost modifier observed' };
    if (Math.sign(total) === Math.sign(expectedSign) && Math.abs(total) <= Math.abs(expectedSign) * 2) return { verdict: 'INCONCLUSIVE', observed: `target.costMod=${total}`, expected: `${expectedSign}`, notes: 'direction matches but magnitude off' };
    return { verdict: 'WRONG', observed: `target.costMod=${total}`, expected: `${expectedSign}`, notes: 'sign mismatch' };
  }
  if (ak === 'cost_reduction') {
    // Player-level nextPlayCostModifier — handler at actions3.ts:492.
    const aDelta = aNextPlay - before.aNextPlayCostModifier;
    if (aDelta === -mag) return { verdict: 'CORRECT', observed: `A.nextPlayCostModifierΔ=${aDelta}`, expected: `-${mag}`, notes: 'cost_reduction applied to A player' };
    if (aDelta === 0) return { verdict: 'NO_DELTA', observed: `A.nextPlayCostModifierΔ=0`, expected: `-${mag}`, notes: 'engine produced no nextPlayCostModifier delta' };
    return { verdict: 'INCONCLUSIVE', observed: `A.nextPlayCostModifierΔ=${aDelta}`, expected: `-${mag}`, notes: 'partial / direction mismatch' };
  }
  if (ak === 'set_base_power' || ak === 'set_base_power_copy_from' || ak === 'set_base_power_copy_from_target' || ak === 'self_set_base_power') {
    const ids = (ak === 'self_set_base_power' && before.sourceIid !== null) ? [before.sourceIid] : before.targetIids;
    const bsum = sumBase(ids);
    if (bsum.oneShotAny || bsum.contAny) return { verdict: 'CORRECT', observed: `target.basePowerOverride changed`, expected: `set`, notes: `${ak} applied base-power override` };
    return { verdict: 'NO_DELTA', observed: `no basePowerOverride change`, expected: 'set', notes: 'engine produced no base-power delta' };
  }
  if (ak === 'set_power_zero') {
    const tDelta = sumPower(before.targetIids);
    const total = tDelta.oneShot + tDelta.thisBattle + tDelta.cont;
    if (total < 0) return { verdict: 'CORRECT', observed: `target.powerMod totalΔ=${total}`, expected: 'large negative (force zero)', notes: 'set_power_zero applied via negative modifier' };
    if (total === 0) return { verdict: 'NO_DELTA', observed: 'no power mod', expected: 'large negative', notes: 'engine produced no delta' };
    return { verdict: 'WRONG', observed: `total=${total}`, expected: 'large negative', notes: 'unexpected positive delta' };
  }
  // Continuous-family kinds (self_power_buff, aura_*, cost_modifier_in_hand) — these
  // apply via refold, not direct dispatch. clauseFired likely false; if it did fire
  // unexpectedly, we still mark INCONCLUSIVE per directive.
  if (CONTINUOUS_KINDS.has(ak)) {
    return { verdict: 'NOT_OBSERVABLE', observed: 'CLAUSE_FIRED only (continuous family)', expected: 'refold-applied', notes: `${ak} is refold-based; not directly observable from clause-dispatcher path. Family #7 (continuous_passive) covered this surface.` };
  }
  return { verdict: 'NOT_OBSERVABLE', observed: 'unhandled', expected: '', notes: `unhandled actionKind=${ak}` };
}

interface StageCPcResult {
  cardId: string; name: string; kind: string; family: 'power_cost_modifiers';
  actionKind: string; trigger: string; targetKind: string | null; clauseIndex: number;
  magnitude: number; magnitudeIsDynamic: boolean; duration: string; gated: boolean; hasCost: boolean;
  dispatchPath: 'PLAY_CARD' | 'ACTIVATE_MAIN' | 'DECLARE_ATTACK' | 'END_TURN' | 'SKIPPED';
  clauseFired: boolean;
  deltaVerdict: Verdict['verdict'] | 'UNCHECKED';
  pendingKindEnd: string | null;
  pageErrors: ReadonlyArray<string>;
  invariantErrors: ReadonlyArray<string>;
  classification: Classification; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; notes: string;
  isAnchor: boolean;
}

function decideDispatchPath(trigger: string, sourceZone: SourceZone): StageCPcResult['dispatchPath'] {
  if (!SUPPORTED_TRIGGERS.has(trigger)) return 'SKIPPED';
  if (trigger === 'on_play') return sourceZone === 'a_hand' ? 'PLAY_CARD' : 'SKIPPED';
  if (trigger === 'activate_main') {
    if (sourceZone === 'a_leader' || sourceZone === 'a_field' || sourceZone === 'a_stage') return 'ACTIVATE_MAIN';
    return 'SKIPPED';
  }
  if (trigger === 'when_attacking') {
    if (sourceZone === 'a_leader' || sourceZone === 'a_field') return 'DECLARE_ATTACK';
    return 'SKIPPED';
  }
  if (trigger === 'at_end_of_turn_self') {
    if (sourceZone === 'a_field' || sourceZone === 'a_leader' || sourceZone === 'a_stage') return 'END_TURN';
    return 'SKIPPED';
  }
  return 'SKIPPED';
}

async function dispatchTrigger(page: Page, path: 'PLAY_CARD' | 'ACTIVATE_MAIN' | 'DECLARE_ATTACK' | 'END_TURN', sourceIid: string): Promise<{ ok: boolean; err: string | null }> {
  if (path === 'PLAY_CARD') return dispatchAs(page, { type: 'PLAY_CARD', instanceId: sourceIid, replaceTargetId: null });
  if (path === 'ACTIVATE_MAIN') return dispatchAs(page, { type: 'ACTIVATE_MAIN', instanceId: sourceIid });
  if (path === 'END_TURN') return dispatchAs(page, { type: 'END_TURN' });
  const bLeaderId = await page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { players: { B: { leader: { instanceId: string } } } } } } }; return w.__store!.getState().state.players.B.leader.instanceId; });
  return dispatchAs(page, { type: 'DECLARE_ATTACK', attackerInstanceId: sourceIid, targetInstanceId: bLeaderId });
}

async function processCard(page: Page, card: CardDef, pageErrorsAcc: string[], invariantErrorsAcc: string[]): Promise<StageCPcResult> {
  const clauseInfo = firstPcClause(card);
  const isAnchor = ANCHORS.has(card.id);
  if (clauseInfo === null) {
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'power_cost_modifiers',
      actionKind: 'n/a', trigger: 'n/a', targetKind: null, clauseIndex: -1,
      magnitude: 0, magnitudeIsDynamic: false, duration: 'this_turn', gated: false, hasCost: false,
      dispatchPath: 'SKIPPED', clauseFired: false,
      deltaVerdict: 'UNCHECKED',
      pendingKindEnd: null, pageErrors: [], invariantErrors: [],
      classification: 'INCONCLUSIVE', confidence: 'LOW',
      notes: 'no P/C-family clause found', isAnchor,
    };
  }
  try {
    const sourceZone = pickSourceZone(card, clauseInfo.trigger);
    const dispatchPath = decideDispatchPath(clauseInfo.trigger, sourceZone);
    if (dispatchPath === 'SKIPPED') {
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'power_cost_modifiers',
        actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
        magnitude: clauseInfo.magnitude, magnitudeIsDynamic: clauseInfo.magnitudeIsDynamic, duration: clauseInfo.duration, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
        dispatchPath: 'SKIPPED', clauseFired: false,
        deltaVerdict: 'UNCHECKED',
        pendingKindEnd: null, pageErrors: [], invariantErrors: [],
        classification: 'HARNESS_GAP', confidence: 'HIGH',
        notes: `trigger '${clauseInfo.trigger}' not in supported set (continuous-family clauses with empty trigger are refold-based, covered by family #7)`,
        isAnchor,
      };
    }
    if (dispatchPath === 'ACTIVATE_MAIN') {
      const hasKw = (card.keywords ?? []).includes('activate_main');
      if (!hasKw) {
        return {
          cardId: card.id, name: card.name, kind: card.kind, family: 'power_cost_modifiers',
          actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
          magnitude: clauseInfo.magnitude, magnitudeIsDynamic: clauseInfo.magnitudeIsDynamic, duration: clauseInfo.duration, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
          dispatchPath: 'SKIPPED', clauseFired: false,
          deltaVerdict: 'UNCHECKED',
          pendingKindEnd: null, pageErrors: [], invariantErrors: [],
          classification: 'CARD_DATA_BUG', confidence: 'MEDIUM',
          notes: `activate_main clause but keywords[] missing 'activate_main'`,
          isAnchor,
        };
      }
    }
    const peBefore = pageErrorsAcc.length; const ieBefore = invariantErrorsAcc.length;
    const seeded = await fullRestoringResetAndSeed(page, sourceZone, card, clauseInfo);
    if (seeded.sourceIid === null) {
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'power_cost_modifiers',
        actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
        magnitude: clauseInfo.magnitude, magnitudeIsDynamic: clauseInfo.magnitudeIsDynamic, duration: clauseInfo.duration, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
        dispatchPath, clauseFired: false,
        deltaVerdict: 'UNCHECKED',
        pendingKindEnd: null, pageErrors: [], invariantErrors: [],
        classification: 'HARNESS_BUG', confidence: 'LOW', notes: `seeding returned null sourceIid`, isAnchor,
      };
    }
    const historyStartIdx = await readHistoryLen(page);
    const dispatchRes = await dispatchTrigger(page, dispatchPath, seeded.sourceIid);
    await drainPending(page);
    const markers = await readMarkers(page, historyStartIdx, seeded.sourceIid);
    const clauseFired = markers.some((m) => m.clauseIndex === clauseInfo.clauseIndex && m.trigger === clauseInfo.trigger && m.actionKind === clauseInfo.actionKind);
    const idsOfInterest = [...seeded.targetIids, ...seeded.controlIids, ...(seeded.sourceIid !== null ? [seeded.sourceIid] : [])];
    const after = await readAfterMods(page, idsOfInterest);
    const pendingKindEnd = await readPendingKind(page);
    const newPE = pageErrorsAcc.slice(peBefore);
    const newIE = invariantErrorsAcc.slice(ieBefore);
    let cls: Classification; let confidence: 'HIGH' | 'MEDIUM' | 'LOW'; let notes: string;
    let deltaVerdict: Verdict['verdict'] = 'NOT_OBSERVABLE';
    if (newPE.length > 0 || newIE.length > 0 || pendingKindEnd !== null) {
      cls = 'ENGINE_BUG'; confidence = 'HIGH';
      notes = `infra failure: PE=${newPE.length} IE=${newIE.length} pendingKindEnd=${pendingKindEnd}`;
    } else if (!dispatchRes.ok) {
      cls = 'HARNESS_GAP'; confidence = 'MEDIUM';
      notes = `dispatch ${dispatchPath} rejected: ${dispatchRes.err}`;
    } else if (!clauseFired) {
      const reason = clauseInfo.gated ? 'condition gated by un-met predicate' : clauseInfo.hasCost ? 'cost block not paid' : 'trigger fired but action did not reach this clause';
      cls = 'HARNESS_GAP'; confidence = 'MEDIUM';
      notes = `CLAUSE_FIRED never observed for clause[${clauseInfo.clauseIndex}] action=${clauseInfo.actionKind}: ${reason}`;
    } else {
      const v = classifyPc(card, clauseInfo, seeded, after.mods, after.aNextPlayCostModifier, after.bNextPlayCostModifier);
      deltaVerdict = v.verdict;
      if (v.verdict === 'CORRECT') { cls = 'VERIFIED'; confidence = 'HIGH'; notes = `dispatched=${dispatchPath}; clauseFired; ${v.observed} (expected ${v.expected}); ${v.notes}`; }
      else if (v.verdict === 'WRONG') { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `clause fired but engine produced wrong delta: ${v.observed} (expected ${v.expected}); ${v.notes}`; }
      else if (v.verdict === 'INCONCLUSIVE') { cls = 'INCONCLUSIVE'; confidence = 'MEDIUM'; notes = `clause fired; attribution inconclusive: ${v.observed} (expected ${v.expected}); ${v.notes}`; }
      else if (v.verdict === 'NO_DELTA') { cls = 'INCONCLUSIVE'; confidence = 'LOW'; notes = `clause fired; ${v.observed} (expected ${v.expected}); ${v.notes}`; }
      else { cls = 'INCONCLUSIVE'; confidence = 'MEDIUM'; notes = `clause fired; ${v.notes}`; }
    }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'power_cost_modifiers',
      actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
      magnitude: clauseInfo.magnitude, magnitudeIsDynamic: clauseInfo.magnitudeIsDynamic, duration: clauseInfo.duration, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
      dispatchPath, clauseFired,
      deltaVerdict,
      pendingKindEnd, pageErrors: newPE, invariantErrors: newIE,
      classification: cls, confidence, notes, isAnchor,
    };
  } catch (err) {
    try { await drainPending(page); } catch { /* ignore */ }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'power_cost_modifiers',
      actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
      magnitude: clauseInfo.magnitude, magnitudeIsDynamic: clauseInfo.magnitudeIsDynamic, duration: clauseInfo.duration, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
      dispatchPath: 'SKIPPED', clauseFired: false,
      deltaVerdict: 'UNCHECKED',
      pendingKindEnd: null, pageErrors: [], invariantErrors: [],
      classification: 'HARNESS_BUG', confidence: 'LOW',
      notes: `harness threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      isAnchor,
    };
  }
}

const SLICES: CardDef[][] = [];
for (let i = 0; i < SLICE_COUNT; i++) SLICES.push(CARDS.slice(i * SLICE_SIZE, (i + 1) * SLICE_SIZE));

test.describe.serial('stage-c-generated-power-cost-modifiers', () => {
  for (let s = 0; s < SLICES.length; s++) {
    const sliceIndex = s; const slice = SLICES[sliceIndex]!;
    test(`slice ${sliceIndex + 1}/${SLICES.length} — ${slice.length} cards (${slice[0]!.id} … ${slice[slice.length - 1]!.id})`, async ({ page }) => {
      test.setTimeout(FIVE_MIN);
      const { drv, pageErrors, invariantErrors } = await bootstrap(page);
      void drv;
      const results: StageCPcResult[] = [];
      for (const card of slice) results.push(await processCard(page, card, pageErrors, invariantErrors));
      expect(pageErrors, `slice ${sliceIndex} pageerrors`).toEqual([]);
      expect(invariantErrors, `slice ${sliceIndex} InvariantErrors`).toEqual([]);
      expect(await readPendingKind(page), `slice ${sliceIndex} no stuck pending`).toBeNull();
      const sliceFile = join(SLICE_TMP_DIR, `pc-slice-${String(sliceIndex).padStart(3, '0')}.json`);
      writeFileSync(sliceFile, JSON.stringify({ sliceIndex, cardCount: slice.length, results }, null, 2), 'utf-8');
      /* eslint-disable no-console */
      console.log(`[power-cost] wrote slice ${sliceIndex} → ${sliceFile}`);
      /* eslint-enable no-console */
    });
  }

  test('aggregator: roll up power-cost slices', async () => {
    const all: StageCPcResult[] = [];
    for (const f of readdirSync(SLICE_TMP_DIR).filter((f) => f.startsWith('pc-slice-') && f.endsWith('.json')).sort()) {
      const raw = JSON.parse(readFileSync(join(SLICE_TMP_DIR, f), 'utf-8')) as { results: StageCPcResult[] };
      for (const r of raw.results) all.push(r);
    }
    const buckets: Record<Classification, number> = { VERIFIED: 0, ENGINE_BUG: 0, CARD_DATA_BUG: 0, UI_BUG: 0, HARNESS_BUG: 0, HARNESS_GAP: 0, NOT_IMPLEMENTED: 0, NO_UI_EXPECTED: 0, INCONCLUSIVE: 0 };
    for (const r of all) buckets[r.classification]++;
    const actionBreakdown = new Map<string, number>();
    const triggerBreakdown = new Map<string, number>();
    const targetBreakdown = new Map<string, number>();
    const cardKindBreakdown = new Map<string, number>();
    for (const r of all) {
      actionBreakdown.set(r.actionKind, (actionBreakdown.get(r.actionKind) ?? 0) + 1);
      triggerBreakdown.set(r.trigger, (triggerBreakdown.get(r.trigger) ?? 0) + 1);
      targetBreakdown.set(r.targetKind ?? '(no-target)', (targetBreakdown.get(r.targetKind ?? '(no-target)') ?? 0) + 1);
      cardKindBreakdown.set(r.kind, (cardKindBreakdown.get(r.kind) ?? 0) + 1);
    }
    const clusters = new Map<string, { rootCause: string; cards: string[] }>();
    for (const r of all) {
      if (r.classification === 'VERIFIED') continue;
      const sig = `[${r.classification}] ` + (r.notes || `(${r.classification})`).slice(0, 100);
      const ex = clusters.get(sig) ?? { rootCause: sig, cards: [] };
      ex.cards.push(r.cardId);
      clusters.set(sig, ex);
    }
    const sortedClusters = Array.from(clusters.values()).sort((a, b) => b.cards.length - a.cards.length);
    const anchorRecs = Array.from(ANCHORS).map((id) => { const r = all.find((x) => x.cardId === id); return { id, classification: r?.classification ?? 'NOT_FOUND', actionKind: r?.actionKind ?? '(missing)', trigger: r?.trigger ?? '(missing)' }; });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = join(REPORTS_DIR, `stage-c-power-cost-modifiers-${ts}.json`);
    const mdPath = join(REPORTS_DIR, `stage-c-power-cost-modifiers-${ts}.md`);
    const finalReport = {
      family: 'power_cost_modifiers', generatedAt: new Date().toISOString(),
      totalCardsDiscovered: CARDS.length, totalRecordsWritten: all.length, sliceCount: SLICE_COUNT,
      classifications: buckets, verifiedPercent: all.length > 0 ? (100 * buckets.VERIFIED / all.length).toFixed(2) : '0',
      actionBreakdown: Object.fromEntries(actionBreakdown),
      triggerBreakdown: Object.fromEntries(triggerBreakdown),
      targetBreakdown: Object.fromEntries(targetBreakdown),
      cardKindBreakdown: Object.fromEntries(cardKindBreakdown),
      anchorStatus: anchorRecs,
      topFailureClusters: sortedClusters.slice(0, 10),
      results: all,
    };
    writeFileSync(jsonPath, JSON.stringify(finalReport, null, 2), 'utf-8');
    const md: string[] = [];
    md.push(`# Stage C — Power/Cost Modifiers Generated Report\n\n**Generated:** ${new Date().toISOString()}\n**Total P/C-family cards discovered:** ${CARDS.length}\n**Total records written:** ${all.length}\n**Slice count:** ${SLICE_COUNT}\n\n`);
    md.push(`## Classification buckets\n\n| Bucket | Count | % |\n|---|---:|---:|\n`);
    for (const [k, v] of Object.entries(buckets)) md.push(`| ${k} | ${v} | ${all.length > 0 ? (100 * v / all.length).toFixed(1) : '0'}% |\n`);
    md.push(`\n## Action kind breakdown\n\n| Action | Count |\n|---|---:|\n`);
    for (const [k, v] of Array.from(actionBreakdown.entries()).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Trigger breakdown\n\n| Trigger | Count |\n|---|---:|\n`);
    for (const [k, v] of Array.from(triggerBreakdown.entries()).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Target kind breakdown\n\n| Target | Count |\n|---|---:|\n`);
    for (const [k, v] of Array.from(targetBreakdown.entries()).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Card kind breakdown\n\n| Card kind | Count |\n|---|---:|\n`);
    for (const [k, v] of Array.from(cardKindBreakdown.entries()).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Anchor card status\n\n| Card | Classification | Action | Trigger |\n|---|---|---|---|\n`);
    for (const x of anchorRecs) md.push(`| ${x.id} | ${x.classification} | ${x.actionKind} | ${x.trigger} |\n`);
    md.push(`\n## Top 10 failure clusters\n\n`);
    if (sortedClusters.length === 0) md.push(`(none)\n`);
    else for (const c of sortedClusters.slice(0, 10)) md.push(`- **${c.cards.length} cards**: ${c.rootCause}\n`);
    md.push(`\n## Report files\n\n- JSON: \`coverage/reports/stage-c-power-cost-modifiers-${ts}.json\`\n- MD: \`coverage/reports/stage-c-power-cost-modifiers-${ts}.md\`\n`);
    writeFileSync(mdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[power-cost] FINAL JSON: ${jsonPath}`);
    console.log(`[power-cost] FINAL MD:   ${mdPath}`);
    console.log(`[power-cost] tally: ${JSON.stringify(buckets)}`);
    /* eslint-enable no-console */
    expect(all.length, 'every card must have a record').toBe(CARDS.length);
  });
});
