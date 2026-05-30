// Pre-game setup: shuffle decks, deal opening hands, open the mulligan window.
// Life cards are NOT dealt here — per CR §5-2-1-7 they're placed only AFTER
// both players resolve their mulligan window (D10, rules-reference.md §6.2
// step 7–8). `dealLifeCards` is the helper that closes the mulligan window.

import type { Card } from '../cards/Card';
import type { GameState, PlayerId } from '../GameState';
import { RULES } from '../GameState';
import { Random } from '../Random';

/** Step 1–6 of CR §5-2-1: shuffle decks, draw opening hands, hand off to the
 *  mulligan window. Life cards are NOT placed yet — that happens after both
 *  players resolve mulligan via `dealLifeCards`. Sets phase to `'mulligan_first'`
 *  so the active player (P1 — CR §5-2-1-6 "first player decides first")
 *  chooses MULLIGAN or KEEP_HAND first. */
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

  next.phase = 'mulligan_first';
  next.history.push({ type: 'GAME_STARTED', firstPlayer: next.activePlayer });
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
