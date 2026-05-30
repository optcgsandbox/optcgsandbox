// D24 — Dice-roll first-player decision (CR §5-2-1-4).
//
// Coverage:
//   - setupGame leaves the engine in 'dice_roll' with 5-card hands, empty life
//     arrays, and a non-null `diceRoll` accumulator.
//   - ROLL_DICE produces values in [1, 6] for both A and B, increments
//     `diceRoll.rolls`, and emits DICE_ROLLED.
//   - A > B: activePlayer becomes 'A', phase advances to 'first_player_choice'.
//   - B > A: activePlayer becomes 'B', phase advances to 'first_player_choice'.
//   - Ties: phase stays 'dice_roll', allowing a re-roll. The next ROLL_DICE
//     produces independent values.
//   - CHOOSE_FIRST → phase 'mulligan_first', activePlayer unchanged.
//   - CHOOSE_SECOND → phase 'mulligan_first', activePlayer swapped.
//   - Deterministic seeds reproduce identical roll sequences (replay-safe).
//   - Legality: dice_roll surfaces ROLL_DICE for both players; first_player_choice
//     surfaces CHOOSE_FIRST / CHOOSE_SECOND only for the winner.

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

/** Find a seed whose first ROLL_DICE produces a tie. The Mulberry32 RNG is
 *  deterministic, so a small search over seed space always finds one. We
 *  bound the search defensively. */
function findSeedFor(predicate: (s: GameState) => boolean, maxSeeds = 4096): number {
  for (let seed = 1; seed < maxSeeds; seed++) {
    const s = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' }).state;
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
  it('dice_roll: both players see ROLL_DICE + RESIGN', () => {
    const s = setupGame(build());
    expect(getLegalActions(s, 'A')).toEqual([
      { type: 'ROLL_DICE' },
      { type: 'RESIGN' },
    ]);
    expect(getLegalActions(s, 'B')).toEqual([
      { type: 'ROLL_DICE' },
      { type: 'RESIGN' },
    ]);
  });
});

describe('D24: ROLL_DICE result envelope', () => {
  it('both rolls are 1..6 and rolls counter increments', () => {
    const s = setupGame(build());
    const { state: after, events } = applyAction(s, 'A', { type: 'ROLL_DICE' });
    expect(after.diceRoll).not.toBeNull();
    const { A: a, B: b, rolls } = after.diceRoll!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a! >= 1 && a! <= 6).toBe(true);
    expect(b! >= 1 && b! <= 6).toBe(true);
    expect(rolls).toBe(1);
    expect(events.some((e) => e.type === 'DICE_ROLLED')).toBe(true);
  });

  it('deterministic for a fixed seed', () => {
    const s1 = applyAction(setupGame(build(42)), 'A', { type: 'ROLL_DICE' }).state;
    const s2 = applyAction(setupGame(build(42)), 'B', { type: 'ROLL_DICE' }).state;
    // Same seed, same RNG → identical dice values regardless of who fired.
    expect(s1.diceRoll).toEqual(s2.diceRoll);
  });

  it('different seeds produce different rolls (at least one out of the search window)', () => {
    const rolls = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const s = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' }).state;
      rolls.add(`${s.diceRoll!.A}-${s.diceRoll!.B}`);
    }
    expect(rolls.size).toBeGreaterThan(1);
  });
});

describe('D24: ROLL_DICE → first_player_choice on non-tie', () => {
  it('A > B: activePlayer becomes A, phase becomes first_player_choice', () => {
    const seed = findSeedFor((s) => {
      const d = s.diceRoll!;
      return d.A! > d.B!;
    });
    const after = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' }).state;
    expect(after.diceRoll!.A! > after.diceRoll!.B!).toBe(true);
    expect(after.phase).toBe('first_player_choice');
    expect(after.activePlayer).toBe('A');
  });

  it('B > A: activePlayer becomes B, phase becomes first_player_choice', () => {
    const seed = findSeedFor((s) => {
      const d = s.diceRoll!;
      return d.B! > d.A!;
    });
    const after = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' }).state;
    expect(after.diceRoll!.B! > after.diceRoll!.A!).toBe(true);
    expect(after.phase).toBe('first_player_choice');
    expect(after.activePlayer).toBe('B');
  });

  it('DICE_ROLLED winner field reflects the high roll', () => {
    const seed = findSeedFor((s) => s.diceRoll!.A! > s.diceRoll!.B!);
    const { events } = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' });
    const e = events.find((ev) => ev.type === 'DICE_ROLLED');
    expect(e).toBeDefined();
    if (e && e.type === 'DICE_ROLLED') {
      expect(e.winner).toBe('A');
      expect(e.a > e.b).toBe(true);
    }
  });
});

describe('D24: ROLL_DICE tie handling', () => {
  it('tie: phase stays dice_roll, both values recorded, winner=null, rolls counter increments', () => {
    const seed = findSeedFor((s) => s.diceRoll!.A === s.diceRoll!.B);
    const { state: after, events } = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' });
    expect(after.phase).toBe('dice_roll');
    expect(after.diceRoll!.A).toBe(after.diceRoll!.B);
    expect(after.diceRoll!.rolls).toBe(1);
    const e = events.find((ev) => ev.type === 'DICE_ROLLED');
    expect(e).toBeDefined();
    if (e && e.type === 'DICE_ROLLED') {
      expect(e.winner).toBeNull();
    }
  });

  it('tie allows a re-roll that uses an independent RNG round', () => {
    // After a tie, ROLL_DICE again must produce values from a different RNG
    // round (per `rollDice`, seed XOR'd with the rolls counter).
    const seed = findSeedFor((s) => s.diceRoll!.A === s.diceRoll!.B);
    let s = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' }).state;
    expect(s.phase).toBe('dice_roll');
    // Loop until a non-tie is produced — the engine must allow re-roll.
    let safety = 0;
    while (s.phase === 'dice_roll' && safety++ < 50) {
      s = applyAction(s, 'A', { type: 'ROLL_DICE' }).state;
    }
    expect(safety).toBeLessThan(50);
    expect(s.phase).toBe('first_player_choice');
    expect(s.diceRoll!.rolls).toBeGreaterThan(1);
  });
});

describe('D24: first_player_choice legality', () => {
  it('winner sees CHOOSE_FIRST + CHOOSE_SECOND + RESIGN; loser sees only RESIGN', () => {
    const seed = findSeedFor((s) => s.diceRoll!.A! > s.diceRoll!.B!);
    const s = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' }).state;
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
    ['winner=A picks first', (s) => s.diceRoll!.A! > s.diceRoll!.B!, 'A'],
    ['winner=B picks first', (s) => s.diceRoll!.B! > s.diceRoll!.A!, 'B'],
  ])('%s', (_label, pred, expectedActive) => {
    const seed = findSeedFor(pred);
    let s = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' }).state;
    expect(s.phase).toBe('first_player_choice');
    expect(s.activePlayer).toBe(expectedActive);
    s = applyAction(s, expectedActive, { type: 'CHOOSE_FIRST' }).state;
    expect(s.phase).toBe('mulligan_first');
    expect(s.activePlayer).toBe(expectedActive);
  });

  it('CHOOSE_FIRST emits FIRST_PLAYER_CHOSEN with goesFirst === chooser', () => {
    const seed = findSeedFor((s) => s.diceRoll!.A! > s.diceRoll!.B!);
    const after = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' }).state;
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
    ['winner=A picks second → B goes first', (s) => s.diceRoll!.A! > s.diceRoll!.B!, 'A', 'B'],
    ['winner=B picks second → A goes first', (s) => s.diceRoll!.B! > s.diceRoll!.A!, 'B', 'A'],
  ])('%s', (_label, pred, winner, expectedFirst) => {
    const seed = findSeedFor(pred);
    let s = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' }).state;
    expect(s.activePlayer).toBe(winner);
    s = applyAction(s, winner, { type: 'CHOOSE_SECOND' }).state;
    expect(s.phase).toBe('mulligan_first');
    expect(s.activePlayer).toBe(expectedFirst);
  });

  it('CHOOSE_SECOND emits FIRST_PLAYER_CHOSEN with goesFirst === other player', () => {
    const seed = findSeedFor((s) => s.diceRoll!.A! > s.diceRoll!.B!);
    const after = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' }).state;
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
    const seed = findSeedFor((s) => s.diceRoll!.A! > s.diceRoll!.B!);
    let s = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' }).state;
    s = applyAction(s, 'A', { type: 'CHOOSE_FIRST' }).state;
    expect(s.phase).toBe('mulligan_first');
    const result = applyAction(s, 'A', { type: 'ROLL_DICE' });
    expect(result.state).toBe(s);
    expect(result.events).toEqual([]);
  });

  it('CHOOSE_FIRST by the loser of the roll is a no-op', () => {
    const seed = findSeedFor((s) => s.diceRoll!.A! > s.diceRoll!.B!);
    const s = applyAction(setupGame(build(seed)), 'A', { type: 'ROLL_DICE' }).state;
    expect(s.activePlayer).toBe('A');
    const result = applyAction(s, 'B', { type: 'CHOOSE_FIRST' });
    expect(result.state).toBe(s);
    expect(result.events).toEqual([]);
  });
});

describe('D24: end-to-end into mulligan', () => {
  it('full dice → choose-first → mulligan-first → mulligan-second → refresh pipeline yields life cards', () => {
    let s = setupGame(build(42));
    // Roll until a winner is produced.
    let safety = 0;
    while (s.phase === 'dice_roll' && safety++ < 64) {
      s = applyAction(s, 'A', { type: 'ROLL_DICE' }).state;
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
  it('rollDice is callable directly and respects the same envelope', () => {
    const s = setupGame(build(7));
    const next = rollDice(s);
    expect(next.diceRoll!.rolls).toBe(1);
    expect(next.diceRoll!.A! >= 1 && next.diceRoll!.A! <= 6).toBe(true);
    expect(next.diceRoll!.B! >= 1 && next.diceRoll!.B! <= 6).toBe(true);
  });
});
