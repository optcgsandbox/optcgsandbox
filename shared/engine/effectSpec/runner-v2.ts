// EffectSpec v2 runtime interpreter. Per docs/optcg-sim/card-effect-
// 100pct-spec.md §Phase A.3.
//
// STATUS: Sub-phase A.3.1 — condition evaluator only. Other helpers
// (target resolver, action handlers, continuous, replacements) land in
// subsequent commits A.3.2 → A.3.10.

import type { GameState, PlayerId } from '../GameState';
import type { EffectConditionV2 } from './types-v2';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

/** Evaluate an EffectConditionV2 against the current state, from
 *  `controller`'s perspective. Returns true when the condition holds and
 *  the clause should fire.
 *
 *  Composite conditions (and/or/not) recurse. Short-circuits on and/or so
 *  side-effect-free predicates don't run more than they have to.
 *
 *  Unknown condition types return `false` defensively (extension-safe).
 */
export function evaluateConditionV2(
  state: GameState,
  controller: PlayerId,
  cond: EffectConditionV2 | undefined,
): boolean {
  if (!cond) return true;
  const me = state.players[controller];
  const opp = state.players[OTHER[controller]];

  switch (cond.type) {
    case 'always':
      return true;

    // ── Leader identity ────────────────────────────────────────────
    case 'if_leader_is': {
      const card = state.cardLibrary[me.leader.cardId];
      return card?.name === cond.name;
    }
    case 'if_leader_has_trait': {
      const card = state.cardLibrary[me.leader.cardId];
      return Array.isArray(card?.traits) && card.traits.includes(cond.trait);
    }
    case 'if_leader_has_type': {
      // OPTCG "type" = trait string (Bandai calls trait + type interchangeably
      // in printed text e.g. {Straw Hat Crew}). We treat it as trait-includes.
      const card = state.cardLibrary[me.leader.cardId];
      return Array.isArray(card?.traits) &&
        card.traits.some((t) => t.includes(cond.typeString));
    }
    case 'if_leader_multicolored': {
      const card = state.cardLibrary[me.leader.cardId];
      return Array.isArray(card?.colors) && card.colors.length >= 2;
    }
    case 'if_leader_power_max': {
      const card = state.cardLibrary[me.leader.cardId];
      const base = typeof card?.power === 'number' ? card.power : 0;
      const mod = me.leader.powerModifier ?? 0;
      const buff = me.leader.attachedDon.length * 1000;
      return Math.max(0, base + mod + buff) <= cond.n;
    }

    // ── Resource counts ────────────────────────────────────────────
    case 'if_don_min':
      return me.donCostArea.length >= cond.n;
    case 'if_don_max':
      return me.donCostArea.length <= cond.n;
    case 'if_own_don_le_opp':
      return me.donCostArea.length <= opp.donCostArea.length;

    case 'if_own_life_max':
      return me.life.length <= cond.n;
    case 'if_own_life_min':
      return me.life.length >= cond.n;
    case 'if_opp_life_max':
      return opp.life.length <= cond.n;
    case 'if_opp_life_min':
      return opp.life.length >= cond.n;

    case 'if_hand_max':
      return me.hand.length <= cond.n;
    case 'if_hand_min':
      return me.hand.length >= cond.n;
    case 'if_opp_hand_min':
      return opp.hand.length >= cond.n;
    case 'if_opp_hand_max':
      return opp.hand.length <= cond.n;

    case 'if_trash_min':
      return me.trash.length >= cond.n;
    case 'if_trash_max':
      return me.trash.length <= cond.n;

    // ── Field state ─────────────────────────────────────────────────
    case 'if_own_chars_min': {
      const charCount = me.field.filter(
        (inst) => state.cardLibrary[inst.cardId]?.kind === 'character',
      ).length;
      return charCount >= cond.n;
    }
    case 'if_own_chars_min_cost': {
      const match = me.field.filter((inst) => {
        const card = state.cardLibrary[inst.cardId];
        return card?.kind === 'character' &&
          typeof card.cost === 'number' && card.cost >= cond.minCost;
      });
      return match.length >= cond.n;
    }
    case 'if_owned_other_with_name':
      return me.field.some((inst) =>
        state.cardLibrary[inst.cardId]?.name === cond.name,
      );
    case 'if_no_other_with_name':
      return !me.field.some((inst) =>
        state.cardLibrary[inst.cardId]?.name === cond.name,
      );
    case 'if_played_this_turn':
      // Heuristic V0: a character is "played this turn" if it's still
      // summoning-sick. Engine could carry an explicit flag later if needed.
      // For non-instance conditions, fall back to false.
      return false;
    case 'if_have_given_don_min': {
      // "Given DON" means DON attached to opp's characters by your effects.
      // Engine doesn't model the "your-effect" provenance yet; approximate
      // as opp's total attachedDon across field + leader + stage.
      const acc = (sum: number, inst: { attachedDon: string[] }) =>
        sum + inst.attachedDon.length;
      const total =
        (opp.leader.attachedDon.length) +
        opp.field.reduce(acc, 0) +
        (opp.stage ? opp.stage.attachedDon.length : 0);
      return total >= cond.n;
    }
    case 'if_field_total_cost_min': {
      const total = me.field.reduce((sum, inst) => {
        const card = state.cardLibrary[inst.cardId];
        return sum + (typeof card?.cost === 'number' ? card.cost : 0);
      }, 0);
      return total >= cond.n;
    }
    case 'if_attacker_has_attribute': {
      // Read the in-flight pendingAttack's attacker. Returns false when no
      // attack is in progress.
      if (!state.pendingAttack) return false;
      const attackerInst = state.instances[state.pendingAttack.attackerInstanceId];
      if (!attackerInst) return false;
      const card = state.cardLibrary[attackerInst.cardId];
      return card?.attribute === cond.attribute;
    }

    // ── Composite ───────────────────────────────────────────────────
    case 'and':
      return cond.conditions.every((c) => evaluateConditionV2(state, controller, c));
    case 'or':
      return cond.conditions.some((c) => evaluateConditionV2(state, controller, c));
    case 'not':
      return !evaluateConditionV2(state, controller, cond.condition);

    default:
      // Future condition types fall through to false defensively.
      return false;
  }
}
