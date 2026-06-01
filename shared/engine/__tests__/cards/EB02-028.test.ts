// EB02-028 Portgas.D.Ace (blue).
//   "[On Play] If your Leader's type includes 'Whitebeard Pirates',
//    look at 5 cards from the top of your deck; reveal up to 1
//    Character card with a cost of 2 and add it to your hand. Then,
//    place the rest at the bottom of your deck in any order and play
//    up to 1 Character card with a cost of 2 from your hand rested."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_028 = ALL_CARDS.find(c => c.id === 'EB02-028')!;

function boot(traits: string[]) {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['blue'], cost: null,
    power: 5000, life: 5, counterValue: null, traits, keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['blue'],
    cost: 4, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  }));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: lead, cards: filler }, B: { leader: { ...lead, id: 'LB', name: 'LB', traits: [] }, cards: filler } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

describe('EB02-028 — Portgas.D.Ace (blue)', () => {
  const [searchClause, playClause] = EB02_028.effectSpecV2!.clauses!;

  it('condition TRUE: Whitebeard Pirates leader', () => {
    const s = boot(['Whitebeard Pirates']);
    expect(evaluateConditionV2(s, 'A', searchClause.condition, 'src')).toBe(true);
  });

  it('search: pulls cost-2 character from top 5', () => {
    const s = boot(['Whitebeard Pirates']);
    const c: CharacterCard = {
      id: 'c2', name: 'c2', kind: 'character', colors: ['blue'],
      cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary['c2'] = c;
    s.instances['c2'] = {
      instanceId: 'c2', cardId: 'c2', controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.deck.unshift('c2');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, searchClause.action, []);
    expect(s.players.A.hand).toContain('c2');
  });

  it('play: cost-2 char from hand onto field, rested', () => {
    const s = boot(['Whitebeard Pirates']);
    s.players.A.hand = [];
    const c: CharacterCard = {
      id: 'h2', name: 'h2', kind: 'character', colors: ['blue'],
      cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary['h2'] = c;
    s.instances['h2'] = {
      instanceId: 'h2', cardId: 'h2', controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.hand.push('h2');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, playClause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'h2')).toBe(true);
    expect(s.instances['h2'].rested).toBe(true);
  });
});
