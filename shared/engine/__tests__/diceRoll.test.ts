// D24 — Dice-roll first-player decision (CR §5-2-1-4).
//
// Per-player roll model (2026-05-29 refactor): each player presses their own
// ROLL_DICE button. Hot-seat hands the device between humans; vs-AI fires
// the AI's roll after the human's roll resolves; remote MP routes each call
// through that player's socket.
//
// Coverage:
//   - setupGame leaves the engine in 'dice_roll' with 5-card hands, empty life
//     arrays, and a non-null `diceRoll` accumulator.
//   - Per-player ROLL_DICE sets exactly one slot; the other stays null.
//   - When both slots are filled, the engine resolves:
//       - Tie → both slots reset to null, `rolls` increments, phase stays
//         'dice_roll' so each player can re-press.
//       - High roll → activePlayer becomes the winner, phase advances to
//         'first_player_choice'.
//   - Re-rolls while the player's slot is already filled are no-ops.
//   - Order independence: A then B vs. B then A produce identical final state
//     for a fixed seed (RNG depends only on seed + round + player).
//   - CHOOSE_FIRST → phase 'mulligan_first', activePlayer unchanged.
//   - CHOOSE_SECOND → phase 'mulligan_first', activePlayer swapped.
//   - Legality: dice_roll surfaces { ROLL_DICE, player: P } for player P
//     while their slot is null; after rolling they see only RESIGN.

import { describe, expect, it } from 'vitest';
import { applyAction } from '../applyAction';
import { initialState, RULES } from '../GameState';
import { rollDice, setupGame } from '../phases/setup';
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

function build(seed = 42): GameState {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  return initialState({
    seed,
    decks: {
      A: { leader: makeLeader('LA'), cards },
      B: { leader: makeLeader('LB'), cards },
    },
  });
}

/** Roll BOTH players for a fresh setup-game state — the new analog of the
 *  old atomic ROLL_DICE. Used by predicate searches that need to inspect the
 *  resolved diceRoll snapshot. */
function rollBoth(state: GameState): GameState {
  let s = applyAction(state, 'A', { type: 'ROLL_DICE', player: 'A' }).state;
  s = applyAction(s, 'B', { type: 'ROLL_DICE', player: 'B' }).state;
  return s;
}

/** Find a seed whose first complete round (A then B) satisfies a predicate.
 *  The Mulberry32 RNG is deterministic, so a small search over seed space
 *  always finds one. We bound the search defensively. */
function findSeedFor(predicate: (s: GameState) => boolean, maxSeeds = 4096): number {
  for (let seed = 1; seed < maxSeeds; seed++) {
    const s = rollBoth(setupGame(build(seed)));
    if (predicate(s)) return seed;
  }
  throw new Error('No seed satisfied predicate within search window');
}

describe('D24: setupGame opens the dice-roll window', () => {
  it('phase = dice_roll, hand = 5, life = empty, diceRoll initialized', () => {
    const s = setupGame(build());
    expect(s.phase).toBe('dice_roll');
    expect(s.players.A.hand).toHaveLength(RULES.STARTING_HAND);
    expect(s.players.B.hand).toHaveLength(RULES.STARTING_HAND);
    expect(s.players.A.life).toEqual([]);
    expect(s.players.B.life).toEqual([]);
    expect(s.diceRoll).toEqual({ A: null, B: null, rolls: 0 });
  });

  it('GAME_STARTED is emitted with firstPlayer defaulting to A', () => {
    const s = setupGame(build());
    expect(s.history).toContainEqual({ type: 'GAME_STARTED', firstPlayer: 'A' });
  });
});

describe('D24: ROLL_DICE legality', () => {
  it('dice_roll: each player sees their own ROLL_DICE + RESIGN before they roll', () => {
    const s = setupGame(build());
    expect(getLegalActions(s, 'A')).toEqual([
      { type: 'ROLL_DICE', player: 'A' },
      { type: 'RESIGN' },
    ]);
    expect(getLegalActions(s, 'B')).toEqual([
      { type: 'ROLL_DICE', player: 'B' },
      { type: 'RESIGN' },
    ]);
  });

  it('after A rolls (and B has not), A sees only RESIGN; B still sees ROLL_DICE', () => {
    const s = applyAction(setupGame(build()), 'A', { type: 'ROLL_DICE', player: 'A' }).state;
    expect(s.phase).toBe('dice_roll');
    expect(s.diceRoll!.A).not.toBeNull();
    expect(s.diceRoll!.B).toBeNull();
    expect(getLegalActions(s, 'A')).toEqual([{ type: 'RESIGN' }]);
    expect(getLegalActions(s, 'B')).toEqual([
      { type: 'ROLL_DICE', player: 'B' },
      { type: 'RESIGN' },
    ]);
  });
});

describe('D24: per-player ROLL_DICE state envelope', () => {
  it('A rolls but B has not → phase stays dice_roll, A set, B null, no PHASE_CHANGED yet', () => {
    const start = setupGame(build());
    const { state: after, events } = applyAction(start, 'A', { type: 'ROLL_DICE', player: 'A' });
    expect(after.phase).toBe('dice_roll');
    expect(after.diceRoll!.A).not.toBeNull();
    expect(after.diceRoll!.A! >= 1 && after.diceRoll!.A! <= 6).toBe(true);
    expect(after.diceRoll!.B).toBeNull();
    // No DICE_ROLLED or PHASE_CHANGED until the round closes.
    expect(events.some((e) => e.type === 'DICE_ROLLED')).toBe(false);
    expect(events.some((e) => e.type === 'PHASE_CHANGED')).toBe(false);
  });

  it('A rolls twice in a row → second call rejected, state unchanged', () => {
    const afterA = applyAction(setupGame(build()), 'A', { type: 'ROLL_DICE', player: 'A' }).state;
    const result = applyAction(afterA, 'A', { type: 'ROLL_DICE', player: 'A' });
    expect(result.state).toBe(afterA);
    expect(result.events).toEqual([]);
  });

  it('both rolls fired → both values in [1, 6] and rolls counter is 1 (single round closed)', () => {
    const s = setupGame(build());
    let after = applyAction(s, 'A', { type: 'ROLL_DICE', player: 'A' }).state;
    after = applyAction(after, 'B', { type: 'ROLL_DICE', player: 'B' }).state;
    expect(after.diceRoll).not.toBeNull();
    // On a non-tie, both values are retained; rolls === 1.
    if (after.phase === 'first_player_choice') {
      const { A: a, B: b, rolls } = after.diceRoll!;
      expect(a! >= 1 && a! <= 6).toBe(true);
      expect(b! >= 1 && b! <= 6).toBe(true);
      expect(rolls).toBe(1);
    } else {
      // On a tie, both slots null but rolls still === 1.
      expect(after.diceRoll!.A).toBeNull();
      expect(after.diceRoll!.B).toBeNull();
      expect(after.diceRoll!.rolls).toBe(1);
    }
  });

  it('order independence: A→B and B→A produce identical resolved state for a fixed seed', () => {
    const s = setupGame(build(42));
    let ab = applyAction(s, 'A', { type: 'ROLL_DICE', player: 'A' }).state;
    ab = applyAction(ab, 'B', { type: 'ROLL_DICE', player: 'B' }).state;
    let ba = applyAction(s, 'B', { type: 'ROLL_DICE', player: 'B' }).state;
    ba = applyAction(ba, 'A', { type: 'ROLL_DICE', player: 'A' }).state;
    expect(ab.diceRoll).toEqual(ba.diceRoll);
    expect(ab.phase).toEqual(ba.phase);
    expect(ab.activePlayer).toEqual(ba.activePlayer);
  });

  it('deterministic for a fixed seed regardless of roll order', () => {
    const ab1 = rollBoth(setupGame(build(42)));
    const ab2 = rollBoth(setupGame(build(42)));
    expect(ab1.diceRoll).toEqual(ab2.diceRoll);
  });

  it('different seeds produce different rolls (at least one out of the search window)', () => {
    const rolls = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const s = rollBoth(setupGame(build(seed)));
      rolls.add(`${s.diceRoll!.A}-${s.diceRoll!.B}`);
    }
    expect(rolls.size).toBeGreaterThan(1);
  });
});

describe('D24: ROLL_DICE → first_player_choice on non-tie', () => {
  it('A > B: activePlayer becomes A, phase becomes first_player_choice', () => {
    const seed = findSeedFor((s) => {
      const d = s.diceRoll!;
      return d.A !== null && d.B !== null && d.A! > d.B!;
    });
    const after = rollBoth(setupGame(build(seed)));
    expect(after.diceRoll!.A! > after.diceRoll!.B!).toBe(true);
    expect(after.phase).toBe('first_player_choice');
    expect(after.activePlayer).toBe('A');
  });

  it('B > A: activePlayer becomes B, phase becomes first_player_choice', () => {
    const seed = findSeedFor((s) => {
      const d = s.diceRoll!;
      return d.A !== null && d.B !== null && d.B! > d.A!;
    });
    const after = rollBoth(setupGame(build(seed)));
    expect(after.diceRoll!.B! > after.diceRoll!.A!).toBe(true);
    expect(after.phase).toBe('first_player_choice');
    expect(after.activePlayer).toBe('B');
  });

  it('DICE_ROLLED winner field reflects the high roll (emitted on round close)', () => {
    const seed = findSeedFor((s) => {
      const d = s.diceRoll!;
      return d.A !== null && d.B !== null && d.A! > d.B!;
    });
    // Resolve A first (no event), then B (event fires on round close).
    const s = setupGame(build(seed));
    const afterA = applyAction(s, 'A', { type: 'ROLL_DICE', player: 'A' });
    expect(afterA.events.some((e) => e.type === 'DICE_ROLLED')).toBe(false);
    const afterB = applyAction(afterA.state, 'B', { type: 'ROLL_DICE', player: 'B' });
    const e = afterB.events.find((ev) => ev.type === 'DICE_ROLLED');
    expect(e).toBeDefined();
    if (e && e.type === 'DICE_ROLLED') {
      expect(e.winner).toBe('A');
      expect(e.a > e.b).toBe(true);
    }
  });
});

describe('D24: per-player ROLL_DICE tie handling', () => {
  it('tie clears both slots back to null and increments rolls (per-player verification)', () => {
    const seed = findSeedFor((s) => {
      const d = s.diceRoll!;
      // A tied round produces null slots + rolls=1 (round closed via tie).
      return d.A === null && d.B === null && d.rolls === 1;
    });
    // Walk the round step by step to verify per-player semantics.
    const s = setupGame(build(seed));
    const afterA = applyAction(s, 'A', { type: 'ROLL_DICE', player: 'A' }).state;
    expect(afterA.phase).toBe('dice_roll');
    expect(afterA.diceRoll!.A).not.toBeNull();
    expect(afterA.diceRoll!.B).toBeNull();
    expect(afterA.diceRoll!.rolls).toBe(0); // round still in progress

    const { state: afterB, events } = applyAction(afterA, 'B', { type: 'ROLL_DICE', player: 'B' });
    expect(afterB.phase).toBe('dice_roll');
    // Tie: both slots reset to null so each player can re-press.
    expect(afterB.diceRoll!.A).toBeNull();
    expect(afterB.diceRoll!.B).toBeNull();
    expect(afterB.diceRoll!.rolls).toBe(1);

    const e = events.find((ev) => ev.type === 'DICE_ROLLED');
    expect(e).toBeDefined();
    if (e && e.type === 'DICE_ROLLED') {
      expect(e.winner).toBeNull();
      expect(e.a).toBe(e.b);
    }
  });

  it('tie allows a re-roll round that uses an independent RNG round', () => {
    // After a tie (slots null, rolls bumped), both players can press again.
    // Loop until a non-tie resolves — the engine must allow it within a
    // small bound.
    const seed = findSeedFor((s) => s.diceRoll!.A === null && s.diceRoll!.B === null && s.diceRoll!.rolls === 1);
    let s = setupGame(build(seed));
    let safety = 0;
    while (s.phase === 'dice_roll' && safety++ < 50) {
      s = applyAction(s, 'A', { type: 'ROLL_DICE', player: 'A' }).state;
      s = applyAction(s, 'B', { type: 'ROLL_DICE', player: 'B' }).state;
    }
    expect(safety).toBeLessThan(50);
    expect(s.phase).toBe('first_player_choice');
    expect(s.diceRoll!.rolls).toBeGreaterThan(1);
  });
});

describe('D24: first_player_choice legality', () => {
  it('winner sees CHOOSE_FIRST + CHOOSE_SECOND + RESIGN; loser sees only RESIGN', () => {
    const seed = findSeedFor((s) => {
      const d = s.diceRoll!;
      return d.A !== null && d.B !== null && d.A! > d.B!;
    });
    const s = rollBoth(setupGame(build(seed)));
    expect(s.phase).toBe('first_player_choice');
    expect(s.activePlayer).toBe('A');
    expect(getLegalActions(s, 'A')).toEqual([
      { type: 'CHOOSE_FIRST' },
      { type: 'CHOOSE_SECOND' },
      { type: 'RESIGN' },
    ]);
    expect(getLegalActions(s, 'B')).toEqual([{ type: 'RESIGN' }]);
  });
});

describe('D24: CHOOSE_FIRST → mulligan_first, activePlayer unchanged', () => {
  it.each<[string, (s: GameState) => boolean, PlayerId]>([
    ['winner=A picks first', (s) => s.diceRoll!.A !== null && s.diceRoll!.B !== null && s.diceRoll!.A! > s.diceRoll!.B!, 'A'],
    ['winner=B picks first', (s) => s.diceRoll!.A !== null && s.diceRoll!.B !== null && s.diceRoll!.B! > s.diceRoll!.A!, 'B'],
  ])('%s', (_label, pred, expectedActive) => {
    const seed = findSeedFor(pred);
    let s = rollBoth(setupGame(build(seed)));
    expect(s.phase).toBe('first_player_choice');
    expect(s.activePlayer).toBe(expectedActive);
    s = applyAction(s, expectedActive, { type: 'CHOOSE_FIRST' }).state;
    expect(s.phase).toBe('mulligan_first');
    expect(s.activePlayer).toBe(expectedActive);
  });

  it('CHOOSE_FIRST emits FIRST_PLAYER_CHOSEN with goesFirst === chooser', () => {
    const seed = findSeedFor((s) => s.diceRoll!.A !== null && s.diceRoll!.B !== null && s.diceRoll!.A! > s.diceRoll!.B!);
    const after = rollBoth(setupGame(build(seed)));
    const { events } = applyAction(after, 'A', { type: 'CHOOSE_FIRST' });
    const e = events.find((ev) => ev.type === 'FIRST_PLAYER_CHOSEN');
    expect(e).toBeDefined();
    if (e && e.type === 'FIRST_PLAYER_CHOSEN') {
      expect(e.chooser).toBe('A');
      expect(e.goesFirst).toBe('A');
    }
  });
});

describe('D24: CHOOSE_SECOND → mulligan_first, activePlayer swapped', () => {
  it.each<[string, (s: GameState) => boolean, PlayerId, PlayerId]>([
    ['winner=A picks second → B goes first', (s) => s.diceRoll!.A !== null && s.diceRoll!.B !== null && s.diceRoll!.A! > s.diceRoll!.B!, 'A', 'B'],
    ['winner=B picks second → A goes first', (s) => s.diceRoll!.A !== null && s.diceRoll!.B !== null && s.diceRoll!.B! > s.diceRoll!.A!, 'B', 'A'],
  ])('%s', (_label, pred, winner, expectedFirst) => {
    const seed = findSeedFor(pred);
    let s = rollBoth(setupGame(build(seed)));
    expect(s.activePlayer).toBe(winner);
    s = applyAction(s, winner, { type: 'CHOOSE_SECOND' }).state;
    expect(s.phase).toBe('mulligan_first');
    expect(s.activePlayer).toBe(expectedFirst);
  });

  it('CHOOSE_SECOND emits FIRST_PLAYER_CHOSEN with goesFirst === other player', () => {
    const seed = findSeedFor((s) => s.diceRoll!.A !== null && s.diceRoll!.B !== null && s.diceRoll!.A! > s.diceRoll!.B!);
    const after = rollBoth(setupGame(build(seed)));
    const { events } = applyAction(after, 'A', { type: 'CHOOSE_SECOND' });
    const e = events.find((ev) => ev.type === 'FIRST_PLAYER_CHOSEN');
    expect(e).toBeDefined();
    if (e && e.type === 'FIRST_PLAYER_CHOSEN') {
      expect(e.chooser).toBe('A');
      expect(e.goesFirst).toBe('B');
    }
  });
});

describe('D24: phase/action gating', () => {
  it('ROLL_DICE is a no-op outside dice_roll', () => {
    // After CHOOSE_FIRST, the engine is in 'mulligan_first' — ROLL_DICE
    // must be rejected.
    const seed = findSeedFor((s) => s.diceRoll!.A !== null && s.diceRoll!.B !== null && s.diceRoll!.A! > s.diceRoll!.B!);
    let s = rollBoth(setupGame(build(seed)));
    s = applyAction(s, 'A', { type: 'CHOOSE_FIRST' }).state;
    expect(s.phase).toBe('mulligan_first');
    const result = applyAction(s, 'A', { type: 'ROLL_DICE', player: 'A' });
    expect(result.state).toBe(s);
    expect(result.events).toEqual([]);
  });

  it('CHOOSE_FIRST by the loser of the roll is a no-op', () => {
    const seed = findSeedFor((s) => s.diceRoll!.A !== null && s.diceRoll!.B !== null && s.diceRoll!.A! > s.diceRoll!.B!);
    const s = rollBoth(setupGame(build(seed)));
    expect(s.activePlayer).toBe('A');
    const result = applyAction(s, 'B', { type: 'CHOOSE_FIRST' });
    expect(result.state).toBe(s);
    expect(result.events).toEqual([]);
  });
});

describe('D24: end-to-end into mulligan', () => {
  it('full dice → choose-first → mulligan-first → mulligan-second → refresh pipeline yields life cards', () => {
    let s = setupGame(build(42));
    // Roll until a winner is produced. Each round is two per-player calls.
    let safety = 0;
    while (s.phase === 'dice_roll' && safety++ < 64) {
      if (s.diceRoll!.A === null) {
        s = applyAction(s, 'A', { type: 'ROLL_DICE', player: 'A' }).state;
      }
      if (s.phase === 'dice_roll' && s.diceRoll!.B === null) {
        s = applyAction(s, 'B', { type: 'ROLL_DICE', player: 'B' }).state;
      }
    }
    expect(s.phase).toBe('first_player_choice');
    const winner: PlayerId = s.activePlayer;
    s = applyAction(s, winner, { type: 'CHOOSE_FIRST' }).state;
    expect(s.phase).toBe('mulligan_first');

    const first: PlayerId = s.activePlayer;
    const second: PlayerId = first === 'A' ? 'B' : 'A';
    s = applyAction(s, first, { type: 'KEEP_HAND' }).state;
    s = applyAction(s, second, { type: 'KEEP_HAND' }).state;

    expect(s.phase).toBe('refresh');
    expect(s.players.A.life).toHaveLength(RULES.LIFE_DEFAULT);
    expect(s.players.B.life).toHaveLength(RULES.LIFE_DEFAULT);
  });
});

describe('D24: pure helper exports are exercised', () => {
  it('rollDice is callable directly per-player and respects the envelope', () => {
    const s = setupGame(build(7));
    const afterA = rollDice(s, 'A');
    // Mid-round: A set, B null, rolls still 0.
    expect(afterA.diceRoll!.A).not.toBeNull();
    expect(afterA.diceRoll!.B).toBeNull();
    expect(afterA.diceRoll!.rolls).toBe(0);
    expect(afterA.diceRoll!.A! >= 1 && afterA.diceRoll!.A! <= 6).toBe(true);

    const afterB = rollDice(afterA, 'B');
    // Round closes — either tie (slots null, rolls=1) or decisive (slots
    // filled, rolls=1, phase advances).
    expect(afterB.diceRoll!.rolls).toBe(1);
    if (afterB.phase === 'first_player_choice') {
      expect(afterB.diceRoll!.A).not.toBeNull();
      expect(afterB.diceRoll!.B).not.toBeNull();
      expect(afterB.diceRoll!.B! >= 1 && afterB.diceRoll!.B! <= 6).toBe(true);
    } else {
      expect(afterB.diceRoll!.A).toBeNull();
      expect(afterB.diceRoll!.B).toBeNull();
    }
  });
});
