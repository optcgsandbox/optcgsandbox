// EB01-042 Scarlet.
//   "[Activate: Main] You may trash this Character: Play up to 1
//    {Dressrosa} type Character card with a cost of 3 or less other
//    than [Scarlet] from your hand rested. Then, give up to 1 of your
//    opponent's Characters −2 cost during this turn."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_042 = ALL_CARDS.find(c => c.id === 'EB01-042')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['black'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['black'],
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

function placeScarlet(s: any) {
  const c: CharacterCard = {
    id: 'SC', name: 'Scarlet', kind: 'character', colors: ['black'],
    cost: 2, power: 0, counterValue: 1000,
    traits: ['Dressrosa'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['sc'] = {
    instanceId: 'sc', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['sc']);
}

function giveDressrosaHand(s: any, id: string, cost: number, name = 'Other') {
  const c: CharacterCard = {
    id, name, kind: 'character', colors: ['black'],
    cost, power: 3000, counterValue: 1000,
    traits: ['Dressrosa'], keywords: [], effectTags: [],
  };
  s.cardLibrary[id] = c;
  s.instances[id] = {
    instanceId: id, cardId: id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.hand.push(id);
}

function placeOppChar(s: any, id: string) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['black'],
    cost: 5, power: 6000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'B',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.B.field.push(s.instances[id]);
}

describe('EB01-042 — Scarlet', () => {
  const clause = EB01_042.effectSpecV2!.clauses![0];

  it('plays a cost-3 Dressrosa from hand rested AND opp char gets -2 cost', () => {
    const s = boot();
    placeScarlet(s);
    giveDressrosaHand(s, 'd3', 3);
    placeOppChar(s, 'opp1');
    applyActionV2(s, { sourceInstanceId: 'sc', controller: 'A' }, clause.action, ['opp1']);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'd3')).toBe(true);
    expect(s.instances['d3'].rested).toBe(true);
    expect(s.instances['opp1'].costModifier).toBe(-2);
  });

  it('costModifier clears at endTurn (this_turn)', () => {
    const s = boot();
    placeScarlet(s);
    placeOppChar(s, 'opp1');
    applyActionV2(s, { sourceInstanceId: 'sc', controller: 'A' }, clause.action, ['opp1']);
    expect(endTurn(s).instances['opp1'].costModifier).toBeUndefined();
  });

  it('rejects another Scarlet from hand (nameExcludes)', () => {
    const s = boot();
    placeScarlet(s);
    giveDressrosaHand(s, 'sc2', 2, 'Scarlet');
    applyActionV2(s, { sourceInstanceId: 'sc', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain('sc2');
  });
});
