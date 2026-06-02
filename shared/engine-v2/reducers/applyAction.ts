/**
 * Engine V2 — single public engine entry.
 *
 * Pipeline (Plan v1 C38 — fixed shape, no exceptions):
 *
 *   prev    = state
 *   working = structuredClone(state)
 *   working = perActionReducer(working, action, player)
 *   working = ContinuousManager.refold(working)
 *   if (DEV_MODE) assertInvariants(working, prev)
 *   events  = working.history.slice(prev.history.length)
 *   return { state: working, events }
 *
 * Pure function: caller's state is unchanged. Returns the next state +
 * the slice of history events produced by this action.
 *
 * Cross-references:
 * - Implementation spec §6.1 + §6.2
 * - Plan v1 §1.1 M04 + C38
 */

import { ContinuousManager } from '../effects/ContinuousManager.js';
import { assertInvariants } from '../invariants/check.js';
import type { Action } from '../protocol/actions.js';
import { RegistryValidationError } from '../registry/types.js';
import type { GameState, PlayerId } from '../state/types.js';
import { actionReducers } from './registry.js';

export interface ApplyActionResult {
  readonly state: GameState;
  readonly events: ReadonlyArray<unknown>;
}

export interface ApplyActionOptions {
  /**
   * Run the invariant suite after the reducer + refold. Default: true in
   * Node test env, false in production builds. Caller decides.
   */
  readonly checkInvariants?: boolean;
}

/**
 * Routes by `action.type` to a registered ActionReducer, refolds continuous,
 * runs invariants (optional), and returns the next state + history slice.
 *
 * Game-over short-circuit: if `state.result !== null` the action is dropped
 * and the input state passes through unchanged.
 */
export function applyAction(
  state: GameState,
  player: PlayerId,
  action: Action,
  options: ApplyActionOptions = {},
): ApplyActionResult {
  // Game-over: no further mutations.
  if (state.result !== null) {
    return { state, events: [] };
  }

  // Clone so the caller's state is never mutated.
  const prev = state;
  const working: GameState = structuredClone(state);

  // Route to per-action reducer.
  if (!actionReducers.has(action.type)) {
    throw new RegistryValidationError(action.type, 'action-reducer');
  }
  const reducer = actionReducers.get(action.type);
  let next = reducer(working, action, player);

  // Refold continuous (top-level wrap per spec §6.2 step 4).
  next = ContinuousManager.refold(next);

  // Optional invariant check.
  const shouldCheck = options.checkInvariants ?? true;
  if (shouldCheck) {
    assertInvariants(next, prev);
  }

  // History slice produced by this action.
  const events = next.history.slice(prev.history.length);
  return { state: next, events };
}
