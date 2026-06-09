/**
 * Server-authoritative turn-pipeline sweep (F-7k BUG-001).
 *
 * `turnFlow.endTurnReducer` (shared/engine-v2/reducers/turnFlow.ts:25)
 * leaves the engine at `phase='refresh'` for the new active player
 * and documents:
 *
 *   "The host (store) runs the paced R/D/D pipeline so each phase
 *    animates visibly."
 *
 * In LOCAL play that host is `src/store/game.ts:222-267`. In
 * SERVER-AUTHORITATIVE play (MatchSession + replay paths) the host is
 * us. Without this sweep, the new active player's `getLegalActions`
 * collapses to CONCEDE-only and every multi-turn online match stalls
 * at the first END_TURN.
 *
 * Invariant: whenever a freshly-applied action leaves the engine at
 *   phase === 'refresh'  AND  result === null
 * the server drives `enterRefresh → enterDraw → enterDon → enterMain`
 * synchronously. This applies uniformly to live action ingestion AND
 * to every replay path, so live state and replayed state are
 * bit-identical (and hash-identical).
 *
 * END_TURN is NOT special-cased — any reducer that leaves the engine
 * at 'refresh' triggers the same sweep.
 */

import { PhaseScheduler } from '../engine-v2/phases/PhaseScheduler.js';
import type { GameState } from '../engine-v2/state/types.js';

export function advanceTurnPipelineIfNeeded(state: GameState): GameState {
  if (state.phase !== 'refresh' || state.result !== null) {
    return state;
  }
  let next = PhaseScheduler.enterRefresh(state);
  next = PhaseScheduler.enterDraw(next);
  next = PhaseScheduler.enterDon(next);
  next = PhaseScheduler.enterMain(next);
  return next;
}
