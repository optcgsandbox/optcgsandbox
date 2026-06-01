// Continuous effects — Phase A.3.6.
//
// Continuous effects modify state on every read, not on a discrete
// trigger fire. Example: "If you have 10 or more cards in your trash,
// this Character gains +2000 power" (OP15-092). The interpreter walks
// every continuous entry on a card, evaluates its condition against the
// current state, and applies the modifier idempotently.
//
// V0 approach: stateless recomputation. Callers invoke
// `applyContinuousEffectsV2ToInstance(state, sourceId, list)` before
// reading state in a context that needs continuous effects baked in
// (e.g. before evaluating attack legality). The engine will eventually
// fold this into a `applyAllContinuous(state, libraryAccessor)` pass.

import type { CardInstance, GameState, PlayerId } from '../GameState';
import { evaluateConditionV2 } from './runner-v2';
import type { ContinuousEffectV2 } from './types-v2';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

/** Apply a single continuous-effect entry from `sourceInstanceId` to
 *  state. Mutates state in place; returns the same reference. */
export function applyContinuousEffectsV2ToInstance(
  state: GameState,
  sourceInstanceId: string,
  effects: ContinuousEffectV2[],
): GameState {
  const source = state.instances[sourceInstanceId];
  if (!source) return state;
  const controller = source.controller;
  const me = state.players[controller];
  const opp = state.players[OTHER[controller]];

  for (const eff of effects) {
    if (!evaluateConditionV2(state, controller, eff.condition, sourceInstanceId)) continue;

    switch (eff.action.kind) {
      case 'self_power_buff': {
        // Read magnitude (could be a formula).
        const m = eff.action.magnitude;
        let delta: number;
        if (typeof m === 'number') delta = m;
        else if (m.kind === 'read_state') {
          switch (m.source) {
            case 'own_trash_count': delta = me.trash.length; break;
            case 'opp_trash_count': delta = opp.trash.length; break;
            case 'own_hand_count': delta = me.hand.length; break;
            case 'opp_hand_count': delta = opp.hand.length; break;
            case 'own_life_count': delta = me.life.length; break;
            case 'opp_life_count': delta = opp.life.length; break;
            case 'own_don_count': delta = me.donCostArea.length; break;
            case 'opp_don_count': delta = opp.donCostArea.length; break;
            default: delta = 0;
          }
        } else if (m.kind === 'per_count') {
          const total = (() => {
            switch (m.countSource) {
              case 'own_trash_count': return me.trash.length;
              case 'opp_trash_count': return opp.trash.length;
              case 'own_hand_count': return me.hand.length;
              case 'opp_hand_count': return opp.hand.length;
              case 'own_life_count': return me.life.length;
              case 'opp_life_count': return opp.life.length;
              case 'own_don_count': return me.donCostArea.length;
              case 'opp_don_count': return opp.donCostArea.length;
              case 'own_rested_don_count': return me.donRested.length;
              case 'own_trash_event_count':
                return me.trash.reduce((n, id) => {
                  const inst = state.instances[id];
                  const card = inst ? state.cardLibrary[inst.cardId] : undefined;
                  return n + (card?.kind === 'event' ? 1 : 0);
                }, 0);
              default: return 0;
            }
          })();
          delta = Math.floor(total / (m.divisor || 1)) * (m.perUnit || 0);
        } else if (m.kind === 'match_opp_don') {
          delta = opp.donCostArea.length;
        } else {
          delta = 0;
        }
        source.powerModifier = (source.powerModifier ?? 0) + delta;
        // Mirror per-zone struct.
        if (me.leader.instanceId === sourceInstanceId) me.leader.powerModifier = source.powerModifier;
        for (const f of me.field) if (f.instanceId === sourceInstanceId) f.powerModifier = source.powerModifier;
        if (me.stage && me.stage.instanceId === sourceInstanceId) me.stage.powerModifier = source.powerModifier;
        break;
      }
      case 'aura_power_buff': {
        // Apply delta to every friendly field instance matching filter.
        // Per OPTCG rules "all your X" includes the source if it
        // matches; "all your other X" sets excludeSelf:true to opt out.
        const delta = eff.action.magnitude;
        const filter = eff.action.filter;
        const excludeSelf = (eff.action as { excludeSelf?: boolean }).excludeSelf === true;
        for (const inst of me.field) {
          if (!matchesFilterMinimal(state, inst, filter)) continue;
          if (excludeSelf && inst.instanceId === sourceInstanceId) continue;
          inst.powerModifier = (inst.powerModifier ?? 0) + delta;
          // Mirror to instances map.
          state.instances[inst.instanceId].powerModifier = inst.powerModifier;
        }
        break;
      }
      case 'aura_cost_modifier': {
        const delta = eff.action.delta;
        const filter = eff.action.filter;
        for (const inst of me.field) {
          if (!matchesFilterMinimal(state, inst, filter)) continue;
          if (inst.instanceId === sourceInstanceId) continue;
          inst.costModifier = (inst.costModifier ?? 0) + delta;
          state.instances[inst.instanceId].costModifier = inst.costModifier;
        }
        break;
      }
      case 'opp_aura_power_buff': {
        const delta = eff.action.magnitude;
        const filter = eff.action.filter;
        for (const inst of opp.field) {
          if (!matchesFilterMinimal(state, inst, filter)) continue;
          inst.powerModifier = (inst.powerModifier ?? 0) + delta;
          state.instances[inst.instanceId].powerModifier = inst.powerModifier;
        }
        break;
      }
      case 'opp_aura_cost_modifier': {
        const delta = eff.action.delta;
        const filter = eff.action.filter;
        for (const inst of opp.field) {
          if (!matchesFilterMinimal(state, inst, filter)) continue;
          inst.costModifier = (inst.costModifier ?? 0) + delta;
          state.instances[inst.instanceId].costModifier = inst.costModifier;
        }
        break;
      }
      case 'aura_immunity': {
        const filter = eff.action.filter;
        for (const inst of me.field) {
          if (!matchesFilterMinimal(state, inst, filter)) continue;
          inst.immunity = { against: eff.action.against };
          state.instances[inst.instanceId].immunity = inst.immunity;
        }
        break;
      }
      case 'aura_grant_keyword': {
        const filter = eff.action.filter;
        const kw = eff.action.keyword;
        // Also apply to source instance if it matches (text often says "All your X cards AND this Character").
        const apply = (inst: CardInstance) => {
          if (!inst.grantedKeywords) inst.grantedKeywords = [];
          if (!inst.grantedKeywords.includes(kw)) inst.grantedKeywords.push(kw);
          const mirror = state.instances[inst.instanceId];
          if (mirror) mirror.grantedKeywords = inst.grantedKeywords;
        };
        for (const inst of me.field) {
          if (!matchesFilterMinimal(state, inst, filter)) continue;
          apply(inst);
        }
        if (matchesFilterMinimal(state, source, filter)) apply(source);
        break;
      }
      case 'aura_set_base_power': {
        const filter = eff.action.filter;
        const bp = eff.action.basePower;
        const apply = (inst: CardInstance) => {
          (inst as { baseOverride?: number }).baseOverride = bp;
          const mirror = state.instances[inst.instanceId] as { baseOverride?: number };
          if (mirror) mirror.baseOverride = bp;
        };
        for (const inst of me.field) {
          if (!matchesFilterMinimal(state, inst, filter)) continue;
          apply(inst);
        }
        if (matchesFilterMinimal(state, source, filter)) apply(source);
        break;
      }
      case 'self_set_base_power': {
        (source as { baseOverride?: number }).baseOverride = eff.action.basePower;
        break;
      }
      case 'aura_set_base_power_copy_from_leader': {
        const filter = eff.action.filter;
        const leaderCard = state.cardLibrary[me.leader.cardId];
        const bp = leaderCard && typeof leaderCard.power === 'number' ? leaderCard.power : 0;
        const apply = (inst: CardInstance) => {
          (inst as { baseOverride?: number }).baseOverride = bp;
          const mirror = state.instances[inst.instanceId] as { baseOverride?: number };
          if (mirror) mirror.baseOverride = bp;
        };
        for (const inst of me.field) {
          if (!matchesFilterMinimal(state, inst, filter)) continue;
          apply(inst);
        }
        if (matchesFilterMinimal(state, source, filter)) apply(source);
        break;
      }
      case 'self_cost_buff': {
        const m = eff.action.magnitude;
        let delta: number;
        if (typeof m === 'number') delta = m;
        else if (m.kind === 'per_count') {
          const total = (() => {
            switch (m.countSource) {
              case 'own_trash_count': return me.trash.length;
              case 'opp_trash_count': return opp.trash.length;
              case 'own_hand_count': return me.hand.length;
              case 'opp_hand_count': return opp.hand.length;
              case 'own_life_count': return me.life.length;
              case 'opp_life_count': return opp.life.length;
              case 'own_don_count': return me.donCostArea.length;
              case 'opp_don_count': return opp.donCostArea.length;
              case 'own_rested_don_count': return me.donRested.length;
              default: return 0;
            }
          })();
          delta = Math.floor(total / (m.divisor || 1)) * (m.perUnit || 0);
        } else delta = 0;
        source.costModifier = (source.costModifier ?? 0) + delta;
        if (me.leader.instanceId === sourceInstanceId) me.leader.costModifier = source.costModifier;
        for (const f of me.field) if (f.instanceId === sourceInstanceId) f.costModifier = source.costModifier;
        if (me.stage && me.stage.instanceId === sourceInstanceId) me.stage.costModifier = source.costModifier;
        break;
      }
      case 'aura_counter_buff': {
        // EB01-001 — chars matching filter that lack a counter chip gain
        // +magnitude counter while source is on field. Counter is read at
        // counter-play time from card.counterValue; we mirror onto inst.
        const m = eff.action.magnitude;
        const filter = eff.action.filter;
        for (const inst of me.field) {
          if (!matchesFilterMinimal(state, inst, filter)) continue;
          const card = state.cardLibrary[inst.cardId];
          // Only add when printed counter is 0/null (text: "without a Counter").
          const printed = card && typeof (card as { counterValue?: number | null }).counterValue === 'number'
            ? (card as { counterValue: number | null }).counterValue
            : null;
          if (printed && printed > 0) continue;
          const augmented = inst as unknown as { counterBonus?: number };
          augmented.counterBonus = (augmented.counterBonus ?? 0) + m;
        }
        break;
      }
      case 'self_immune_to_opp_effects': {
        source.immunity = { against: 'opp_effects' };
        if (me.leader.instanceId === sourceInstanceId) me.leader.immunity = source.immunity;
        for (const f of me.field) if (f.instanceId === sourceInstanceId) f.immunity = source.immunity;
        if (me.stage && me.stage.instanceId === sourceInstanceId) me.stage.immunity = source.immunity;
        break;
      }
      case 'grant_keyword_to_self': {
        if (!source.grantedKeywords) source.grantedKeywords = [];
        if (!source.grantedKeywords.includes(eff.action.keyword)) {
          source.grantedKeywords.push(eff.action.keyword);
        }
        if (me.leader.instanceId === sourceInstanceId && !me.leader.grantedKeywords?.includes(eff.action.keyword)) {
          me.leader.grantedKeywords = source.grantedKeywords;
        }
        for (const f of me.field) {
          if (f.instanceId === sourceInstanceId) f.grantedKeywords = source.grantedKeywords;
        }
        if (me.stage && me.stage.instanceId === sourceInstanceId) me.stage.grantedKeywords = source.grantedKeywords;
        break;
      }
      case 'restrict_self_attack': {
        source.attackLocked = true;
        if (me.leader.instanceId === sourceInstanceId) me.leader.attackLocked = true;
        for (const f of me.field) if (f.instanceId === sourceInstanceId) f.attackLocked = true;
        if (me.stage && me.stage.instanceId === sourceInstanceId) me.stage.attackLocked = true;
        break;
      }
      case 'cost_modifier_in_hand': {
        // Only applies when source instance is in controller's hand.
        if (!me.hand.includes(sourceInstanceId)) break;
        source.costModifier = (source.costModifier ?? 0) + eff.action.delta;
        break;
      }
    }
  }
  return state;
}

/** Lightweight filter used by aura effects. Subset of `matchesFilter`
 *  from runner-v2 — only checks cost / trait / kind / typeIncludes.
 *  Continuous aura targeting can't depend on rested/power since those
 *  are dynamic. */
function matchesFilterMinimal(
  state: GameState,
  inst: CardInstance,
  filter:
    | { cost_max?: number; cost_min?: number; trait?: string; typeIncludes?: string; kind?: 'character' | 'event' | 'stage' }
    | { costMax?: number; costMin?: number; powerMax?: number; powerMin?: number; trait?: string; typeIncludes?: string; kind?: 'character' | 'event' | 'stage' }
    | undefined,
): boolean {
  if (!filter) return true;
  const card = state.cardLibrary[inst.cardId];
  if (!card) return false;
  // Both naming conventions accepted (runner uses costMax/costMin).
  const f = filter as { costMax?: number; costMin?: number; powerMax?: number; powerMin?: number; trait?: string; typeIncludes?: string; kind?: string };
  if (typeof f.costMax === 'number') {
    const c = typeof card.cost === 'number' ? card.cost + (inst.costModifier ?? 0) : -1;
    if (c < 0 || c > f.costMax) return false;
  }
  if (typeof f.costMin === 'number') {
    const c = typeof card.cost === 'number' ? card.cost + (inst.costModifier ?? 0) : -1;
    if (c < 0 || c < f.costMin) return false;
  }
  // Power filters in aura context read BASE power (printed) — current power could
  // mutate during the same evaluation pass and create non-idempotent feedback.
  if (typeof f.powerMax === 'number') {
    const p = typeof card.power === 'number' ? card.power : -1;
    if (p < 0 || p > f.powerMax) return false;
  }
  if (typeof f.powerMin === 'number') {
    const p = typeof card.power === 'number' ? card.power : -1;
    if (p < 0 || p < f.powerMin) return false;
  }
  if (f.trait && !card.traits.includes(f.trait)) return false;
  if (f.typeIncludes && !card.traits.some((t) => t.includes(f.typeIncludes!))) return false;
  if (f.kind && card.kind !== f.kind) return false;
  return true;
}
