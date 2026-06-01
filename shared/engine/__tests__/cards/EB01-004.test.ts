// EB01-004 Koza (character).
//   "[When Attacking] You may give your 1 active Leader −5000 power during
//    this turn: Give up to 1 of your opponent's Characters −3000 power
//    during this turn."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { canPayClauseCost as canPayCost, payClauseCost as payCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_004 = ALL_CARDS.find(c => c.id === 'EB01-004')!;

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

function placeOppChar(state: any, id: string) {
  const c: CharacterCard = {
    id: 'OC', name: 'OC', kind: 'character', colors: ['red'],
    cost: 3, power: 4000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  state.cardLibrary[c.id] = c;
  state.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'B',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  state.players.B.field.push(state.instances[id]);
}

describe('EB01-004 — Koza (character)', () => {
  const clause = EB01_004.effectSpecV2!.clauses![0];

  it('canPayCost true when leader is active', () => {
    const s = boot();
    expect(canPayCost(s, 'A', 'src', clause.cost!)).toBe(true);
  });

  it('canPayCost false when leader is rested', () => {
    const s = boot();
    s.players.A.leader.rested = true;
    expect(canPayCost(s, 'A', 'src', clause.cost!)).toBe(false);
  });

  it('payCost applies -5000 powerModifier to leader', () => {
    const s = boot();
    payCost(s, 'A', 'src', clause.cost!);
    expect(s.players.A.leader.powerModifier).toBe(-5000);
  });

  it('action gives target opp char -3000 powerModifier this turn', () => {
    const s = boot();
    placeOppChar(s, 'oc1');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['oc1']);
    expect(s.instances['oc1'].powerModifier).toBe(-3000);
  });

  it('both cost and action expire at endTurn (this_turn duration)', () => {
    const s = boot();
    placeOppChar(s, 'oc1');
    payCost(s, 'A', 'src', clause.cost!);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['oc1']);
    const s2 = endTurn(s);
    expect(s2.players.A.leader.powerModifier).toBeUndefined();
    expect(s2.instances['oc1'].powerModifier).toBeUndefined();
  });
});
