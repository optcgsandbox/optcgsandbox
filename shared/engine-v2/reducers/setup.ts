/**
 * Engine V2 — setup-phase reducers.
 *
 * Setup sequence (CR §5-2-1):
 *   dice_roll → first_player_choice → mulligan_first → mulligan_second
 *     → deal_life → refresh (turn 1 of firstPlayer)
 *
 * Per-action reducers:
 *   - ROLL_DICE          (dice_roll): each player rolls a d6 once;
 *                         ties null both slots + re-roll; high roller becomes
 *                         the activePlayer (the chooser).
 *   - CHOOSE_FIRST       (first_player_choice → mulligan_first):
 *                         chooser declares they go first; firstPlayer = activePlayer.
 *   - CHOOSE_SECOND      (first_player_choice → mulligan_first):
 *                         chooser declares they go second; firstPlayer = opponent.
 *   - MULLIGAN           (mulligan_*): return hand to deck, reshuffle, redraw 5
 *   - KEEP_HAND          (mulligan_*): keep current hand; advance phase
 *
 * After both mulligan windows: dealLifeCards → enterRefresh (firstPlayer's turn 1).
 *
 * Cross-references:
 * - Implementation spec §12 (SetupMulligan M16)
 * - Plan v2 §1.1 M16 + CR §5-2-1
 */

import { PhaseScheduler } from '../phases/PhaseScheduler.js';
import type {
  ActionChooseFirst,
  ActionChooseSecond,
  ActionKeepHand,
  ActionMulligan,
  ActionRollDice,
} from '../protocol/actions.js';
import { triggerEmitters } from '../registry/types.js';
import { RngService } from '../state/RngService.js';
import {
  type GameState,
  OTHER_PLAYER,
  type PlayerId,
  STARTING_HAND_SIZE,
} from '../state/types.js';
import { registerActionReducer } from './registry.js';

const LIFE_CARD_COUNT_DEFAULT = 5;

// ─── ROLL_DICE
function rollDiceReducer(
  state: GameState,
  action: ActionRollDice,
  _player: PlayerId,
): GameState {
  if (state.phase !== 'dice_roll') return state;
  if (state.diceRoll === null) {
    state.diceRoll = { A: null, B: null, rolls: 0 };
  }
  // Per-player slot — only fill once per round.
  if (state.diceRoll[action.player] !== null) return state;

  const rng = RngService.pull(state);
  const value = rng.nextInt(6) + 1;
  state.diceRoll[action.player] = value;
  (state.history as Array<unknown>).push({
    type: 'DICE_ROLLED',
    player: action.player,
    value,
  });

  // Both slots filled?
  const a = state.diceRoll.A;
  const b = state.diceRoll.B;
  if (a !== null && b !== null) {
    if (a === b) {
      // Tie: null both slots, re-roll round.
      state.diceRoll = { A: null, B: null, rolls: state.diceRoll.rolls + 1 };
      return state;
    }
    // Winner = higher roll = chooser.
    const winner: PlayerId = a > b ? 'A' : 'B';
    state.activePlayer = winner;
    state.phase = 'first_player_choice';
  }
  return state;
}

// ─── CHOOSE_FIRST
function chooseFirstReducer(
  state: GameState,
  _action: ActionChooseFirst,
  player: PlayerId,
): GameState {
  if (state.phase !== 'first_player_choice') return state;
  if (state.activePlayer !== player) return state;
  state.firstPlayer = player;
  state.activePlayer = player;
  state.phase = 'mulligan_first';
  (state.history as Array<unknown>).push({
    type: 'FIRST_PLAYER_CHOSEN',
    player,
    goesFirst: true,
  });
  return state;
}

// ─── CHOOSE_SECOND
function chooseSecondReducer(
  state: GameState,
  _action: ActionChooseSecond,
  player: PlayerId,
): GameState {
  if (state.phase !== 'first_player_choice') return state;
  if (state.activePlayer !== player) return state;
  const opp = OTHER_PLAYER[player];
  state.firstPlayer = opp;
  state.activePlayer = opp;
  state.phase = 'mulligan_first';
  (state.history as Array<unknown>).push({
    type: 'FIRST_PLAYER_CHOSEN',
    player,
    goesFirst: false,
  });
  return state;
}

// ─── MULLIGAN: return hand → deck, shuffle, redraw STARTING_HAND_SIZE.
function mulliganReducer(
  state: GameState,
  _action: ActionMulligan,
  player: PlayerId,
): GameState {
  if (state.phase !== 'mulligan_first' && state.phase !== 'mulligan_second') return state;
  if (state.activePlayer !== player) return state;
  if (state.mulliganUsed[player] === true) return state;

  const pl = state.players[player];
  // Return hand → deck
  while (pl.hand.length > 0) {
    const id = pl.hand.shift();
    if (id !== undefined) pl.deck.push(id);
  }
  // Reshuffle deck deterministically
  const rng = RngService.pull(state);
  rng.shuffle(pl.deck);
  // Redraw STARTING_HAND_SIZE
  for (let i = 0; i < STARTING_HAND_SIZE; i++) {
    const id = pl.deck.shift();
    if (id !== undefined) pl.hand.push(id);
  }
  state.mulliganUsed[player] = true;

  (state.history as Array<unknown>).push({
    type: 'MULLIGAN_USED',
    player,
  });

  return advanceMulliganPhase(state);
}

// ─── KEEP_HAND
function keepHandReducer(
  state: GameState,
  _action: ActionKeepHand,
  player: PlayerId,
): GameState {
  if (state.phase !== 'mulligan_first' && state.phase !== 'mulligan_second') return state;
  if (state.activePlayer !== player) return state;
  state.mulliganUsed[player] = true; // mark as decided (no actual mulligan)
  (state.history as Array<unknown>).push({
    type: 'HAND_KEPT',
    player,
  });
  return advanceMulliganPhase(state);
}

/**
 * After a mulligan decision:
 *  - If we were on mulligan_first → activePlayer = opp, phase = mulligan_second
 *  - If we were on mulligan_second → dealLifeCards → enterRefresh(firstPlayer)
 */
function advanceMulliganPhase(state: GameState): GameState {
  if (state.phase === 'mulligan_first') {
    const next = OTHER_PLAYER[state.activePlayer];
    state.activePlayer = next;
    state.phase = 'mulligan_second';
    return state;
  }
  if (state.phase === 'mulligan_second') {
    // Deal life cards to both players.
    const lifeCount = LIFE_CARD_COUNT_DEFAULT;
    for (const side of ['A', 'B'] as PlayerId[]) {
      const pl = state.players[side];
      const leaderCard = state.cardLibrary[pl.leader.cardId] as
        | { kind: 'leader'; life: number }
        | undefined;
      const count =
        leaderCard !== undefined && leaderCard.kind === 'leader'
          ? leaderCard.life
          : lifeCount;
      for (let i = 0; i < count; i++) {
        const id = pl.deck.shift();
        if (id !== undefined) pl.life.push(id);
      }
    }
    (state.history as Array<unknown>).push({ type: 'LIFE_CARDS_DEALT' });

    // First-player turn 1 begins.
    if (state.firstPlayer !== null) {
      state.activePlayer = state.firstPlayer;
      state.turn = 1;
      state.phase = 'refresh';
      // Broadcast at_start_of_game BEFORE the first refresh — listeners (e.g.,
      // leader effects, atStartOfGamePlay scheduled placements) get to fire
      // against the freshly dealt-life initial state per CR §5-2-1-5-1.
      let next = state;
      if (triggerEmitters.has('at_start_of_game')) {
        next = triggerEmitters.get('at_start_of_game')(next, { kind: 'at_start_of_game' }, state.firstPlayer);
      }
      next = PhaseScheduler.enterRefresh(next);
      if (next.result !== null) return next;
      next = PhaseScheduler.enterDraw(next);
      if (next.result !== null) return next;
      next = PhaseScheduler.enterDon(next);
      if (next.result !== null) return next;
      return PhaseScheduler.enterMain(next);
    }
  }
  return state;
}

export function registerSetupReducers(): void {
  registerActionReducer('ROLL_DICE', rollDiceReducer);
  registerActionReducer('CHOOSE_FIRST', chooseFirstReducer);
  registerActionReducer('CHOOSE_SECOND', chooseSecondReducer);
  registerActionReducer('MULLIGAN', mulliganReducer);
  registerActionReducer('KEEP_HAND', keepHandReducer);
}
