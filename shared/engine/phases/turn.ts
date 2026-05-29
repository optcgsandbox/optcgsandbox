// Per-turn phase transitions. Source: rules-reference.md §1.4.
//
// Order: Refresh → Draw → DON → Main → (attacks fold into main) → End.

import type { GameState, PlayerId } from '../GameState';
import { RULES } from '../GameState';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

/** Active player un-rests their leader, characters, and all DON. */
export function runRefreshPhase(state: GameState): GameState {
  const next: GameState = structuredClone(state);
  const p = next.players[next.activePlayer];

  p.leader.rested = false;
  for (const inst of p.field) inst.rested = false;
  // All rested DON returns to active pool.
  p.donActive += p.donRested;
  p.donRested = 0;

  next.phase = 'draw';
  next.history.push({ type: 'PHASE_CHANGED', phase: 'draw' });
  return next;
}

/** Active player draws 1. First player skips on turn 1 (rules-reference.md §1.4). */
export function runDrawPhase(state: GameState): GameState {
  const next: GameState = structuredClone(state);
  const p = next.players[next.activePlayer];

  const isFirstPlayerFirstTurn = next.turn === 1 && next.activePlayer === 'A';
  if (!isFirstPlayerFirstTurn) {
    if (p.deck.length === 0) {
      next.result = { winner: OTHER[next.activePlayer], reason: 'deck_out' };
      next.history.push({ type: 'GAME_ENDED', result: next.result });
      return next;
    }
    const drawn = p.deck.shift()!;
    p.hand.push(drawn);
    next.history.push({ type: 'CARD_DRAWN', player: next.activePlayer, instanceId: drawn });
  }

  next.phase = 'don';
  next.history.push({ type: 'PHASE_CHANGED', phase: 'don' });
  return next;
}

/** Active player adds DON. 1 on first player's first turn, 2 otherwise. */
export function runDonPhase(state: GameState): GameState {
  const next: GameState = structuredClone(state);
  const p = next.players[next.activePlayer];

  const isFirstPlayerFirstTurn = next.turn === 1 && next.activePlayer === 'A';
  const count = isFirstPlayerFirstTurn ? RULES.DON_PER_TURN_FIRST : RULES.DON_PER_TURN_AFTER_FIRST;
  const dealt = Math.min(count, p.donDeck);
  p.donActive += dealt;
  p.donDeck -= dealt;
  if (dealt > 0) {
    next.history.push({ type: 'DON_DEALT', player: next.activePlayer, count: dealt });
  }

  next.phase = 'main';
  next.history.push({ type: 'PHASE_CHANGED', phase: 'main' });
  return next;
}

/** Active player ends turn. Per-turn flags reset; turn handoff. */
export function endTurn(state: GameState): GameState {
  const next: GameState = structuredClone(state);
  const p = next.players[next.activePlayer];

  // Detach DON used this turn — they return to the rested pool.
  // (DON-attached-to-characters return at end of opponent's turn; for simplicity
  // we model "DON returns at end of YOUR turn" — matches Bandai's rule §1.5.)
  for (const inst of p.field) {
    p.donRested += inst.attachedDon;
    inst.attachedDon = 0;
    inst.perTurn = { hasAttacked: false, onceEffectUsed: false };
  }
  p.leader.perTurn = { hasAttacked: false, onceEffectUsed: false };

  next.history.push({ type: 'TURN_ENDED', player: next.activePlayer });
  next.activePlayer = OTHER[next.activePlayer];
  next.turn += 1;
  next.phase = 'refresh';
  return next;
}
