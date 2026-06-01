// EB01-029 "Sorry. I'm a Goner."
//   "[Counter] Reveal 1 card from the top of your deck. If the revealed
//    card has a cost of 4 or more, return up to 1 of your Characters to
//    the owner's hand. Then, place the revealed card at the bottom of
//    your deck."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_029 = ALL_CARDS.find(c => c.id === 'EB01-029')!;

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

function placeTopOfDeck(s: any, cardId: string, cost: number, instId: string) {
  const c: CharacterCard = {
    id: cardId, name: cardId, kind: 'character', colors: ['blue'],
    cost, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[instId] = {
    instanceId: instId, cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.deck.unshift(instId);
}

function placeOwnChar(s: any, id: string) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['blue'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances[id]);
}

describe('EB01-029 — Sorry. I\'m a Goner.', () => {
  const clause = EB01_029.effectSpecV2!.clauses![0];

  it('cost-4 top: bounces own char + sends revealed to bottom of deck', () => {
    const s = boot();
    placeOwnChar(s, 'ch1');
    placeTopOfDeck(s, 'TOP4', 4, 't4');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['ch1']);
    // Bounce happened
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'ch1')).toBe(false);
    expect(s.players.A.hand).toContain('ch1');
    // Top card is at bottom
    expect(s.players.A.deck[s.players.A.deck.length - 1]).toBe('t4');
  });

  it('cost-3 top: NO bounce; revealed still placed at bottom', () => {
    const s = boot();
    placeOwnChar(s, 'ch1');
    placeTopOfDeck(s, 'TOP3', 3, 't3');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['ch1']);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'ch1')).toBe(true);
    expect(s.players.A.deck[s.players.A.deck.length - 1]).toBe('t3');
  });

  it('cost-10 top: bounces (>= 4 threshold)', () => {
    const s = boot();
    placeOwnChar(s, 'ch1');
    placeTopOfDeck(s, 'TOP10', 10, 't10');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['ch1']);
    expect(s.players.A.hand).toContain('ch1');
  });
});
