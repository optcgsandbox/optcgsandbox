// EB02-008 The Peak (event).
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
const EB02_008 = ALL_CARDS.find(c => c.id === 'EB02-008')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['red'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['red'],
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

function placeOnTop(s: any, id: string, cost: number, kind: 'character'|'event'|'stage' = 'character') {
  const c: any = {
    id, name: id, kind, colors: ['red'], cost,
    power: kind === 'character' ? 4000 : null,
    counterValue: kind === 'character' ? 1000 : null,
    traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[id] = c;
  s.instances[id] = {
    instanceId: id, cardId: id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.deck.unshift(id);
}

describe('EB02-008 — The Peak', () => {
  const clause = EB02_008.effectSpecV2!.clauses![0];

  it('pulls cost-4 character from top 4 to hand', () => {
    const s = boot();
    placeOnTop(s, 'c4', 4);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain('c4');
  });

  it('pulls cost-5 event from top 4', () => {
    const s = boot();
    placeOnTop(s, 'e5', 5, 'event');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain('e5');
  });

  it('does NOT pull cost-3 card (below threshold)', () => {
    const s = boot();
    placeOnTop(s, 'c3', 3);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).not.toContain('c3');
  });

  it('lookCount=4: cost-4 card at position 4 is NOT found', () => {
    const s = boot();
    const c: any = {
      id: 'c4deep', name: 'c4deep', kind: 'character', colors: ['red'],
      cost: 4, power: 4000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary['c4deep'] = c;
    s.instances['c4deep'] = {
      instanceId: 'c4deep', cardId: 'c4deep', controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.deck.splice(4, 0, 'c4deep');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).not.toContain('c4deep');
  });
});
