/**
 * Engine V2 — PARTIAL_COVERAGE root-cause classifier.
 *
 * Observation-only pass. Iterates cards.json + the existing SCENARIOS
 * library. For every card whose best multi-scenario outcome is
 * PARTIAL_COVERAGE, classifies the structural reason into one of:
 *
 *   A) missing game-state simulation
 *   B) missing opponent simulation
 *   C) missing deck/hand evolution
 *   D) engine rule gap (handler missing for a referenced primitive)
 *   E) unreachable in minimal deterministic state (engine event-emission trigger)
 *
 * Each PARTIAL card is assigned EXACTLY ONE primary category by a
 * priority cascade (D > E > B > C > A).
 *
 * Pure observation; no engine, handler, dispatcher, card-data, or
 * existing-test changes.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error
import { resolve } from 'node:path';
// @ts-expect-error
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card } from '../cards/Card.js';
import { EffectDispatcher } from '../effects/EffectDispatcher.js';
import {
  actionHandlers,
  conditionHandlers,
  costHandlers,
  targetResolvers,
} from '../registry/types.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';
import type { EffectClauseV2, EffectConditionV2 } from '../spec/types.js';
import type { GameState } from '../state/types.js';

import { applicableScenarios } from '../tests/corpus-scenarios.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

type RootCause = 'A' | 'B' | 'C' | 'D' | 'E';

const ROOT_CAUSE_DESC: Record<RootCause, string> = {
  A: 'missing game-state simulation (own field / attached DON / rest-state / phase / per-turn flags)',
  B: 'missing opponent simulation (opp chars / opp DON / opp life / opp hand)',
  C: 'missing deck/hand evolution (filtered discard, play-by-filter, deck search)',
  D: 'engine rule gap (handler missing for a referenced primitive)',
  E: 'unreachable in minimal deterministic state (engine event-emission trigger)',
};

const TRIGGERS_NEED_ENGINE_EMISSION = new Set([
  'on_battle_ko',
  'on_become_rested',
  'on_damage_taken',
  'on_self_activate_event',
  'on_opp_activate_event',
  'on_attack_deal_damage',
  'on_life_changed',
  'on_life_lost',
  'on_own_don_returned',
  'on_own_char_removed_by_opp_effect',
  'on_opp_play_character',
  'on_block',
  'at_start_of_game',
]);

const CONDITIONS_OPP_SIDE = new Set([
  'if_opp_don_min', 'if_opp_don_max',
  'if_opp_life_max', 'if_opp_life_min',
  'if_opp_hand_max', 'if_opp_hand_min',
  'if_opp_chars_min', 'if_opp_chars_min_rested',
  'if_opp_chars_min_cost', 'if_opp_chars_max_cost',
  'if_opp_chars_min_power',
  'if_own_chars_lt_opp_chars',
  'if_own_life_lt_opp', 'if_own_life_le_opp',
  'if_attacker_has_attribute',
]);

const CONDITIONS_OWN_BOARD = new Set([
  'if_own_chars_min',
  'if_own_chars_min_rested',
  'if_own_chars_min_cost',
  'if_own_chars_min_with_trait',
  'if_own_chars_max_with_min_power',
  'if_own_chars_min_power',
  'if_own_chars_min_filter',
  'if_attached_don_min',
  'if_field_total_cost_min',
  'if_only_chars_with_trait',
  'if_self_active',
  'if_self_rested',
  'if_self_power_min',
  'if_played_this_turn',
  'if_self_kod_by_opp_effect',
  'if_owned_other_with_name',
  'if_no_other_with_name',
  'if_have_given_don_min',
  'if_don_returned_count_min',
  'if_own_rested_don_min',
  'if_own_leader_active',
]);

const COST_KEYS_HAND = new Set([
  'discardHand',
  'discardHandFilter',
  'revealHand',
]);

const COST_KEYS_DECK = new Set([
  'millSelf',
  'trashFromTrash',
]);

const COST_KEYS_LIFE = new Set([
  'lifeToHand',
  'flipLife',
]);

const COST_KEYS_BOARD_OWN = new Set([
  'returnOwnCharFilter',
  'restOwnCharFilter',
  'restLeaderOrStageFilter',
  'restSelf',
  'restSource',
  'restLeader',
  'returnAttachedDon',
  'returnOwnDon',
  'donCost',
]);

const ACTIONS_HAND_OR_DECK_SEARCH = new Set([
  'play_for_free',
  'reveal_top_add',
  'look_pick',
  'search_deck_add',
  'search_deck_play',
  'reveal_search',
  'chained_search_play',
  'play_from_trash',
  'play_from_hand',
  'add_from_trash_to_hand',
  'add_from_deck_to_hand',
]);

function walkCondition(c: EffectConditionV2 | undefined, sink: Set<string>): void {
  if (c === undefined) return;
  if (typeof c.type === 'string') sink.add(c.type);
  const subs = (c as { conditions?: ReadonlyArray<EffectConditionV2> }).conditions;
  if (Array.isArray(subs)) for (const sub of subs) walkCondition(sub, sink);
  const inner = (c as { condition?: EffectConditionV2 }).condition;
  if (inner !== undefined) walkCondition(inner, sink);
}

function walkAction(action: { kind?: unknown; actions?: ReadonlyArray<unknown> } | undefined, sink: Set<string>): void {
  if (action === undefined) return;
  if (typeof action.kind === 'string') sink.add(action.kind);
  if (Array.isArray(action.actions)) {
    for (const sub of action.actions) walkAction(sub as { kind?: unknown; actions?: ReadonlyArray<unknown> }, sink);
  }
}

function collectClauseTriggers(card: Card): Set<string> {
  const out = new Set<string>();
  const clauses = card.effectSpecV2?.clauses;
  if (!Array.isArray(clauses)) return out;
  for (const cl of clauses) out.add(cl.trigger);
  return out;
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
    if (cl.cost === undefined) continue;
    for (const k of Object.keys(cl.cost)) if (k !== 'bind') out.add(k);
  }
  return out;
}
function collectClauseActionKinds(card: Card): Set<string> {
  const out = new Set<string>();
  const clauses = card.effectSpecV2?.clauses;
  if (!Array.isArray(clauses)) return out;
  for (const cl of clauses) walkAction(cl.action as { kind?: unknown; actions?: ReadonlyArray<unknown> } | undefined, out);
  return out;
}
function collectClauseTargetKinds(card: Card): Set<string> {
  const out = new Set<string>();
  const clauses = card.effectSpecV2?.clauses;
  if (!Array.isArray(clauses)) return out;
  for (const cl of clauses) {
    const t = cl.target as { kind?: unknown } | undefined;
    if (t !== undefined && typeof t.kind === 'string') out.add(t.kind);
  }
  return out;
}

type Category = 'FULL_COVERAGE' | 'PARTIAL_COVERAGE' | 'NOT_TRIGGERED' | 'ERROR';

function rank(c: Category): number {
  switch (c) {
    case 'FULL_COVERAGE': return 3;
    case 'PARTIAL_COVERAGE': return 2;
    case 'NOT_TRIGGERED': return 1;
    case 'ERROR': return 0;
  }
}

function bestCategoryUnderScenarios(card: Card): Category {
  const spec = card.effectSpecV2;
  const clauses: ReadonlyArray<EffectClauseV2> = (spec && Array.isArray(spec.clauses)) ? spec.clauses : [];
  if (clauses.length === 0) return 'NOT_TRIGGERED';
  const uniqueTriggers = Array.from(new Set(clauses.map((c) => c.trigger))).sort();
  const scenarios = applicableScenarios(card);
  let best: Category = 'NOT_TRIGGERED';
  for (const scenario of scenarios) {
    for (const trig of uniqueTriggers) {
      const { state, sourceId } = scenario.build(card);
      const historyBefore = state.history.length;
      let after: GameState;
      try {
        after = EffectDispatcher.dispatch(state, { sourceInstanceId: sourceId, controller: 'A' }, trig);
      } catch {
        if (rank('ERROR') > rank(best)) best = 'ERROR';
        continue;
      }
      const newEvents = (after.history as ReadonlyArray<{ type?: string }>).slice(historyBefore);
      const clauseFired = newEvents.some((e) => e?.type === 'CLAUSE_FIRED');
      const out: Category = clauseFired ? 'FULL_COVERAGE' : 'PARTIAL_COVERAGE';
      if (rank(out) > rank(best)) best = out;
      if (best === 'FULL_COVERAGE') return 'FULL_COVERAGE';
    }
  }
  return best;
}

interface RootCauseEvidence {
  readonly cardId: string;
  readonly cause: RootCause;
  readonly indicator: string;
}

function classifyPartial(card: Card): RootCauseEvidence {
  const triggers = collectClauseTriggers(card);
  const conditions = collectClauseConditions(card);
  const costs = collectClauseCostKeys(card);
  const actions = collectClauseActionKinds(card);
  const targets = collectClauseTargetKinds(card);

  // (D) Engine rule gap — any primitive kind referenced that has no handler.
  for (const t of conditions) {
    if (t === 'and' || t === 'or' || t === 'not') continue;
    if (!conditionHandlers.has(t)) {
      return { cardId: card.id, cause: 'D', indicator: `unregistered condition: ${t}` };
    }
  }
  for (const a of actions) {
    if (!actionHandlers.has(a) && a !== 'sequence' && a !== 'choose_one') {
      return { cardId: card.id, cause: 'D', indicator: `unregistered action: ${a}` };
    }
  }
  for (const c of costs) {
    if (!costHandlers.has(c)) {
      return { cardId: card.id, cause: 'D', indicator: `unregistered cost: ${c}` };
    }
  }
  for (const t of targets) {
    if (!targetResolvers.has(t)) {
      return { cardId: card.id, cause: 'D', indicator: `unregistered target: ${t}` };
    }
  }

  // (E) Unreachable trigger — needs engine event emission.
  for (const t of triggers) {
    if (TRIGGERS_NEED_ENGINE_EMISSION.has(t)) {
      return { cardId: card.id, cause: 'E', indicator: `engine-emit-only trigger: ${t}` };
    }
  }

  // (B) Opponent-side condition referenced.
  for (const c of conditions) {
    if (CONDITIONS_OPP_SIDE.has(c)) {
      return { cardId: card.id, cause: 'B', indicator: `opp-side condition: ${c}` };
    }
  }

  // (C) Hand / deck / trash filtered access referenced.
  for (const c of costs) {
    if (COST_KEYS_HAND.has(c) || COST_KEYS_DECK.has(c)) {
      return { cardId: card.id, cause: 'C', indicator: `hand/deck cost: ${c}` };
    }
  }
  for (const a of actions) {
    if (ACTIONS_HAND_OR_DECK_SEARCH.has(a)) {
      return { cardId: card.id, cause: 'C', indicator: `hand/deck-search action: ${a}` };
    }
  }

  // (A) Own-board / DON / phase / per-turn condition referenced.
  for (const c of conditions) {
    if (CONDITIONS_OWN_BOARD.has(c)) {
      return { cardId: card.id, cause: 'A', indicator: `own-board condition: ${c}` };
    }
  }
  for (const c of costs) {
    if (COST_KEYS_BOARD_OWN.has(c) || COST_KEYS_LIFE.has(c)) {
      return { cardId: card.id, cause: 'A', indicator: `own-board cost: ${c}` };
    }
  }

  return { cardId: card.id, cause: 'A', indicator: 'default — own-side state mismatch' };
}

function loadCards(): Card[] {
  const raw = readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf-8');
  return JSON.parse(raw) as Card[];
}

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

// ────────────────────────────────────────────────────────────────────
// Category C sub-classification — for cards stuck in PARTIAL with
// primary cause C, decompose into:
//   - missing hand content (cost discardHand/discardHandFilter)
//   - missing trash content (play_from_trash filtered)
//   - missing exact-name card (filter has literal nameIs)
//   - missing trait card (filter has trait/typeIncludes/traitsAny)
//   - multi-factor gate (more than one of the above OR combined with
//     own-board/DON/leader gates)
// ────────────────────────────────────────────────────────────────────

type CSubCause =
  | 'missing_hand_content'
  | 'missing_trash_content'
  | 'missing_exact_name_card'
  | 'missing_trait_card'
  | 'multi_factor_gate';

function subClassifyC(card: Card): { cause: CSubCause; signals: ReadonlyArray<string> } {
  const conditions = collectClauseConditions(card);
  const costs = collectClauseCostKeys(card);
  const actions = collectClauseActionKinds(card);

  const signals: string[] = [];
  let hand = false;
  let trash = false;
  let nameIs = false;
  let trait = false;

  // Hand-side cost?
  for (const k of costs) {
    if (k === 'discardHand' || k === 'discardHandFilter') {
      hand = true; signals.push(`cost:${k}`);
    }
  }

  // Walk action shapes for play_for_free etc with from/filter information.
  function walkAction(value: unknown): void {
    if (typeof value !== 'object' || value === null) return;
    if (Array.isArray(value)) { for (const x of value) walkAction(x); return; }
    const v = value as Record<string, unknown>;
    if (typeof v['kind'] === 'string' && (v['kind'] === 'play_for_free' || v['kind'] === 'play_from_hand' || v['kind'] === 'play_from_trash' || v['kind'] === 'add_from_trash_to_hand' || v['kind'] === 'add_from_deck_to_hand')) {
      const from = v['from'];
      if (from === 'hand') { hand = true; signals.push(`action:${v['kind']} from=hand`); }
      else if (from === 'trash') { trash = true; signals.push(`action:${v['kind']} from=trash`); }
    }
    const filt = v['filter'];
    if (typeof filt === 'object' && filt !== null) {
      const f = filt as Record<string, unknown>;
      if (typeof f['nameIs'] === 'string') { nameIs = true; signals.push(`filter.nameIs:${String(f['nameIs'])}`); }
      if (typeof f['trait'] === 'string') { trait = true; signals.push(`filter.trait:${String(f['trait'])}`); }
      if (typeof f['typeIncludes'] === 'string') { trait = true; signals.push(`filter.typeIncludes:${String(f['typeIncludes'])}`); }
      if (Array.isArray(f['traitsAny'])) { trait = true; signals.push(`filter.traitsAny:${(f['traitsAny'] as ReadonlyArray<unknown>).filter((x) => typeof x === 'string').join('|')}`); }
    }
    for (const k of Object.keys(v)) walkAction(v[k]);
  }
  for (const cl of card.effectSpecV2?.clauses ?? []) {
    walkAction(cl.action);
    walkAction(cl.cost);
  }

  void conditions; void actions; // silence unused

  const flags = [hand, trash, nameIs, trait].filter(Boolean).length;
  if (flags > 1) return { cause: 'multi_factor_gate', signals };
  if (nameIs) return { cause: 'missing_exact_name_card', signals };
  if (trash) return { cause: 'missing_trash_content', signals };
  if (hand) return { cause: 'missing_hand_content', signals };
  if (trait) return { cause: 'missing_trait_card', signals };
  return { cause: 'multi_factor_gate', signals };
}

describe('PARTIAL_COVERAGE root-cause classifier', () => {
  it('classifies PARTIAL cards into A–E categories with deterministic output', () => {
    const cards = loadCards();
    const partialCards: Card[] = [];
    for (const card of cards) {
      const best = bestCategoryUnderScenarios(card);
      if (best === 'PARTIAL_COVERAGE') partialCards.push(card);
    }

    const classified: RootCauseEvidence[] = partialCards.map(classifyPartial);
    const buckets: Record<RootCause, RootCauseEvidence[]> = { A: [], B: [], C: [], D: [], E: [] };
    for (const ev of classified) buckets[ev.cause].push(ev);

    const totals: Record<RootCause, number> = {
      A: buckets.A.length, B: buckets.B.length, C: buckets.C.length,
      D: buckets.D.length, E: buckets.E.length,
    };
    const totalPartial = partialCards.length;

    /* eslint-disable no-console */
    console.log('\n========== PARTIAL_COVERAGE ROOT-CAUSE REPORT ==========');
    console.log(`Total PARTIAL cards under multi-scenario:  ${totalPartial}`);
    console.log('\n--- Category vocabulary ---');
    for (const k of ['A', 'B', 'C', 'D', 'E'] as RootCause[]) {
      console.log(`  ${k}: ${ROOT_CAUSE_DESC[k]}`);
    }
    console.log('\n--- Counts per category ---');
    for (const k of ['A', 'B', 'C', 'D', 'E'] as RootCause[]) {
      const pct = totalPartial > 0 ? ((totals[k] / totalPartial) * 100).toFixed(1) : '0.0';
      console.log(`  ${k}  ${totals[k].toString().padStart(4)}  (${pct}% of PARTIAL)`);
    }

    console.log('\n--- Estimated PARTIAL → FULL conversion if category were fixed (upper bound) ---');
    const ranked = ([...Object.entries(totals)] as Array<[RootCause, number]>).sort((a, b) => b[1] - a[1]);
    for (const [k, n] of ranked) {
      console.log(`  Fix ${k}: up to +${n} cards would move PARTIAL → FULL`);
    }

    for (const k of ['A', 'B', 'C', 'D', 'E'] as RootCause[]) {
      const list = buckets[k];
      if (list.length === 0) {
        console.log(`\n--- Category ${k}: 0 cards ---`);
        continue;
      }
      console.log(`\n--- Category ${k} top 50 (of ${list.length}) ---`);
      for (const ev of list.slice(0, 50)) {
        console.log(`  ${ev.cardId}  — ${ev.indicator}`);
      }
      if (list.length > 50) console.log(`  …and ${list.length - 50} more`);
    }

    console.log('\n========================================================\n');
    /* eslint-enable no-console */

    expect(totalPartial).toBeGreaterThanOrEqual(0);
  }, 240_000);

  it('sub-classifies remaining Category C cards', () => {
    const cards = loadCards();
    const cCards: Card[] = [];
    for (const card of cards) {
      const best = bestCategoryUnderScenarios(card);
      if (best !== 'PARTIAL_COVERAGE') continue;
      const ev = classifyPartial(card);
      if (ev.cause === 'C') cCards.push(card);
    }

    const subBuckets: Record<CSubCause, Array<{ cardId: string; signals: ReadonlyArray<string> }>> = {
      missing_hand_content: [],
      missing_trash_content: [],
      missing_exact_name_card: [],
      missing_trait_card: [],
      multi_factor_gate: [],
    };

    for (const card of cCards) {
      const sub = subClassifyC(card);
      subBuckets[sub.cause].push({ cardId: card.id, signals: sub.signals });
    }

    /* eslint-disable no-console */
    console.log('\n========== CATEGORY C SUB-CLASSIFICATION ==========');
    console.log(`Total remaining Category C cards: ${cCards.length}`);
    for (const k of ['missing_hand_content', 'missing_trash_content', 'missing_exact_name_card', 'missing_trait_card', 'multi_factor_gate'] as CSubCause[]) {
      console.log(`  ${k}: ${subBuckets[k].length}`);
    }
    for (const k of ['missing_hand_content', 'missing_trash_content', 'missing_exact_name_card', 'missing_trait_card', 'multi_factor_gate'] as CSubCause[]) {
      const list = subBuckets[k];
      if (list.length === 0) continue;
      console.log(`\n--- ${k} (top 30 of ${list.length}) ---`);
      for (const ev of list.slice(0, 30)) {
        console.log(`  ${ev.cardId}  signals=[${ev.signals.slice(0, 3).join(' | ')}]`);
      }
      if (list.length > 30) console.log(`  …and ${list.length - 30} more`);
    }
    console.log('====================================================\n');
    /* eslint-enable no-console */

    expect(cCards.length).toBeGreaterThanOrEqual(0);
  }, 240_000);
});
