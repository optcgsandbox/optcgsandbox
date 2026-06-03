/**
 * Card Effect Execution Layer — entry point.
 *
 * Public API: `simHandleEvent(state, event, library) → SimMutation[]`
 *
 * Pure function. Reads game state + a fired event + the per-card effect
 * library. Returns the list of mutations the host engine should apply.
 * The sim layer NEVER mutates state.
 *
 * Contract: docs/OP_SIM_COMPILER_CONTRACT.md.
 * Engine spec: docs/OP_SIM_ENGINE_SPEC_V1.md.
 */

import type { CardInstance, GameState } from '../engine-v2/state/types.js';
import { OTHER_PLAYER } from '../engine-v2/state/types.js';
import { evaluateCondition } from './conditions.js';
import { actionToMutations } from './actions.js';
import { resolveSelector } from './selectors.js';
import { matchesTrigger } from './triggers.js';
import type {
  CardEffectsLibrary,
  EffectSpec,
  SimEvent,
  SimMutation,
} from './types.js';

export type {
  Action,
  ConditionSpec,
  ConditionType,
  Duration,
  EffectAction,
  EffectSpec,
  CardEffects,
  CardEffectsLibrary,
  Selector,
  SelectorFilters,
  SelectorRef,
  SimEvent,
  SimMutation,
  Trigger,
} from './types.js';

export { evaluateCondition } from './conditions.js';
export { resolveSelector, resolvedIds } from './selectors.js';
export { actionToMutations } from './actions.js';
export { ALL_TRIGGERS, matchesTrigger } from './triggers.js';

// ────────────────────────────────────────────────────────────────────
// Internal — find effect specs that match the event
// ────────────────────────────────────────────────────────────────────

/**
 * Collect every CardInstance currently on either side's field (incl.
 * Leader). These are the cards whose effects can fire from a generic
 * board event.
 *
 * For triggers that fire from outside the field (e.g., ON_PLAY of a
 * card not yet on the field; ON_KO of a card that just left the field),
 * the host engine supplies `event.sourceInstanceId` and the sim layer
 * adds that instance to the candidate list.
 */
function candidateInstances(state: GameState, event: SimEvent): CardInstance[] {
  const a = state.players.A;
  const b = state.players.B;
  const onField: CardInstance[] = [
    a.leader,
    b.leader,
    ...a.field,
    ...b.field,
  ];

  if (event.sourceInstanceId !== undefined) {
    const src = state.instances[event.sourceInstanceId];
    if (src !== undefined && !onField.some((i) => i.instanceId === src.instanceId)) {
      onField.push(src);
    }
  }
  return onField;
}

function effectsFor(
  library: CardEffectsLibrary,
  cardId: string,
): ReadonlyArray<EffectSpec> {
  const entry = library[cardId];
  if (entry === undefined || entry.status !== 'OK') return [];
  return entry.effects;
}

// ────────────────────────────────────────────────────────────────────
// Public entry point
// ────────────────────────────────────────────────────────────────────

/**
 * Resolve all card effects that fire from this event and produce the
 * mutations to apply.
 *
 * Pipeline:
 *   1. Find candidate instances (cards on field + the event's source).
 *   2. For each candidate, look up its CardEffects from `library`.
 *   3. For each EffectSpec on that card whose trigger matches `event`:
 *      a. Re-target the event's `controller` to the candidate's
 *         controller (a card's "SELF" is the card's owner, not the
 *         player who triggered the event).
 *      b. Check `requires_don` (DON in cost area + rested DON area).
 *      c. Evaluate every `condition` against the rebound event.
 *      d. For each `effect`, resolve the selector and emit mutations.
 *   4. Concatenate and return.
 */
export function simHandleEvent(
  state: GameState,
  event: SimEvent,
  library: CardEffectsLibrary,
): SimMutation[] {
  const mutations: SimMutation[] = [];

  for (const candidate of candidateInstances(state, event)) {
    const specs = effectsFor(library, candidate.cardId);
    if (specs.length === 0) continue;

    // Rebind the event to the candidate's controller. The card's
    // sourceInstanceId is the candidate, unless the event already
    // names a specific source (e.g., ON_CHARACTER_PLAYED carries the
    // played character's instance — that's a different concept from
    // "which card is reacting to the event").
    const reboundEvent: SimEvent = {
      trigger: event.trigger,
      controller: candidate.controller,
      sourceInstanceId: candidate.instanceId,
      ...(event.targetInstanceId !== undefined ? { targetInstanceId: event.targetInstanceId } : {}),
      ...(event.attackingInstanceId !== undefined ? { attackingInstanceId: event.attackingInstanceId } : {}),
      ...(event.defendingInstanceId !== undefined ? { defendingInstanceId: event.defendingInstanceId } : {}),
    };

    for (const spec of specs) {
      if (!matchesTrigger(spec, reboundEvent)) continue;

      // requires_don check — counts DON in cost area + rested.
      if (spec.requires_don !== undefined && spec.requires_don > 0) {
        const z = state.players[candidate.controller];
        const totalDon = z.donCostArea.length + z.donRested.length;
        if (totalDon < spec.requires_don) continue;
      }

      // Condition gates — ALL must pass.
      const conditions = spec.conditions ?? [];
      let allConditionsPass = true;
      for (const c of conditions) {
        if (!evaluateCondition(state, reboundEvent, c)) {
          allConditionsPass = false;
          break;
        }
      }
      if (!allConditionsPass) continue;

      // Emit mutations for each effect, one selector resolution per effect.
      for (const eff of spec.effects) {
        const resolved = eff.target !== undefined
          ? resolveSelector(state, reboundEvent, eff.target)
          : [];
        mutations.push(...actionToMutations(state, reboundEvent, eff, resolved ?? []));
      }
    }
  }

  return mutations;
}

// Keep OTHER_PLAYER reachable for downstream tooling that might want
// the helper (without re-importing from the engine).
void OTHER_PLAYER;
