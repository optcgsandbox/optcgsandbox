// EB02-025 Donquixote Rosinante.
//   "[Activate: Main] You may rest 1 of your DON!! cards and this
//    Character: If your Leader is [Donquixote Rosinante], look at 5
//    cards from the top of your deck; play up to 1 Character card with
//    a cost of 2 or less rested. Then, place the rest at the bottom of
//    your deck in any order."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { canPayClauseCost, payClauseCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_025 = ALL_CARDS.find(c => c.id === 'EB02-025')!;

function boot(name: string) {
  const lead: LeaderCard = {
    id: 'LA', name, kind: 'leader', colors: ['blue'], cost: null,
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

function placeRos(s: any) {
  const c: CharacterCard = {
    id: 'ROS', name: 'Donquixote Rosinante', kind: 'character', colors: ['blue'],
    cost: 2, power: 3000, counterValue: 1000,
    traits: ['Navy', 'Donquixote Pirates'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['ros'] = {
    instanceId: 'ros', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['ros']);
}

describe('EB02-025 — Donquixote Rosinante', () => {
  const clause = EB02_025.effectSpecV2!.clauses![0];

  it('condition TRUE: leader named Donquixote Rosinante', () => {
    const s = boot('Donquixote Rosinante');
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('condition FALSE: other leader name', () => {
    const s = boot('Other');
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(false);
  });

  it('cost: restSelf + donCost 1 payable', () => {
    const s = boot('Donquixote Rosinante');
    placeRos(s);
    expect(canPayClauseCost(s, 'A', 'ros', clause.cost!)).toBe(true);
  });

  it('cost: rests this char AND moves 1 DON to rested', () => {
    const s = boot('Donquixote Rosinante');
    placeRos(s);
    const cBefore = s.players.A.donCostArea.length;
    const rBefore = s.players.A.donRested.length;
    payClauseCost(s, 'A', 'ros', clause.cost!);
    expect(s.instances['ros'].rested).toBe(true);
    expect(s.players.A.donCostArea.length).toBe(cBefore - 1);
    expect(s.players.A.donRested.length).toBe(rBefore + 1);
  });

  it('action: peek 5, play cost-2 char rested onto field', () => {
    const s = boot('Donquixote Rosinante');
    const candidate: CharacterCard = {
      id: 'CAND', name: 'C', kind: 'character', colors: ['blue'],
      cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[candidate.id] = candidate;
    s.instances['cand'] = {
      instanceId: 'cand', cardId: candidate.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.deck.unshift('cand');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'cand')).toBe(true);
    expect(s.instances['cand'].rested).toBe(true);
  });
});
