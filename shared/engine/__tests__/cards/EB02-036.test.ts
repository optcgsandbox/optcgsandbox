// EB02-036 Nico Robin (purple).
//   "[Blocker]
//    [On K.O.] DON!! −1: Look at 3 cards from the top of your deck;
//    reveal up to 1 {Straw Hat Crew} type card and add it to your
//    hand. Then, place the rest at the bottom of your deck in any
//    order."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { canPayClauseCost, payClauseCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_036 = ALL_CARDS.find(c => c.id === 'EB02-036')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['purple'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['purple'],
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

function placeRobin(s: any) {
  const c: CharacterCard = {
    id: 'RB', name: 'Nico Robin', kind: 'character', colors: ['purple'],
    cost: 3, power: 2000, counterValue: 1000,
    traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['rb'] = {
    instanceId: 'rb', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['rb']);
}

describe('EB02-036 — Nico Robin (purple)', () => {
  const clause = EB02_036.effectSpecV2!.clauses![0];

  it('continuous grants blocker', () => {
    const s = boot();
    placeRobin(s);
    applyContinuousEffectsV2ToInstance(s, 'rb', EB02_036.effectSpecV2!.continuous!);
    expect(s.instances['rb'].grantedKeywords).toContain('blocker');
  });

  it('cost donCostReturnToDeck 1', () => {
    const s = boot();
    placeRobin(s);
    const cBefore = s.players.A.donCostArea.length;
    const dBefore = s.players.A.donDeck.length;
    expect(canPayClauseCost(s, 'A', 'rb', clause.cost!)).toBe(true);
    payClauseCost(s, 'A', 'rb', clause.cost!);
    expect(s.players.A.donCostArea.length).toBe(cBefore - 1);
    expect(s.players.A.donDeck.length).toBe(dBefore + 1);
  });

  it('action: pulls a Straw Hat card from top 3', () => {
    const s = boot();
    const shc: CharacterCard = {
      id: 'SH', name: 'SH', kind: 'character', colors: ['purple'],
      cost: 3, power: 4000, counterValue: 1000, traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
    };
    s.cardLibrary[shc.id] = shc;
    s.instances['sh'] = {
      instanceId: 'sh', cardId: shc.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.deck.unshift('sh');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain('sh');
  });
});
