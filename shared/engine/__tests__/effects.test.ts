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
    const beforeCost = s.players.A.donCostArea.length;
    const beforeDeck = s.players.A.donDeck.length;
    const s2 = TEMPLATES.ramp(s, { sourceInstanceId: 'X', controller: 'A', trigger: 'on_play' });
    expect(s2.players.A.donCostArea.length).toBe(beforeCost + 1);
    expect(s2.players.A.donDeck.length).toBe(beforeDeck - 1);
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
      'life_to_hand', 'disruption', 'vanilla',
      // V3-5:
      'rest_opp_don', 'mill', 'reveal_opp_hand', 'take_from_opp_hand', 'search_deck',
      'exile', 'play_for_free', 'rest_target', 'move_to_top'];
    expect(Object.keys(TEMPLATES).sort()).toEqual(expected.sort());
    for (const k of expected) {
      expect(typeof (TEMPLATES as Record<string, unknown>)[k]).toBe('function');
    }
  });

  // V3-5: new effect tags.
  it('rest_opp_don moves N from opp donCostArea to opp donRested', () => {
    const s = build();
    // Seed opp active DON.
    s.players.B.donCostArea = ['d1', 'd2', 'd3'];
    s.players.B.donRested = [];
    const s2 = TEMPLATES.rest_opp_don(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play', param: 2,
    });
    expect(s2.players.B.donCostArea).toEqual(['d3']);
    expect(s2.players.B.donRested).toEqual(['d1', 'd2']);
  });

  it('mill moves top N of controller deck to trash', () => {
    const s = build();
    const beforeDeck = s.players.A.deck.length;
    const beforeTrash = s.players.A.trash.length;
    const s2 = TEMPLATES.mill(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play', param: 3,
    });
    expect(s2.players.A.deck.length).toBe(beforeDeck - 3);
    expect(s2.players.A.trash.length).toBe(beforeTrash + 3);
  });

  it('take_from_opp_hand moves first opp hand card to controller hand', () => {
    const s = build();
    s.players.B.hand = ['opp1', 'opp2'];
    s.players.A.hand = ['me1'];
    const s2 = TEMPLATES.take_from_opp_hand(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
    });
    expect(s2.players.B.hand).toEqual(['opp2']);
    expect(s2.players.A.hand).toEqual(['me1', 'opp1']);
  });

  it('exile sends a field instance to controller exile, returning DON to rested', () => {
    const s = build();
    const tid = 'tgt-ex';
    s.instances[tid] = {
      instanceId: tid, cardId: 'C0', controller: 'B',
      rested: false, attachedDon: ['d99'], perTurn: { hasAttacked: false, effectsUsed: [] },
      summoningSick: false,
    };
    s.players.B.field.push(s.instances[tid]);
    const s2 = TEMPLATES.exile(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
      targetInstanceId: tid,
    });
    expect(s2.players.B.field.find((i) => i.instanceId === tid)).toBeUndefined();
    expect(s2.players.B.exile).toContain(tid);
    expect(s2.players.B.donRested).toContain('d99');
  });

  it('play_for_free places a hand character on field with summoningSick=true', () => {
    const s = build();
    // Grab a card from A's hand
    const handCard = s.players.A.hand[0];
    const s2 = TEMPLATES.play_for_free(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'trigger',
      targetInstanceId: handCard,
    });
    expect(s2.players.A.hand).not.toContain(handCard);
    expect(s2.players.A.field.find((i) => i.instanceId === handCard)).toBeDefined();
    expect(s2.instances[handCard].summoningSick).toBe(true);
  });

  it('rest_target sets target.rested true on both instance map and per-zone', () => {
    const s = build();
    const tid = 'tgt-rt';
    s.instances[tid] = {
      instanceId: tid, cardId: 'C0', controller: 'A',
      rested: false, attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] },
      summoningSick: false,
    };
    s.players.A.field.push(s.instances[tid]);
    const s2 = TEMPLATES.rest_target(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
      targetInstanceId: tid,
    });
    expect(s2.instances[tid].rested).toBe(true);
    expect(s2.players.A.field[0].rested).toBe(true);
  });

  it('move_to_top moves a hand card to top of controller deck', () => {
    const s = build();
    const handCard = s.players.A.hand[0];
    const s2 = TEMPLATES.move_to_top(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
      targetInstanceId: handCard,
    });
    expect(s2.players.A.hand).not.toContain(handCard);
    expect(s2.players.A.deck[0]).toBe(handCard);
  });

  it('search_deck takes the top deck card and adds to controller hand', () => {
    const s = build();
    const topBefore = s.players.A.deck[0];
    const handBefore = s.players.A.hand.length;
    const s2 = TEMPLATES.search_deck(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
    });
    expect(s2.players.A.hand.length).toBe(handBefore + 1);
    expect(s2.players.A.hand).toContain(topBefore);
  });

  it('reveal_opp_hand populates knownByViewer[controller] with every opp hand id (V3-9)', () => {
    const s = build();
    s.players.B.hand = ['opp1', 'opp2'];
    const s2 = TEMPLATES.reveal_opp_hand(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
    });
    expect(s2.knownByViewer.A).toEqual(['opp1', 'opp2']);
    // Idempotent: re-running adds no duplicates.
    const s3 = TEMPLATES.reveal_opp_hand(s2, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
    });
    expect(s3.knownByViewer.A).toEqual(['opp1', 'opp2']);
  });

  it('take_from_opp_hand records the taken card in knownByViewer[controller] (V3-9)', () => {
    const s = build();
    s.players.B.hand = ['oppX'];
    const s2 = TEMPLATES.take_from_opp_hand(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
    });
    expect(s2.knownByViewer.A).toContain('oppX');
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

  // V3-1: power_buff template.
  it('power_buff adds ctx.param to target powerModifier and mirrors onto per-zone', () => {
    const s = build();
    const tid = 'tgt-inst-b';
    s.instances[tid] = {
      instanceId: tid, cardId: 'C0', controller: 'A',
      rested: false, attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] },
      summoningSick: false,
    };
    s.players.A.field.push(s.instances[tid]);
    const s2 = TEMPLATES.power_buff(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
      targetInstanceId: tid, param: 2000,
    });
    expect(s2.instances[tid].powerModifier).toBe(2000);
    expect(s2.players.A.field[0].powerModifier).toBe(2000);
  });

  it('power_buff defaults to +1000 when ctx.param omitted', () => {
    const s = build();
    const tid = 'tgt-inst-d';
    s.instances[tid] = {
      instanceId: tid, cardId: 'C0', controller: 'A',
      rested: false, attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] },
      summoningSick: false,
    };
    s.players.A.field.push(s.instances[tid]);
    const s2 = TEMPLATES.power_buff(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play', targetInstanceId: tid,
    });
    expect(s2.instances[tid].powerModifier).toBe(1000);
  });

  // V3-2: cost_reduction + removal_cost_reduce.
  it('cost_reduction sets nextPlayCostModifier to -param and clears at endTurn', () => {
    const s = build();
    const s2 = TEMPLATES.cost_reduction(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play', param: 2,
    });
    expect(s2.players.A.nextPlayCostModifier).toBe(-2);
    const after = endTurn(s2);
    expect(after.players.A.nextPlayCostModifier).toBeUndefined();
  });

  it('cost_reduction stacks across multiple applications', () => {
    const s = build();
    const s2 = TEMPLATES.cost_reduction(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play', param: 1,
    });
    const s3 = TEMPLATES.cost_reduction(s2, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play', param: 2,
    });
    expect(s3.players.A.nextPlayCostModifier).toBe(-3);
  });

  it('removal_cost_reduce sets costModifier on target and clears at endTurn', () => {
    const s = build();
    const tid = 'tgt-inst-rc';
    s.instances[tid] = {
      instanceId: tid, cardId: 'C0', controller: 'B',
      rested: false, attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] },
      summoningSick: false,
    };
    s.players.B.field.push(s.instances[tid]);
    const s2 = TEMPLATES.removal_cost_reduce(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
      targetInstanceId: tid, param: 2,
    });
    expect(s2.instances[tid].costModifier).toBe(-2);
    expect(s2.players.B.field[0].costModifier).toBe(-2);
    const after = endTurn(s2);
    expect(after.instances[tid].costModifier).toBeUndefined();
  });

  it('power_buff stacks with existing modifier and clears at endTurn', () => {
    const s = build();
    const tid = 'tgt-inst-s';
    s.instances[tid] = {
      instanceId: tid, cardId: 'C0', controller: 'A',
      rested: false, attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] },
      summoningSick: false, powerModifier: 500,
    };
    s.players.A.field.push(s.instances[tid]);
    const s2 = TEMPLATES.power_buff(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
      targetInstanceId: tid, param: 1000,
    });
    expect(s2.instances[tid].powerModifier).toBe(1500);
    const after = endTurn(s2);
    expect(after.instances[tid].powerModifier).toBeUndefined();
  });
});
