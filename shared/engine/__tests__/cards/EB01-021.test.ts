// EB01-021 Hannyabal (leader).
//   "[End of Your Turn] You may return 1 of your {Impel Down} type
//    Characters with a cost of 2 or more to the owner's hand: Add up to
//    1 DON!! card from your DON!! deck and set it as active."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { canPayClauseCost, payClauseCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_021 = ALL_CARDS.find(c => c.id === 'EB01-021')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['blue'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: ['Impel Down'], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['blue'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
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

function placeImpelChar(s: any, id: string, cost: number) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['blue'],
    cost, power: 3000, counterValue: 1000, traits: ['Impel Down'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances[id]);
}

describe('EB01-021 — Hannyabal (leader)', () => {
  const clause = EB01_021.effectSpecV2!.clauses![0];

  it('cost payable: cost-2 Impel Down char on field', () => {
    const s = boot();
    placeImpelChar(s, 'ic2', 2);
    expect(canPayClauseCost(s, 'A', s.players.A.leader.instanceId, clause.cost!)).toBe(true);
  });

  it('cost NOT payable: only cost-1 Impel Down (below min)', () => {
    const s = boot();
    placeImpelChar(s, 'ic1', 1);
    expect(canPayClauseCost(s, 'A', s.players.A.leader.instanceId, clause.cost!)).toBe(false);
  });

  it('cost NOT payable: non-Impel-Down trait on cost-2', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'OT', name: 'Other', kind: 'character', colors: ['blue'],
      cost: 2, power: 3000, counterValue: 1000, traits: ['Other'], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['ot'] = {
      instanceId: 'ot', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['ot']);
    expect(canPayClauseCost(s, 'A', s.players.A.leader.instanceId, clause.cost!)).toBe(false);
  });

  it('paying cost moves Impel Down char from field to hand', () => {
    const s = boot();
    placeImpelChar(s, 'ic2', 2);
    payClauseCost(s, 'A', s.players.A.leader.instanceId, clause.cost!);
    expect(s.players.A.field.find((i: { instanceId: string }) => i.instanceId === 'ic2')).toBeUndefined();
    expect(s.players.A.hand).toContain('ic2');
  });

  it('action: ramp 1 (active) moves 1 from DON deck to cost area', () => {
    const s = boot();
    const costBefore = s.players.A.donCostArea.length;
    const deckBefore = s.players.A.donDeck.length;
    applyActionV2(s, { sourceInstanceId: s.players.A.leader.instanceId, controller: 'A' }, clause.action, []);
    expect(s.players.A.donCostArea.length).toBe(costBefore + 1);
    expect(s.players.A.donDeck.length).toBe(deckBefore - 1);
  });
});
