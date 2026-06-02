/**
 * Engine V2 — continuous handlers.
 *
 * Each handler declares its `resets: keyof CardInstance[]` (the fields it
 * writes) — ContinuousManager resets those fields on every instance BEFORE
 * any handler runs, so refold(refold(s)) === refold(s) holds.
 *
 * Handlers take the full ContinuousEffectV2 so they can use `eff.target` to
 * resolve who the modifier applies to.
 *
 * Cross-references:
 * - Implementation spec §3.3 (continuous variants) + §8
 * - Plan v1 §4.1
 */

import type { Card, Keyword } from '../../cards/Card.js';
import type {
  ContinuousEffectV2,
  EffectActionV2,
  EffectTargetV2,
} from '../../spec/types.js';
import {
  type CardInstance,
  type GameState,
  type InstanceId,
  type PlayerId,
} from '../../state/types.js';
import {
  type ContinuousHandler,
  continuousHandlers,
  targetResolvers,
} from '../types.js';

function num(a: EffectActionV2, key: string, fallback = 0): number {
  const v = a[key];
  return typeof v === 'number' ? v : fallback;
}
function str(a: EffectActionV2, key: string): string {
  const v = a[key];
  return typeof v === 'string' ? v : '';
}

function resolveTargets(
  state: GameState,
  source: CardInstance,
  eff: ContinuousEffectV2,
): InstanceId[] {
  if (eff.target === undefined) {
    // No target → self
    return [source.instanceId];
  }
  if (!targetResolvers.has(eff.target.kind)) return [];
  const resolver = targetResolvers.get(eff.target.kind);
  return [...resolver(state, {
    sourceInstanceId: source.instanceId,
    controller: source.controller,
  }, eff.target as EffectTargetV2)];
}

// ────────────────────────────────────────────────────────────────────
// give_continuous_power — adds n to powerModifierContinuous
// ────────────────────────────────────────────────────────────────────
const giveContinuousPower: ContinuousHandler = {
  resets: ['powerModifierContinuous'],
  fold(state, source, eff) {
    const n = num(eff.action, 'n', 0);
    for (const id of resolveTargets(state, source, eff)) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.powerModifierContinuous = (inst.powerModifierContinuous ?? 0) + n;
    }
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// give_continuous_cost_modifier — adds n to costModifierContinuous
// ────────────────────────────────────────────────────────────────────
const giveContinuousCost: ContinuousHandler = {
  resets: ['costModifierContinuous'],
  fold(state, source, eff) {
    const n = num(eff.action, 'n', 0);
    for (const id of resolveTargets(state, source, eff)) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.costModifierContinuous = (inst.costModifierContinuous ?? 0) + n;
    }
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// give_continuous_keyword — append to grantedKeywordsContinuous
// ────────────────────────────────────────────────────────────────────
const giveContinuousKeyword: ContinuousHandler = {
  resets: ['grantedKeywordsContinuous'],
  fold(state, source, eff) {
    const keywordRaw = str(eff.action, 'keyword');
    if (keywordRaw === '') return state;
    const keyword = keywordRaw as Keyword;
    for (const id of resolveTargets(state, source, eff)) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      const cur = inst.grantedKeywordsContinuous ?? [];
      if (!cur.includes(keyword)) {
        inst.grantedKeywordsContinuous = [...cur, keyword];
      }
    }
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// base_power_override — sets basePowerOverrideContinuous = n
// ────────────────────────────────────────────────────────────────────
const basePowerOverrideContinuous: ContinuousHandler = {
  resets: ['basePowerOverrideContinuous'],
  fold(state, source, eff) {
    const n = num(eff.action, 'n', 0);
    for (const id of resolveTargets(state, source, eff)) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      // Later sources can't lower a higher override → use max
      const cur = inst.basePowerOverrideContinuous;
      inst.basePowerOverrideContinuous = cur === undefined ? n : Math.max(cur, n);
    }
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// give_continuous_immunity — set immunityContinuous = { against }
// ────────────────────────────────────────────────────────────────────
const giveContinuousImmunity: ContinuousHandler = {
  resets: ['immunityContinuous'],
  fold(state, source, eff) {
    const against = str(eff.action, 'against');
    for (const id of resolveTargets(state, source, eff)) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.immunityContinuous = { against };
    }
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// attack_lock_continuous — set attackLockedContinuous = true
// ────────────────────────────────────────────────────────────────────
const attackLockContinuous: ContinuousHandler = {
  resets: ['attackLockedContinuous'],
  fold(state, source, eff) {
    for (const id of resolveTargets(state, source, eff)) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.attackLockedContinuous = true;
    }
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// counter_bonus_continuous — adds n to counterBonus
// ────────────────────────────────────────────────────────────────────
const counterBonusContinuous: ContinuousHandler = {
  resets: ['counterBonus'],
  fold(state, source, eff) {
    const n = num(eff.action, 'n', 0);
    for (const id of resolveTargets(state, source, eff)) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.counterBonus = (inst.counterBonus ?? 0) + n;
    }
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// damage_immunity_attribute — sets damageImmunityAttribute
// ────────────────────────────────────────────────────────────────────
const damageImmunityAttribute: ContinuousHandler = {
  resets: ['damageImmunityAttribute'],
  fold(state, source, eff) {
    const attr = str(eff.action, 'attribute');
    if (attr === '') return state;
    for (const id of resolveTargets(state, source, eff)) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.damageImmunityAttribute = attr;
    }
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// restrict_effect_type — set restrictEffectType
// ────────────────────────────────────────────────────────────────────
const restrictEffectType: ContinuousHandler = {
  resets: ['restrictEffectType'],
  fold(state, source, eff) {
    const t = str(eff.action, 'type');
    if (t === '') return state;
    for (const id of resolveTargets(state, source, eff)) {
      const inst = state.instances[id];
      if (inst === undefined) continue;
      inst.restrictEffectType = t;
    }
    return state;
  },
};

// suppress unused — Card import retained for ESLint plumbing
export type { Card, PlayerId };

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerContinuousHandlers(): void {
  continuousHandlers.register('give_continuous_power', giveContinuousPower);
  continuousHandlers.register('give_continuous_cost_modifier', giveContinuousCost);
  continuousHandlers.register('give_continuous_keyword', giveContinuousKeyword);
  continuousHandlers.register('base_power_override', basePowerOverrideContinuous);
  continuousHandlers.register('give_continuous_immunity', giveContinuousImmunity);
  continuousHandlers.register('attack_lock_continuous', attackLockContinuous);
  continuousHandlers.register('counter_bonus_continuous', counterBonusContinuous);
  continuousHandlers.register('damage_immunity_attribute', damageImmunityAttribute);
  continuousHandlers.register('restrict_effect_type', restrictEffectType);
}
