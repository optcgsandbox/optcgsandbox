/**
 * Engine V2 — second batch of atomic condition handlers (field state +
 * misc). Adds the ~20 conditions not covered by conditions.ts.
 *
 * Cross-references:
 * - Implementation spec §3.2
 * - Plan v1 §3.2 + C31 / C32
 */

import type { Card } from '../../cards/Card.js';
import { effectivePower } from '../../state/derived/power.js';
import type { EffectConditionV2 } from '../../spec/types.js';
import {
  type CardInstance,
  type GameState,
  type PlayerId,
} from '../../state/types.js';
import {
  type ConditionHandler,
  conditionHandlers,
  type HandlerCtx,
} from '../types.js';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

function num(c: EffectConditionV2, key: string): number {
  const v = c[key];
  return typeof v === 'number' ? v : 0;
}
function str(c: EffectConditionV2, key: string): string {
  const v = c[key];
  return typeof v === 'string' ? v : '';
}

function cardOf(state: GameState, inst: CardInstance): Card | undefined {
  return state.cardLibrary[inst.cardId] as Card | undefined;
}

function charCost(card: Card | undefined): number {
  if (card === undefined) return 0;
  if (card.kind === 'character' || card.kind === 'event' || card.kind === 'stage') {
    return card.cost;
  }
  return 0;
}

// ─── if_own_chars_lt_opp_chars{,_delta}
const ifOwnCharsLtOppChars: ConditionHandler = (s, ctx, c) => {
  const me = s.players[ctx.controller].field.length;
  const opp = s.players[OTHER[ctx.controller]].field.length;
  const delta = num(c, 'delta');
  return me + delta < opp;
};

// ─── if_own_chars_min_cost { n, minCost }: at least n own chars with cost >= minCost
const ifOwnCharsMinCost: ConditionHandler = (s, ctx, c) => {
  const n = num(c, 'n');
  const minCost = num(c, 'minCost');
  const hits = s.players[ctx.controller].field.filter((i) => charCost(cardOf(s, i)) >= minCost).length;
  return hits >= n;
};

// ─── if_opp_chars_min_cost { n, minCost }
const ifOppCharsMinCost: ConditionHandler = (s, ctx, c) => {
  const n = num(c, 'n');
  const minCost = num(c, 'minCost');
  const hits = s.players[OTHER[ctx.controller]].field.filter((i) => charCost(cardOf(s, i)) >= minCost).length;
  return hits >= n;
};

// ─── if_opp_chars_max_cost { n, maxCost }: at least n opp chars with cost <= maxCost
const ifOppCharsMaxCost: ConditionHandler = (s, ctx, c) => {
  const n = num(c, 'n');
  const maxCost = num(c, 'maxCost');
  const hits = s.players[OTHER[ctx.controller]].field.filter((i) => charCost(cardOf(s, i)) <= maxCost).length;
  return hits >= n;
};

// ─── if_attached_don_min { n }: source has >= n attached DON (active + rested)
const ifAttachedDonMin: ConditionHandler = (s, ctx, c) => {
  const n = num(c, 'n');
  const inst = s.instances[ctx.sourceInstanceId];
  if (inst === undefined) return false;
  return inst.attachedDon.length + inst.attachedDonRested.length >= n;
};

// ─── if_don_returned_count_min { n }: pendingDonReturned >= n
const ifDonReturnedCountMin: ConditionHandler = (s, ctx, c) => {
  const n = num(c, 'n');
  return (s.pendingDonReturned[ctx.controller] ?? 0) >= n;
};

// ─── if_only_chars_with_trait { trait }: all own chars have the trait
const ifOnlyCharsWithTrait: ConditionHandler = (s, ctx, c) => {
  const trait = str(c, 'trait');
  if (trait === '') return false;
  const field = s.players[ctx.controller].field;
  if (field.length === 0) return false;
  return field.every((i) => cardOf(s, i)?.traits.includes(trait) === true);
};

// ─── if_own_chars_max_with_min_power { n, minPower }: at most n own chars with power >= minPower
const ifOwnCharsMaxWithMinPower: ConditionHandler = (s, ctx, c) => {
  const n = num(c, 'n');
  const minPower = num(c, 'minPower');
  const hits = s.players[ctx.controller].field.filter((i) => effectivePower(s, i) >= minPower).length;
  return hits <= n;
};

// ─── if_opp_chars_min_power { n, minPower }
const ifOppCharsMinPower: ConditionHandler = (s, ctx, c) => {
  const n = num(c, 'n');
  const minPower = num(c, 'minPower');
  const hits = s.players[OTHER[ctx.controller]].field.filter((i) => effectivePower(s, i) >= minPower).length;
  return hits >= n;
};

// ─── if_own_chars_min_power { n, minPower }
const ifOwnCharsMinPower: ConditionHandler = (s, ctx, c) => {
  const n = num(c, 'n');
  const minPower = num(c, 'minPower');
  const hits = s.players[ctx.controller].field.filter((i) => effectivePower(s, i) >= minPower).length;
  return hits >= n;
};

// ─── if_own_chars_min_with_trait { n, trait }
const ifOwnCharsMinWithTrait: ConditionHandler = (s, ctx, c) => {
  const n = num(c, 'n');
  const trait = str(c, 'trait');
  if (trait === '') return false;
  const hits = s.players[ctx.controller].field.filter((i) => cardOf(s, i)?.traits.includes(trait) === true).length;
  return hits >= n;
};

// ─── if_owned_other_with_name { name }: at least one OTHER (non-self) own
//     char with given card name
const ifOwnedOtherWithName: ConditionHandler = (s, ctx, c) => {
  const name = str(c, 'name');
  if (name === '') return false;
  for (const inst of s.players[ctx.controller].field) {
    if (inst.instanceId === ctx.sourceInstanceId) continue;
    if (cardOf(s, inst)?.name === name) return true;
  }
  return false;
};

// ─── if_no_other_with_name { name }: NO other own chars with given name
const ifNoOtherWithName: ConditionHandler = (s, ctx, c) => {
  const name = str(c, 'name');
  if (name === '') return true;
  for (const inst of s.players[ctx.controller].field) {
    if (inst.instanceId === ctx.sourceInstanceId) continue;
    if (cardOf(s, inst)?.name === name) return false;
  }
  return true;
};

// ─── if_played_this_turn: source's perTurn.hasAttacked stand-in. Most cards
//     mean "was placed on field this turn" — encoded as summoningSick OR
//     hasAttacked=false (i.e., not been around for a refresh).
const ifPlayedThisTurn: ConditionHandler = (s, ctx) => {
  const inst = s.instances[ctx.sourceInstanceId];
  if (inst === undefined) return false;
  return inst.summoningSick === true;
};

// ─── if_field_total_cost_min { n }: sum of own field cards' costs >= n
const ifFieldTotalCostMin: ConditionHandler = (s, ctx, c) => {
  const n = num(c, 'n');
  let total = 0;
  for (const inst of s.players[ctx.controller].field) {
    total += charCost(cardOf(s, inst));
  }
  return total >= n;
};

// ─── if_attacker_has_attribute { attribute }: during defense, attacker has attribute
const ifAttackerHasAttribute: ConditionHandler = (s, _ctx, c) => {
  const attribute = str(c, 'attribute');
  if (attribute === '' || s.pending === null || s.pending.kind !== 'attack') return false;
  const attackerInst = s.instances[s.pending.pendingAttack.attackerInstanceId];
  if (attackerInst === undefined) return false;
  const card = cardOf(s, attackerInst);
  return card?.attribute === attribute;
};

// ─── if_self_power_min { n }: source's effective power >= n
const ifSelfPowerMin: ConditionHandler = (s, ctx, c) => {
  const n = num(c, 'n');
  const inst = s.instances[ctx.sourceInstanceId];
  if (inst === undefined) return false;
  return effectivePower(s, inst) >= n;
};

// ─── if_own_leader_active: own leader is not rested
const ifOwnLeaderActive: ConditionHandler = (s, ctx) => {
  return s.players[ctx.controller].leader.rested === false;
};

// ─── if_have_given_don_min { n }: pendingDonReturned[opp] >= n (DON YOU gave
//     to opp via effect this turn)
const ifHaveGivenDonMin: ConditionHandler = (s, ctx, c) => {
  const n = num(c, 'n');
  return (s.pendingDonReturned[OTHER[ctx.controller]] ?? 0) >= n;
};

// ─── if_own_chars_min_filter — flat filter mirroring EffectTargetV2.
//     Supports the shape used across cards.json:
//       trait      — single trait substring (legacy / singular)
//       traitsAny  — array; passes if char.traits includes ANY listed value
//       kind       — exact card.kind match (e.g. 'character')
//       minCost / maxCost — inclusive bounds on charCost
//     Char must satisfy EVERY specified key. Count own field hits;
//     condition passes iff hits >= n.
const ifOwnCharsMinFilter: ConditionHandler = (s, ctx, c) => {
  const n = num(c, 'n');
  const filter = c['filter'];
  if (typeof filter !== 'object' || filter === null) return false;
  const f = filter as {
    trait?: string;
    traitsAny?: ReadonlyArray<string>;
    kind?: string;
    minCost?: number;
    maxCost?: number;
  };
  const hits = s.players[ctx.controller].field.filter((i) => {
    const card = cardOf(s, i);
    if (card === undefined) return false;
    if (f.kind !== undefined && card.kind !== f.kind) return false;
    if (f.trait !== undefined && !card.traits.includes(f.trait)) return false;
    if (f.traitsAny !== undefined && !f.traitsAny.some((t) => card.traits.includes(t))) return false;
    if (f.minCost !== undefined && charCost(card) < f.minCost) return false;
    if (f.maxCost !== undefined && charCost(card) > f.maxCost) return false;
    return true;
  }).length;
  return hits >= n;
};

// suppress unused — Card import retained for type narrowing
export type { Card, HandlerCtx };

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerConditionHandlers2(): void {
  conditionHandlers.register('if_own_chars_lt_opp_chars', ifOwnCharsLtOppChars);
  conditionHandlers.register('if_own_chars_min_cost', ifOwnCharsMinCost);
  conditionHandlers.register('if_opp_chars_min_cost', ifOppCharsMinCost);
  conditionHandlers.register('if_opp_chars_max_cost', ifOppCharsMaxCost);
  conditionHandlers.register('if_attached_don_min', ifAttachedDonMin);
  conditionHandlers.register('if_don_returned_count_min', ifDonReturnedCountMin);
  conditionHandlers.register('if_only_chars_with_trait', ifOnlyCharsWithTrait);
  conditionHandlers.register('if_own_chars_max_with_min_power', ifOwnCharsMaxWithMinPower);
  conditionHandlers.register('if_opp_chars_min_power', ifOppCharsMinPower);
  conditionHandlers.register('if_own_chars_min_power', ifOwnCharsMinPower);
  conditionHandlers.register('if_own_chars_min_with_trait', ifOwnCharsMinWithTrait);
  conditionHandlers.register('if_owned_other_with_name', ifOwnedOtherWithName);
  conditionHandlers.register('if_no_other_with_name', ifNoOtherWithName);
  conditionHandlers.register('if_played_this_turn', ifPlayedThisTurn);
  conditionHandlers.register('if_field_total_cost_min', ifFieldTotalCostMin);
  conditionHandlers.register('if_attacker_has_attribute', ifAttackerHasAttribute);
  conditionHandlers.register('if_self_power_min', ifSelfPowerMin);
  conditionHandlers.register('if_own_leader_active', ifOwnLeaderActive);
  conditionHandlers.register('if_have_given_don_min', ifHaveGivenDonMin);
  conditionHandlers.register('if_own_chars_min_filter', ifOwnCharsMinFilter);
}
