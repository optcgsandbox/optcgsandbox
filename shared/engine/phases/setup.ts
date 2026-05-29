// Pre-game setup: shuffle decks, place life cards, draw opening hands.
// Run once before the first refresh phase. Source: rules-reference.md §1.1.

import type { Card } from '../cards/Card';
import type { GameState, PlayerId } from '../GameState';
import { RULES } from '../GameState';
import { Random } from '../Random';

export function setupGame(state: GameState): GameState {
  const rng = new Random(state.seed);
  const next: GameState = structuredClone(state);

  for (const pid of ['A', 'B'] as PlayerId[]) {
    const player = next.players[pid];
    const leaderLife = (next.cardLibrary[player.leader.cardId] as Card & { life?: number }).life
      ?? RULES.LIFE_DEFAULT;

    // 1. Shuffle deck.
    player.deck = rng.shuffle(player.deck);

    // 2. Deal life cards from top of deck, face-down.
    player.life = player.deck.splice(0, leaderLife);

    // 3. Draw opening hand.
    player.hand = player.deck.splice(0, RULES.STARTING_HAND);
  }

  next.history.push({ type: 'GAME_STARTED', firstPlayer: next.activePlayer });
  return next;
}

/** Perform mulligan: shuffle hand back, redraw same count. May only be used once per player. */
export function mulligan(state: GameState, player: PlayerId): GameState {
  const rng = new Random(state.seed ^ (player === 'A' ? 0xa1a1 : 0xb1b1));
  const next: GameState = structuredClone(state);
  const p = next.players[player];

  // Hand → deck top
  p.deck = [...p.hand, ...p.deck];
  p.hand = [];
  // Shuffle
  p.deck = rng.shuffle(p.deck);
  // Redraw
  p.hand = p.deck.splice(0, RULES.STARTING_HAND);

  return next;
}
