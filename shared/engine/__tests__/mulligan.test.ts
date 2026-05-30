// D10 — Mulligan window (CR §5-2-1-6 + §5-2-1-7).
//
// Coverage:
//   - setupGame leaves the engine in 'mulligan_first' with 5-card hands and
//     NO life cards (life is only dealt after both mulligans resolve).
//   - MULLIGAN: active player reshuffles + redraws a different opening hand;
//     phase advances to 'mulligan_second'.
//   - KEEP_HAND: active player keeps their hand unchanged; phase advances to
//     'mulligan_second'.
//   - After the second player resolves (either path), phase becomes
//     'refresh' and BOTH players' life arrays are full (5 each).
//   - A player may not MULLIGAN twice in the same window — the second attempt
//     is rejected per CR §5-2-1-6-1 (once-only).
//   - getLegalActions in mulligan phases offers exactly MULLIGAN / KEEP_HAND
//     for the decider and only RESIGN for the non-decider.
//
// D24 (2026-05-29) — setupGame now opens the dice-roll window BEFORE the
// mulligan window. These tests run the dice-roll and first-player choice
// through a helper so they exercise mulligan flow in isolation.

import { describe, expect, it } from 'vitest';
import { applyAction } from '../applyAction';
import { initialState, RULES } from '../GameState';
import { chooseFirstPlayer, rollDice, setupGame } from '../phases/setup';
import { getLegalActions } from '../rules/legality';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import type { GameState, PlayerId } from '../GameState';

function makeLeader(id: string): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}

function makeChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost: 2, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  };
}

/** 50 distinct vanilla characters so any subset of 5 is distinguishable as a
 *  list — essential for the "different cards after mulligan" assertion. */
function build(seed = 42) {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  return initialState({
    seed,
    decks: {
      A: { leader: makeLeader('LA'), cards },
      B: { leader: makeLeader('LB'), cards },
    },
  });
}

/** D24: advance setupGame past the dice-roll + first-player choice and into
 *  `mulligan_first`. Loops ROLL_DICE until a winner is produced (uses the
 *  pure rollDice helper to bypass the legality check, since we don't care
 *  who fires it). The winner picks CHOOSE_FIRST so they become activePlayer
 *  for the mulligan window. */
function advancePastDiceRoll(state: GameState, firstPlayer: PlayerId = 'A'): GameState {
  let s = state;
  let rolls = 0;
  while (s.phase === 'dice_roll' && rolls++ < 64) {
    s = rollDice(s);
  }
  // If the winner wasn't the requested firstPlayer, the loser-of-the-choice
  // picks CHOOSE_SECOND so the requested player goes first; otherwise winner
  // picks CHOOSE_FIRST.
  if (s.phase === 'first_player_choice') {
    const winner = s.activePlayer;
    if (winner === firstPlayer) {
      s = chooseFirstPlayer(s, winner, winner);
    } else {
      const other: PlayerId = winner === 'A' ? 'B' : 'A';
      s = chooseFirstPlayer(s, winner, other);
    }
  }
  return s;
}

/** Compose setupGame + dice-roll close so existing mulligan tests can keep
 *  asserting against `mulligan_first` directly. */
function setupForMulliganTests(seed = 42): GameState {
  return advancePastDiceRoll(setupGame(build(seed)));
}

describe('D10: Mulligan window — initial state after setupGame', () => {
  it('phase is mulligan_first; both players have 5-card hands; no life dealt yet', () => {
    const s = setupForMulliganTests();
    expect(s.phase).toBe('mulligan_first');
    expect(s.activePlayer).toBe('A');
    expect(s.players.A.hand).toHaveLength(RULES.STARTING_HAND);
    expect(s.players.B.hand).toHaveLength(RULES.STARTING_HAND);
    // CR §5-2-1-7: life cards placed AFTER both mulligan decisions.
    expect(s.players.A.life).toEqual([]);
    expect(s.players.B.life).toEqual([]);
    expect(s.mulliganUsed).toEqual({ A: false, B: false });
  });
});

describe('D10: legal actions during the mulligan window', () => {
  it('mulligan_first: active player gets MULLIGAN + KEEP_HAND + RESIGN', () => {
    const s = setupForMulliganTests();
    const legal = getLegalActions(s, 'A');
    expect(legal).toContainEqual({ type: 'MULLIGAN' });
    expect(legal).toContainEqual({ type: 'KEEP_HAND' });
    expect(legal).toContainEqual({ type: 'RESIGN' });
    expect(legal).toHaveLength(3);
  });

  it('mulligan_first: non-decider (player B) can only RESIGN', () => {
    const s = setupForMulliganTests();
    expect(getLegalActions(s, 'B')).toEqual([{ type: 'RESIGN' }]);
  });

  it('mulligan_second: only player B may decide', () => {
    let s = setupForMulliganTests();
    s = applyAction(s, 'A', { type: 'KEEP_HAND' }).state;
    expect(s.phase).toBe('mulligan_second');
    const legalB = getLegalActions(s, 'B');
    expect(legalB).toContainEqual({ type: 'MULLIGAN' });
    expect(legalB).toContainEqual({ type: 'KEEP_HAND' });
    // A (who already decided) cannot act again.
    expect(getLegalActions(s, 'A')).toEqual([{ type: 'RESIGN' }]);
  });
});

describe('D10: MULLIGAN action — active player', () => {
  it('reshuffles and redraws a different hand; phase → mulligan_second', () => {
    const s = setupForMulliganTests();
    const handBefore = [...s.players.A.hand];

    const { state: after, events } = applyAction(s, 'A', { type: 'MULLIGAN' });

    expect(after.players.A.hand).toHaveLength(RULES.STARTING_HAND);
    expect(after.players.A.hand).not.toEqual(handBefore); // reshuffle changes order
    expect(after.players.B.hand).toEqual(s.players.B.hand); // B's hand untouched
    expect(after.mulliganUsed.A).toBe(true);
    expect(after.mulliganUsed.B).toBe(false);
    expect(after.phase).toBe('mulligan_second');
    // Life still NOT dealt — second player hasn't decided yet.
    expect(after.players.A.life).toEqual([]);
    expect(after.players.B.life).toEqual([]);
    expect(events).toContainEqual({ type: 'MULLIGAN_DECISION', player: 'A', kept: false });
  });

  it('rejects a second MULLIGAN by the same player in the same window', () => {
    // A mulligans, then we try to make A mulligan AGAIN — this should fail.
    // Phase will have advanced to 'mulligan_second' so the request gets
    // rejected on phase grounds; additionally `mulliganUsed.A` is true so
    // even routing A through mulligan_second's decider check (it's B now)
    // can't reach the second-mulligan path. Confirm via state equality.
    let s = setupForMulliganTests();
    s = applyAction(s, 'A', { type: 'MULLIGAN' }).state;
    expect(s.phase).toBe('mulligan_second');
    expect(s.mulliganUsed.A).toBe(true);
    const handAfterFirst = [...s.players.A.hand];

    const { state: after } = applyAction(s, 'A', { type: 'MULLIGAN' });
    // No-op: A is not the decider during mulligan_second.
    expect(after).toBe(s);
    expect(after.players.A.hand).toEqual(handAfterFirst);
    expect(after.mulliganUsed.A).toBe(true);
  });
});

describe('D10: KEEP_HAND action — active player', () => {
  it('keeps hand unchanged; phase → mulligan_second; mulliganUsed stays false', () => {
    const s = setupForMulliganTests();
    const handBefore = [...s.players.A.hand];

    const { state: after, events } = applyAction(s, 'A', { type: 'KEEP_HAND' });

    expect(after.players.A.hand).toEqual(handBefore);
    expect(after.phase).toBe('mulligan_second');
    expect(after.mulliganUsed.A).toBe(false);
    expect(events).toContainEqual({ type: 'MULLIGAN_DECISION', player: 'A', kept: true });
  });
});

describe('D10: closing the window deals life and advances to refresh', () => {
  it('after both players KEEP: phase = refresh, life arrays full', () => {
    let s = setupForMulliganTests();
    s = applyAction(s, 'A', { type: 'KEEP_HAND' }).state;
    expect(s.phase).toBe('mulligan_second');

    const { state: after, events } = applyAction(s, 'B', { type: 'KEEP_HAND' });
    expect(after.phase).toBe('refresh');
    expect(after.players.A.life).toHaveLength(RULES.LIFE_DEFAULT);
    expect(after.players.B.life).toHaveLength(RULES.LIFE_DEFAULT);
    expect(events).toContainEqual({ type: 'LIFE_DEALT', firstPlayer: 'A' });
    // Sanity: deck size = 50 - 5 (hand) - 5 (life) = 40.
    expect(after.players.A.deck).toHaveLength(50 - RULES.STARTING_HAND - RULES.LIFE_DEFAULT);
    expect(after.players.B.deck).toHaveLength(50 - RULES.STARTING_HAND - RULES.LIFE_DEFAULT);
  });

  it('after both players MULLIGAN: phase = refresh, both hands redrawn, life full', () => {
    let s = setupForMulliganTests();
    const aHandBefore = [...s.players.A.hand];
    const bHandBefore = [...s.players.B.hand];
    s = applyAction(s, 'A', { type: 'MULLIGAN' }).state;
    s = applyAction(s, 'B', { type: 'MULLIGAN' }).state;

    expect(s.phase).toBe('refresh');
    expect(s.mulliganUsed).toEqual({ A: true, B: true });
    expect(s.players.A.hand).not.toEqual(aHandBefore);
    expect(s.players.B.hand).not.toEqual(bHandBefore);
    expect(s.players.A.life).toHaveLength(RULES.LIFE_DEFAULT);
    expect(s.players.B.life).toHaveLength(RULES.LIFE_DEFAULT);
  });

  it('mixed: A KEEPS, B MULLIGANS → A hand same, B hand different, life full', () => {
    let s = setupForMulliganTests();
    const aHandBefore = [...s.players.A.hand];
    const bHandBefore = [...s.players.B.hand];

    s = applyAction(s, 'A', { type: 'KEEP_HAND' }).state;
    s = applyAction(s, 'B', { type: 'MULLIGAN' }).state;

    expect(s.phase).toBe('refresh');
    expect(s.players.A.hand).toEqual(aHandBefore);
    expect(s.players.B.hand).not.toEqual(bHandBefore);
    expect(s.players.A.life).toHaveLength(RULES.LIFE_DEFAULT);
    expect(s.players.B.life).toHaveLength(RULES.LIFE_DEFAULT);
    expect(s.mulliganUsed).toEqual({ A: false, B: true });
  });
});
