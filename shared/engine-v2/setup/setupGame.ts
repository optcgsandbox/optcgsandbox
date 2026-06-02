/**
 * Engine V2 — public initial-state builder (setupGame).
 *
 * Port of V1 shared/engine/phases/setup.ts:setupGame.
 *
 * Takes a partially-built GameState (with cardLibrary + instances +
 * players' decks + leaders populated), shuffles each deck deterministically
 * via RngService, deals opening hands (5), and opens the dice_roll window.
 *
 * Life cards are NOT placed here — that happens after both mulligan
 * windows resolve, via PhaseScheduler / setup reducer chain.
 *
 * Cross-references:
 * - V1 reference: shared/engine/phases/setup.ts:22 setupGame
 * - CR §5-2-1-4
 */

import { RngService } from '../state/RngService.js';
import {
  type GameState,
  type PlayerId,
  STARTING_HAND_SIZE,
} from '../state/types.js';

export function setupGame(state: GameState): GameState {
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const pl = state.players[pid];
    // 1. Shuffle deck deterministically.
    const rng = RngService.pull(state);
    rng.shuffle(pl.deck);
    // 2. Draw STARTING_HAND_SIZE → hand.
    pl.hand = pl.deck.splice(0, STARTING_HAND_SIZE);
  }

  state.phase = 'dice_roll';
  state.diceRoll = { A: null, B: null, rolls: 0 };
  (state.history as Array<unknown>).push({
    type: 'GAME_STARTED',
    firstPlayer: null,
    seed: state.seed,
  });
  return state;
}
