/**
 * Condition evaluators.
 *
 * One pure function per condition type from
 * docs/OP_SIM_ENGINE_SPEC_V1.md L55-79. Each takes the GameState and the
 * condition spec and returns a boolean. No state mutation.
 */

import type { CardInstance, GameState, PlayerId } from '../engine-v2/state/types.js';
import type { Card } from '../engine-v2/cards/Card.js';
import { OTHER_PLAYER } from '../engine-v2/state/types.js';
import type { ConditionSpec, Owner, SimEvent } from './types.js';

function sideOf(controller: PlayerId, owner: Owner | undefined): PlayerId {
  if (owner === 'OPPONENT') return OTHER_PLAYER[controller];
  return controller;
}

function cardOf(state: GameState, inst: CardInstance): Card | undefined {
  return state.cardLibrary[inst.cardId];
}

function fieldChars(state: GameState, side: PlayerId): CardInstance[] {
  return state.players[side].field;
}

function leaderInst(state: GameState, side: PlayerId): CardInstance {
  return state.players[side].leader;
}

function totalDon(state: GameState, side: PlayerId): number {
  const z = state.players[side];
  return z.donCostArea.length + z.donRested.length;
}

function matchesFilter(
  state: GameState,
  inst: CardInstance,
  spec: ConditionSpec,
): boolean {
  const card = cardOf(state, inst);
  if (card === undefined) return false;
  if (spec.trait !== undefined && !card.traits.includes(spec.trait)) return false;
  if (spec.color !== undefined && !card.colors.includes(spec.color as never)) return false;
  if (spec.attribute !== undefined && card.attribute !== spec.attribute) return false;
  // Cost (Leader/Don may have null cost — exclude when a cost filter is set).
  const cost = card.kind === 'character' || card.kind === 'event' || card.kind === 'stage' ? card.cost : null;
  if (spec.cost !== undefined && cost !== spec.cost) return false;
  if (spec.cost_gte !== undefined && (cost === null || cost < spec.cost_gte)) return false;
  if (spec.cost_lte !== undefined && (cost === null || cost > spec.cost_lte)) return false;
  // Power (Event/Stage/Don may have null power).
  const power = card.kind === 'character' || card.kind === 'leader' ? card.power : null;
  if (spec.power !== undefined && power !== spec.power) return false;
  if (spec.power_gte !== undefined && (power === null || power < spec.power_gte)) return false;
  if (spec.power_lte !== undefined && (power === null || power > spec.power_lte)) return false;
  return true;
}

// ────────────────────────────────────────────────────────────────────
// Evaluator
// ────────────────────────────────────────────────────────────────────

/**
 * Evaluate one condition spec against the game state. The `event`
 * argument supplies trigger context (controller, source instance, etc.)
 * needed by some conditions (e.g., IS_RESTED on THIS_CARD).
 *
 * Unknown / unsupported condition types return false rather than
 * throwing — the sim layer's invariant is that the host engine never
 * sees a partially-applied effect. An unknown condition simply gates
 * the effect off.
 */
export function evaluateCondition(
  state: GameState,
  event: SimEvent,
  spec: ConditionSpec,
): boolean {
  const self = event.controller;
  const opp = OTHER_PLAYER[self];
  const side = sideOf(self, spec.owner);

  switch (spec.type) {
    case 'HAS_DON': {
      const required = spec.amount ?? spec.amount_gte ?? 0;
      return totalDon(state, side) >= required;
    }

    case 'HAS_CHARACTER': {
      return fieldChars(state, side).some((inst) => matchesFilter(state, inst, spec));
    }

    case 'HAS_TRAIT': {
      if (spec.trait === undefined) return false;
      return fieldChars(state, side).some((inst) => {
        const card = cardOf(state, inst);
        return card !== undefined && card.traits.includes(spec.trait!);
      });
    }

    case 'HAS_COLOR': {
      if (spec.color === undefined) return false;
      return fieldChars(state, side).some((inst) => {
        const card = cardOf(state, inst);
        return card !== undefined && card.colors.includes(spec.color! as never);
      });
    }

    case 'HAS_COST_AT_LEAST': {
      const min = spec.cost_gte ?? spec.cost ?? 0;
      return fieldChars(state, side).some((inst) => {
        const card = cardOf(state, inst);
        if (card === undefined) return false;
        const cost = card.kind === 'character' || card.kind === 'event' || card.kind === 'stage' ? card.cost : null;
        return cost !== null && cost >= min;
      });
    }

    case 'HAS_COST_AT_MOST': {
      const max = spec.cost_lte ?? spec.cost ?? 0;
      return fieldChars(state, side).some((inst) => {
        const card = cardOf(state, inst);
        if (card === undefined) return false;
        const cost = card.kind === 'character' || card.kind === 'event' || card.kind === 'stage' ? card.cost : null;
        return cost !== null && cost <= max;
      });
    }

    case 'HAS_POWER_AT_LEAST': {
      const min = spec.power_gte ?? spec.power ?? 0;
      return fieldChars(state, side).some((inst) => {
        const card = cardOf(state, inst);
        if (card === undefined) return false;
        const power = card.kind === 'character' || card.kind === 'leader' ? card.power : null;
        return power !== null && power >= min;
      });
    }

    case 'HAS_POWER_AT_MOST': {
      const max = spec.power_lte ?? spec.power ?? 0;
      return fieldChars(state, side).some((inst) => {
        const card = cardOf(state, inst);
        if (card === undefined) return false;
        const power = card.kind === 'character' || card.kind === 'leader' ? card.power : null;
        return power !== null && power <= max;
      });
    }

    case 'LEADER_IS': {
      if (spec.name === undefined) return false;
      const ldr = leaderInst(state, side);
      const card = cardOf(state, ldr);
      return card !== undefined && card.name === spec.name;
    }

    case 'COUNT_CHARACTERS': {
      const n = fieldChars(state, side).length;
      if (spec.amount !== undefined) return n === spec.amount;
      if (spec.amount_gte !== undefined && n < spec.amount_gte) return false;
      if (spec.amount_lte !== undefined && n > spec.amount_lte) return false;
      return spec.amount_gte !== undefined || spec.amount_lte !== undefined;
    }

    case 'COUNT_RESTED_CHARACTERS': {
      const n = fieldChars(state, side).filter((i) => i.rested).length;
      if (spec.amount !== undefined) return n === spec.amount;
      if (spec.amount_gte !== undefined && n < spec.amount_gte) return false;
      if (spec.amount_lte !== undefined && n > spec.amount_lte) return false;
      return spec.amount_gte !== undefined || spec.amount_lte !== undefined;
    }

    case 'COUNT_ACTIVE_CHARACTERS': {
      const n = fieldChars(state, side).filter((i) => !i.rested).length;
      if (spec.amount !== undefined) return n === spec.amount;
      if (spec.amount_gte !== undefined && n < spec.amount_gte) return false;
      if (spec.amount_lte !== undefined && n > spec.amount_lte) return false;
      return spec.amount_gte !== undefined || spec.amount_lte !== undefined;
    }

    case 'COUNT_TRAIT': {
      if (spec.trait === undefined) return false;
      const n = fieldChars(state, side).filter((inst) => {
        const card = cardOf(state, inst);
        return card !== undefined && card.traits.includes(spec.trait!);
      }).length;
      if (spec.amount !== undefined) return n === spec.amount;
      if (spec.amount_gte !== undefined && n < spec.amount_gte) return false;
      if (spec.amount_lte !== undefined && n > spec.amount_lte) return false;
      return spec.amount_gte !== undefined || spec.amount_lte !== undefined;
    }

    case 'COUNT_COLOR': {
      if (spec.color === undefined) return false;
      const n = fieldChars(state, side).filter((inst) => {
        const card = cardOf(state, inst);
        return card !== undefined && card.colors.includes(spec.color! as never);
      }).length;
      if (spec.amount !== undefined) return n === spec.amount;
      if (spec.amount_gte !== undefined && n < spec.amount_gte) return false;
      if (spec.amount_lte !== undefined && n > spec.amount_lte) return false;
      return spec.amount_gte !== undefined || spec.amount_lte !== undefined;
    }

    case 'LIFE_AT_OR_BELOW': {
      const threshold = spec.amount ?? spec.amount_lte ?? 0;
      return state.players[side].life.length <= threshold;
    }

    case 'LIFE_AT_OR_ABOVE': {
      const threshold = spec.amount ?? spec.amount_gte ?? 0;
      return state.players[side].life.length >= threshold;
    }

    case 'HAND_SIZE_AT_LEAST': {
      const threshold = spec.amount ?? spec.amount_gte ?? 0;
      return state.players[side].hand.length >= threshold;
    }

    case 'HAND_SIZE_AT_MOST': {
      const threshold = spec.amount ?? spec.amount_lte ?? 0;
      return state.players[side].hand.length <= threshold;
    }

    case 'TRASH_SIZE_AT_LEAST': {
      const threshold = spec.amount ?? spec.amount_gte ?? 0;
      return state.players[side].trash.length >= threshold;
    }

    case 'TURN_PLAYER': {
      // owner=SELF (default) means "is it MY turn"; OPPONENT means "is it OPP's turn".
      return state.activePlayer === side;
    }

    case 'EXISTS_TARGET': {
      // Generic existence — a target exists matching the filter on this side's field.
      return fieldChars(state, side).some((inst) => matchesFilter(state, inst, spec));
    }

    case 'NO_TARGET_EXISTS': {
      return !fieldChars(state, side).some((inst) => matchesFilter(state, inst, spec));
    }

    case 'IS_RESTED': {
      // Checked against the event's source instance (THIS_CARD semantics).
      if (event.sourceInstanceId === undefined) return false;
      const inst = state.instances[event.sourceInstanceId];
      return inst !== undefined && inst.rested;
    }

    case 'IS_ACTIVE': {
      if (event.sourceInstanceId === undefined) return false;
      const inst = state.instances[event.sourceInstanceId];
      return inst !== undefined && !inst.rested;
    }

    case 'HAS_ATTRIBUTE': {
      if (spec.attribute === undefined) return false;
      return fieldChars(state, side).some((inst) => {
        const card = cardOf(state, inst);
        return card !== undefined && card.attribute === spec.attribute;
      });
    }

    default: {
      // Exhaustiveness check — unknown type means the compiler emitted a
      // condition not in the spec. Return false so the effect doesn't fire.
      const _exhaustive: never = spec.type;
      void _exhaustive;
      void self;
      void opp;
      return false;
    }
  }
}
