// D24 (2026-05-29) — First-player propagation through turn-1 rules.
//
// Before this fix, runDrawPhase + runDonPhase + the attack-gate in legality
// and applyAction.declareAttack hardcoded `activePlayer === 'A'` as the
// first-player check. When B wins the dice-roll and goes first (or when A
// wins and chooses SECOND), that hardcode produced the wrong rules:
//
//   - B-as-first drew on turn 1 (should skip per CR §6-3-1)
//   - B-as-first got 2 DON on turn 1 (should be 1 per CR §6-4-1)
//   - B-as-first could attack on turn 1 (should be blocked per CR §6-5-6-1)
//   - A-as-second only got 1 DON on turn 2 (should be 2)
//
// `GameState.firstPlayer` now persists the post-CHOOSE_FIRST/SECOND decision,
// and runDrawPhase / runDonPhase / attack gating all read it instead of
// hardcoding A. This file validates the propagation for every B-first /
// A-second scenario, plus a regression test for the A-first default, and
// turn-2/3 fall-through.

import { describe, expect, it } from 'vitest';
import { applyAction } from '../applyAction';
import { initialState, RULES } from '../GameState';
import { chooseFirstPlayer, rollDice, setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
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

/** Roll both players until a winner emerges (skips ties). Uses the pure
 *  helper so we don't depend on legality gating. Returns the resolved state
 *  in `first_player_choice`. */
function rollUntilWinner(state: GameState): GameState {
  let s = state;
  let safety = 0;
  while (s.phase === 'dice_roll' && safety++ < 64) {
    if (s.diceRoll!.A === null) s = rollDice(s, 'A');
    if (s.phase === 'dice_roll' && s.diceRoll!.B === null) s = rollDice(s, 'B');
  }
  if (s.phase !== 'first_player_choice') throw new Error('failed to resolve dice roll');
  return s;
}

/** Drive setupGame → roll → CHOOSE_FIRST/SECOND → both KEEP_HAND so the
 *  engine lands in 'refresh' with `state.firstPlayer === requested`. */
function setupWithFirstPlayer(requested: PlayerId, seed = 42): GameState {
  let s = rollUntilWinner(setupGame(build(seed)));
  const winner = s.activePlayer;
  if (winner === requested) {
    s = chooseFirstPlayer(s, winner, winner);
  } else {
    s = chooseFirstPlayer(s, winner, requested);
  }
  // Close mulligan window: first player (now activePlayer) decides first.
  const first = s.activePlayer;
  const second: PlayerId = first === 'A' ? 'B' : 'A';
  s = applyAction(s, first, { type: 'KEEP_HAND' }).state;
  s = applyAction(s, second, { type: 'KEEP_HAND' }).state;
  expect(s.phase).toBe('refresh');
  expect(s.firstPlayer).toBe(requested);
  expect(s.activePlayer).toBe(requested);
  return s;
}

describe('D24: GameState.firstPlayer is null at initial state', () => {
  it('initialState produces firstPlayer === null', () => {
    const s = build();
    expect(s.firstPlayer).toBeNull();
  });

  it('setupGame leaves firstPlayer null until the choice is made', () => {
    const s = setupGame(build());
    expect(s.firstPlayer).toBeNull();
  });
});

describe('D24: CHOOSE_FIRST / CHOOSE_SECOND set firstPlayer', () => {
  it('CHOOSE_FIRST sets firstPlayer to the chooser', () => {
    // Force A as winner so we exercise both A-first and B-first cleanly.
    let s = setupGame(build(42));
    // Skip the RNG by pinning the dice result and forcing A as winner.
    s = { ...s, diceRoll: { A: 6, B: 1, rolls: 1 }, phase: 'first_player_choice', activePlayer: 'A' };
    const result = applyAction(s, 'A', { type: 'CHOOSE_FIRST' }).state;
    expect(result.firstPlayer).toBe('A');
    expect(result.activePlayer).toBe('A');
  });

  it('CHOOSE_SECOND sets firstPlayer to the OTHER player', () => {
    let s = setupGame(build(42));
    s = { ...s, diceRoll: { A: 6, B: 1, rolls: 1 }, phase: 'first_player_choice', activePlayer: 'A' };
    const result = applyAction(s, 'A', { type: 'CHOOSE_SECOND' }).state;
    expect(result.firstPlayer).toBe('B');
    expect(result.activePlayer).toBe('B');
  });

  it('B wins + CHOOSE_FIRST → firstPlayer = B', () => {
    let s = setupGame(build(42));
    s = { ...s, diceRoll: { A: 1, B: 6, rolls: 1 }, phase: 'first_player_choice', activePlayer: 'B' };
    const result = applyAction(s, 'B', { type: 'CHOOSE_FIRST' }).state;
    expect(result.firstPlayer).toBe('B');
    expect(result.activePlayer).toBe('B');
  });

  it('B wins + CHOOSE_SECOND → firstPlayer = A', () => {
    let s = setupGame(build(42));
    s = { ...s, diceRoll: { A: 1, B: 6, rolls: 1 }, phase: 'first_player_choice', activePlayer: 'B' };
    const result = applyAction(s, 'B', { type: 'CHOOSE_SECOND' }).state;
    expect(result.firstPlayer).toBe('A');
    expect(result.activePlayer).toBe('A');
  });
});

describe('D24: B-first — B skips draw + gets 1 DON on turn 1 (CR §6-3-1 + §6-4-1)', () => {
  it('B-as-first, turn 1: draw is skipped and DON deals exactly 1', () => {
    let s = setupWithFirstPlayer('B');
    expect(s.activePlayer).toBe('B');
    expect(s.turn).toBe(1);
    const handBefore = s.players.B.hand.length;

    s = runRefreshPhase(s);
    expect(s.phase).toBe('draw');

    s = runDrawPhase(s);
    // CR §6-3-1: first player skips draw on turn 1 — hand size unchanged.
    expect(s.players.B.hand).toHaveLength(handBefore);
    expect(s.phase).toBe('don');

    s = runDonPhase(s);
    // CR §6-4-1: first player gets 1 DON on turn 1.
    expect(s.players.B.donCostArea).toHaveLength(RULES.DON_PER_TURN_FIRST);
    expect(s.players.B.donCostArea).toHaveLength(1);
    expect(s.phase).toBe('main');
  });
});

describe('D24: A-as-second — A draws + gets 2 DON on turn 2 (CR §6-3-2 + §6-4-2)', () => {
  it('A-as-second, turn 2: standard draw + 2 DON', () => {
    let s = setupWithFirstPlayer('B');
    // B's full turn 1.
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s = endTurn(s);
    expect(s.activePlayer).toBe('A');
    expect(s.turn).toBe(2);
    const handBefore = s.players.A.hand.length;

    s = runRefreshPhase(s);
    s = runDrawPhase(s);
    // A is second player → normal draw on turn 2.
    expect(s.players.A.hand).toHaveLength(handBefore + 1);

    s = runDonPhase(s);
    expect(s.players.A.donCostArea).toHaveLength(RULES.DON_PER_TURN_AFTER_FIRST);
    expect(s.players.A.donCostArea).toHaveLength(2);
  });
});

describe('D24: A-first regression (default path) — A skips draw + 1 DON', () => {
  it('A-as-first, turn 1: draw skipped, 1 DON, attack blocked', () => {
    let s = setupWithFirstPlayer('A');
    expect(s.activePlayer).toBe('A');
    expect(s.turn).toBe(1);
    const handBefore = s.players.A.hand.length;

    s = runRefreshPhase(s);
    s = runDrawPhase(s);
    expect(s.players.A.hand).toHaveLength(handBefore); // no draw
    s = runDonPhase(s);
    expect(s.players.A.donCostArea).toHaveLength(1);

    // Attack must be blocked on first player's turn 1.
    const actions = getLegalActions(s, 'A');
    expect(actions.find((a) => a.type === 'DECLARE_ATTACK')).toBeUndefined();
  });
});

describe('D24: turn 2 — second player gets full draw + 2 DON', () => {
  it('A-first → B on turn 2: full draw + 2 DON', () => {
    let s = setupWithFirstPlayer('A');
    s = endTurn(runDonPhase(runDrawPhase(runRefreshPhase(s))));
    expect(s.activePlayer).toBe('B');
    expect(s.turn).toBe(2);
    const handBefore = s.players.B.hand.length;

    s = runRefreshPhase(s);
    s = runDrawPhase(s);
    expect(s.players.B.hand).toHaveLength(handBefore + 1);
    s = runDonPhase(s);
    expect(s.players.B.donCostArea).toHaveLength(2);
  });
});

describe('D24: turn 3+ — both players get full draw + 2 DON regardless of firstPlayer', () => {
  it('B-first, turn 3 (B again): draws + 2 DON', () => {
    let s = setupWithFirstPlayer('B');
    // B turn 1
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s = endTurn(s);
    // A turn 2
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s = endTurn(s);
    // B turn 3
    expect(s.activePlayer).toBe('B');
    expect(s.turn).toBe(3);
    const handBefore = s.players.B.hand.length;
    const donBefore = s.players.B.donCostArea.length;

    s = runRefreshPhase(s);
    s = runDrawPhase(s);
    expect(s.players.B.hand).toHaveLength(handBefore + 1);
    s = runDonPhase(s);
    // 2 fresh DON added on top of whatever was active heading in.
    expect(s.players.B.donCostArea.length).toBe(donBefore + 2);
  });

  it('A-first, turn 3 (A again): draws + 2 DON', () => {
    let s = setupWithFirstPlayer('A');
    s = endTurn(runDonPhase(runDrawPhase(runRefreshPhase(s))));
    s = endTurn(runDonPhase(runDrawPhase(runRefreshPhase(s))));
    expect(s.activePlayer).toBe('A');
    expect(s.turn).toBe(3);
    const handBefore = s.players.A.hand.length;
    const donBefore = s.players.A.donCostArea.length;

    s = runRefreshPhase(s);
    s = runDrawPhase(s);
    expect(s.players.A.hand).toHaveLength(handBefore + 1);
    s = runDonPhase(s);
    expect(s.players.A.donCostArea.length).toBe(donBefore + 2);
  });
});

describe('D24: attack gating follows firstPlayer (CR §6-5-6-1)', () => {
  it('B-first, turn 1: B cannot attack', () => {
    let s = setupWithFirstPlayer('B');
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    expect(s.activePlayer).toBe('B');
    expect(s.turn).toBe(1);
    const actions = getLegalActions(s, 'B');
    expect(actions.find((a) => a.type === 'DECLARE_ATTACK')).toBeUndefined();
  });

  it('B-first, turn 2: A (the second player) also cannot attack', () => {
    let s = setupWithFirstPlayer('B');
    s = endTurn(runDonPhase(runDrawPhase(runRefreshPhase(s))));
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    expect(s.activePlayer).toBe('A');
    expect(s.turn).toBe(2);
    const actions = getLegalActions(s, 'A');
    expect(actions.find((a) => a.type === 'DECLARE_ATTACK')).toBeUndefined();
  });
});

// Phase G / D15: at-start-of-game effects (CR §5-2-1-5-1).
describe('D15: at-start-of-game effects', () => {
  function makeDrawLeader(id: string): LeaderCard {
    return {
      id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
      life: 5, counterValue: null, traits: [], keywords: [], effectTags: ['draw'],
    };
  }
  function buildWithLeader(leaderA: LeaderCard, leaderB: LeaderCard, seed = 42): GameState {
    const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
    return initialState({
      seed,
      decks: { A: { leader: leaderA, cards }, B: { leader: leaderB, cards } },
    });
  }

  // Post-2026-06-01: V1 tag-based at_start_of_game fallback is REMOVED.
  // Cards with `effectTags: ['draw' | 'ramp' | 'searcher' | 'lifegain']` no
  // longer ghost-fire game-start effects. V2 cardEffectSpecs (`effectSpecV2`)
  // are now the sole authority. These tests pin the new contract.

  it('leader with [draw] effectTag does NOT draw extra at game start (V1 fallback removed)', () => {
    let s = setupGame(buildWithLeader(makeDrawLeader('LA_DRAW'), makeLeader('LB')));
    s = rollUntilWinner(s);
    const winner = s.activePlayer;
    if (winner === 'A') {
      s = chooseFirstPlayer(s, 'A', 'A');
    } else {
      s = chooseFirstPlayer(s, 'B', 'B');
    }
    // Without a V2 spec authorizing it, the [draw] tag alone must NOT fire.
    expect(s.players.A.hand).toHaveLength(RULES.STARTING_HAND);
    expect(s.players.B.hand).toHaveLength(RULES.STARTING_HAND);
  });

  it('non-trigger leader: no extra cards at game start', () => {
    let s = setupGame(buildWithLeader(makeLeader('LA'), makeLeader('LB')));
    s = rollUntilWinner(s);
    s = chooseFirstPlayer(s, s.activePlayer, s.activePlayer);
    expect(s.players.A.hand).toHaveLength(RULES.STARTING_HAND);
    expect(s.players.B.hand).toHaveLength(RULES.STARTING_HAND);
  });

  it('both leaders with [draw] effectTag: no V1 ghost-fire either side', () => {
    let s = setupGame(buildWithLeader(makeDrawLeader('LA'), makeDrawLeader('LB')));
    s = rollUntilWinner(s);
    const winner = s.activePlayer;
    s = chooseFirstPlayer(s, winner, winner);
    // V1 fallback removed: neither leader draws via the tag-only path.
    expect(s.players.A.hand).toHaveLength(RULES.STARTING_HAND);
    expect(s.players.B.hand).toHaveLength(RULES.STARTING_HAND);
  });
});
