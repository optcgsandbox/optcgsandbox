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
  if (state.pending !== null) return state; // can't end during a pending choice

  // Run the end-phase chain: end → (turn passes inside enterEnd) → next player's
  // refresh → draw → don → main.
  let next = PhaseScheduler.enterEnd(state);
  // If enterEnd suspended on hand-limit discard, stop here.
  if (next.pending !== null) return next;
  // If the game ended via deck-out etc., stop here.
  if (next.result !== null) return next;

  next = PhaseScheduler.enterRefresh(next);
  if (next.result !== null) return next;
  next = PhaseScheduler.enterDraw(next);
  if (next.result !== null) return next;
  next = PhaseScheduler.enterDon(next);
  if (next.result !== null) return next;
  next = PhaseScheduler.enterMain(next);
  return next;
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
