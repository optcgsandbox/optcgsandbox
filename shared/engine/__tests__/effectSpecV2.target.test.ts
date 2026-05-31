import { describe, expect, it } from 'vitest';
import { resolveTargetV2 } from '../effectSpec/runner-v2';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard, CardColor } from '../cards/Card';
import { closeMulliganKeepBoth } from './_donHelpers';

function makeLeader(id: string): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}
function makeChar(id: string, opts: { cost?: number; power?: number; name?: string; traits?: string[]; colors?: CardColor[]; rested?: boolean; kind?: 'character' } = {}): CharacterCard {
  return {
    id, name: opts.name ?? id, kind: 'character',
    colors: opts.colors ?? ['red'],
    cost: opts.cost ?? 2,
    power: opts.power ?? 3000,
    counterValue: 1000,
    traits: opts.traits ?? [],
    keywords: [], effectTags: ['vanilla'],
  };
}
function placeOnField(state: any, controller: 'A' | 'B', card: CharacterCard, instanceId: string, opts: { rested?: boolean } = {}) {
  state.cardLibrary[card.id] = card;
  state.instances[instanceId] = {
    instanceId, cardId: card.id, controller,
    rested: !!opts.rested, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  state.players[controller].field.push(state.instances[instanceId]);
}

function boot() {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

describe('EffectSpec v2 — resolveTargetV2', () => {
  it('undefined target → []', () => {
    const s = boot();
    expect(resolveTargetV2(s, 'A', 'x', undefined)).toEqual([]);
  });

  it('self → source id', () => {
    const s = boot();
    s.instances['src-1'] = {
      instanceId: 'src-1', cardId: 'C0', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    expect(resolveTargetV2(s, 'A', 'src-1', { kind: 'self' })).toEqual(['src-1']);
  });

  it('your_leader / opp_leader return correct ids', () => {
    const s = boot();
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'your_leader' })).toEqual([s.players.A.leader.instanceId]);
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_leader' })).toEqual([s.players.B.leader.instanceId]);
  });

  it('your_character → first matching on own field', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('X1'), 'i1');
    placeOnField(s, 'A', makeChar('X2'), 'i2');
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'your_character' })).toEqual(['i1']);
  });

  it('opp_character → first matching on opp field', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('Y1'), 'b1');
    placeOnField(s, 'B', makeChar('Y2'), 'b2');
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_character' })).toEqual(['b1']);
  });

  it('opp_character with costMax filter narrows to ≤ cap', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('Y1', { cost: 7 }), 'b1');
    placeOnField(s, 'B', makeChar('Y2', { cost: 3 }), 'b2');
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_character', filter: { costMax: 4 } })).toEqual(['b2']);
  });

  it('filter.powerMax filters by effective power', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('Y1', { power: 6000 }), 'b1');
    placeOnField(s, 'B', makeChar('Y2', { power: 3000 }), 'b2');
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_character', filter: { powerMax: 5000 } })).toEqual(['b2']);
  });

  it('filter.trait filters by Bandai trait', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('Y1', { traits: ['Marine'] }), 'b1');
    placeOnField(s, 'B', makeChar('Y2', { traits: ['Straw Hat Crew'] }), 'b2');
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_character', filter: { trait: 'Marine' } })).toEqual(['b1']);
  });

  it('filter.typeIncludes uses substring match', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('Y1', { traits: ['Whitebeard Pirates'] }), 'b1');
    placeOnField(s, 'B', makeChar('Y2', { traits: ['East Blue'] }), 'b2');
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_character', filter: { typeIncludes: 'Whitebeard' } })).toEqual(['b1']);
  });

  it('filter.colors matches by overlap', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('Y1', { colors: ['blue'] }), 'b1');
    placeOnField(s, 'B', makeChar('Y2', { colors: ['green'] }), 'b2');
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_character', filter: { colors: ['green'] } })).toEqual(['b2']);
  });

  it('filter.nameIs + filter.nameExcludes', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('Y1', { name: 'Zoro' }), 'b1');
    placeOnField(s, 'B', makeChar('Y2', { name: 'Sanji' }), 'b2');
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_character', filter: { nameIs: 'Sanji' } })).toEqual(['b2']);
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_character', filter: { nameExcludes: 'Zoro' } })).toEqual(['b2']);
  });

  it('filter.rested narrows to rested or active', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('Y1'), 'b1', { rested: true });
    placeOnField(s, 'B', makeChar('Y2'), 'b2', { rested: false });
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_character', filter: { rested: true } })).toEqual(['b1']);
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_character', filter: { rested: false } })).toEqual(['b2']);
  });

  it('opp_hand_card → first matching opp hand instance', () => {
    const s = boot();
    s.cardLibrary['H1'] = makeChar('H1', { cost: 3 });
    s.cardLibrary['H2'] = makeChar('H2', { cost: 7 });
    s.instances['h1-i'] = {
      instanceId: 'h1-i', cardId: 'H1', controller: 'B', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.instances['h2-i'] = {
      instanceId: 'h2-i', cardId: 'H2', controller: 'B', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.B.hand = ['h1-i', 'h2-i'];
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_hand_card', filter: { costMin: 5 } })).toEqual(['h2-i']);
  });

  it('own_trash_card returns the most recent trash entry by default', () => {
    const s = boot();
    s.cardLibrary['T1'] = makeChar('T1');
    s.cardLibrary['T2'] = makeChar('T2');
    s.instances['t1-i'] = {
      instanceId: 't1-i', cardId: 'T1', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.instances['t2-i'] = {
      instanceId: 't2-i', cardId: 'T2', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.trash = ['t1-i', 't2-i'];
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'own_trash_card' })).toEqual(['t2-i']);
  });

  it('top_of_deck / top_of_opp_deck', () => {
    const s = boot();
    s.players.A.deck = ['d1', 'd2'];
    s.players.B.deck = ['e1', 'e2'];
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'top_of_deck' })).toEqual(['d1']);
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'top_of_opp_deck' })).toEqual(['e1']);
  });

  it('top_of_deck returns [] on empty deck', () => {
    const s = boot();
    s.players.A.deck = [];
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'top_of_deck' })).toEqual([]);
  });

  it('all_your_characters returns every match (mass target)', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('A1'), 'a1');
    placeOnField(s, 'A', makeChar('A2'), 'a2');
    placeOnField(s, 'A', makeChar('A3'), 'a3');
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'all_your_characters' })).toEqual(['a1', 'a2', 'a3']);
  });

  it('all_opp_characters with filter returns subset', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('B1', { cost: 2 }), 'b1');
    placeOnField(s, 'B', makeChar('B2', { cost: 5 }), 'b2');
    placeOnField(s, 'B', makeChar('B3', { cost: 1 }), 'b3');
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'all_opp_characters', filter: { costMax: 2 } })).toEqual(['b1', 'b3']);
  });

  it('own_life_top / opp_life_top return first life id', () => {
    const s = boot();
    s.players.A.life = ['la1', 'la2'];
    s.players.B.life = ['lb1'];
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'own_life_top' })).toEqual(['la1']);
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_life_top' })).toEqual(['lb1']);
  });

  it('your_character with empty field → []', () => {
    const s = boot();
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'your_character' })).toEqual([]);
  });

  it('combined filter axes (cost + trait)', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('Y1', { cost: 6, traits: ['Marine'] }), 'b1');
    placeOnField(s, 'B', makeChar('Y2', { cost: 3, traits: ['Marine'] }), 'b2');
    placeOnField(s, 'B', makeChar('Y3', { cost: 3, traits: ['Pirate'] }), 'b3');
    expect(resolveTargetV2(s, 'A', 'x', { kind: 'opp_character', filter: { costMax: 4, trait: 'Marine' } })).toEqual(['b2']);
  });
});
