import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../cards/effects/templates';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn } from '../phases/turn';
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

  it('all templates exist and are functions', () => {
    const expected = ['searcher', 'draw', 'removal_ko', 'removal_bounce', 'removal_cost_reduce',
      'blocker', 'rush', 'double_attack', 'counter_event', 'counter_character',
      'power_buff', 'set_power_zero', 'cost_reduction', 'recursion', 'ramp', 'lifegain',
      'life_to_hand', 'disruption', 'vanilla'];
    expect(Object.keys(TEMPLATES).sort()).toEqual(expected.sort());
    for (const k of expected) {
      expect(typeof (TEMPLATES as Record<string, unknown>)[k]).toBe('function');
    }
  });

  // D16 (CR §4-12): Set Power to 0
  it('set_power_zero on a positive-power target sets effectivePower delta to -current', () => {
    const s = build();
    // Plant a 3000-power character on B's field for A to target.
    const targetCardId = 'TGT';
    const targetInstanceId = 'tgt-inst';
    s.cardLibrary[targetCardId] = {
      id: targetCardId, name: targetCardId, kind: 'character', colors: ['red'],
      cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
    };
    s.instances[targetInstanceId] = {
      instanceId: targetInstanceId, cardId: targetCardId, controller: 'B',
      rested: false, attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] },
      summoningSick: false,
    };
    s.players.B.field.push(s.instances[targetInstanceId]);

    const s2 = TEMPLATES.set_power_zero(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
      targetInstanceId,
    });
    // Modifier set to -3000 so effectivePower (3000 + 0 + (-3000)) = 0.
    expect(s2.instances[targetInstanceId].powerModifier).toBe(-3000);
    // Per-zone mirror.
    expect(s2.players.B.field[0].powerModifier).toBe(-3000);
  });

  it('endTurn clears powerModifier on both players (turn-scoped per CR §4-12)', () => {
    const s = build();
    // Plant a target with a powerModifier set.
    const targetCardId = 'TGTE';
    const targetInstanceId = 'tgt-inst-e';
    s.cardLibrary[targetCardId] = {
      id: targetCardId, name: targetCardId, kind: 'character', colors: ['red'],
      cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
    };
    s.instances[targetInstanceId] = {
      instanceId: targetInstanceId, cardId: targetCardId, controller: 'B',
      rested: false, attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] },
      summoningSick: false, powerModifier: -3000,
    };
    s.players.B.field.push(s.instances[targetInstanceId]);

    const after = endTurn(s);
    expect(after.instances[targetInstanceId].powerModifier).toBeUndefined();
    expect(after.players.B.field[0].powerModifier).toBeUndefined();
  });

  it('set_power_zero on a target with 0 or negative power is a no-op', () => {
    const s = build();
    const targetCardId = 'TGT0';
    const targetInstanceId = 'tgt-inst-0';
    s.cardLibrary[targetCardId] = {
      id: targetCardId, name: targetCardId, kind: 'character', colors: ['red'],
      cost: 2, power: 0, counterValue: 0, traits: [], keywords: [], effectTags: ['vanilla'],
    };
    s.instances[targetInstanceId] = {
      instanceId: targetInstanceId, cardId: targetCardId, controller: 'B',
      rested: false, attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] },
      summoningSick: false,
    };
    s.players.B.field.push(s.instances[targetInstanceId]);

    const s2 = TEMPLATES.set_power_zero(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
      targetInstanceId,
    });
    // No-op per spec: already-non-positive → no change.
    expect(s2.instances[targetInstanceId].powerModifier).toBeUndefined();
  });
});
