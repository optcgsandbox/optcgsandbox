/**
 * Engine V2 — per-action reducer registry.
 *
 * One reducer per Action.type. `applyAction` routes by type.
 *
 * Cross-references:
 * - Implementation spec §6.3
 */

import type { Action, ActionType } from '../protocol/actions.js';
import { Registry } from '../registry/types.js';
import type { GameState, PlayerId } from '../state/types.js';

export type ActionReducer<A extends Action = Action> = (
  state: GameState,
  action: A,
  player: PlayerId,
) => GameState;

export const actionReducers = new Registry<ActionReducer>('action-reducer');

/** Convenience typed wrapper around the generic Registry. */
export function registerActionReducer<T extends ActionType>(
  type: T,
  reducer: ActionReducer<Extract<Action, { type: T }>>,
): void {
  actionReducers.register(type, reducer as ActionReducer);
}
