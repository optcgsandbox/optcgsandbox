/**
 * Engine V2 — continuous handlers.
 *
 * Continuous effects in cards.json have:
 *   - eff.action: { kind, [filter], [magnitude|delta|basePower|keyword|...] }
 *   - eff.condition (optional) — gate the whole effect
 *   - eff.target (rare — most omit; filter is on eff.action.filter)
 *
 * Scope resolution per `aura_*` vs `self_*`:
 *   - `aura_*` actions apply to OWN field characters matching filter.
 *   - `opp_aura_*` actions apply to OPP field characters matching filter.
 *   - `self_*` and `grant_keyword_to_self` / `restrict_self_attack` /
 *     `self_immune_to_opp_effects` etc. apply ONLY to source.
 *   - `aura_set_base_power_copy_from_leader` is a special: writes leader's
 *     power onto each matching own field char.
 *
 * Field-name notes from cards.json grep:
 *   - aura_power_buff / opp_aura_power_buff: `magnitude` (count helper)
 *   - aura_cost_modifier / cost_modifier_in_hand / opp_aura_cost_modifier: `delta`
 *   - aura_set_base_power / self_set_base_power: `basePower`
 *   - restrict_effect_type: `effectKind`
 *   - aura_immunity: `against`
 *
 * Cross-references:
 * - Implementation spec §3.3 + §8
 * - Plan v1 §4.1
 */

import type { Card, Keyword } from '../../cards/Card.js';
import type { EffectActionV2 } from '../../spec/types.js';
import {
  type CardInstance,
  type GameState,
  type InstanceId,
  type PlayerId,
} from '../../state/types.js';
import {
  type ContinuousHandler,
  continuousHandlers,
} from '../types.js';
import { type CardFilter, matchesCardFilter } from './filter.js';
import { resolveMagnitude } from './formula.js';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

function readNum(a: EffectActionV2, key: string, fallback = 0): number {
  const v = a[key];
  return typeof v === 'number' ? v : fallback;
}
function readStr(a: EffectActionV2, key: string): string {
  const v = a[key];
  return typeof v === 'string' ? v : '';
}

// Read action.magnitude OR action.n (canonical reader for aura_power_buff etc.).
// Cluster C fix: when caller supplies state + source, formula objects on
// `magnitude` are evaluated via the shared resolveMagnitude path. Without
// state/source, behavior is unchanged (formula → 0 fallback) so existing
// callers that pass only the action retain their current semantics.
function readMagnitude(
  a: EffectActionV2,
  state?: GameState,
  source?: CardInstance,
): number {
  const m = a['magnitude'];
  if (typeof m === 'number') return m;
  if (
    state !== undefined &&
    source !== undefined &&
    m !== null &&
    typeof m === 'object'
  ) {
    return resolveMagnitude(
      state,
      { controller: source.controller, sourceInstanceId: source.instanceId },
      m,
      0,
    );
  }
  const n = a['n'];
  if (typeof n === 'number') return n;
  return 0;
}

// Read action.delta (for cost modifiers — cards.json uses `delta` here).
function readDelta(a: EffectActionV2): number {
  const d = a['delta'];
  if (typeof d === 'number') return d;
  return readMagnitude(a);
}

function actionFilter(a: EffectActionV2): CardFilter | undefined {
  const f = a['filter'];
  return typeof f === 'object' && f !== null ? (f as CardFilter) : undefined;
}

function ownFieldMatching(
  state: GameState,
  source: CardInstance,
  filter: CardFilter | undefined,
): InstanceId[] {
  return state.players[source.controller].field
    .filter((c) => matchesCardFilter(state, c, filter))
    .map((c) => c.instanceId);
}

function oppFieldMatching(
  state: GameState,
  source: CardInstance,
  filter: CardFilter | undefined,
): InstanceId[] {
  return state.players[OTHER[source.controller]].field
    .filter((c) => matchesCardFilter(state, c, filter))
    .map((c) => c.instanceId);
}

// ────────────────────────────────────────────────────────────────────
// give_continuous_power / aura_power_buff / self_power_buff
// ────────────────────────────────────────────────────────────────────
const auraPowerBuff: ContinuousHandler = {
  resets: ['powerModifierContinuous'],
  fold(state, source, eff) {
    const n = readMagnitude(eff.action, state, source);
    const targets = ownFieldMatching(state, source, actionFilter(eff.action));
    for (const id of targets) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.powerModifierContinuous = (inst.powerModifierContinuous ?? 0) + n;
    }
    return state;
  },
};

const oppAuraPowerBuff: ContinuousHandler = {
  resets: ['powerModifierContinuous'],
  fold(state, source, eff) {
    const n = readMagnitude(eff.action, state, source);
    const targets = oppFieldMatching(state, source, actionFilter(eff.action));
    for (const id of targets) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.powerModifierContinuous = (inst.powerModifierContinuous ?? 0) + n;
    }
    return state;
  },
};

const selfPowerBuff: ContinuousHandler = {
  resets: ['powerModifierContinuous'],
  fold(state, source, eff) {
    const n = readMagnitude(eff.action, state, source);
    source.powerModifierContinuous = (source.powerModifierContinuous ?? 0) + n;
    return state;
  },
};

// leader_power_buff: continuous power buff to the SOURCE controller's LEADER
// (e.g. "[Your Turn] if ≤2 Life, your Leader gains +1000"). Generic + card-
// agnostic: magnitude + condition come from the effect metadata, the target
// is always the source's own Leader. The leader instance is in state.instances
// and reset each refold tick (ContinuousManager.ts:58), so the buff is
// idempotent and expires automatically when the condition is false or the
// source leaves play.
const leaderPowerBuff: ContinuousHandler = {
  resets: ['powerModifierContinuous'],
  fold(state, source, eff) {
    const n = readMagnitude(eff.action, state, source);
    const leader = state.players[source.controller].leader;
    leader.powerModifierContinuous = (leader.powerModifierContinuous ?? 0) + n;
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// give_continuous_cost_modifier / aura_cost_modifier / cost_modifier_in_hand
// / opp_aura_cost_modifier / self_cost_buff — use `delta`
// ────────────────────────────────────────────────────────────────────
const auraCostModifier: ContinuousHandler = {
  resets: ['costModifierContinuous'],
  fold(state, source, eff) {
    const d = readDelta(eff.action);
    const targets = ownFieldMatching(state, source, actionFilter(eff.action));
    for (const id of targets) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.costModifierContinuous = (inst.costModifierContinuous ?? 0) + d;
    }
    return state;
  },
};

const oppAuraCostModifier: ContinuousHandler = {
  resets: ['costModifierContinuous'],
  fold(state, source, eff) {
    const d = readDelta(eff.action);
    const targets = oppFieldMatching(state, source, actionFilter(eff.action));
    for (const id of targets) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.costModifierContinuous = (inst.costModifierContinuous ?? 0) + d;
    }
    return state;
  },
};

// cost_modifier_in_hand: applies cost delta to source while in hand. Engine
// stores cost mods on the instance regardless of zone — works for hand too.
const costModifierInHand: ContinuousHandler = {
  resets: ['costModifierContinuous'],
  fold(state, source, eff) {
    const d = readDelta(eff.action);
    source.costModifierContinuous = (source.costModifierContinuous ?? 0) + d;
    return state;
  },
};

const selfCostBuff: ContinuousHandler = costModifierInHand;

// ────────────────────────────────────────────────────────────────────
// give_continuous_keyword / aura_grant_keyword / grant_keyword_to_self
// ────────────────────────────────────────────────────────────────────
const auraGrantKeyword: ContinuousHandler = {
  resets: ['grantedKeywordsContinuous'],
  fold(state, source, eff) {
    const keyword = readStr(eff.action, 'keyword');
    if (keyword === '') return state;
    const targets = ownFieldMatching(state, source, actionFilter(eff.action));
    for (const id of targets) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      const cur = inst.grantedKeywordsContinuous ?? [];
      if (!cur.includes(keyword as Keyword)) {
        inst.grantedKeywordsContinuous = [...cur, keyword as Keyword];
      }
    }
    return state;
  },
};

const grantKeywordToSelf: ContinuousHandler = {
  resets: ['grantedKeywordsContinuous'],
  fold(state, source, eff) {
    const keyword = readStr(eff.action, 'keyword');
    if (keyword === '') return state;
    const cur = source.grantedKeywordsContinuous ?? [];
    if (!cur.includes(keyword as Keyword)) {
      source.grantedKeywordsContinuous = [...cur, keyword as Keyword];
    }
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// aura_set_base_power / self_set_base_power — use `basePower`
// ────────────────────────────────────────────────────────────────────
const auraSetBasePower: ContinuousHandler = {
  resets: ['basePowerOverrideContinuous'],
  fold(state, source, eff) {
    const n = readNum(eff.action, 'basePower', readMagnitude(eff.action));
    const targets = ownFieldMatching(state, source, actionFilter(eff.action));
    for (const id of targets) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      const cur = inst.basePowerOverrideContinuous;
      inst.basePowerOverrideContinuous = cur === undefined ? n : Math.max(cur, n);
    }
    return state;
  },
};

const selfSetBasePower: ContinuousHandler = {
  resets: ['basePowerOverrideContinuous'],
  fold(state, source, eff) {
    const n = readNum(eff.action, 'basePower', readMagnitude(eff.action));
    const cur = source.basePowerOverrideContinuous;
    source.basePowerOverrideContinuous = cur === undefined ? n : Math.max(cur, n);
    return state;
  },
};

// aura_set_base_power_copy_from_leader: write source-side leader's power
// onto each matching own field char.
const auraSetBasePowerCopyFromLeader: ContinuousHandler = {
  resets: ['basePowerOverrideContinuous'],
  fold(state, source, eff) {
    const pl = state.players[source.controller];
    const leaderCard = state.cardLibrary[pl.leader.cardId] as Card | undefined;
    const leaderPower = leaderCard !== undefined && (leaderCard.kind === 'leader' || leaderCard.kind === 'character')
      ? leaderCard.power
      : 0;
    const targets = ownFieldMatching(state, source, actionFilter(eff.action));
    for (const id of targets) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      const cur = inst.basePowerOverrideContinuous;
      inst.basePowerOverrideContinuous = cur === undefined ? leaderPower : Math.max(cur, leaderPower);
    }
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// give_continuous_immunity / aura_immunity / self_immune_to_opp_effects
// ────────────────────────────────────────────────────────────────────
const auraImmunity: ContinuousHandler = {
  resets: ['immunityContinuous'],
  fold(state, source, eff) {
    const against = readStr(eff.action, 'against');
    const targets = ownFieldMatching(state, source, actionFilter(eff.action));
    for (const id of targets) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.immunityContinuous = { against };
    }
    return state;
  },
};

const selfImmuneToOppEffects: ContinuousHandler = {
  resets: ['immunityContinuous'],
  fold(state, source) {
    source.immunityContinuous = { against: 'opp_effect' };
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// attack_lock_continuous / restrict_self_attack
// ────────────────────────────────────────────────────────────────────
const attackLockContinuous: ContinuousHandler = {
  resets: ['attackLockedContinuous'],
  fold(state, source, eff) {
    const targets = ownFieldMatching(state, source, actionFilter(eff.action));
    for (const id of targets) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.attackLockedContinuous = true;
    }
    return state;
  },
};

const restrictSelfAttack: ContinuousHandler = {
  resets: ['attackLockedContinuous'],
  fold(state, source) {
    source.attackLockedContinuous = true;
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// counter_bonus_continuous / aura_counter_buff
// ────────────────────────────────────────────────────────────────────
const auraCounterBuff: ContinuousHandler = {
  resets: ['counterBonus'],
  fold(state, source, eff) {
    const n = readMagnitude(eff.action);
    const targets = ownFieldMatching(state, source, actionFilter(eff.action));
    for (const id of targets) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      // CR §3-5-2 (counter chip): aura buffs that grant a counter value to
      // characters apply ONLY to characters without a printed counter
      // (e.g., EB01-001 "without a Counter"). Skip targets that already
      // print a counter value > 0.
      const card = state.cardLibrary[inst.cardId];
      const printed = (card as { counterValue?: number | null } | undefined)?.counterValue;
      if (typeof printed === 'number' && printed > 0) continue;
      inst.counterBonus = (inst.counterBonus ?? 0) + n;
    }
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// damage_immunity_attribute — uses `attribute` on action
// ────────────────────────────────────────────────────────────────────
const damageImmunityAttribute: ContinuousHandler = {
  resets: ['damageImmunityAttribute'],
  fold(state, source, eff) {
    const attr = readStr(eff.action, 'attribute');
    if (attr === '') return state;
    // V0: applies to source (no aura_/_to_self distinction in this kind)
    source.damageImmunityAttribute = attr;
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// restrict_effect_type — uses `effectKind` on action
// ────────────────────────────────────────────────────────────────────
const restrictEffectType: ContinuousHandler = {
  resets: ['restrictEffectType'],
  fold(state, source, eff) {
    const t = readStr(eff.action, 'effectKind') || readStr(eff.action, 'type');
    if (t === '') return state;
    const targets = ownFieldMatching(state, source, actionFilter(eff.action));
    for (const id of targets) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.restrictEffectType = t;
    }
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerContinuousHandlers(): void {
  // Power
  continuousHandlers.register('give_continuous_power', auraPowerBuff);
  continuousHandlers.register('aura_power_buff', auraPowerBuff);
  continuousHandlers.register('opp_aura_power_buff', oppAuraPowerBuff);
  continuousHandlers.register('self_power_buff', selfPowerBuff);
  continuousHandlers.register('leader_power_buff', leaderPowerBuff);

  // Cost
  continuousHandlers.register('give_continuous_cost_modifier', auraCostModifier);
  continuousHandlers.register('aura_cost_modifier', auraCostModifier);
  continuousHandlers.register('opp_aura_cost_modifier', oppAuraCostModifier);
  continuousHandlers.register('cost_modifier_in_hand', costModifierInHand);
  continuousHandlers.register('self_cost_buff', selfCostBuff);

  // Keywords
  continuousHandlers.register('give_continuous_keyword', auraGrantKeyword);
  continuousHandlers.register('aura_grant_keyword', auraGrantKeyword);
  continuousHandlers.register('grant_keyword_to_self', grantKeywordToSelf);

  // Base power override
  continuousHandlers.register('base_power_override', auraSetBasePower);
  continuousHandlers.register('aura_set_base_power', auraSetBasePower);
  continuousHandlers.register('self_set_base_power', selfSetBasePower);
  continuousHandlers.register('aura_set_base_power_copy_from_leader', auraSetBasePowerCopyFromLeader);

  // Immunity
  continuousHandlers.register('give_continuous_immunity', auraImmunity);
  continuousHandlers.register('aura_immunity', auraImmunity);
  continuousHandlers.register('self_immune_to_opp_effects', selfImmuneToOppEffects);

  // Attack lock
  continuousHandlers.register('attack_lock_continuous', attackLockContinuous);
  continuousHandlers.register('restrict_self_attack', restrictSelfAttack);

  // Counter
  continuousHandlers.register('counter_bonus_continuous', auraCounterBuff);
  continuousHandlers.register('aura_counter_buff', auraCounterBuff);

  // Damage immunity / restrictions
  continuousHandlers.register('damage_immunity_attribute', damageImmunityAttribute);
  continuousHandlers.register('restrict_effect_type', restrictEffectType);
}

/**
 * Field names this manager resets BEFORE every refold tick. Single source of
 * truth — any new continuous half-field must be added here AND to the
 * `resets` declaration on the corresponding ContinuousHandler in the
 * registry.
 */
export const CONTINUOUS_RESET_FIELDS: ReadonlyArray<keyof CardInstance> = [
  'powerModifierContinuous',
  'basePowerOverrideContinuous',
  'costModifierContinuous',
  'grantedKeywordsContinuous',
  'immunityContinuous',
  'attackLockedContinuous',
  'counterBonus',
  'damageImmunityAttribute',
  'restrictEffectType',
];
