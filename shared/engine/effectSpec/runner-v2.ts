// EffectSpec v2 runtime interpreter. Per docs/optcg-sim/card-effect-
// 100pct-spec.md §Phase A.3.
//
// STATUS: Sub-phase A.3.1 — condition evaluator only. Other helpers
// (target resolver, action handlers, continuous, replacements) land in
// subsequent commits A.3.2 → A.3.10.

import type { CardInstance, GameState, PlayerId } from '../GameState';
import type { Card } from '../cards/Card';
import type { EffectConditionV2, EffectTargetV2, TargetFilter } from './types-v2';

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

// ─────────────────────────────────────────────────────────────────────
// Target resolver — Sub-phase A.3.2
// ─────────────────────────────────────────────────────────────────────

/** Compute the effective power of an instance (base + DON × 1000 + mod).
 *  Used by power-axis filters. */
function effectivePower(state: GameState, inst: CardInstance): number {
  const card = state.cardLibrary[inst.cardId];
  let base = 0;
  if (card?.kind === 'leader' || card?.kind === 'character') {
    base = (card as { power: number }).power ?? 0;
  }
  const mod = inst.powerModifier ?? 0;
  return Math.max(0, base + inst.attachedDon.length * 1000 + mod);
}

/** Compute the effective cost of an instance (base cost + costModifier).
 *  Used by cost-axis filters. */
function effectiveCost(card: Card | undefined, inst: CardInstance): number | null {
  if (!card || card.cost === null || card.cost === undefined) return null;
  return Math.max(0, card.cost + (inst.costModifier ?? 0));
}

/** Test whether an instance passes every axis of a TargetFilter. Each
 *  axis is independent — omitted axes match everything. */
function matchesFilter(state: GameState, inst: CardInstance, filter: TargetFilter | undefined): boolean {
  if (!filter) return true;
  const card = state.cardLibrary[inst.cardId];
  if (!card) return false;

  if (typeof filter.costMax === 'number') {
    const c = effectiveCost(card, inst);
    if (c === null || c > filter.costMax) return false;
  }
  if (typeof filter.costMin === 'number') {
    const c = effectiveCost(card, inst);
    if (c === null || c < filter.costMin) return false;
  }
  if (typeof filter.powerMax === 'number') {
    if (effectivePower(state, inst) > filter.powerMax) return false;
  }
  if (typeof filter.powerMin === 'number') {
    if (effectivePower(state, inst) < filter.powerMin) return false;
  }
  if (filter.trait) {
    if (!Array.isArray(card.traits) || !card.traits.includes(filter.trait)) return false;
  }
  if (filter.typeIncludes) {
    if (!Array.isArray(card.traits) || !card.traits.some((t) => t.includes(filter.typeIncludes!))) return false;
  }
  if (filter.colors && filter.colors.length > 0) {
    if (!Array.isArray(card.colors) || !card.colors.some((c) => filter.colors!.includes(c))) return false;
  }
  if (filter.nameIs) {
    if (card.name !== filter.nameIs) return false;
  }
  if (filter.nameExcludes) {
    if (card.name === filter.nameExcludes) return false;
  }
  if (filter.kind) {
    if (card.kind !== filter.kind) return false;
  }
  if (typeof filter.rested === 'boolean') {
    if (inst.rested !== filter.rested) return false;
  }
  return true;
}

/** Resolve an EffectTargetV2 descriptor against state. Returns an array
 *  of instance ids. Single-target kinds return at most 1; mass-target
 *  kinds (all_your_characters, all_opp_characters) return many.
 *
 *  V0 picks deterministically (first match in scan order). The runtime
 *  will eventually accept a controller-provided pick when ambiguous —
 *  this resolver gives the default candidate set. */
export function resolveTargetV2(
  state: GameState,
  controller: PlayerId,
  sourceInstanceId: string,
  target: EffectTargetV2 | undefined,
): string[] {
  if (!target) return [];
  const me = state.players[controller];
  const opp = state.players[OTHER[controller]];

  switch (target.kind) {
    case 'self':
      return state.instances[sourceInstanceId] ? [sourceInstanceId] : [];

    case 'your_leader':
      return [me.leader.instanceId];

    case 'opp_leader':
      return [opp.leader.instanceId];

    case 'your_character': {
      const hits = me.field.filter((inst) => matchesFilter(state, inst, target.filter));
      return hits.length > 0 ? [hits[0].instanceId] : [];
    }

    case 'opp_character': {
      const hits = opp.field.filter((inst) => matchesFilter(state, inst, target.filter));
      return hits.length > 0 ? [hits[0].instanceId] : [];
    }

    case 'opp_hand_card': {
      const hits = opp.hand
        .map((id) => state.instances[id])
        .filter((inst): inst is CardInstance => !!inst && matchesFilter(state, inst, target.filter));
      return hits.length > 0 ? [hits[0].instanceId] : [];
    }

    case 'own_trash_card': {
      const hits = me.trash
        .map((id) => state.instances[id])
        .filter((inst): inst is CardInstance => !!inst && matchesFilter(state, inst, target.filter));
      // Trash picks default to MOST RECENT match (top of trash).
      return hits.length > 0 ? [hits[hits.length - 1].instanceId] : [];
    }

    case 'top_of_deck':
      return me.deck.length > 0 ? [me.deck[0]] : [];

    case 'top_of_opp_deck':
      return opp.deck.length > 0 ? [opp.deck[0]] : [];

    case 'all_your_characters':
      return me.field
        .filter((inst) => matchesFilter(state, inst, target.filter))
        .map((inst) => inst.instanceId);

    case 'all_opp_characters':
      return opp.field
        .filter((inst) => matchesFilter(state, inst, target.filter))
        .map((inst) => inst.instanceId);

    case 'own_life_top':
      return me.life.length > 0 ? [me.life[0]] : [];

    case 'opp_life_top':
      return opp.life.length > 0 ? [opp.life[0]] : [];

    default:
      return [];
  }
}
