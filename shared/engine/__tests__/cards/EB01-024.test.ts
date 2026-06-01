// EB01-024 Hamlet.
//   "If you have 4 or less cards in your hand, all of your {SMILE} type
//    Characters gain +1000 power."
import { describe, expect, it } from 'vitest';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_024 = ALL_CARDS.find(c => c.id === 'EB01-024')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['blue'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['blue'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  }));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: lead, cards: filler }, B: { leader: { ...lead, id: 'LB', name: 'LB' }, cards: filler } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

function placeHamlet(s: any) {
  const ham: CharacterCard = {
    id: 'HAM', name: 'Hamlet', kind: 'character', colors: ['blue'],
    cost: 3, power: 4000, counterValue: 1000,
    traits: ['Animal Kingdom Pirates', 'SMILE'], keywords: [], effectTags: [],
  };
  s.cardLibrary[ham.id] = ham;
  s.instances['ham'] = {
    instanceId: 'ham', cardId: ham.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['ham']);
}

function placeSmileChar(s: any, id: string) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['blue'],
    cost: 2, power: 3000, counterValue: 1000, traits: ['SMILE'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances[id]);
}

describe('EB01-024 — Hamlet', () => {
  const cont = EB01_024.effectSpecV2!.continuous!;

  it('grants +1000 to other SMILE chars when hand <= 4', () => {
    const s = boot();
    placeHamlet(s);
    placeSmileChar(s, 'sm1');
    s.players.A.hand = s.players.A.hand.slice(0, 3);
    applyContinuousEffectsV2ToInstance(s, 'ham', cont);
    expect(s.instances['sm1'].powerModifier).toBe(1000);
  });

  it('also buffs Hamlet itself (SMILE includes source)', () => {
    const s = boot();
    placeHamlet(s);
    s.players.A.hand = s.players.A.hand.slice(0, 3);
    applyContinuousEffectsV2ToInstance(s, 'ham', cont);
    expect(s.instances['ham'].powerModifier).toBe(1000);
  });

  it('no buff when hand > 4', () => {
    const s = boot();
    placeHamlet(s);
    placeSmileChar(s, 'sm1');
    while (s.players.A.hand.length < 5) s.players.A.hand.push('x' + s.players.A.hand.length);
    applyContinuousEffectsV2ToInstance(s, 'ham', cont);
    expect(s.instances['sm1'].powerModifier ?? 0).toBe(0);
    expect(s.instances['ham'].powerModifier ?? 0).toBe(0);
  });

  it('does not buff non-SMILE chars', () => {
    const s = boot();
    placeHamlet(s);
    const c: CharacterCard = {
      id: 'NS', name: 'NS', kind: 'character', colors: ['blue'],
      cost: 2, power: 3000, counterValue: 1000, traits: ['Other'], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['ns'] = {
      instanceId: 'ns', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['ns']);
    s.players.A.hand = s.players.A.hand.slice(0, 3);
    applyContinuousEffectsV2ToInstance(s, 'ham', cont);
    expect(s.instances['ns'].powerModifier ?? 0).toBe(0);
  });
});
