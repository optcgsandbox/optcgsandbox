// EB02-031 Hope (event).
//   "[Main] Look at 4 cards from the top of your deck; reveal up to 1
//    card with a cost of 4 or more and add it to your hand. Then,
//    place the rest at the bottom of your deck in any order."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_031 = ALL_CARDS.find(c => c.id === 'EB02-031')!;

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

describe('EB02-031 — Hope', () => {
  it('pulls cost-4 char from top 4 to hand', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'c4', name: 'c4', kind: 'character', colors: ['blue'],
      cost: 4, power: 5000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary['c4'] = c;
    s.instances['c4'] = {
      instanceId: 'c4', cardId: 'c4', controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.deck.unshift('c4');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, EB02_031.effectSpecV2!.clauses![0].action, []);
    expect(s.players.A.hand).toContain('c4');
  });
});
