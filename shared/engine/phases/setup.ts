// Pre-game setup: shuffle decks, deal opening hands, open the dice-roll window.
// Life cards are NOT dealt here — per CR §5-2-1-7 they're placed only AFTER
// both players resolve their mulligan window (D10, rules-reference.md §6.2
// step 7–8). `dealLifeCards` is the helper that closes the mulligan window.
//
// D24 (CR §5-2-1-4): the setup window starts in `dice_roll`. Both players draw
// their opening 5 here so the UI can preview hands during the roll, but the
// engine does NOT advance into the mulligan window until ROLL_DICE produces a
// winner and the winner declares first/second via CHOOSE_FIRST / CHOOSE_SECOND.

import type { Card } from '../cards/Card';
import type { GameState, PlayerId } from '../GameState';
import { RULES } from '../GameState';
import { Random } from '../Random';

/** Step 1–4 of CR §5-2-1: shuffle decks, draw opening hands, hand off to the
 *  dice-roll window (D24, CR §5-2-1-4). Life cards are NOT placed yet — that
 *  happens after both players resolve mulligan via `dealLifeCards`. Sets phase
 *  to `'dice_roll'` so both players can resolve `ROLL_DICE` before the mulligan
 *  window opens. `activePlayer` is left at the caller-provided default (A) —
 *  it'll be reassigned by CHOOSE_FIRST / CHOOSE_SECOND based on the roll. */
export function setupGame(state: GameState): GameState {
  const rng = new Random(state.seed);
  const next: GameState = structuredClone(state);

  for (const pid of ['A', 'B'] as PlayerId[]) {
    const player = next.players[pid];

    // 1. Shuffle deck.
    player.deck = rng.shuffle(player.deck);

    // 2. Draw opening hand (5 cards). Life cards stay on top of the deck
    //    until both mulligans resolve — see `dealLifeCards`.
    player.hand = player.deck.splice(0, RULES.STARTING_HAND);
  }

  next.phase = 'dice_roll';
  next.diceRoll = { A: null, B: null, rolls: 0 };
  next.history.push({ type: 'GAME_STARTED', firstPlayer: next.activePlayer });
  return next;
}

/** D24 (CR §5-2-1-4): perform a single dice-roll round. Both players roll a
 *  d6 atomically using a Mulberry32 RNG derived from the seed and the rolls
 *  counter (so re-rolls produce fresh values). Returns the next state:
 *
 *   - Tie → phase stays `dice_roll`, `rolls` increments, both d6 values are
 *     recorded for UI feedback. The winner field on `DICE_ROLLED` is null.
 *   - High roll → phase transitions to `first_player_choice`, `activePlayer`
 *     becomes the winner so legality / dispatch route to them for the choice.
 *
 *  ROLL_DICE is legal for BOTH players in `dice_roll` — either can fire it;
 *  the engine atomically rolls for both at once. */
export function rollDice(state: GameState): GameState {
  const next: GameState = structuredClone(state);
  // Derive a per-round RNG seed so each re-roll is independent of the previous.
  // XOR the rolls counter with a nonce to avoid trivial coincidence with the
  // setup shuffle.
  const round = (state.diceRoll?.rolls ?? 0) + 1;
  const rng = new Random((state.seed ^ 0xd1ced1ce) + round * 0x9e3779b1);

  const a = rng.nextInt(6) + 1; // 1..6 inclusive
  const b = rng.nextInt(6) + 1;

  next.diceRoll = { A: a, B: b, rolls: round };

  if (a === b) {
    // Tie: stay in dice_roll, allow re-roll.
    next.history.push({ type: 'DICE_ROLLED', a, b, winner: null });
    return next;
  }

  const winner: PlayerId = a > b ? 'A' : 'B';
  next.activePlayer = winner;
  next.phase = 'first_player_choice';
  next.history.push({ type: 'DICE_ROLLED', a, b, winner });
  next.history.push({ type: 'PHASE_CHANGED', phase: 'first_player_choice' });
  return next;
}

/** D24 (CR §5-2-1-4): the dice-winner declares whether to go first or second.
 *  Called from CHOOSE_FIRST (`goesFirst === chooser`) or CHOOSE_SECOND
 *  (`goesFirst === other player`). Sets `activePlayer` to whoever ends up
 *  first and transitions to `mulligan_first`. Both ROLL_DICE and this helper
 *  preserve `diceRoll` so the UI / log can replay the outcome. */
export function chooseFirstPlayer(
  state: GameState,
  chooser: PlayerId,
  goesFirst: PlayerId,
): GameState {
  const next: GameState = structuredClone(state);
  next.activePlayer = goesFirst;
  next.phase = 'mulligan_first';
  next.history.push({ type: 'FIRST_PLAYER_CHOSEN', chooser, goesFirst });
  next.history.push({ type: 'PHASE_CHANGED', phase: 'mulligan_first' });
  return next;
}

/** Perform mulligan: shuffle hand back, redraw 5 (CR §5-2-1-6-1). Per the rule,
 *  the entire hand is returned to the deck, the deck is reshuffled, and the
 *  player redraws their opening hand. Sets `mulliganUsed[player] = true` so the
 *  action surface can enforce single-use defensively. */
export function applyMulligan(state: GameState, player: PlayerId): GameState {
  // Mix in a per-player nonce so the redraw isn't identical to the original
  // shuffle for the same seed. Without this, putting the same 5 cards back +
  // reshuffling with the same RNG state would deterministically reproduce a
  // similar top of the deck.
  const rng = new Random(state.seed ^ (player === 'A' ? 0xa1a17777 : 0xb1b18888));
  const next: GameState = structuredClone(state);
  const p = next.players[player];

  // Hand → deck top, then full reshuffle, then redraw.
  p.deck = [...p.hand, ...p.deck];
  p.hand = [];
  p.deck = rng.shuffle(p.deck);
  p.hand = p.deck.splice(0, RULES.STARTING_HAND);

  next.mulliganUsed[player] = true;
  return next;
}

/** Backwards-compat alias for the old export name. Some callers may still
 *  reach for `mulligan`; both names target the same helper. */
export const mulligan = applyMulligan;

/** CR §5-2-1-7: after both players close the mulligan window, each places
 *  Leader.life cards from the TOP of their deck face-down into their Life
 *  Area. The first card placed sits at the TOP of the life pile (and is the
 *  first to flip on damage), so we take consecutive `.splice(0, N)` and
 *  preserve order. Phase transitions to `'refresh'` for player A's first
 *  turn. */
export function dealLifeCards(state: GameState): GameState {
  const next: GameState = structuredClone(state);

  for (const pid of ['A', 'B'] as PlayerId[]) {
    const player = next.players[pid];
    const leaderLife = (next.cardLibrary[player.leader.cardId] as Card & { life?: number }).life
      ?? RULES.LIFE_DEFAULT;
    player.life = player.deck.splice(0, leaderLife);
  }

  next.phase = 'refresh';
  next.history.push({ type: 'LIFE_DEALT', firstPlayer: next.activePlayer });
  return next;
}
