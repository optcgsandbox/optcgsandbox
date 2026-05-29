import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../cards/effects/templates';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';

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

function build() {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  return setupGame(initialState({
    seed: 1,
    decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } },
  }));
}

describe('Effect templates', () => {
  it('searcher takes top of deck to hand', () => {
    const s = build();
    const before = s.players.A.hand.length;
    const s2 = TEMPLATES.searcher(s, { sourceInstanceId: 'X', controller: 'A', trigger: 'on_play' });
    expect(s2.players.A.hand.length).toBe(before + 1);
  });

  it('draw draws N cards', () => {
    const s = build();
    const before = s.players.A.hand.length;
    const s2 = TEMPLATES.draw(s, { sourceInstanceId: 'X', controller: 'A', trigger: 'on_play', param: 2 });
    expect(s2.players.A.hand.length).toBe(before + 2);
  });

  it('ramp adds 1 DON from the DON deck', () => {
    const s = build();
    const before = s.players.A.donCostArea.length;
    const s2 = TEMPLATES.ramp(s, { sourceInstanceId: 'X', controller: 'A', trigger: 'on_play' });
    expect(s2.players.A.donCostArea.length).toBe(before + 1);
    expect(s2.players.A.donDeck.length).toBe(s.players.A.donDeck.length - 1);
  });

  it('lifegain adds a life card from top of deck', () => {
    const s = build();
    const before = s.players.A.life.length;
    const s2 = TEMPLATES.lifegain(s, { sourceInstanceId: 'X', controller: 'A', trigger: 'on_play' });
    expect(s2.players.A.life.length).toBe(before + 1);
  });

  it('disruption removes a card from opponent hand', () => {
    const s = build();
    const before = s.players.B.hand.length;
    const s2 = TEMPLATES.disruption(s, { sourceInstanceId: 'X', controller: 'A', trigger: 'on_play' });
    expect(s2.players.B.hand.length).toBe(before - 1);
  });

  it('all 18 templates exist and are functions', () => {
    const expected = ['searcher', 'draw', 'removal_ko', 'removal_bounce', 'removal_cost_reduce',
      'blocker', 'rush', 'double_attack', 'counter_event', 'counter_character',
      'power_buff', 'cost_reduction', 'recursion', 'ramp', 'lifegain',
      'life_to_hand', 'disruption', 'vanilla'];
    expect(Object.keys(TEMPLATES).sort()).toEqual(expected.sort());
    for (const k of expected) {
      expect(typeof (TEMPLATES as Record<string, unknown>)[k]).toBe('function');
    }
  });
});
