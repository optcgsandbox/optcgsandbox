import { describe, expect, it } from 'vitest';
import { initialState, RULES } from '../GameState';
import { mulligan, setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import { getLegalActions } from '../rules/legality';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';

function makeLeader(id: string): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}

function makeChar(id: string, cost = 2, power = 3000): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost, power,
    counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  };
}

function build() {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  return initialState({
    seed: 42,
    decks: {
      A: { leader: makeLeader('LA'), cards },
      B: { leader: makeLeader('LB'), cards },
    },
  });
}

describe('setupGame', () => {
  it('places life cards and opening hand', () => {
    const s = setupGame(build());
    expect(s.players.A.life).toHaveLength(RULES.LIFE_DEFAULT);
    expect(s.players.A.hand).toHaveLength(RULES.STARTING_HAND);
    expect(s.players.A.deck).toHaveLength(50 - RULES.LIFE_DEFAULT - RULES.STARTING_HAND);
    expect(s.players.B.life).toHaveLength(RULES.LIFE_DEFAULT);
    expect(s.history).toContainEqual({ type: 'GAME_STARTED', firstPlayer: 'A' });
  });

  it('is deterministic per seed', () => {
    const a = setupGame(build());
    const b = setupGame(build());
    expect(a.players.A.hand).toEqual(b.players.A.hand);
    expect(a.players.B.hand).toEqual(b.players.B.hand);
  });
});

describe('mulligan', () => {
  it('returns hand to deck and redraws full hand', () => {
    const s = setupGame(build());
    const before = s.players.A.hand;
    const after = mulligan(s, 'A');
    expect(after.players.A.hand).toHaveLength(RULES.STARTING_HAND);
    expect(after.players.A.hand).not.toEqual(before);
    expect(after.players.A.deck.length + after.players.A.hand.length).toBe(
      before.length + s.players.A.deck.length
    );
  });
});

describe('turn phases', () => {
  it('refresh → draw → don → main, first player skips draw on turn 1', () => {
    let s = setupGame(build());
    expect(s.activePlayer).toBe('A');
    expect(s.turn).toBe(1);
    expect(s.phase).toBe('refresh');
    const handSize = s.players.A.hand.length;

    s = runRefreshPhase(s);
    expect(s.phase).toBe('draw');
    s = runDrawPhase(s);
    expect(s.players.A.hand).toHaveLength(handSize); // No draw — first player turn 1.
    expect(s.phase).toBe('don');

    s = runDonPhase(s);
    expect(s.players.A.donActive).toBe(RULES.DON_PER_TURN_FIRST);
    expect(s.phase).toBe('main');
  });

  it('player B turn 1: draws + gets 2 DON', () => {
    let s = setupGame(build());
    s = endTurn(runDonPhase(runDrawPhase(runRefreshPhase(s))));
    expect(s.activePlayer).toBe('B');
    expect(s.turn).toBe(2);
    const handSize = s.players.B.hand.length;

    s = runRefreshPhase(s);
    s = runDrawPhase(s);
    expect(s.players.B.hand).toHaveLength(handSize + 1);

    s = runDonPhase(s);
    expect(s.players.B.donActive).toBe(RULES.DON_PER_TURN_AFTER_FIRST);
  });

  it('deck-out triggers game end', () => {
    let s = setupGame(build());
    s = endTurn(runDonPhase(runDrawPhase(runRefreshPhase(s))));
    // Force B's deck empty before draw phase.
    s.players.B.deck = [];
    s = runRefreshPhase(s);
    s = runDrawPhase(s);
    expect(s.result?.reason).toBe('deck_out');
    expect(s.result?.winner).toBe('A');
  });
});

describe('getLegalActions', () => {
  it('inactive player has no main-phase actions', () => {
    const s = setupGame(build());
    expect(getLegalActions(s, 'B')).toEqual([]);
  });

  it('active player on main phase can END_TURN and RESIGN', () => {
    let s = setupGame(build());
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    const actions = getLegalActions(s, 'A');
    expect(actions).toContainEqual({ type: 'END_TURN' });
    expect(actions).toContainEqual({ type: 'RESIGN' });
  });

  it('cannot attack on first player turn 1', () => {
    let s = setupGame(build());
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    const actions = getLegalActions(s, 'A');
    expect(actions.find((a) => a.type === 'DECLARE_ATTACK')).toBeUndefined();
  });
});
