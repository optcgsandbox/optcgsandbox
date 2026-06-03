/**
 * Selector resolvers.
 *
 * One pure function per selector from docs/OP_SIM_ENGINE_SPEC_V1.md
 * L87-111. Each takes the GameState + event context + optional filters
 * and returns either:
 *
 *   - A list of resolved targets (InstanceId | PlayerId), OR
 *   - undefined when the selector cannot be resolved in this event
 *     context (e.g., ATTACKING_CHARACTER when there is no attack pending).
 *
 * Filters are applied per docs/OP_SIM_ENGINE_SPEC_V1.md L120-135.
 */

import type { CardInstance, GameState, InstanceId, PlayerId } from '../engine-v2/state/types.js';
import type { Card } from '../engine-v2/cards/Card.js';
import { OTHER_PLAYER } from '../engine-v2/state/types.js';
import type { SelectorFilters, SelectorRef, Selector, SimEvent } from './types.js';

function cardOf(state: GameState, inst: CardInstance): Card | undefined {
  return state.cardLibrary[inst.cardId];
}

/**
 * Apply selector filters to one CardInstance. Returns true if all
 * provided filter keys match (AND semantics, mirroring the spec).
 */
function passFilters(state: GameState, inst: CardInstance, f: SelectorFilters | undefined): boolean {
  if (f === undefined) return true;
  const card = cardOf(state, inst);
  if (card === undefined) return false;

  if (f.trait !== undefined && !card.traits.includes(f.trait)) return false;
  if (f.color !== undefined && !card.colors.includes(f.color as never)) return false;

  const cost = card.kind === 'character' || card.kind === 'event' || card.kind === 'stage' ? card.cost : null;
  if (f.cost !== undefined && cost !== f.cost) return false;
  if (f.cost_gte !== undefined && (cost === null || cost < f.cost_gte)) return false;
  if (f.cost_lte !== undefined && (cost === null || cost > f.cost_lte)) return false;

  const power = card.kind === 'character' || card.kind === 'leader' ? card.power : null;
  if (f.power !== undefined && power !== f.power) return false;
  if (f.power_gte !== undefined && (power === null || power < f.power_gte)) return false;
  if (f.power_lte !== undefined && (power === null || power > f.power_lte)) return false;

  if (f.attribute !== undefined && card.attribute !== f.attribute) return false;
  if (f.type !== undefined && card.kind !== f.type) return false;

  if (f.is_rested === true && !inst.rested) return false;
  if (f.is_active === true && inst.rested) return false;

  // Counter filters apply to the printed counter value (counterValue on the
  // card definition). Characters with counterValue null have no counter.
  if (f.has_counter !== undefined || f.without_counter !== undefined) {
    const counter = card.kind === 'character' ? card.counterValue : null;
    const hasCounter = counter !== null && counter > 0;
    if (f.has_counter === true && !hasCounter) return false;
    if (f.without_counter === true && hasCounter) return false;
  }

  // `owner` filter only meaningful when the selector returns instances
  // from a side-agnostic pool; for side-bound selectors (SELF_*, OPPONENT_*)
  // the side is already constrained by the selector itself.
  if (f.owner !== undefined) {
    const expected: PlayerId = f.owner === 'SELF' ? state.activePlayer : OTHER_PLAYER[state.activePlayer];
    if (inst.controller !== expected) return false;
  }

  return true;
}

function fieldChars(state: GameState, side: PlayerId): CardInstance[] {
  return state.players[side].field;
}

function allChars(state: GameState, side: PlayerId): CardInstance[] {
  // ALL_*_CHARACTERS includes the Leader.
  return [state.players[side].leader, ...state.players[side].field];
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Resolve a selector reference to a list of CardInstances (or
 * undefined). The caller converts to InstanceIds for the mutation
 * output.
 */
export function resolveSelector(
  state: GameState,
  event: SimEvent,
  ref: Selector | SelectorRef,
): CardInstance[] | undefined {
  const sel: Selector = typeof ref === 'string' ? ref : ref.selector;
  const filters: SelectorFilters | undefined = typeof ref === 'string' ? undefined : ref.filters;

  const self = event.controller;
  const opp = OTHER_PLAYER[self];

  switch (sel) {
    case 'SELF_LEADER':
      return [state.players[self].leader].filter((i) => passFilters(state, i, filters));
    case 'OPPONENT_LEADER':
      return [state.players[opp].leader].filter((i) => passFilters(state, i, filters));
    case 'SELF_CHARACTER':
      return fieldChars(state, self).filter((i) => passFilters(state, i, filters));
    case 'OPPONENT_CHARACTER':
      return fieldChars(state, opp).filter((i) => passFilters(state, i, filters));
    case 'ALL_SELF_CHARACTERS':
      return allChars(state, self).filter((i) => passFilters(state, i, filters));
    case 'ALL_OPPONENT_CHARACTERS':
      return allChars(state, opp).filter((i) => passFilters(state, i, filters));

    case 'THIS_CARD': {
      if (event.sourceInstanceId === undefined) return undefined;
      const inst = state.instances[event.sourceInstanceId];
      return inst === undefined ? undefined : [inst];
    }

    case 'ATTACKING_CHARACTER': {
      if (event.attackingInstanceId === undefined) return undefined;
      const inst = state.instances[event.attackingInstanceId];
      if (inst === undefined) return undefined;
      const card = cardOf(state, inst);
      if (card === undefined || card.kind !== 'character') return undefined;
      return [inst];
    }

    case 'ATTACKING_LEADER': {
      if (event.attackingInstanceId === undefined) return undefined;
      const inst = state.instances[event.attackingInstanceId];
      if (inst === undefined) return undefined;
      const card = cardOf(state, inst);
      if (card === undefined || card.kind !== 'leader') return undefined;
      return [inst];
    }

    case 'TARGET_CHARACTER': {
      if (event.targetInstanceId === undefined) return undefined;
      const inst = state.instances[event.targetInstanceId];
      if (inst === undefined) return undefined;
      const card = cardOf(state, inst);
      if (card === undefined || card.kind !== 'character') return undefined;
      return [inst];
    }

    case 'TARGET_LEADER': {
      if (event.targetInstanceId === undefined) return undefined;
      const inst = state.instances[event.targetInstanceId];
      if (inst === undefined) return undefined;
      const card = cardOf(state, inst);
      if (card === undefined || card.kind !== 'leader') return undefined;
      return [inst];
    }

    // Zone selectors return the InstanceId list for that zone; consumers
    // that need CardInstance views should look them up via state.instances.
    case 'SELF_HAND':
    case 'OPPONENT_HAND':
    case 'SELF_DECK':
    case 'OPPONENT_DECK':
    case 'SELF_TRASH':
    case 'OPPONENT_TRASH':
    case 'SELF_LIFE':
    case 'OPPONENT_LIFE': {
      const side: PlayerId = sel.startsWith('SELF_') ? self : opp;
      const zoneKey = sel.endsWith('_HAND')
        ? 'hand'
        : sel.endsWith('_DECK')
          ? 'deck'
          : sel.endsWith('_TRASH')
            ? 'trash'
            : 'life';
      const ids = state.players[side][zoneKey];
      return ids
        .map((id) => state.instances[id])
        .filter((i): i is CardInstance => i !== undefined && passFilters(state, i, filters));
    }

    default: {
      const _exhaustive: never = sel;
      void _exhaustive;
      return undefined;
    }
  }
}

/**
 * Helper: convert a list of resolved CardInstances to their InstanceIds
 * (the form the mutation output uses). Returns empty array if
 * resolution failed.
 */
export function resolvedIds(
  instances: CardInstance[] | undefined,
): InstanceId[] {
  if (instances === undefined) return [];
  return instances.map((i) => i.instanceId);
}
