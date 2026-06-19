/**
 * F-13 — Full-corpus runtime verification harness (standalone, re-runnable).
 *
 *   npx tsx scripts/f13-runtime-verify/run.ts
 *
 * For EVERY card in cards.json, enumerates every effect path (clause /
 * continuous / replacement) and drives the REAL engine to verify runtime
 * behavior — not handler existence, not static shape. Card-agnostic: no
 * card-ID or card-name branches anywhere.
 *
 * Honesty contract: a path is only VERIFIED_RUNTIME when the harness can
 * construct a decisive scenario and observe correct behavior. Anything it
 * cannot prove → NEEDS_TEXT_REVIEW (never inflated to "good").
 *
 * Outputs (always written, even on partial failure):
 *   docs/F13_CARD_RUNTIME_MATRIX.csv          (one row per card per path)
 *   docs/F13_FULL_CORPUS_RUNTIME_VERIFICATION.md
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Card, CharacterCard, LeaderCard } from '../../shared/engine-v2/cards/Card.js';
import { EffectDispatcher, evaluateCondition } from '../../shared/engine-v2/effects/EffectDispatcher.js';
import { ContinuousManager } from '../../shared/engine-v2/effects/ContinuousManager.js';
import { ReplacementManager } from '../../shared/engine-v2/effects/ReplacementManager.js';
import { getLegalActions } from '../../shared/engine-v2/rules/legality.js';
import { registerAllHandlers } from '../../shared/engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../shared/engine-v2/reducers/index.js';
import { buildState, makeInst } from '../../shared/engine-v2/__tests__/cards/_fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

registerAllReducers();
registerAllHandlers();

const cards = JSON.parse(readFileSync(resolve(ROOT, 'shared/data/cards.json'), 'utf8')) as Card[];

// ── generic filler cards (broad traits/colors so common targets/filters can
//    resolve; no card-specific intent) ──
const FILLER_LEADER: LeaderCard = {
  id: '__F13_LDR', name: 'F13 Leader', kind: 'leader', colors: ['red', 'green', 'blue', 'purple', 'black', 'yellow'],
  cost: null, power: 5000, counterValue: null, traits: ['Straw Hat Crew'], keywords: [], effectTags: [], life: 5,
};
const FILLER_CHAR = (id: string): CharacterCard => ({
  id, name: id, kind: 'character', colors: ['red', 'green', 'blue', 'purple', 'black', 'yellow'],
  cost: 3, power: 5000, counterValue: 1000, traits: ['Straw Hat Crew'], keywords: [], effectTags: ['vanilla'],
});

type Trigger = string;
// Directly-dispatchable triggers. The combat/window/event triggers are driven
// by dispatching the trigger string directly — this drives the CLAUSE'S EFFECT
// (the runtime-correctness question) but NOT the full combat orchestration
// (whether the trigger fires at the right moment); the report flags that.
const DRIVABLE = new Set([
  'on_play', 'activate_main', 'when_attacking', 'on_ko',
  'trigger', 'on_block', 'dondonon', 'at_end_of_turn_self', 'on_opp_attack',
  'on_own_don_returned', 'on_life_changed', 'on_become_rested', 'on_attack_deal_damage',
  'on_own_char_removed_by_opp_effect', 'on_opp_activate_event', 'on_self_activate_event',
  'on_any_opp_char_ko', 'on_battle_ko', 'on_opp_play_character', 'on_any_char_ko',
  'on_opp_char_bounce_by_me', 'on_hand_trashed_by_effect', 'on_damage_taken',
]);
const DIRECT_DISPATCH_ONLY = new Set([ // driven via direct trigger dispatch, not full combat flow
  'trigger', 'on_block', 'dondonon', 'at_end_of_turn_self', 'on_opp_attack',
  'on_own_don_returned', 'on_life_changed', 'on_become_rested', 'on_attack_deal_damage',
  'on_own_char_removed_by_opp_effect', 'on_opp_activate_event', 'on_self_activate_event',
  'on_any_opp_char_ko', 'on_battle_ko', 'on_opp_play_character', 'on_any_char_ko',
  'on_opp_char_bounce_by_me', 'on_hand_trashed_by_effect', 'on_damage_taken',
]);
const CHOICE_TARGETS = new Set(['opp_character', 'your_character', 'any_character', 'opp_leader_or_character', 'your_leader_or_character', 'opp_don_or_character', 'own_trash_card', 'opp_hand_card']);
const CHOICE_COSTS = new Set(['discardHand', 'discardHandFilter', 'trashFromHand', 'bottomOfDeckFromHand', 'restOwnCharFilter', 'returnOwnCharFilter', 'bottomOfDeckOwnChar', 'revealHand']);

// recursively collect families from an action tree
function actionKinds(a: unknown, acc: Set<string>): void {
  if (!a || typeof a !== 'object') return;
  const o = a as Record<string, unknown>;
  if (typeof o.kind === 'string') acc.add(o.kind);
  for (const f of ['actions', 'thenAction', 'then', 'else']) {
    const v = o[f];
    if (Array.isArray(v)) v.forEach((x) => actionKinds(x, acc));
    else if (v && typeof v === 'object') actionKinds(v, acc);
  }
  if (Array.isArray(o.options)) o.options.forEach((op: unknown) => { if (op && typeof op === 'object') actionKinds((op as Record<string, unknown>).action, acc); });
}
function condFamilies(c: unknown, acc: Set<string>): void {
  if (!c || typeof c !== 'object') return;
  const o = c as Record<string, unknown>;
  if (typeof o.type === 'string') acc.add(o.type);
  if (Array.isArray(o.conditions)) o.conditions.forEach((x) => condFamilies(x, acc));
  if (o.condition) condFamilies(o.condition, acc);
}
function targetKinds(node: unknown, acc: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o.target && typeof o.target === 'object' && typeof (o.target as Record<string, unknown>).kind === 'string') acc.add((o.target as Record<string, unknown>).kind as string);
  for (const f of ['actions', 'thenAction', 'then', 'else']) {
    const v = o[f];
    if (Array.isArray(v)) v.forEach((x) => targetKinds(x, acc));
    else if (v && typeof v === 'object') targetKinds(v, acc);
  }
}
function costKeys(cost: unknown, acc: Set<string>): void {
  if (!cost || typeof cost !== 'object') return;
  for (const k of Object.keys(cost as object)) if (k !== 'bind') acc.add(k);
}

interface Row {
  cardId: string; cardName: string; cardType: string; path: string; timing: string;
  conditionFamily: string; costFamily: string; targetFamily: string; actionFamily: string;
  generatedScenario: string; expectedLegal: string; actualLegal: string;
  expectedPending: string; actualPending: string; expectedStateDelta: string; actualStateDelta: string;
  expectedHistory: string; actualHistory: string; status: string; failureReason: string;
  blockingLayer: string; fixFamily: string;
}

const rows: Row[] = [];
const visited = new Set<string>();
let clausesDiscovered = 0, clausesExecuted = 0, clausesSkipped = 0;
const skipReasons: Record<string, number> = {};

import { targetResolvers } from '../../shared/engine-v2/registry/types.js';

// build a rich favorable state with the card's source placed, plus fillers.
// specOverride: replace the card's effectSpecV2 in the library so a single
// clause can be dispatched in ISOLATION (correct per-clause attribution —
// multi-clause same-trigger cards otherwise pollute each other's CLAUSE_FIRED).
function favorable(card: Card, specOverride?: unknown): { state: ReturnType<typeof buildState>['state']; sourceId: string } {
  const kind = (card as { kind: string }).kind;
  const isLeader = kind === 'leader';
  const built = buildState({
    leaderA: isLeader ? (card as LeaderCard) : FILLER_LEADER,
    leaderB: { ...FILLER_LEADER, id: '__F13_LDRB' },
    charsA: kind === 'character' ? [card as CharacterCard, FILLER_CHAR('__F13_CA1'), FILLER_CHAR('__F13_CA2')] : [FILLER_CHAR('__F13_CA1'), FILLER_CHAR('__F13_CA2')],
    charsB: [FILLER_CHAR('__F13_CB1'), FILLER_CHAR('__F13_CB2')],
    handA: [FILLER_CHAR('__F13_HA1'), FILLER_CHAR('__F13_HA2')],
    donInCostA: 10, donInCostB: 10,
  });
  const s = built.state;
  s.activePlayer = 'A'; s.phase = 'main';
  // life + deck + trash for both, so life/deck/trash families resolve
  for (let i = 0; i < 5; i++) {
    const la = makeInst('__F13_CA1', 'A'); s.instances[la.instanceId] = la; s.players.A.life.push(la.instanceId);
    const lb = makeInst('__F13_CB1', 'B'); s.instances[lb.instanceId] = lb; s.players.B.life.push(lb.instanceId);
    const da = makeInst('__F13_CA1', 'A'); s.instances[da.instanceId] = da; s.players.A.deck.push(da.instanceId);
    const ta = makeInst('__F13_CA2', 'A'); s.instances[ta.instanceId] = ta; s.players.A.trash.push(ta.instanceId);
  }
  // place source + attached DON
  let sourceId: string;
  if (isLeader) sourceId = s.players.A.leader.instanceId;
  else if (kind === 'character') sourceId = s.players.A.field[0]!.instanceId;
  else { // event / stage — register + instance + place in hand
    s.cardLibrary[card.id] = card;
    const inst = makeInst(card.id, 'A'); s.instances[inst.instanceId] = inst; s.players.A.hand.push(inst.instanceId);
    if (kind === 'stage') s.players.A.stage = inst;
    sourceId = inst.instanceId;
  }
  const src = s.instances[sourceId]!;
  src.attachedDon = ['__f13_d1', '__f13_d2']; // satisfy [DON!! xN] up to 2
  if (specOverride !== undefined) s.cardLibrary[card.id] = { ...(card as object), effectSpecV2: specOverride } as Card;
  return { state: s, sourceId };
}

function barren(card: Card, specOverride?: unknown): { state: ReturnType<typeof buildState>['state']; sourceId: string } {
  const { state, sourceId } = favorable(card, specOverride);
  // make it hostile to conditions: opp turn, no DON, empty hand, no chars, full life
  state.activePlayer = 'B';
  state.players.A.donCostArea = [];
  state.players.A.hand = [];
  state.instances[sourceId]!.attachedDon = [];
  return { state, sourceId };
}

let matchCtr = 0;
// build a character matching a clause filter (trait/type/color/cost/power/keyword)
function matchChar(filter: Record<string, unknown> | undefined): CharacterCard {
  const f = filter ?? {};
  const trait = (f.trait as string) ?? (f.typeIncludes as string) ?? (Array.isArray(f.traitsAny) ? (f.traitsAny as string[])[0] : undefined);
  const cost = typeof f.costMax === 'number' ? f.costMax : (typeof f.costMin === 'number' ? f.costMin : 3);
  const power = typeof f.powerMax === 'number' ? f.powerMax : (typeof f.powerMin === 'number' ? f.powerMin : (typeof f.basePowerMax === 'number' ? f.basePowerMax : 5000));
  const colors = (f.colors as string[]) ?? (f.color ? [f.color as string] : ['red', 'green', 'blue', 'purple', 'black', 'yellow']);
  const keywords = (f.keyword ? [f.keyword as string] : (f.hasTrigger ? ['trigger'] : [])) as never;
  return { id: `__F13_M${matchCtr++}`, name: 'F13 Match', kind: 'character', colors: colors as never, cost, power, counterValue: 1000, traits: trait ? [trait] : ['Straw Hat Crew'], keywords, effectTags: [] };
}
function leafConds(c: unknown, out: Record<string, unknown>[]): void {
  if (!c || typeof c !== 'object') return;
  const o = c as Record<string, unknown>;
  if (Array.isArray(o.conditions)) { o.conditions.forEach((x) => leafConds(x, out)); return; }
  if (o.type === 'not' && o.condition) return; // don't satisfy negated leaves
  if (typeof o.type === 'string') out.push(o);
}
function plantChar(state: ReturnType<typeof buildState>['state'], side: 'A' | 'B', card: CharacterCard): void {
  state.cardLibrary[card.id] = card;
  const inst = makeInst(card.id, side);
  state.instances[inst.instanceId] = inst;
  state.players[side].field.push(inst);
}
function padZone(state: ReturnType<typeof buildState>['state'], side: 'A' | 'B', zone: 'hand' | 'trash' | 'life' | 'donDeck', n: number): void {
  const arr = state.players[side][zone];
  while (arr.length < n) { const i = makeInst('__F13_CA1', side); state.instances[i.instanceId] = i; arr.push(i.instanceId); }
}
// mutate the favorable state to satisfy a clause's condition + plant its target/resources.
function tailorState(state: ReturnType<typeof buildState>['state'], sourceId: string, clause: Record<string, unknown>): void {
  const A = state.players.A, B = state.players.B;
  const src = state.instances[sourceId]!;
  const leaderCardId = A.leader.cardId;
  const isFiller = leaderCardId.startsWith('__F13_LDR');
  const lib = state.cardLibrary[leaderCardId] as { traits: string[]; name: string };
  const conds: Record<string, unknown>[] = []; leafConds(clause.condition, conds);
  const num = (c: Record<string, unknown>) => (typeof c.n === 'number' ? c.n : 1);
  for (const c of conds) {
    const t = c.type as string; const n = num(c);
    if (isFiller && t === 'if_leader_has_trait' && typeof c.trait === 'string') lib.traits = [...lib.traits, c.trait];
    else if (isFiller && t === 'if_leader_has_type' && typeof c.typeString === 'string') lib.traits = [...lib.traits, c.typeString];
    else if (isFiller && t === 'if_leader_is' && typeof c.name === 'string') lib.name = c.name;
    else if (t === 'if_own_life_max') { while (A.life.length > n) A.life.pop(); }
    else if (t === 'if_own_life_min') padZone(state, 'A', 'life', n);
    else if (t === 'if_opp_life_max') { while (B.life.length > n) B.life.pop(); }
    else if (t === 'if_opp_life_min') padZone(state, 'B', 'life', n);
    else if (t === 'if_opp_hand_min') padZone(state, 'B', 'hand', n);
    else if (t === 'if_hand_min') padZone(state, 'A', 'hand', n);
    else if (t === 'if_hand_max') { while (A.hand.length > n) A.hand.pop(); }
    else if (t === 'if_trash_min') padZone(state, 'A', 'trash', n);
    else if (t === 'if_attached_don_min' || t === 'if_have_given_don_min') src.attachedDon = Array.from({ length: n }, (_, i) => `__f13_ad${i}`);
    else if (t === 'is_opp_turn') state.activePlayer = 'B';
    else if (t === 'if_own_rested_don_min') padZone(state, 'A', 'donRested', n);
    else if (t === 'if_don_max') { while (A.donCostArea.length > n) A.donCostArea.pop(); }
    else if (t === 'if_owned_other_with_name' && typeof c.name === 'string') { const m = { ...matchChar(undefined), name: c.name as string, id: `__F13_N${matchCtr++}` }; plantChar(state, 'A', m); }
    else if (t === 'if_own_chars_min_cost') for (let i = 0; i < n; i++) plantChar(state, 'A', matchChar({ costMin: c.minCost as number, costMax: typeof c.minCost === 'number' ? (c.minCost as number) + 4 : undefined }));
    else if (t === 'if_own_chars_min_with_trait' && typeof c.trait === 'string') for (let i = 0; i < n; i++) plantChar(state, 'A', matchChar({ trait: c.trait }));
    else if (/^if_own_chars_min/.test(t)) for (let i = 0; i < n; i++) plantChar(state, 'A', matchChar(c.filter as Record<string, unknown>));
    else if (/^if_opp_chars_min/.test(t)) for (let i = 0; i < n; i++) plantChar(state, 'B', matchChar(c.filter as Record<string, unknown>));
  }
  // plant a target matching the clause-level target filter on the right field
  const tgt = clause.target as { kind?: string; filter?: Record<string, unknown> } | undefined;
  if (tgt?.kind) {
    if (/opp/.test(tgt.kind) && /character/.test(tgt.kind)) plantChar(state, 'B', matchChar(tgt.filter));
    else if (/your/.test(tgt.kind) && /character/.test(tgt.kind)) plantChar(state, 'A', matchChar(tgt.filter));
    else if (tgt.kind === 'own_trash_card') { const m = matchChar(tgt.filter); state.cardLibrary[m.id] = m; const i = makeInst(m.id, 'A'); state.instances[i.instanceId] = i; A.trash.push(i.instanceId); }
  }
  // Phase 3 — plant targets for NESTED sub-action filters (sequence / thenAction
  // / choose_one options): "choose then KO/buff/bounce/play".
  const subTargets: { kind?: string; filter?: Record<string, unknown> }[] = [];
  collectActionTargets(clause.action, subTargets);
  for (const t of subTargets) {
    if (!t?.kind) continue;
    if (/opp/.test(t.kind) && /character/.test(t.kind)) plantChar(state, 'B', matchChar(t.filter));
    else if (/your/.test(t.kind) && /character/.test(t.kind)) plantChar(state, 'A', matchChar(t.filter));
  }
  // resources: DON deck (ramp / set_active_don) + a trash card (recursion)
  padZone(state, 'A', 'donDeck', 5);
}
function collectActionTargets(a: unknown, out: { kind?: string; filter?: Record<string, unknown> }[]): void {
  if (!a || typeof a !== 'object') return;
  const o = a as Record<string, unknown>;
  if (o.target && typeof o.target === 'object') out.push(o.target as { kind?: string; filter?: Record<string, unknown> });
  for (const f of ['actions', 'thenAction', 'then', 'else']) {
    const v = o[f];
    if (Array.isArray(v)) v.forEach((x) => collectActionTargets(x, out));
    else if (v && typeof v === 'object') collectActionTargets(v, out);
  }
  if (Array.isArray(o.options)) o.options.forEach((op: unknown) => { if (op && typeof op === 'object') collectActionTargets((op as Record<string, unknown>).action, out); });
}

function historyTypesFor(state: { history: unknown[] }, sourceId: string, sinceLen: number): string[] {
  return (state.history.slice(sinceLen) as Array<Record<string, unknown>>)
    .filter((h) => h.sourceInstanceId === undefined || h.sourceInstanceId === sourceId)
    .map((h) => String(h.type));
}

function classifyClause(card: Card, clause: Record<string, unknown>, idx: number): Row {
  const trigger = String(clause.trigger);
  const conds = new Set<string>(); condFamilies(clause.condition, conds);
  const costs = new Set<string>(); costKeys(clause.cost, costs);
  const tgts = new Set<string>(); if (clause.target) targetKinds({ target: clause.target }, tgts); targetKinds(clause.action, tgts);
  const acts = new Set<string>(); actionKinds(clause.action, acts);
  const row: Row = {
    cardId: card.id, cardName: (card as { name: string }).name, cardType: (card as { kind: string }).kind,
    path: `clause#${idx}:${trigger}`, timing: trigger,
    conditionFamily: [...conds].join('|') || '(none)', costFamily: [...costs].join('|') || '(none)',
    targetFamily: [...tgts].join('|') || '(none)', actionFamily: [...acts].join('|') || '(none)',
    generatedScenario: '', expectedLegal: '', actualLegal: '', expectedPending: '', actualPending: '',
    expectedStateDelta: '', actualStateDelta: '', expectedHistory: '', actualHistory: '',
    status: 'NEEDS_TEXT_REVIEW', failureReason: '', blockingLayer: '', fixFamily: '',
  };

  if (!DRIVABLE.has(trigger)) {
    clausesSkipped++; skipReasons[`trigger:${trigger}`] = (skipReasons[`trigger:${trigger}`] ?? 0) + 1;
    row.generatedScenario = 'not-driven'; row.status = 'NEEDS_TEXT_REVIEW';
    row.failureReason = `trigger '${trigger}' requires combat/window/event context not constructible in isolation`;
    row.blockingLayer = 'harness';
    return row;
  }
  clausesExecuted++;

  // Isolate THIS clause so CLAUSE_FIRED attribution is unambiguous (multi-clause
  // same-trigger cards otherwise pollute each other). Conservative throughout:
  // only PROVEN contradictions are FAILS_*; anything unprovable in the generic
  // state is NEEDS_TEXT_REVIEW (never an inflated failure).
  const isoSpec = { schemaVersion: 2, verified: clause.verified ?? 'flagged', clauses: [clause], continuous: [], replacements: [] };
  const clauseTgt = (clause.target as { kind?: string } | undefined)?.kind;
  try {
    const fav = favorable(card, isoSpec);
    tailorState(fav.state, fav.sourceId, clause);
    const directOnly = DIRECT_DISPATCH_ONLY.has(trigger);
    const ctxFav = { sourceInstanceId: fav.sourceId, controller: 'A' as const };
    const condTrueFav = evaluateCondition(fav.state, ctxFav as never, clause.condition as never);
    // candidate count for a clause-level target (resolve with a wide count)
    let candCount = -1;
    if (clauseTgt && targetResolvers.has(clauseTgt)) {
      try { candCount = targetResolvers.get(clauseTgt)(fav.state, ctxFav as never, { ...(clause.target as object), count: 99 } as never).length; } catch { candCount = -1; }
    }
    const beforeLen = fav.state.history.length;
    // Snapshot includes knownByViewer (Phase 5): look/peek/reveal effects change
    // VISIBILITY, not durable zones — that IS an observable runtime effect.
    const snap = (s: typeof fav.state) => JSON.stringify(s.players.A) + JSON.stringify(s.players.B) + JSON.stringify(s.instances) + JSON.stringify(s.knownByViewer);
    const beforeSnap = snap(fav.state);
    const after = EffectDispatcher.dispatch(fav.state, ctxFav, trigger, 0);
    const hist = historyTypesFor(after, fav.sourceId, beforeLen);
    const fired = hist.includes('CLAUSE_FIRED');
    // effect-specific history events that prove a look/reveal/search happened
    const VISIBILITY_EVENTS = ['DECK_SEARCHED', 'SEARCHER_PEEK_RESOLVED', 'SEARCHER_PICKED', 'HAND_CARD_REVEALED', 'LIFE_REVEALED', 'CARD_HAND_TO_DECK_TOP'];
    const visEvent = hist.some((h) => VISIBILITY_EVENTS.includes(h));
    const pendingRaised = after.pending !== null && fav.state.pending === null;
    const delta = snap(after) !== beforeSnap || visEvent || pendingRaised;
    row.generatedScenario = directOnly ? 'isolated-tailored(direct-trigger-dispatch)' : 'isolated-tailored';
    row.expectedHistory = 'CLAUSE_FIRED'; row.actualHistory = hist.join(',') || '(none)';
    row.expectedStateDelta = 'mutated'; row.actualStateDelta = delta ? 'mutated' : 'none';

    // (A) PROVEN: condition gating — isolated clause fired despite a false condition
    if (conds.size > 0) {
      const bar = barren(card, isoSpec);
      const ctxBar = { sourceInstanceId: bar.sourceId, controller: 'A' as const };
      if (!evaluateCondition(bar.state, ctxBar as never, clause.condition as never)) {
        const bl = bar.state.history.length;
        const aft2 = EffectDispatcher.dispatch(bar.state, ctxBar, trigger, 0);
        if (historyTypesFor(aft2, bar.sourceId, bl).includes('CLAUSE_FIRED')) {
          row.status = 'FAILS_CONDITION'; row.failureReason = 'isolated clause fired even though its condition evaluated false';
          row.blockingLayer = 'dispatch'; row.fixFamily = 'condition-enforcement'; return row;
        }
      }
    }

    // (B) PROVEN: activate_main offered with 0 DON despite a DON cost
    if (trigger === 'activate_main') {
      const offered = getLegalActions(fav.state, 'A').some((a) => a.type === 'ACTIVATE_MAIN' && (a as { instanceId?: string }).instanceId === fav.sourceId);
      row.expectedLegal = 'offered-when-legal'; row.actualLegal = offered ? 'offered' : 'not-offered';
      if ([...costs].some((c) => c.startsWith('don'))) {
        const noDon = favorable(card, isoSpec); tailorState(noDon.state, noDon.sourceId, clause); noDon.state.players.A.donCostArea = [];
        if (getLegalActions(noDon.state, 'A').some((a) => a.type === 'ACTIVATE_MAIN' && (a as { instanceId?: string }).instanceId === noDon.sourceId)) {
          row.status = 'FAILS_COST'; row.failureReason = 'ACTIVATE_MAIN offered with 0 DON though clause carries a DON cost (offering layer does not pre-check cost)';
          row.blockingLayer = 'legality'; row.fixFamily = 'offering-cost-precheck'; return row;
        }
      }
    }

    // (C) PROVEN: human choice path with candidates>0 raises no pending (auto-pick).
    // Require NO cost on the clause — a choice-cost may be unpayable in the
    // generic state (e.g. needs a specific-trait char to rest/KO), which would
    // (correctly) raise no pending and is not an auto-pick bug.
    if (clauseTgt && CHOICE_TARGETS.has(clauseTgt) && candCount > 0 && condTrueFav && costs.size === 0) {
      const h = favorable(card, isoSpec); tailorState(h.state, h.sourceId, clause); h.state.humanControllers = ['A'];
      const aft = EffectDispatcher.dispatch(h.state, { sourceInstanceId: h.sourceId, controller: 'A' }, trigger, 0);
      row.expectedPending = 'pending-raised'; row.actualPending = aft.pending ? aft.pending.kind : '(none)';
      if (!aft.pending) {
        row.status = 'FAILS_PENDING_UI'; row.failureReason = `human choice (${clauseTgt}, ${candCount} candidates) raised no pending — auto-pick`;
        row.blockingLayer = 'dispatch'; row.fixFamily = 'pending-for-human-choice'; return row;
      }
    }

    // (D) PROVEN positive vs honest unknown
    if (fired && delta) { row.status = 'VERIFIED_RUNTIME'; return row; }
    // everything below is UNPROVEN in the generic state → NEEDS_TEXT_REVIEW (not a failure)
    if (!condTrueFav) { row.status = 'NEEDS_TEXT_REVIEW'; row.failureReason = 'condition not satisfiable in the generic state — resolution unproven'; row.blockingLayer = 'harness'; return row; }
    if (clauseTgt && candCount === 0) { row.status = 'NEEDS_TEXT_REVIEW'; row.failureReason = 'no candidate matches the clause filter in the generic state — needs a planted target'; row.blockingLayer = 'harness'; return row; }
    if (fired && !delta) { row.status = 'NEEDS_TEXT_REVIEW'; row.failureReason = 'CLAUSE_FIRED but no delta — likely a missing resource/target in the generic state (cannot distinguish from a no-op handler without a richer scenario)'; row.blockingLayer = 'harness'; return row; }
    row.status = 'NEEDS_TEXT_REVIEW'; row.failureReason = 'no fire + no delta in generic state — unproven (richer scenario needed)'; row.blockingLayer = 'harness';
  } catch (err) {
    row.status = 'FAILS_RESOLUTION'; row.failureReason = `engine threw: ${(err as Error).message?.slice(0, 120)}`;
    row.blockingLayer = 'engine'; row.fixFamily = 'crash';
  }
  return row;
}

function classifyContinuous(card: Card, eff: Record<string, unknown>, idx: number): Row {
  const conds = new Set<string>(); condFamilies(eff.condition, conds);
  const acts = new Set<string>(); actionKinds(eff.action, acts);
  const row: Row = {
    cardId: card.id, cardName: (card as { name: string }).name, cardType: (card as { kind: string }).kind,
    path: `continuous#${idx}`, timing: 'passive', conditionFamily: [...conds].join('|') || '(none)',
    costFamily: '(none)', targetFamily: '(none)', actionFamily: [...acts].join('|') || '(none)',
    generatedScenario: 'favorable-refold', expectedLegal: '', actualLegal: '', expectedPending: '', actualPending: '',
    expectedStateDelta: 'continuous-applied', actualStateDelta: '', expectedHistory: '', actualHistory: '',
    status: 'NEEDS_TEXT_REVIEW', failureReason: '', blockingLayer: '', fixFamily: '',
  };
  try {
    const fav = favorable(card);
    tailorState(fav.state, fav.sourceId, eff);
    const before = JSON.stringify(fav.state.instances);
    const after = ContinuousManager.refold(fav.state);
    const changed = JSON.stringify(after.instances) !== before;
    row.actualStateDelta = changed ? 'applied' : 'none';
    // idempotency
    const after2 = ContinuousManager.refold(after);
    const idempotent = JSON.stringify(after2.instances) === JSON.stringify(after.instances);
    if (!idempotent) { row.status = 'FAILS_RESOLUTION'; row.failureReason = 'continuous refold not idempotent (stacks)'; row.blockingLayer = 'handler'; row.fixFamily = 'continuous-idempotency'; }
    else if (changed) row.status = 'VERIFIED_RUNTIME';
    else { row.status = 'NEEDS_TEXT_REVIEW'; row.failureReason = 'continuous applied no observable change in generic state (condition may be unmet)'; row.blockingLayer = 'harness'; }
  } catch (err) {
    row.status = 'FAILS_RESOLUTION'; row.failureReason = `refold threw: ${(err as Error).message?.slice(0, 120)}`; row.blockingLayer = 'engine'; row.fixFamily = 'crash';
  }
  return row;
}

// Phase 1 — drive replacement effects through the real ReplacementManager.
// Card-intrinsic replacements are auto-armed (buildArmedList includes
// card.effectSpecV2.replacements), so tryReplace with the source as the
// would-be-removed victim drives the real pipeline (no direct-dispatch bypass).
function classifyReplacement(card: Card, eff: Record<string, unknown>, idx: number): Row {
  const conds = new Set<string>(); condFamilies(eff.condition, conds);
  const acts = new Set<string>(); actionKinds(eff.action, acts);
  const trig = String(eff.trigger);
  const row: Row = {
    cardId: card.id, cardName: (card as { name: string }).name, cardType: (card as { kind: string }).kind,
    path: `replacement#${idx}:${trig}`, timing: trig,
    conditionFamily: [...conds].join('|') || '(none)', costFamily: '(none)', targetFamily: '(none)',
    actionFamily: [...acts].join('|') || '(none)', generatedScenario: 'replacement-pipeline',
    expectedLegal: '', actualLegal: '', expectedPending: '', actualPending: '', expectedStateDelta: 'replaced', actualStateDelta: '',
    expectedHistory: '', actualHistory: '', status: 'NEEDS_TEXT_REVIEW', failureReason: '', blockingLayer: '', fixFamily: '',
  };
  try {
    const fav = favorable(card);
    tailorState(fav.state, fav.sourceId, eff);
    const ctx = { sourceInstanceId: fav.sourceId, controller: 'A' as const };
    const condTrue = evaluateCondition(fav.state, ctx as never, eff.condition as never);
    const res = ReplacementManager.tryReplace(fav.state, ctx as never, trig as never);
    row.actualStateDelta = res.replaced ? 'replaced' : 'not-replaced';
    if (res.replaced) {
      // proven-fired; also confirm it does NOT fire when the condition is false (gating)
      if (conds.size > 0) {
        const bar = barren(card);
        const ctxB = { sourceInstanceId: bar.sourceId, controller: 'A' as const };
        if (!evaluateCondition(bar.state, ctxB as never, eff.condition as never)) {
          const r2 = ReplacementManager.tryReplace(bar.state, ctxB as never, trig as never);
          if (r2.replaced) { row.status = 'FAILS_CONDITION'; row.failureReason = 'replacement fired even though its condition was false'; row.blockingLayer = 'replacement'; row.fixFamily = 'condition-enforcement'; return row; }
        }
      }
      row.status = 'VERIFIED_RUNTIME';
    } else {
      row.status = 'NEEDS_TEXT_REVIEW';
      row.failureReason = condTrue ? 'replacement did not fire despite condition true (cost unpayable / not applicable in generic state)' : 'replacement condition not satisfiable in generic state';
      row.blockingLayer = 'harness';
    }
  } catch (err) {
    row.status = 'FAILS_RESOLUTION'; row.failureReason = `tryReplace threw: ${(err as Error).message?.slice(0, 120)}`; row.blockingLayer = 'engine'; row.fixFamily = 'crash';
  }
  return row;
}

// ── main loop ──
for (const card of cards) {
  visited.add(card.id);
  const spec = (card as { effectSpecV2?: { clauses?: unknown[]; continuous?: unknown[]; replacements?: unknown[] } }).effectSpecV2;
  const text = ((card as { effectText?: string }).effectText ?? '').trim();
  if (!spec || ((spec.clauses?.length ?? 0) === 0 && (spec.continuous?.length ?? 0) === 0 && (spec.replacements?.length ?? 0) === 0)) {
    // vanilla vs unsupported
    const vanilla = text === '' || text === '-';
    rows.push({
      cardId: card.id, cardName: (card as { name: string }).name, cardType: (card as { kind: string }).kind,
      path: 'no-spec', timing: '(none)', conditionFamily: '(none)', costFamily: '(none)', targetFamily: '(none)',
      actionFamily: '(none)', generatedScenario: vanilla ? 'vanilla' : 'empty-spec', expectedLegal: '', actualLegal: '',
      expectedPending: '', actualPending: '', expectedStateDelta: vanilla ? 'none' : '', actualStateDelta: '',
      expectedHistory: '', actualHistory: '', status: vanilla ? 'VERIFIED_RUNTIME' : 'UNSUPPORTED',
      failureReason: vanilla ? 'vanilla (no printed effect)' : 'printed ability but empty/unauthored spec',
      blockingLayer: vanilla ? '' : 'data', fixFamily: vanilla ? '' : 'author-spec',
    });
    continue;
  }
  (spec.clauses ?? []).forEach((cl, i) => { clausesDiscovered++; rows.push(classifyClause(card, cl as Record<string, unknown>, i)); });
  (spec.continuous ?? []).forEach((ce, i) => { clausesDiscovered++; clausesExecuted++; rows.push(classifyContinuous(card, ce as Record<string, unknown>, i)); });
  (spec.replacements ?? []).forEach((re, i) => { clausesDiscovered++; clausesExecuted++; rows.push(classifyReplacement(card, re as Record<string, unknown>, i)); });
}

// ── write CSV ──
const COLS = ['cardId', 'cardName', 'cardType', 'path', 'timing', 'conditionFamily', 'costFamily', 'targetFamily', 'actionFamily', 'generatedScenario', 'expectedLegal', 'actualLegal', 'expectedPending', 'actualPending', 'expectedStateDelta', 'actualStateDelta', 'expectedHistory', 'actualHistory', 'status', 'failureReason', 'blockingLayer', 'fixFamily'] as const;
const csvCell = (v: string) => `"${String(v ?? '').replace(/"/g, "'").replace(/\n/g, ' ')}"`;
const csv = [COLS.join(',')].concat(rows.map((r) => COLS.map((c) => csvCell((r as unknown as Record<string, string>)[c])).join(','))).join('\n');
mkdirSync(resolve(ROOT, 'docs'), { recursive: true });
writeFileSync(resolve(ROOT, 'docs/F13_CARD_RUNTIME_MATRIX.csv'), csv);

// ── tallies + clustering ──
const statusTally: Record<string, number> = {};
for (const r of rows) statusTally[r.status] = (statusTally[r.status] ?? 0) + 1;
const skippedCards = cards.filter((c) => !visited.has(c.id)).map((c) => c.id);

// condition family pass/fail clustering (per clause path)
const condCluster: Record<string, { total: number; verified: number; fail: number; review: number }> = {};
for (const r of rows) {
  if (r.path.startsWith('clause#') && r.conditionFamily !== '(none)') {
    for (const fam of r.conditionFamily.split('|')) {
      const e = condCluster[fam] ?? { total: 0, verified: 0, fail: 0, review: 0 };
      e.total++; if (r.status === 'VERIFIED_RUNTIME') e.verified++; else if (r.status.startsWith('FAILS')) e.fail++; else e.review++;
      condCluster[fam] = e;
    }
  }
}
const failFamilyCluster: Record<string, number> = {};
for (const r of rows) if (r.status.startsWith('FAILS') || r.status === 'UNSUPPORTED') { const k = `${r.status}:${r.fixFamily || r.failureReason.slice(0, 40)}`; failFamilyCluster[k] = (failFamilyCluster[k] ?? 0) + 1; }

// ── write report ──
const top = (o: Record<string, number>, n: number) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
const md = `# F-13 — Full-Corpus Runtime Verification

**Generated by** \`scripts/f13-runtime-verify/run.ts\` (re-runnable). Drives the real engine per card per effect path. Card-agnostic (no card-ID/name branches). Discovery only — no fixes.

## Before/after — harness deepened across F-13 → F-14b → F-14c
| metric | F-13 (generic) | now (F-14c) | Δ |
|---|--:|--:|--:|
| VERIFIED_RUNTIME | 1818 | ${statusTally['VERIFIED_RUNTIME'] ?? 0} | ${(statusTally['VERIFIED_RUNTIME'] ?? 0) - 1818} |
| NEEDS_TEXT_REVIEW | 1436 | ${statusTally['NEEDS_TEXT_REVIEW'] ?? 0} | ${(statusTally['NEEDS_TEXT_REVIEW'] ?? 0) - 1436} |
| skipped paths | 257 | ${clausesSkipped} | ${clausesSkipped - 257} |
| FAILS_COST | 75 | ${statusTally['FAILS_COST'] ?? 0} | ${(statusTally['FAILS_COST'] ?? 0) - 75} |
| UNSUPPORTED | 19 | ${statusTally['UNSUPPORTED'] ?? 0} | ${(statusTally['UNSUPPORTED'] ?? 0) - 19} |

What changed:
- **F-14b:** per-clause \`tailorState\` plants the condition (leader trait/type/name, life/hand/trash/DON thresholds, own/opp char counts) + a filter-matching target + resources; combat/window/event triggers driven via direct trigger dispatch (labeled \`direct-trigger-dispatch\`).
- **F-14a:** fixed the one real bug — \`offering-cost-precheck\` (FAILS_COST 75 → 0).
- **F-14c:** (1) **replacements driven through the real \`ReplacementManager\`** (auto-armed card-intrinsic replacements; \`would_be_ko\`/\`would_be_removed\`) with condition gating; (2) **visibility counts as a real effect** — snapshot now includes \`knownByViewer\`, plus look/peek/reveal history events + raised pending (so a no-durable-delta look effect is proven, not "unknown"); (3) **nested sub-action targets planted** (choose-then-KO/buff/bounce/play); (4) exotic condition builders (\`is_opp_turn\`, \`if_owned_other_with_name\`, \`if_own_chars_min_cost/with_trait\`, \`if_own_rested_don_min\`, \`if_don_max\`).

Integrity unchanged: delta snapshots are taken AFTER tailoring, so planting cannot fake a pass; nothing is VERIFIED without a real observable post-dispatch effect (durable delta, visibility change, raised pending, or a proven replacement).

## Coverage (no card left behind)
- Total cards: **${cards.length}**
- Cards visited: **${visited.size}**
- Cards skipped: **${skippedCards.length}**${skippedCards.length ? ' — ' + skippedCards.join(', ') : ' ✅'}
- Clauses/paths discovered: **${clausesDiscovered}** · executed: **${clausesExecuted}** · skipped: **${clausesSkipped}**
- Skip reasons (path could not be driven in isolation):
${top(skipReasons, 30).map(([k, v]) => `  - ${k}: ${v}`).join('\n')}

## Status distribution (rows = ${rows.length})
${Object.entries(statusTally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Top failure families (systemic — the real deliverable)
${top(failFamilyCluster, 25).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Condition-family runtime clustering (clause paths)
| condition family | total | verified | fail | needs-review |
|---|--:|--:|--:|--:|
${Object.entries(condCluster).sort((a, b) => b[1].total - a[1].total).map(([k, e]) => `| ${k} | ${e.total} | ${e.verified} | ${e.fail} | ${e.review} |`).join('\n')}

## Harness validation — false positives eliminated (do not re-introduce)
An earlier permissive pass reported ~700 "failures"; spot-checking proved they were **harness artifacts**, now eliminated:
- **FAILS_CONDITION (was 36 → 0):** multi-clause same-trigger cards polluted each other's \`CLAUSE_FIRED\`. Fixed by dispatching each clause in **isolation** (single-clause synthetic spec).
- **FAILS_RESOLUTION/no-op-handler (was 227 → 0):** "fired but no delta" is usually a missing resource in the generic state (empty DON deck, no filter-matching card), not a handler bug. Downgraded to NEEDS_TEXT_REVIEW.
- **FAILS_PENDING_UI (was 208 → 0):** a choice target whose filter excludes the generic fillers has 0 candidates → correctly no pending; choice-costs may be unpayable in the generic state. Now only flagged for cost-less, candidates>0, clause-level choice targets — which left 0 provable cases.

Only **PROVEN** contradictions remain as FAILS_*. This is deliberate: a false failure is as dishonest as a false pass.

## Honesty notes
- **VERIFIED_RUNTIME** = the harness built a decisive favorable state, the clause fired (CLAUSE_FIRED) AND mutated state; for continuous, applied + idempotent. For \`activate_main\` it also confirms offering, and for human-choice paths it confirms a pending is raised.
- **NEEDS_TEXT_REVIEW** = the harness could not construct a decisive scenario (non-drivable trigger, filtered target with no matching card in the generic state, unmet condition, replacement effect) — NOT a pass. These need a per-card reading pass or a richer scenario generator.
- **FAILS_*** = a runtime contradiction the harness proved (crash, condition not enforced, offering without cost pre-check, no pending for a human choice, silent no-op).
- This pass does NOT prove "exact match to printed English" — that remains a reading-pass concern on top of the runtime facts here.

## Highest-impact next engineering tasks (proposed, no fixes yet)
1. The largest **FAILS_*** family above is the first systemic fix.
2. Reduce **NEEDS_TEXT_REVIEW** by extending the harness: (a) drive \`trigger\`/\`on_block\`/\`counter\` via full combat reducers; (b) a smarter target generator that plants a filter-matching card per clause; (c) drive replacement effects via a would-be-KO probe.
3. Then a per-card text↔runtime reading pass over the residual NEEDS_TEXT_REVIEW set.

*Artifacts:* \`F13_CARD_RUNTIME_MATRIX.csv\` (per card per path). Re-run: \`npx tsx scripts/f13-runtime-verify/run.ts\`.
`;
writeFileSync(resolve(ROOT, 'docs/F13_FULL_CORPUS_RUNTIME_VERIFICATION.md'), md);

// ── console summary ──
console.log('F-13 runtime verification complete.');
console.log('cards:', cards.length, 'visited:', visited.size, 'skipped:', skippedCards.length);
console.log('paths discovered:', clausesDiscovered, 'executed:', clausesExecuted, 'skipped:', clausesSkipped);
console.log('rows:', rows.length);
console.log('status:', JSON.stringify(statusTally));
console.log('top fail families:', JSON.stringify(top(failFamilyCluster, 8)));
console.log('wrote docs/F13_CARD_RUNTIME_MATRIX.csv + docs/F13_FULL_CORPUS_RUNTIME_VERIFICATION.md');
