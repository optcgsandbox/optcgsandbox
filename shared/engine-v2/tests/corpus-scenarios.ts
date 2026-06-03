/**
 * Engine V2 — corpus scenario library (test-layer only).
 *
 * Deterministic, fixed-order board-state fixtures used by the corpus
 * coverage harness to drive each card under multiple plausible
 * scenarios. Each scenario is pure data + a constructor; no engine
 * logic touched.
 *
 * Scenarios are listed in fixed order. Each scenario declares:
 *   - name: human-readable label
 *   - appliesTo(card): heuristic — does this scenario fit the card's
 *     declared triggers / conditions / costs?
 *   - build(card): returns a GameState with the card placed and
 *     adjacent state shaped for the scenario.
 *
 * Scratch / dispatcher are NOT exercised here. This file only builds
 * states; the harness runs EffectDispatcher.dispatch against each.
 */

import type { Card } from '../cards/Card.js';
import type { EffectClauseV2, EffectConditionV2 } from '../spec/types.js';
import {
  type CardId,
  type CardInstance,
  CURRENT_SCHEMA_VERSION,
  type GameState,
  type InstanceId,
  type Phase,
  type PlayerId,
} from '../state/types.js';

// ────────────────────────────────────────────────────────────────────
// ID factory (deterministic per build call)
// ────────────────────────────────────────────────────────────────────

let _idCounter = 0;
function resetIds(): void { _idCounter = 0; }
function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${_idCounter}`;
}

function makeInst(cardId: CardId, controller: PlayerId): CardInstance {
  return {
    instanceId: nextId(`${controller}-${cardId}`),
    cardId, controller,
    rested: false, summoningSick: false,
    attachedDon: [], attachedDonRested: [],
    perTurn: { hasAttacked: false, effectsUsed: [] },
  };
}

// ────────────────────────────────────────────────────────────────────
// Card stubs — vanilla character / DON / trait-tagged leaders + hand
// ────────────────────────────────────────────────────────────────────

const VANILLA = {
  id: 'V', name: 'V', kind: 'character', cost: 2, power: 3000,
  counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '',
} as unknown as Card;

const DON = {
  id: 'DON', name: 'DON!!', kind: 'don', cost: null, power: null,
  counterValue: null, colors: [], traits: [], keywords: [], effectText: '',
} as unknown as Card;

function leaderWithTraits(id: string, traits: ReadonlyArray<string>, colors: ReadonlyArray<string> = ['red']): Card {
  return {
    id, name: id, kind: 'leader', cost: null, power: 5000, life: 5,
    counterValue: null, colors, traits: [...traits], keywords: [], effectText: '',
  } as unknown as Card;
}

function charWithTraitsAndPower(id: string, traits: ReadonlyArray<string>, cost = 2, power = 3000): Card {
  return {
    id, name: id, kind: 'character', cost, power,
    counterValue: 1000, colors: ['red'], traits: [...traits], keywords: [], effectText: '',
  } as unknown as Card;
}

const LEADER_VANILLA = leaderWithTraits('LV', []);

// Trait-tagged leaders — one per common archetype trait found in corpus.
const LEADER_STRAW_HAT = leaderWithTraits('L_STRAW', ['Straw Hat Crew']);
const LEADER_LAND_OF_WANO = leaderWithTraits('L_WANO', ['Land of Wano']);
const LEADER_SUPERNOVAS = leaderWithTraits('L_SN', ['Supernovas']);
const LEADER_BAROQUE_WORKS = leaderWithTraits('L_BW', ['Baroque Works']);
const LEADER_WHITEBEARD = leaderWithTraits('L_WB', ['Whitebeard Pirates']);
const LEADER_DONQUIXOTE = leaderWithTraits('L_DQ', ['Donquixote Pirates']);
const LEADER_IMPEL_DOWN = leaderWithTraits('L_ID', ['Impel Down']);
const LEADER_DRESSROSA = leaderWithTraits('L_DR', ['Dressrosa']);

// Hand cards spanning common traits — for discard-filter / play-filter tests.
const HAND_PALETTE: ReadonlyArray<Card> = [
  charWithTraitsAndPower('H_IMPEL', ['Impel Down'], 2, 3000),
  charWithTraitsAndPower('H_GERMA', ['GERMA 66', 'The Vinsmoke Family'], 3, 3000),
  charWithTraitsAndPower('H_STRAW', ['Straw Hat Crew'], 2, 4000),
  charWithTraitsAndPower('H_WANO', ['Land of Wano'], 5, 5000),
  charWithTraitsAndPower('H_BW', ['Baroque Works'], 3, 4000),
  charWithTraitsAndPower('H_WB', ['Whitebeard Pirates'], 4, 5000),
  charWithTraitsAndPower('H_DQ', ['Donquixote Pirates'], 2, 3000),
  charWithTraitsAndPower('H_DR', ['Dressrosa'], 3, 4000),
  charWithTraitsAndPower('H_ANIMAL', ['Animal'], 2, 3000),
  charWithTraitsAndPower('H_CP', ['CP9'], 4, 5000),
];

// ────────────────────────────────────────────────────────────────────
// State builder primitives
// ────────────────────────────────────────────────────────────────────

interface BuildOpts {
  readonly leader?: Card;
  readonly handCards?: ReadonlyArray<Card>;
  readonly fieldCharsOwn?: ReadonlyArray<Card>;
  readonly fieldCharsOpp?: ReadonlyArray<Card>;
  readonly trashCharsOwn?: ReadonlyArray<Card>;
  readonly donInCostAreaOwn?: number; // active DON count for A
  readonly donInCostAreaOpp?: number; // active DON count for B
  readonly donRestedOwn?: number;
  readonly lifeOwn?: number;
  readonly lifeOpp?: number;
  readonly turn?: number;
  readonly phase?: Phase;
  readonly activePlayer?: PlayerId;
  readonly attachAttachedDonToSource?: number;
  // Category A extensions
  readonly sourceRested?: boolean;             // inst.rested = true on source
  readonly sourceSummoningSick?: boolean;      // inst.summoningSick = true on source
  readonly fieldCharsOwnRested?: boolean;      // all opts.fieldCharsOwn entered rested
  readonly attachDonToNonSourceField?: number; // attach N active DON to first non-source field char
  readonly nameMatchChars?: ReadonlyArray<string>; // add own field chars named exactly these
  // Category B extensions
  readonly oppHandSize?: number;               // override opp hand size (default 5)
  readonly fieldCharsOppRested?: boolean;      // all opts.fieldCharsOpp entered rested
}

function fillVanilla(
  side: PlayerId,
  count: number,
  instances: Record<InstanceId, CardInstance>,
): InstanceId[] {
  const out: InstanceId[] = [];
  for (let i = 0; i < count; i++) {
    const inst = makeInst(VANILLA.id, side);
    instances[inst.instanceId] = inst;
    out.push(inst.instanceId);
  }
  return out;
}

function pushChar(
  side: PlayerId,
  card: Card,
  cardLibrary: Record<CardId, Card>,
  instances: Record<InstanceId, CardInstance>,
): CardInstance {
  cardLibrary[card.id] = card;
  const inst = makeInst(card.id, side);
  instances[inst.instanceId] = inst;
  return inst;
}

function build(card: Card, opts: BuildOpts = {}): { state: GameState; sourceId: InstanceId } {
  resetIds();
  const leaderCard = opts.leader ?? LEADER_VANILLA;
  const cardLibrary: Record<CardId, Card> = {
    [VANILLA.id]: VANILLA,
    [DON.id]: DON,
    [leaderCard.id]: leaderCard,
    [card.id]: card,
  };
  for (const h of opts.handCards ?? []) cardLibrary[h.id] = h;
  for (const f of opts.fieldCharsOwn ?? []) cardLibrary[f.id] = f;
  for (const f of opts.fieldCharsOpp ?? []) cardLibrary[f.id] = f;
  for (const t of opts.trashCharsOwn ?? []) cardLibrary[t.id] = t;

  const instances: Record<InstanceId, CardInstance> = {};
  const aLeader = makeInst(leaderCard.id, 'A');
  const bLeader = makeInst(leaderCard.id, 'B');
  instances[aLeader.instanceId] = aLeader;
  instances[bLeader.instanceId] = bLeader;

  // Source instance
  const source = makeInst(card.id, 'A');
  instances[source.instanceId] = source;

  // Hand
  const aHandIds: InstanceId[] = [];
  for (const h of opts.handCards ?? []) {
    const inst = pushChar('A', h, cardLibrary, instances);
    aHandIds.push(inst.instanceId);
  }
  // Pad with vanilla to keep hand non-empty (deterministic).
  const padHand = 3 - aHandIds.length;
  if (padHand > 0) aHandIds.push(...fillVanilla('A', padHand, instances));

  // Field own (excluding source which we place separately)
  const aFieldChars: CardInstance[] = [];
  for (const f of opts.fieldCharsOwn ?? []) {
    const inst = pushChar('A', f, cardLibrary, instances);
    if (opts.fieldCharsOwnRested === true) inst.rested = true;
    aFieldChars.push(inst);
  }

  // Name-match own field chars (Category A: if_owned_other_with_name).
  // Each entry is a card-name; we emit a minimally-shaped character card
  // with that name and place it on own field next to the source.
  for (const nm of opts.nameMatchChars ?? []) {
    const idSafe = `NAME_${nm.replace(/[^A-Za-z0-9_]/g, '_')}`;
    const nmCard = ({
      id: idSafe, name: nm, kind: 'character', cost: 2, power: 3000,
      counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '',
    } as unknown) as Card;
    const inst = pushChar('A', nmCard, cardLibrary, instances);
    aFieldChars.push(inst);
  }

  // Field opp
  const bFieldChars: CardInstance[] = [];
  for (const f of opts.fieldCharsOpp ?? []) {
    const inst = pushChar('B', f, cardLibrary, instances);
    if (opts.fieldCharsOppRested === true) inst.rested = true;
    bFieldChars.push(inst);
  }

  // Trash
  const aTrashIds: InstanceId[] = fillVanilla('A', 3, instances);
  for (const t of opts.trashCharsOwn ?? []) {
    const inst = pushChar('A', t, cardLibrary, instances);
    aTrashIds.push(inst.instanceId);
  }

  // Deck / life
  const aDeck = fillVanilla('A', 30, instances);
  const aLife = fillVanilla('A', opts.lifeOwn ?? 5, instances);
  const bDeck = fillVanilla('B', 30, instances);
  const bLife = fillVanilla('B', opts.lifeOpp ?? 5, instances);
  const bHand = fillVanilla('B', opts.oppHandSize ?? 5, instances);

  // DON setup
  const aDonAll = fillVanilla('A', 10, instances);
  const aActiveDon = Math.max(0, Math.min(10, opts.donInCostAreaOwn ?? 4));
  const aRestedDon = Math.max(0, Math.min(10 - aActiveDon, opts.donRestedOwn ?? 0));
  const aDonCostArea = aDonAll.slice(0, aActiveDon);
  const aDonRested = aDonAll.slice(aActiveDon, aActiveDon + aRestedDon);
  const aDonDeck = aDonAll.slice(aActiveDon + aRestedDon);

  const bDonAll = fillVanilla('B', 10, instances);
  const bActiveDon = Math.max(0, Math.min(10, opts.donInCostAreaOpp ?? 4));
  const bDonCostArea = bDonAll.slice(0, bActiveDon);
  const bDonDeck = bDonAll.slice(bActiveDon);

  // Attach DON to source if requested
  const attachToSrc = Math.min(opts.attachAttachedDonToSource ?? 0, aDonCostArea.length);
  if (attachToSrc > 0) {
    for (let i = 0; i < attachToSrc; i++) {
      const id = aDonCostArea.shift();
      if (id !== undefined) source.attachedDon.push(id);
    }
  }
  // Attach DON to first non-source own field char if requested
  const attachToNonSrc = Math.min(opts.attachDonToNonSourceField ?? 0, aDonCostArea.length);
  if (attachToNonSrc > 0 && aFieldChars.length > 0) {
    const target = aFieldChars[0]!;
    for (let i = 0; i < attachToNonSrc; i++) {
      const id = aDonCostArea.shift();
      if (id !== undefined) target.attachedDon.push(id);
    }
  }
  // Source rest-state / played-this-turn flags (Category A)
  if (opts.sourceRested === true) source.rested = true;
  if (opts.sourceSummoningSick === true) source.summoningSick = true;

  const state: GameState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    seed: 1, rngCounter: 0,
    turn: opts.turn ?? 2,
    activePlayer: opts.activePlayer ?? 'A',
    firstPlayer: 'A',
    phase: opts.phase ?? 'main',
    controllerMode: { A: 'deterministic', B: 'deterministic' },
    players: {
      A: {
        leader: aLeader,
        hand: aHandIds, deck: aDeck, trash: aTrashIds,
        field: [source, ...aFieldChars],
        stage: null,
        life: aLife, lifeFaceUp: {},
        donDeck: aDonDeck, donCostArea: aDonCostArea, donRested: aDonRested,
        exile: [],
      },
      B: {
        leader: bLeader,
        hand: bHand, deck: bDeck, trash: [],
        field: bFieldChars,
        stage: null,
        life: bLife, lifeFaceUp: {},
        donDeck: bDonDeck, donCostArea: bDonCostArea, donRested: [],
        exile: [],
      },
    },
    cardLibrary, instances, history: [], result: null, pending: null,
    koSourceStack: [], pendingDonReturned: {},
    mulliganUsed: { A: false, B: false },
    diceRoll: null, knownByViewer: { A: [], B: [] }, gameRules: {},
    continuousApplyDepth: 0, cardsTrashedThisResolution: 0,
  };
  return { state, sourceId: source.instanceId };
}

// ────────────────────────────────────────────────────────────────────
// Trigger / condition / cost introspection helpers
// ────────────────────────────────────────────────────────────────────

function collectClauseTriggers(card: Card): Set<string> {
  const out = new Set<string>();
  const clauses = card.effectSpecV2?.clauses;
  if (!Array.isArray(clauses)) return out;
  for (const cl of clauses) out.add(cl.trigger);
  return out;
}

function walkCondition(cond: EffectConditionV2 | undefined, out: Set<string>): void {
  if (cond === undefined) return;
  if (typeof cond.type === 'string') out.add(cond.type);
  const subs = (cond as { conditions?: ReadonlyArray<EffectConditionV2> }).conditions;
  if (Array.isArray(subs)) for (const s of subs) walkCondition(s, out);
  const inner = (cond as { condition?: EffectConditionV2 }).condition;
  if (inner !== undefined) walkCondition(inner, out);
}

function collectClauseConditions(card: Card): Set<string> {
  const out = new Set<string>();
  const clauses = card.effectSpecV2?.clauses;
  if (!Array.isArray(clauses)) return out;
  for (const cl of clauses) walkCondition(cl.condition, out);
  return out;
}

function collectClauseCostKeys(card: Card): Set<string> {
  const out = new Set<string>();
  const clauses = card.effectSpecV2?.clauses;
  if (!Array.isArray(clauses)) return out;
  for (const cl of clauses) {
    const c = cl.cost;
    if (c === undefined) continue;
    for (const k of Object.keys(c)) if (k !== 'bind') out.add(k);
  }
  return out;
}

function collectClauseActionKinds(card: Card): Set<string> {
  const out = new Set<string>();
  const clauses = card.effectSpecV2?.clauses;
  if (!Array.isArray(clauses)) return out;
  function walk(action: { kind?: unknown; actions?: ReadonlyArray<EffectClauseV2['action']> } | undefined): void {
    if (action === undefined) return;
    if (typeof action.kind === 'string') out.add(action.kind);
    if (Array.isArray(action.actions)) for (const sub of action.actions) walk(sub as { kind?: unknown; actions?: ReadonlyArray<EffectClauseV2['action']> });
  }
  for (const cl of clauses) walk(cl.action as { kind?: unknown; actions?: ReadonlyArray<EffectClauseV2['action']> } | undefined);
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Scenario interface + library
// ────────────────────────────────────────────────────────────────────

export interface Scenario {
  readonly name: string;
  readonly appliesTo: (card: Card) => boolean;
  readonly build: (card: Card) => { state: GameState; sourceId: InstanceId };
}

const ATTACK_TRIGGERS = new Set(['when_attacking', 'on_attack_deal_damage']);
const DEFENSE_TRIGGERS = new Set(['on_opp_attack', 'on_block', 'on_self_activate_event', 'on_opp_activate_event']);
const ON_KO_TRIGGERS = new Set(['on_ko']);
const END_OF_TURN_TRIGGERS = new Set(['at_end_of_turn_self', 'at_end_of_turn_opp', 'at_end_of_turn']);
const LEADER_GATE_CONDITIONS = new Set([
  'if_leader_has_trait', 'if_leader_has_type', 'if_leader_is',
  'if_leader_has_color', 'if_leader_multicolored', 'if_leader_attribute_is',
  'if_leader_power_min', 'if_leader_power_max', 'if_own_leader_active',
]);
const DON_CONDITIONS = new Set([
  'if_don_min', 'if_don_max', 'if_opp_don_min', 'if_opp_don_max',
  'if_own_don_le_opp', 'if_own_rested_don_min', 'if_attached_don_min',
]);
const HAND_USAGE = new Set([
  'discardHandFilter', 'discardHand', 'play_for_free',
]);

function clauseUsesAttackTrigger(card: Card): boolean {
  for (const t of collectClauseTriggers(card)) if (ATTACK_TRIGGERS.has(t)) return true;
  return false;
}
function clauseUsesDefenseTrigger(card: Card): boolean {
  for (const t of collectClauseTriggers(card)) if (DEFENSE_TRIGGERS.has(t)) return true;
  return false;
}
function clauseUsesOnKoTrigger(card: Card): boolean {
  for (const t of collectClauseTriggers(card)) if (ON_KO_TRIGGERS.has(t)) return true;
  return false;
}
function clauseUsesEndOfTurnTrigger(card: Card): boolean {
  for (const t of collectClauseTriggers(card)) if (END_OF_TURN_TRIGGERS.has(t)) return true;
  return false;
}
function clauseUsesLeaderGate(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (LEADER_GATE_CONDITIONS.has(c)) return true;
  return false;
}
function clauseUsesDonGate(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (DON_CONDITIONS.has(c)) return true;
  return false;
}
function clauseUsesHand(card: Card): boolean {
  const costs = collectClauseCostKeys(card);
  for (const c of costs) if (HAND_USAGE.has(c)) return true;
  const actions = collectClauseActionKinds(card);
  for (const a of actions) if (HAND_USAGE.has(a)) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────
// Category A heuristics + per-condition extractors
// ────────────────────────────────────────────────────────────────────

const OWN_FIELD_COUNT_CONDS = new Set([
  'if_own_chars_min',
  'if_own_chars_min_rested',
  'if_own_chars_min_cost',
  'if_own_chars_max_with_min_power',
  'if_own_chars_min_power',
  'if_own_chars_min_filter',
  'if_field_total_cost_min',
  'if_own_chars_lt_opp_chars',
]);
const OWN_FIELD_REST_CONDS = new Set(['if_own_chars_min_rested', 'if_own_rested_don_min']);
const OWN_FIELD_TRAIT_CONDS = new Set([
  'if_own_chars_min_with_trait', 'if_only_chars_with_trait',
]);
const SOURCE_REST_CONDS = new Set(['if_self_rested']);
const SOURCE_ACTIVE_CONDS = new Set(['if_self_active']);
const SOURCE_PLAYED_THIS_TURN_CONDS = new Set(['if_played_this_turn']);
const ATTACHED_DON_CONDS = new Set(['if_attached_don_min']);
const NAME_MATCH_CONDS = new Set(['if_owned_other_with_name']);

function clauseUsesOwnFieldCount(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (OWN_FIELD_COUNT_CONDS.has(c)) return true;
  return false;
}
function clauseUsesOwnFieldRest(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (OWN_FIELD_REST_CONDS.has(c)) return true;
  return false;
}
function clauseUsesOwnFieldTrait(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (OWN_FIELD_TRAIT_CONDS.has(c)) return true;
  return false;
}
function clauseUsesSourceRest(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (SOURCE_REST_CONDS.has(c)) return true;
  return false;
}
function clauseUsesSourceActive(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (SOURCE_ACTIVE_CONDS.has(c)) return true;
  return false;
}
function clauseUsesPlayedThisTurn(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (SOURCE_PLAYED_THIS_TURN_CONDS.has(c)) return true;
  return false;
}
function clauseUsesAttachedDon(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (ATTACHED_DON_CONDS.has(c)) return true;
  return false;
}
function clauseUsesNameMatch(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (NAME_MATCH_CONDS.has(c)) return true;
  return false;
}

// Walk every condition in every clause and collect the `name` field from
// any `if_owned_other_with_name` condition. Returns deterministic list.
function extractRequiredNames(card: Card): string[] {
  const names = new Set<string>();
  function visit(c: EffectConditionV2 | undefined): void {
    if (c === undefined) return;
    if (c.type === 'if_owned_other_with_name') {
      const nm = (c as { name?: unknown }).name;
      if (typeof nm === 'string' && nm.length > 0) names.add(nm);
    }
    const subs = (c as { conditions?: ReadonlyArray<EffectConditionV2> }).conditions;
    if (Array.isArray(subs)) for (const s of subs) visit(s);
    const inner = (c as { condition?: EffectConditionV2 }).condition;
    if (inner !== undefined) visit(inner);
  }
  for (const cl of card.effectSpecV2?.clauses ?? []) visit(cl.condition);
  return [...names].sort();
}

// ────────────────────────────────────────────────────────────────────
// Category C heuristics + filter-shape introspection
// ────────────────────────────────────────────────────────────────────

const HAND_COST_KEYS = new Set(['discardHand', 'discardHandFilter']);
const PLAY_FROM_FILTER_ACTIONS = new Set(['play_for_free', 'play_from_hand', 'play_from_trash']);

function clauseUsesHandFromCost(card: Card): boolean {
  for (const k of collectClauseCostKeys(card)) if (HAND_COST_KEYS.has(k)) return true;
  return false;
}

function clauseUsesPlayFromHand(card: Card): boolean {
  for (const cl of card.effectSpecV2?.clauses ?? []) {
    const a = cl.action as { kind?: unknown; from?: unknown; actions?: ReadonlyArray<unknown> };
    if (typeof a.kind === 'string' && PLAY_FROM_FILTER_ACTIONS.has(a.kind) && (a as { from?: unknown }).from === 'hand') return true;
    if (Array.isArray(a.actions)) {
      for (const sub of a.actions) {
        const s = sub as { kind?: unknown; from?: unknown };
        if (typeof s.kind === 'string' && PLAY_FROM_FILTER_ACTIONS.has(s.kind) && s.from === 'hand') return true;
      }
    }
  }
  return false;
}

function clauseUsesPlayFromTrash(card: Card): boolean {
  for (const cl of card.effectSpecV2?.clauses ?? []) {
    const a = cl.action as { kind?: unknown; from?: unknown; actions?: ReadonlyArray<unknown> };
    if (typeof a.kind === 'string' && PLAY_FROM_FILTER_ACTIONS.has(a.kind) && (a as { from?: unknown }).from === 'trash') return true;
    if (Array.isArray(a.actions)) {
      for (const sub of a.actions) {
        const s = sub as { kind?: unknown; from?: unknown };
        if (typeof s.kind === 'string' && PLAY_FROM_FILTER_ACTIONS.has(s.kind) && s.from === 'trash') return true;
      }
    }
  }
  return false;
}

// Extract literal `nameIs` values used in filters (cost or action).
function extractFilterNameIs(card: Card): string[] {
  const names = new Set<string>();
  function visit(value: unknown): void {
    if (typeof value !== 'object' || value === null) return;
    if (Array.isArray(value)) { for (const x of value) visit(x); return; }
    const v = value as Record<string, unknown>;
    const ni = v['nameIs'];
    if (typeof ni === 'string' && ni.length > 0) names.add(ni);
    for (const k of Object.keys(v)) visit(v[k]);
  }
  for (const cl of card.effectSpecV2?.clauses ?? []) {
    visit(cl.action);
    visit(cl.cost);
    visit(cl.target);
  }
  return [...names].sort();
}

// Category B heuristics — opp-side condition detection.
const OPP_HAND_CONDS = new Set(['if_opp_hand_min', 'if_opp_hand_max']);
const OPP_LIFE_CONDS = new Set([
  'if_opp_life_min', 'if_opp_life_max', 'if_own_life_lt_opp', 'if_own_life_le_opp',
]);
const OPP_DON_CONDS = new Set(['if_opp_don_min', 'if_opp_don_max', 'if_own_don_le_opp']);
const OPP_CHARS_CONDS = new Set([
  'if_opp_chars_min', 'if_opp_chars_min_rested',
  'if_opp_chars_min_cost', 'if_opp_chars_max_cost',
  'if_opp_chars_min_power',
  'if_own_chars_lt_opp_chars',
]);
const ATTACKER_ATTRIBUTE_CONDS = new Set(['if_attacker_has_attribute']);

function clauseUsesOppHand(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (OPP_HAND_CONDS.has(c)) return true;
  return false;
}
function clauseUsesOppLife(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (OPP_LIFE_CONDS.has(c)) return true;
  return false;
}
function clauseUsesOppDon(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (OPP_DON_CONDS.has(c)) return true;
  return false;
}
function clauseUsesOppChars(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (OPP_CHARS_CONDS.has(c)) return true;
  return false;
}
function clauseUsesAttackerAttribute(card: Card): boolean {
  for (const c of collectClauseConditions(card)) if (ATTACKER_ATTRIBUTE_CONDS.has(c)) return true;
  return false;
}

// Extract literal `trait` filter values used inside any action / cost
// filter (any trait references for play_for_free / discardHandFilter).
function extractFilterTraits(card: Card): string[] {
  const traits = new Set<string>();
  function visit(value: unknown): void {
    if (typeof value !== 'object' || value === null) return;
    if (Array.isArray(value)) { for (const x of value) visit(x); return; }
    const v = value as Record<string, unknown>;
    const t = v['trait'];
    if (typeof t === 'string' && t.length > 0) traits.add(t);
    const ti = v['typeIncludes'];
    if (typeof ti === 'string' && ti.length > 0) traits.add(ti);
    const ta = v['traitsAny'];
    if (Array.isArray(ta)) for (const x of ta) if (typeof x === 'string' && x.length > 0) traits.add(x);
    for (const k of Object.keys(v)) visit(v[k]);
  }
  for (const cl of card.effectSpecV2?.clauses ?? []) {
    visit(cl.action);
    visit(cl.cost);
    visit(cl.target);
  }
  return [...traits].sort();
}

// ────────────────────────────────────────────────────────────────────
// Concrete scenarios
// ────────────────────────────────────────────────────────────────────

export const BASELINE: Scenario = {
  name: 'BASELINE',
  appliesTo: () => true,
  build: (card) => build(card, { handCards: HAND_PALETTE.slice(0, 3) }),
};

function makeTraitScenario(name: string, leader: Card): Scenario {
  return {
    name,
    appliesTo: clauseUsesLeaderGate,
    build: (card) => build(card, { leader, handCards: HAND_PALETTE.slice(0, 5) }),
  };
}

export const TRAIT_MATCH_STRAW_HAT = makeTraitScenario('TRAIT:Straw Hat Crew', LEADER_STRAW_HAT);
export const TRAIT_MATCH_LAND_OF_WANO = makeTraitScenario('TRAIT:Land of Wano', LEADER_LAND_OF_WANO);
export const TRAIT_MATCH_SUPERNOVAS = makeTraitScenario('TRAIT:Supernovas', LEADER_SUPERNOVAS);
export const TRAIT_MATCH_BAROQUE_WORKS = makeTraitScenario('TRAIT:Baroque Works', LEADER_BAROQUE_WORKS);
export const TRAIT_MATCH_WHITEBEARD = makeTraitScenario('TRAIT:Whitebeard Pirates', LEADER_WHITEBEARD);
export const TRAIT_MATCH_DONQUIXOTE = makeTraitScenario('TRAIT:Donquixote Pirates', LEADER_DONQUIXOTE);
export const TRAIT_MATCH_IMPEL_DOWN = makeTraitScenario('TRAIT:Impel Down', LEADER_IMPEL_DOWN);
export const TRAIT_MATCH_DRESSROSA = makeTraitScenario('TRAIT:Dressrosa', LEADER_DRESSROSA);

function makeDonScenario(name: string, ownActive: number, oppActive: number, attached: number): Scenario {
  return {
    name,
    appliesTo: clauseUsesDonGate,
    build: (card) => build(card, {
      handCards: HAND_PALETTE.slice(0, 3),
      donInCostAreaOwn: ownActive,
      donInCostAreaOpp: oppActive,
      attachAttachedDonToSource: attached,
    }),
  };
}

export const DON_THRESHOLD_0 = makeDonScenario('DON:0/own,4/opp', 0, 4, 0);
export const DON_THRESHOLD_5 = makeDonScenario('DON:5/own,5/opp + 1 attached', 5, 5, 1);
export const DON_THRESHOLD_10 = makeDonScenario('DON:10/own,5/opp + 2 attached', 10, 5, 2);

export const ATTACK_PHASE: Scenario = {
  name: 'ATTACK_PHASE',
  appliesTo: clauseUsesAttackTrigger,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOpp: [charWithTraitsAndPower('OPP_C', [], 2, 3000)],
    attachAttachedDonToSource: 1,
  }),
};

export const DEFENSE_PHASE: Scenario = {
  name: 'DEFENSE_PHASE',
  appliesTo: clauseUsesDefenseTrigger,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOpp: [charWithTraitsAndPower('OPP_ATKR', [], 3, 4000)],
  }),
};

export const ON_KO: Scenario = {
  name: 'ON_KO',
  appliesTo: clauseUsesOnKoTrigger,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOpp: [charWithTraitsAndPower('OPP_KO_SRC', [], 3, 5000)],
  }),
};

export const END_OF_TURN: Scenario = {
  name: 'END_OF_TURN',
  appliesTo: clauseUsesEndOfTurnTrigger,
  build: (card) => build(card, {
    phase: 'end',
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOwn: [
      charWithTraitsAndPower('FIELD_IMPEL', ['Impel Down'], 3, 4000),
      charWithTraitsAndPower('FIELD_BIG', ['Whitebeard Pirates'], 6, 7000),
    ],
  }),
};

export const HAND_VARIANTS: Scenario = {
  name: 'HAND_VARIANTS',
  appliesTo: clauseUsesHand,
  build: (card) => build(card, {
    handCards: HAND_PALETTE, // full palette of typed cards
  }),
};

// ────────────────────────────────────────────────────────────────────
// Category A scenarios — own-board / source-state / DON-attached /
// name-match expansion. Each appliesTo is a precise heuristic so we
// only run scenarios where the card's clauses actually reference the
// corresponding state aspect.
// ────────────────────────────────────────────────────────────────────

// Standard 2-vanilla own-field pack (covers if_own_chars_min ≥ 2).
export const OWN_FIELD_LOW: Scenario = {
  name: 'OWN_FIELD_LOW (2 chars)',
  appliesTo: clauseUsesOwnFieldCount,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOwn: [
      charWithTraitsAndPower('OF_L_1', [], 2, 3000),
      charWithTraitsAndPower('OF_L_2', [], 3, 4000),
    ],
  }),
};

// Larger 5-vanilla own-field pack (covers if_own_chars_min ≥ 3+, if_field_total_cost_min).
export const OWN_FIELD_HIGH: Scenario = {
  name: 'OWN_FIELD_HIGH (5 chars)',
  appliesTo: clauseUsesOwnFieldCount,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOwn: [
      charWithTraitsAndPower('OF_H_1', [], 3, 4000),
      charWithTraitsAndPower('OF_H_2', [], 4, 5000),
      charWithTraitsAndPower('OF_H_3', [], 5, 6000),
      charWithTraitsAndPower('OF_H_4', [], 6, 7000),
      charWithTraitsAndPower('OF_H_5', [], 7, 8000),
    ],
  }),
};

// 3 rested chars own field (for if_own_chars_min_rested, if_self_rested combos).
export const OWN_FIELD_RESTED: Scenario = {
  name: 'OWN_FIELD_RESTED (3 rested chars)',
  appliesTo: clauseUsesOwnFieldRest,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOwn: [
      charWithTraitsAndPower('OF_R_1', [], 2, 3000),
      charWithTraitsAndPower('OF_R_2', [], 3, 4000),
      charWithTraitsAndPower('OF_R_3', [], 4, 5000),
    ],
    fieldCharsOwnRested: true,
  }),
};

// Source rested (for if_self_rested).
export const SOURCE_RESTED: Scenario = {
  name: 'SOURCE_RESTED',
  appliesTo: clauseUsesSourceRest,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    sourceRested: true,
  }),
};

// Source active and adjacent chars to enable if_self_active.
export const SOURCE_ACTIVE: Scenario = {
  name: 'SOURCE_ACTIVE',
  appliesTo: clauseUsesSourceActive,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOwn: [charWithTraitsAndPower('OF_A_1', [], 2, 3000)],
  }),
};

// Source freshly-played-this-turn (summoningSick=true) — for if_played_this_turn.
export const SOURCE_PLAYED_THIS_TURN: Scenario = {
  name: 'SOURCE_PLAYED_THIS_TURN',
  appliesTo: clauseUsesPlayedThisTurn,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    sourceSummoningSick: true,
  }),
};

// 2 DON attached to source (covers if_attached_don_min ≤ 2).
export const ATTACHED_DON_SOURCE_2: Scenario = {
  name: 'ATTACHED_DON:source +2',
  appliesTo: clauseUsesAttachedDon,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    attachAttachedDonToSource: 2,
  }),
};

// 4 DON attached to source (covers if_attached_don_min ≤ 4).
export const ATTACHED_DON_SOURCE_4: Scenario = {
  name: 'ATTACHED_DON:source +4',
  appliesTo: clauseUsesAttachedDon,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    donInCostAreaOwn: 10,
    attachAttachedDonToSource: 4,
  }),
};

// 2 DON attached to non-source own field char (rare but covers some cards).
export const ATTACHED_DON_NON_SOURCE: Scenario = {
  name: 'ATTACHED_DON:non-source +2',
  appliesTo: clauseUsesAttachedDon,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOwn: [charWithTraitsAndPower('OF_ADN', [], 2, 3000)],
    attachDonToNonSourceField: 2,
  }),
};

// Own-field trait-pack scenarios — N chars sharing a trait, useful for
// if_own_chars_min_with_trait and if_only_chars_with_trait. Pair each
// pack with a matching leader so leader-trait gates also satisfy.
function makeOwnFieldTraitPack(trait: string, leader: Card): Scenario {
  return {
    name: `OWN_FIELD_TRAIT:${trait}`,
    appliesTo: clauseUsesOwnFieldTrait,
    build: (card) => build(card, {
      leader,
      handCards: HAND_PALETTE.slice(0, 3),
      fieldCharsOwn: [
        charWithTraitsAndPower(`OF_T_${trait}_1`, [trait], 2, 3000),
        charWithTraitsAndPower(`OF_T_${trait}_2`, [trait], 3, 4000),
        charWithTraitsAndPower(`OF_T_${trait}_3`, [trait], 4, 5000),
      ],
    }),
  };
}

export const OWN_FIELD_TRAIT_STRAW_HAT = makeOwnFieldTraitPack('Straw Hat Crew', LEADER_STRAW_HAT);
export const OWN_FIELD_TRAIT_LAND_OF_WANO = makeOwnFieldTraitPack('Land of Wano', LEADER_LAND_OF_WANO);
export const OWN_FIELD_TRAIT_SUPERNOVAS = makeOwnFieldTraitPack('Supernovas', LEADER_SUPERNOVAS);
export const OWN_FIELD_TRAIT_BAROQUE = makeOwnFieldTraitPack('Baroque Works', LEADER_BAROQUE_WORKS);
export const OWN_FIELD_TRAIT_WHITEBEARD = makeOwnFieldTraitPack('Whitebeard Pirates', LEADER_WHITEBEARD);
export const OWN_FIELD_TRAIT_DONQUIXOTE = makeOwnFieldTraitPack('Donquixote Pirates', LEADER_DONQUIXOTE);
export const OWN_FIELD_TRAIT_IMPEL_DOWN = makeOwnFieldTraitPack('Impel Down', LEADER_IMPEL_DOWN);
export const OWN_FIELD_TRAIT_DRESSROSA = makeOwnFieldTraitPack('Dressrosa', LEADER_DRESSROSA);

// NAME_MATCH — dynamically introspects card's clauses for
// if_owned_other_with_name and places matching-named own-field chars.
export const NAME_MATCH: Scenario = {
  name: 'NAME_MATCH (dynamic)',
  appliesTo: clauseUsesNameMatch,
  build: (card) => {
    const names = extractRequiredNames(card);
    return build(card, {
      handCards: HAND_PALETTE.slice(0, 3),
      nameMatchChars: names,
    });
  },
};

// ────────────────────────────────────────────────────────────────────
// Category C — TRASH variants by trait, HAND variants by trait,
// dynamic NAME_MATCH variants for filter literals, and COMPOUND
// variants combining trait + trash/hand/DON/own-field.
// ────────────────────────────────────────────────────────────────────

const TRAITS_C = [
  'Supernovas',
  'Straw Hat Crew',
  'Land of Wano',
  'Whitebeard Pirates',
  'Baroque Works',
  'Donquixote Pirates',
  'Impel Down',
  'GERMA 66',
  'Navy',
  'Animal Kingdom Pirates',
] as const;

const TRAIT_TO_LEADER: Record<(typeof TRAITS_C)[number], Card> = {
  'Supernovas': LEADER_SUPERNOVAS,
  'Straw Hat Crew': LEADER_STRAW_HAT,
  'Land of Wano': LEADER_LAND_OF_WANO,
  'Whitebeard Pirates': LEADER_WHITEBEARD,
  'Baroque Works': LEADER_BAROQUE_WORKS,
  'Donquixote Pirates': LEADER_DONQUIXOTE,
  'Impel Down': LEADER_IMPEL_DOWN,
  'GERMA 66': leaderWithTraits('L_GERMA', ['GERMA 66', 'The Vinsmoke Family']),
  'Navy': leaderWithTraits('L_NAVY', ['Navy']),
  'Animal Kingdom Pirates': leaderWithTraits('L_AKP', ['Animal Kingdom Pirates']),
};

// Trash deck containing 5 chars sharing the trait at varied costs 1..6.
function trashPackByTrait(trait: string): ReadonlyArray<Card> {
  return [
    charWithTraitsAndPower(`TC_${trait}_1`, [trait], 1, 2000),
    charWithTraitsAndPower(`TC_${trait}_3`, [trait], 3, 4000),
    charWithTraitsAndPower(`TC_${trait}_5`, [trait], 5, 6000),
    charWithTraitsAndPower(`TC_${trait}_5b`, [trait], 5, 5000),
    charWithTraitsAndPower(`TC_${trait}_7`, [trait], 7, 8000),
  ];
}

// Hand pack containing 5 chars sharing the trait at varied costs.
function handPackByTrait(trait: string): ReadonlyArray<Card> {
  return [
    charWithTraitsAndPower(`HC_${trait}_1`, [trait], 1, 2000),
    charWithTraitsAndPower(`HC_${trait}_2`, [trait], 2, 3000),
    charWithTraitsAndPower(`HC_${trait}_3`, [trait], 3, 4000),
    charWithTraitsAndPower(`HC_${trait}_5`, [trait], 5, 6000),
    charWithTraitsAndPower(`HC_${trait}_7`, [trait], 7, 8000),
  ];
}

function makeTrashTraitScenario(trait: string): Scenario {
  return {
    name: `TRASH:${trait}`,
    appliesTo: clauseUsesPlayFromTrash,
    build: (card) => build(card, {
      handCards: HAND_PALETTE.slice(0, 3),
      trashCharsOwn: trashPackByTrait(trait),
    }),
  };
}

function makeHandTraitScenario(trait: string): Scenario {
  return {
    name: `HAND:${trait}`,
    appliesTo: (card) => clauseUsesHandFromCost(card) || clauseUsesPlayFromHand(card),
    build: (card) => build(card, {
      handCards: handPackByTrait(trait),
    }),
  };
}

export const TRASH_SUPERNOVAS = makeTrashTraitScenario('Supernovas');
export const TRASH_STRAW_HAT = makeTrashTraitScenario('Straw Hat Crew');
export const TRASH_LAND_OF_WANO = makeTrashTraitScenario('Land of Wano');
export const TRASH_WHITEBEARD = makeTrashTraitScenario('Whitebeard Pirates');
export const TRASH_BAROQUE = makeTrashTraitScenario('Baroque Works');
export const TRASH_DONQUIXOTE = makeTrashTraitScenario('Donquixote Pirates');
export const TRASH_IMPEL_DOWN = makeTrashTraitScenario('Impel Down');
export const TRASH_GERMA = makeTrashTraitScenario('GERMA 66');
export const TRASH_NAVY = makeTrashTraitScenario('Navy');
export const TRASH_AKP = makeTrashTraitScenario('Animal Kingdom Pirates');

export const HAND_SUPERNOVAS = makeHandTraitScenario('Supernovas');
export const HAND_STRAW_HAT = makeHandTraitScenario('Straw Hat Crew');
export const HAND_LAND_OF_WANO = makeHandTraitScenario('Land of Wano');
export const HAND_WHITEBEARD = makeHandTraitScenario('Whitebeard Pirates');
export const HAND_BAROQUE = makeHandTraitScenario('Baroque Works');
export const HAND_DONQUIXOTE = makeHandTraitScenario('Donquixote Pirates');
export const HAND_IMPEL_DOWN = makeHandTraitScenario('Impel Down');
export const HAND_GERMA = makeHandTraitScenario('GERMA 66');
export const HAND_NAVY = makeHandTraitScenario('Navy');
export const HAND_AKP = makeHandTraitScenario('Animal Kingdom Pirates');

// Dynamic name-match variants — populate hand or trash with chars whose
// names match `nameIs` filter literals referenced anywhere in the card's
// clauses. Applicable only when the spec literally names something.
function clauseUsesNameIs(card: Card): boolean {
  return extractFilterNameIs(card).length > 0;
}

function namedCharsByList(names: ReadonlyArray<string>): ReadonlyArray<Card> {
  return names.map((nm) => {
    const idSafe = `NMC_${nm.replace(/[^A-Za-z0-9_]/g, '_')}`;
    return ({
      id: idSafe, name: nm, kind: 'character', cost: 2, power: 3000,
      counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '',
    } as unknown) as Card;
  });
}

export const NAME_MATCH_HAND: Scenario = {
  name: 'NAME_MATCH_HAND (dynamic)',
  appliesTo: clauseUsesNameIs,
  build: (card) => build(card, {
    handCards: namedCharsByList(extractFilterNameIs(card)),
  }),
};

export const NAME_MATCH_TRASH: Scenario = {
  name: 'NAME_MATCH_TRASH (dynamic)',
  appliesTo: clauseUsesNameIs,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    trashCharsOwn: namedCharsByList(extractFilterNameIs(card)),
  }),
};

// COMPOUND variants — TRAIT + (trash | hand | DON | own-field) so cards
// with COMBO conditions (leader-trait gate + filtered hand/trash pick)
// can clear all gates in one scenario.

function makeCompoundTraitTrash(trait: string): Scenario {
  const leader = TRAIT_TO_LEADER[trait as keyof typeof TRAIT_TO_LEADER];
  return {
    name: `COMPOUND:TRAIT+TRASH:${trait}`,
    appliesTo: (card) => clauseUsesLeaderGate(card) && clauseUsesPlayFromTrash(card),
    build: (card) => build(card, {
      leader,
      handCards: HAND_PALETTE.slice(0, 3),
      trashCharsOwn: trashPackByTrait(trait),
    }),
  };
}

function makeCompoundTraitHand(trait: string): Scenario {
  const leader = TRAIT_TO_LEADER[trait as keyof typeof TRAIT_TO_LEADER];
  return {
    name: `COMPOUND:TRAIT+HAND:${trait}`,
    appliesTo: (card) => clauseUsesLeaderGate(card) && (clauseUsesHandFromCost(card) || clauseUsesPlayFromHand(card)),
    build: (card) => build(card, {
      leader,
      handCards: handPackByTrait(trait),
    }),
  };
}

function makeCompoundTraitDon(trait: string): Scenario {
  const leader = TRAIT_TO_LEADER[trait as keyof typeof TRAIT_TO_LEADER];
  return {
    name: `COMPOUND:TRAIT+DON:${trait}`,
    appliesTo: (card) => clauseUsesLeaderGate(card) && clauseUsesDonGate(card),
    build: (card) => build(card, {
      leader,
      handCards: HAND_PALETTE.slice(0, 3),
      donInCostAreaOwn: 10,
      attachAttachedDonToSource: 2,
    }),
  };
}

function makeCompoundTraitOwnField(trait: string): Scenario {
  const leader = TRAIT_TO_LEADER[trait as keyof typeof TRAIT_TO_LEADER];
  return {
    name: `COMPOUND:TRAIT+OWN_FIELD:${trait}`,
    appliesTo: (card) => clauseUsesLeaderGate(card) && (clauseUsesOwnFieldCount(card) || clauseUsesOwnFieldTrait(card)),
    build: (card) => build(card, {
      leader,
      handCards: HAND_PALETTE.slice(0, 3),
      fieldCharsOwn: [
        charWithTraitsAndPower(`CF_${trait}_1`, [trait], 2, 3000),
        charWithTraitsAndPower(`CF_${trait}_2`, [trait], 3, 4000),
        charWithTraitsAndPower(`CF_${trait}_3`, [trait], 4, 5000),
      ],
    }),
  };
}

// Generate compound variants for the major archetypes most-represented
// in the corpus. Keep deterministic; sorted by trait name within each
// kind.
export const COMPOUND_TRAIT_TRASH_STRAW = makeCompoundTraitTrash('Straw Hat Crew');
export const COMPOUND_TRAIT_TRASH_WANO = makeCompoundTraitTrash('Land of Wano');
export const COMPOUND_TRAIT_TRASH_SUPERNOVAS = makeCompoundTraitTrash('Supernovas');
export const COMPOUND_TRAIT_TRASH_BAROQUE = makeCompoundTraitTrash('Baroque Works');
export const COMPOUND_TRAIT_TRASH_IMPEL = makeCompoundTraitTrash('Impel Down');
export const COMPOUND_TRAIT_TRASH_GERMA = makeCompoundTraitTrash('GERMA 66');
export const COMPOUND_TRAIT_TRASH_NAVY = makeCompoundTraitTrash('Navy');
export const COMPOUND_TRAIT_TRASH_AKP = makeCompoundTraitTrash('Animal Kingdom Pirates');

export const COMPOUND_TRAIT_HAND_STRAW = makeCompoundTraitHand('Straw Hat Crew');
export const COMPOUND_TRAIT_HAND_WANO = makeCompoundTraitHand('Land of Wano');
export const COMPOUND_TRAIT_HAND_SUPERNOVAS = makeCompoundTraitHand('Supernovas');
export const COMPOUND_TRAIT_HAND_BAROQUE = makeCompoundTraitHand('Baroque Works');
export const COMPOUND_TRAIT_HAND_IMPEL = makeCompoundTraitHand('Impel Down');
export const COMPOUND_TRAIT_HAND_GERMA = makeCompoundTraitHand('GERMA 66');
export const COMPOUND_TRAIT_HAND_NAVY = makeCompoundTraitHand('Navy');
export const COMPOUND_TRAIT_HAND_AKP = makeCompoundTraitHand('Animal Kingdom Pirates');

export const COMPOUND_TRAIT_DON_STRAW = makeCompoundTraitDon('Straw Hat Crew');
export const COMPOUND_TRAIT_DON_WANO = makeCompoundTraitDon('Land of Wano');
export const COMPOUND_TRAIT_DON_SUPERNOVAS = makeCompoundTraitDon('Supernovas');
export const COMPOUND_TRAIT_DON_BAROQUE = makeCompoundTraitDon('Baroque Works');

export const COMPOUND_TRAIT_OF_STRAW = makeCompoundTraitOwnField('Straw Hat Crew');
export const COMPOUND_TRAIT_OF_WANO = makeCompoundTraitOwnField('Land of Wano');
export const COMPOUND_TRAIT_OF_SUPERNOVAS = makeCompoundTraitOwnField('Supernovas');
export const COMPOUND_TRAIT_OF_BAROQUE = makeCompoundTraitOwnField('Baroque Works');

// ────────────────────────────────────────────────────────────────────
// Category B — opponent-state scenarios.
// ────────────────────────────────────────────────────────────────────

export const OPP_HAND_LOW: Scenario = {
  name: 'OPP_HAND_LOW (size 0)',
  appliesTo: clauseUsesOppHand,
  build: (card) => build(card, { handCards: HAND_PALETTE.slice(0, 3), oppHandSize: 0 }),
};

export const OPP_HAND_HIGH: Scenario = {
  name: 'OPP_HAND_HIGH (size 8)',
  appliesTo: clauseUsesOppHand,
  build: (card) => build(card, { handCards: HAND_PALETTE.slice(0, 3), oppHandSize: 8 }),
};

export const OPP_LIFE_LOW: Scenario = {
  name: 'OPP_LIFE_LOW (1)',
  appliesTo: clauseUsesOppLife,
  build: (card) => build(card, { handCards: HAND_PALETTE.slice(0, 3), lifeOpp: 1 }),
};

export const OPP_LIFE_HIGH: Scenario = {
  name: 'OPP_LIFE_HIGH (5)',
  appliesTo: clauseUsesOppLife,
  build: (card) => build(card, { handCards: HAND_PALETTE.slice(0, 3), lifeOpp: 5 }),
};

export const OPP_DON_LOW: Scenario = {
  name: 'OPP_DON_LOW (0)',
  appliesTo: clauseUsesOppDon,
  build: (card) => build(card, { handCards: HAND_PALETTE.slice(0, 3), donInCostAreaOpp: 0, donInCostAreaOwn: 4 }),
};

export const OPP_DON_HIGH: Scenario = {
  name: 'OPP_DON_HIGH (10)',
  appliesTo: clauseUsesOppDon,
  build: (card) => build(card, { handCards: HAND_PALETTE.slice(0, 3), donInCostAreaOpp: 10, donInCostAreaOwn: 4 }),
};

export const OPP_CHARS_PRESENT: Scenario = {
  name: 'OPP_CHARS_PRESENT (3 chars)',
  appliesTo: clauseUsesOppChars,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOpp: [
      charWithTraitsAndPower('OPP_3_1', [], 2, 3000),
      charWithTraitsAndPower('OPP_3_2', [], 3, 4000),
      charWithTraitsAndPower('OPP_3_3', [], 4, 5000),
    ],
  }),
};

export const OPP_CHARS_LOW_COST: Scenario = {
  name: 'OPP_CHARS_LOW_COST (3 cost-1 chars)',
  appliesTo: clauseUsesOppChars,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOpp: [
      charWithTraitsAndPower('OPP_LC_1', [], 1, 2000),
      charWithTraitsAndPower('OPP_LC_2', [], 1, 2000),
      charWithTraitsAndPower('OPP_LC_3', [], 2, 3000),
    ],
  }),
};

export const OPP_CHARS_HIGH_COST: Scenario = {
  name: 'OPP_CHARS_HIGH_COST (3 cost-6+ chars)',
  appliesTo: clauseUsesOppChars,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOpp: [
      charWithTraitsAndPower('OPP_HC_1', [], 6, 7000),
      charWithTraitsAndPower('OPP_HC_2', [], 7, 8000),
      charWithTraitsAndPower('OPP_HC_3', [], 8, 9000),
    ],
  }),
};

export const OPP_CHARS_LOW_POWER: Scenario = {
  name: 'OPP_CHARS_LOW_POWER (3 power-1000 chars)',
  appliesTo: clauseUsesOppChars,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOpp: [
      charWithTraitsAndPower('OPP_LP_1', [], 2, 1000),
      charWithTraitsAndPower('OPP_LP_2', [], 2, 1000),
      charWithTraitsAndPower('OPP_LP_3', [], 3, 2000),
    ],
  }),
};

export const OPP_CHARS_HIGH_POWER: Scenario = {
  name: 'OPP_CHARS_HIGH_POWER (3 power-10000 chars)',
  appliesTo: clauseUsesOppChars,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOpp: [
      charWithTraitsAndPower('OPP_HP_1', [], 6, 10000),
      charWithTraitsAndPower('OPP_HP_2', [], 7, 11000),
      charWithTraitsAndPower('OPP_HP_3', [], 8, 12000),
    ],
  }),
};

export const OPP_CHARS_RESTED: Scenario = {
  name: 'OPP_CHARS_RESTED (3 rested chars)',
  appliesTo: clauseUsesOppChars,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOpp: [
      charWithTraitsAndPower('OPP_R_1', [], 2, 3000),
      charWithTraitsAndPower('OPP_R_2', [], 3, 4000),
      charWithTraitsAndPower('OPP_R_3', [], 4, 5000),
    ],
    fieldCharsOppRested: true,
  }),
};

export const OWN_LIFE_LT_OPP: Scenario = {
  name: 'OWN_LIFE_LT_OPP (own=1, opp=5)',
  appliesTo: clauseUsesOppLife,
  build: (card) => build(card, { handCards: HAND_PALETTE.slice(0, 3), lifeOwn: 1, lifeOpp: 5 }),
};

export const OWN_BOARD_LT_OPP: Scenario = {
  name: 'OWN_BOARD_LT_OPP (own=0 extra, opp=3)',
  appliesTo: clauseUsesOppChars,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOpp: [
      charWithTraitsAndPower('OPP_BD_1', [], 3, 4000),
      charWithTraitsAndPower('OPP_BD_2', [], 4, 5000),
      charWithTraitsAndPower('OPP_BD_3', [], 5, 6000),
    ],
  }),
};

// Attacker-attribute variants — when the source is the defender during
// an opp attack, conditions like if_attacker_has_attribute can fire.
// We can't synthesize a pending attack via dispatch, but we surface the
// scenario for completeness; the harness will report PARTIAL if engine
// can't reach the condition path.
export const ATTACKER_ATTRIBUTE_SLASH: Scenario = {
  name: 'ATTACKER_ATTRIBUTE_SLASH',
  appliesTo: clauseUsesAttackerAttribute,
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOpp: [charWithTraitsAndPower('OPP_ATKR_SL', [], 3, 4000)],
  }),
};

// ────────────────────────────────────────────────────────────────────
// Category A compound MEGA scenarios — combine multiple dimensions
// (leader trait + own field + DON + attached + source state) in one
// shot. Each MEGA scenario is applicable when the card's clauses
// reference ANY of the bundled dimensions (so we widen reachability
// without per-card targeting).
// ────────────────────────────────────────────────────────────────────

function clauseUsesAnyOwnSide(card: Card): boolean {
  return (
    clauseUsesLeaderGate(card) ||
    clauseUsesOwnFieldCount(card) ||
    clauseUsesOwnFieldTrait(card) ||
    clauseUsesAttachedDon(card) ||
    clauseUsesDonGate(card) ||
    clauseUsesSourceRest(card) ||
    clauseUsesSourceActive(card) ||
    clauseUsesPlayedThisTurn(card) ||
    clauseUsesNameMatch(card)
  );
}

// MEGA archetype: leader+field+DON+attached+hand in one scenario per
// major archetype. Wide applicability — runs on any card touching
// own-side state. Generic, deterministic, no per-card logic.
function makeMegaArchetype(trait: string): Scenario {
  const leader = TRAIT_TO_LEADER[trait as keyof typeof TRAIT_TO_LEADER];
  return {
    name: `MEGA:${trait}`,
    appliesTo: clauseUsesAnyOwnSide,
    build: (card) => build(card, {
      leader,
      handCards: handPackByTrait(trait),
      fieldCharsOwn: [
        charWithTraitsAndPower(`MEGA_${trait}_1`, [trait], 2, 3000),
        charWithTraitsAndPower(`MEGA_${trait}_2`, [trait], 4, 5000),
        charWithTraitsAndPower(`MEGA_${trait}_3`, [trait], 6, 7000),
      ],
      trashCharsOwn: trashPackByTrait(trait),
      donInCostAreaOwn: 10,
      attachAttachedDonToSource: 2,
    }),
  };
}

export const MEGA_STRAW_HAT = makeMegaArchetype('Straw Hat Crew');
export const MEGA_LAND_OF_WANO = makeMegaArchetype('Land of Wano');
export const MEGA_SUPERNOVAS = makeMegaArchetype('Supernovas');
export const MEGA_BAROQUE = makeMegaArchetype('Baroque Works');
export const MEGA_WHITEBEARD = makeMegaArchetype('Whitebeard Pirates');
export const MEGA_DONQUIXOTE = makeMegaArchetype('Donquixote Pirates');
export const MEGA_IMPEL_DOWN = makeMegaArchetype('Impel Down');
export const MEGA_GERMA = makeMegaArchetype('GERMA 66');

// Source-state compound scenarios — leader-vanilla, used when card
// references source-state without an archetype gate.
export const COMPOUND_OF_PLUS_PLAYED: Scenario = {
  name: 'COMPOUND:OwnField+PlayedThisTurn',
  appliesTo: (card) => clauseUsesOwnFieldCount(card) && clauseUsesPlayedThisTurn(card),
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOwn: [
      charWithTraitsAndPower('CF_PT_1', [], 2, 3000),
      charWithTraitsAndPower('CF_PT_2', [], 3, 4000),
      charWithTraitsAndPower('CF_PT_3', [], 4, 5000),
    ],
    sourceSummoningSick: true,
  }),
};

export const COMPOUND_OF_PLUS_REST_PLUS_ATTACHED: Scenario = {
  name: 'COMPOUND:OwnField+SourceRested+Attached',
  appliesTo: (card) => clauseUsesOwnFieldCount(card) && (clauseUsesSourceRest(card) || clauseUsesAttachedDon(card)),
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOwn: [
      charWithTraitsAndPower('CF_RA_1', [], 2, 3000),
      charWithTraitsAndPower('CF_RA_2', [], 3, 4000),
    ],
    sourceRested: true,
    attachAttachedDonToSource: 2,
  }),
};

export const COMPOUND_OF_PLUS_DON_HIGH: Scenario = {
  name: 'COMPOUND:OwnField+DON_HIGH',
  appliesTo: (card) => clauseUsesOwnFieldCount(card) && clauseUsesDonGate(card),
  build: (card) => build(card, {
    handCards: HAND_PALETTE.slice(0, 3),
    fieldCharsOwn: [
      charWithTraitsAndPower('CF_DH_1', [], 2, 3000),
      charWithTraitsAndPower('CF_DH_2', [], 3, 4000),
      charWithTraitsAndPower('CF_DH_3', [], 4, 5000),
    ],
    donInCostAreaOwn: 10,
    attachAttachedDonToSource: 3,
  }),
};

// Leader+attached+source-rested compound — for cards like activate-main
// effects with cost rest-self AND leader-trait condition.
function makeTraitPlusSourceRested(trait: string): Scenario {
  const leader = TRAIT_TO_LEADER[trait as keyof typeof TRAIT_TO_LEADER];
  return {
    name: `COMPOUND:TRAIT+SourceRested:${trait}`,
    appliesTo: (card) => clauseUsesLeaderGate(card) && clauseUsesSourceRest(card),
    build: (card) => build(card, {
      leader,
      handCards: HAND_PALETTE.slice(0, 3),
      sourceRested: true,
    }),
  };
}

export const COMPOUND_TRAIT_REST_STRAW = makeTraitPlusSourceRested('Straw Hat Crew');
export const COMPOUND_TRAIT_REST_WANO = makeTraitPlusSourceRested('Land of Wano');
export const COMPOUND_TRAIT_REST_BAROQUE = makeTraitPlusSourceRested('Baroque Works');
export const COMPOUND_TRAIT_REST_IMPEL = makeTraitPlusSourceRested('Impel Down');

// Leader+played-this-turn for source-just-played effects with leader gate.
function makeTraitPlusPlayed(trait: string): Scenario {
  const leader = TRAIT_TO_LEADER[trait as keyof typeof TRAIT_TO_LEADER];
  return {
    name: `COMPOUND:TRAIT+Played:${trait}`,
    appliesTo: (card) => clauseUsesLeaderGate(card) && clauseUsesPlayedThisTurn(card),
    build: (card) => build(card, {
      leader,
      handCards: HAND_PALETTE.slice(0, 3),
      sourceSummoningSick: true,
    }),
  };
}

export const COMPOUND_TRAIT_PLAYED_STRAW = makeTraitPlusPlayed('Straw Hat Crew');
export const COMPOUND_TRAIT_PLAYED_WANO = makeTraitPlusPlayed('Land of Wano');
export const COMPOUND_TRAIT_PLAYED_BAROQUE = makeTraitPlusPlayed('Baroque Works');
export const COMPOUND_TRAIT_PLAYED_IMPEL = makeTraitPlusPlayed('Impel Down');

// Deterministic fixed order. The harness MUST iterate this array.
export const SCENARIOS: ReadonlyArray<Scenario> = [
  BASELINE,
  TRAIT_MATCH_STRAW_HAT,
  TRAIT_MATCH_LAND_OF_WANO,
  TRAIT_MATCH_SUPERNOVAS,
  TRAIT_MATCH_BAROQUE_WORKS,
  TRAIT_MATCH_WHITEBEARD,
  TRAIT_MATCH_DONQUIXOTE,
  TRAIT_MATCH_IMPEL_DOWN,
  TRAIT_MATCH_DRESSROSA,
  DON_THRESHOLD_0,
  DON_THRESHOLD_5,
  DON_THRESHOLD_10,
  ATTACK_PHASE,
  DEFENSE_PHASE,
  ON_KO,
  END_OF_TURN,
  HAND_VARIANTS,
  // Category A scenarios (appended; existing order preserved)
  OWN_FIELD_LOW,
  OWN_FIELD_HIGH,
  OWN_FIELD_RESTED,
  SOURCE_RESTED,
  SOURCE_ACTIVE,
  SOURCE_PLAYED_THIS_TURN,
  ATTACHED_DON_SOURCE_2,
  ATTACHED_DON_SOURCE_4,
  ATTACHED_DON_NON_SOURCE,
  OWN_FIELD_TRAIT_STRAW_HAT,
  OWN_FIELD_TRAIT_LAND_OF_WANO,
  OWN_FIELD_TRAIT_SUPERNOVAS,
  OWN_FIELD_TRAIT_BAROQUE,
  OWN_FIELD_TRAIT_WHITEBEARD,
  OWN_FIELD_TRAIT_DONQUIXOTE,
  OWN_FIELD_TRAIT_IMPEL_DOWN,
  OWN_FIELD_TRAIT_DRESSROSA,
  NAME_MATCH,
  // Category C scenarios (appended; existing order preserved)
  TRASH_SUPERNOVAS, TRASH_STRAW_HAT, TRASH_LAND_OF_WANO, TRASH_WHITEBEARD,
  TRASH_BAROQUE, TRASH_DONQUIXOTE, TRASH_IMPEL_DOWN, TRASH_GERMA, TRASH_NAVY, TRASH_AKP,
  HAND_SUPERNOVAS, HAND_STRAW_HAT, HAND_LAND_OF_WANO, HAND_WHITEBEARD,
  HAND_BAROQUE, HAND_DONQUIXOTE, HAND_IMPEL_DOWN, HAND_GERMA, HAND_NAVY, HAND_AKP,
  NAME_MATCH_HAND, NAME_MATCH_TRASH,
  COMPOUND_TRAIT_TRASH_STRAW, COMPOUND_TRAIT_TRASH_WANO, COMPOUND_TRAIT_TRASH_SUPERNOVAS,
  COMPOUND_TRAIT_TRASH_BAROQUE, COMPOUND_TRAIT_TRASH_IMPEL, COMPOUND_TRAIT_TRASH_GERMA,
  COMPOUND_TRAIT_TRASH_NAVY, COMPOUND_TRAIT_TRASH_AKP,
  COMPOUND_TRAIT_HAND_STRAW, COMPOUND_TRAIT_HAND_WANO, COMPOUND_TRAIT_HAND_SUPERNOVAS,
  COMPOUND_TRAIT_HAND_BAROQUE, COMPOUND_TRAIT_HAND_IMPEL, COMPOUND_TRAIT_HAND_GERMA,
  COMPOUND_TRAIT_HAND_NAVY, COMPOUND_TRAIT_HAND_AKP,
  COMPOUND_TRAIT_DON_STRAW, COMPOUND_TRAIT_DON_WANO, COMPOUND_TRAIT_DON_SUPERNOVAS,
  COMPOUND_TRAIT_DON_BAROQUE,
  COMPOUND_TRAIT_OF_STRAW, COMPOUND_TRAIT_OF_WANO, COMPOUND_TRAIT_OF_SUPERNOVAS,
  COMPOUND_TRAIT_OF_BAROQUE,
  // Category B scenarios (appended; existing order preserved)
  OPP_HAND_LOW, OPP_HAND_HIGH,
  OPP_LIFE_LOW, OPP_LIFE_HIGH, OWN_LIFE_LT_OPP,
  OPP_DON_LOW, OPP_DON_HIGH,
  OPP_CHARS_PRESENT, OPP_CHARS_LOW_COST, OPP_CHARS_HIGH_COST,
  OPP_CHARS_LOW_POWER, OPP_CHARS_HIGH_POWER, OPP_CHARS_RESTED,
  OWN_BOARD_LT_OPP, ATTACKER_ATTRIBUTE_SLASH,
  // Category A MEGA + COMPOUND scenarios (appended; existing order preserved)
  MEGA_STRAW_HAT, MEGA_LAND_OF_WANO, MEGA_SUPERNOVAS, MEGA_BAROQUE,
  MEGA_WHITEBEARD, MEGA_DONQUIXOTE, MEGA_IMPEL_DOWN, MEGA_GERMA,
  COMPOUND_OF_PLUS_PLAYED, COMPOUND_OF_PLUS_REST_PLUS_ATTACHED, COMPOUND_OF_PLUS_DON_HIGH,
  COMPOUND_TRAIT_REST_STRAW, COMPOUND_TRAIT_REST_WANO, COMPOUND_TRAIT_REST_BAROQUE, COMPOUND_TRAIT_REST_IMPEL,
  COMPOUND_TRAIT_PLAYED_STRAW, COMPOUND_TRAIT_PLAYED_WANO, COMPOUND_TRAIT_PLAYED_BAROQUE, COMPOUND_TRAIT_PLAYED_IMPEL,
];

// Convenience: return the subset of scenarios applicable to a card.
// Always includes BASELINE so we have at least one scenario.
export function applicableScenarios(card: Card): ReadonlyArray<Scenario> {
  return SCENARIOS.filter((s) => s.appliesTo(card));
}
