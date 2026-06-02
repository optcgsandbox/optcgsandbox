/**
 * Engine V2 — turn-flow reducers.
 *
 * Phase-control actions that delegate to PhaseScheduler:
 *   - END_TURN     → enterEnd → enterRefresh (now-active player's) → enterDraw → enterDon → enterMain
 *   - CONCEDE      → set GameResult { loser: player, reason: 'concede' }
 *
 * Setup-phase reducers (ROLL_DICE, CHOOSE_FIRST/SECOND, MULLIGAN, KEEP_HAND)
 * live in `reducers/setup.ts` — they require RngService + dealLifeCards
 * which haven't been built yet.
 *
 * Cross-references:
 * - Implementation spec §6.3 + §11
 * - Plan v1 §1.7
 */

import { PhaseScheduler } from '../phases/PhaseScheduler.js';
import type {
  ActionConcede,
  ActionEndTurn,
} from '../protocol/actions.js';
import type { GameState, PlayerId } from '../state/types.js';
import { registerActionReducer } from './registry.js';

function endTurnReducer(state: GameState, _action: ActionEndTurn, player: PlayerId): GameState {
  // Guard: only the active player can end their turn.
  if (state.activePlayer !== player) return state;
  if (state.phase !== 'main') return state;
  if (state.pending !== null) return state;

  // Engine ends turn + flips activePlayer + leaves phase='refresh' for the
  // new active player. The host (store) runs the paced R/D/D pipeline so
  // each phase animates visibly.
  return PhaseScheduler.enterEnd(state);
}

function concedeReducer(state: GameState, _action: ActionConcede, player: PlayerId): GameState {
  if (state.result !== null) return state;
  state.result = { loser: player, reason: 'concede' };
  (state.history as Array<unknown>).push({
    type: 'CONCEDED',
    player,
  });
  return state;
}

export function registerTurnFlowReducers(): void {
  registerActionReducer('END_TURN', endTurnReducer);
  registerActionReducer('CONCEDE', concedeReducer);
}
