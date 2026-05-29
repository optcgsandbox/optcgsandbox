import { describe, expect, it } from 'vitest';
import { Random } from '../Random';
import { initialState, RULES } from '../GameState';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';

function makeLeader(id: string): LeaderCard {
  return {
    id,
    name: id,
    kind: 'leader',
    colors: ['red'],
    cost: null,
    power: 5000,
    life: 5,
    counterValue: null,
    traits: ['Straw Hat Crew'],
    keywords: [],
    effectTags: [],
  };
}

function makeChar(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['red'],
    cost: 2,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: ['vanilla'],
  };
}

describe('Random', () => {
  it('is deterministic for the same seed', () => {
    const a = new Random(42);
    const b = new Random(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('shuffle returns a permutation', () => {
    const r = new Random(7);
    const input = [1, 2, 3, 4, 5];
    const out = r.shuffle(input);
    expect(out).toHaveLength(5);
    expect(out.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('shuffle is deterministic by seed', () => {
    const a = new Random(123).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Random(123).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
  });
});

describe('initialState', () => {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));

  it('builds two players with leaders + 50-card decks', () => {
    const state = initialState({
      seed: 1,
      decks: {
        A: { leader: makeLeader('LA'), cards },
        B: { leader: makeLeader('LB'), cards },
      },
    });
    expect(state.turn).toBe(1);
    expect(state.activePlayer).toBe('A');
    expect(state.players.A.deck).toHaveLength(50);
    expect(state.players.B.deck).toHaveLength(50);
    expect(state.players.A.leader.cardId).toBe('LA');
    expect(state.players.B.leader.cardId).toBe('LB');
    expect(state.players.A.hand).toEqual([]);
    expect(state.players.A.donDeck).toBe(RULES.DON_DECK_SIZE);
    expect(state.result).toBeNull();
  });

  it('every card in a deck has a unique instanceId', () => {
    const state = initialState({
      seed: 1,
      decks: {
        A: { leader: makeLeader('LA'), cards },
        B: { leader: makeLeader('LB'), cards },
      },
    });
    const allIds = [
      ...state.players.A.deck,
      ...state.players.B.deck,
      state.players.A.leader.instanceId,
      state.players.B.leader.instanceId,
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
