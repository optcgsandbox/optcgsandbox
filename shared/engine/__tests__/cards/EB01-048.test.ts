// EB01-048 Laboon (4-cost).
//   "[Activate: Main] You may rest this Character: Give up to 1 of your
//    opponent's Characters −4 cost during this turn."
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
const EB01_048 = ALL_CARDS.find(c => c.id === 'EB01-048')!;

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

function placeLaboon(s: any) {
  const c: CharacterCard = {
    id: 'LAB', name: 'Laboon', kind: 'character', colors: ['black'],
    cost: 4, power: 5000, counterValue: 1000, traits: ['Animal'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['lb'] = {
    instanceId: 'lb', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['lb']);
}

function placeOppChar(s: any, id: string, cost: number) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['black'],
    cost, power: 4000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'B',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.B.field.push(s.instances[id]);
}

describe('EB01-048 — Laboon (4-cost)', () => {
  const clause = EB01_048.effectSpecV2!.clauses![0];

  it('cost restSelf payable when active', () => {
    const s = boot();
    placeLaboon(s);
    expect(canPayClauseCost(s, 'A', 'lb', clause.cost!)).toBe(true);
  });

  it('paying cost rests Laboon', () => {
    const s = boot();
    placeLaboon(s);
    payClauseCost(s, 'A', 'lb', clause.cost!);
    expect(s.instances['lb'].rested).toBe(true);
  });

  it('action: -4 cost to opp char this_turn; clears at endTurn', () => {
    const s = boot();
    placeLaboon(s);
    placeOppChar(s, 'c5', 5);
    applyActionV2(s, { sourceInstanceId: 'lb', controller: 'A' }, clause.action, ['c5']);
    expect(s.instances['c5'].costModifier).toBe(-4);
    expect(endTurn(s).instances['c5'].costModifier).toBeUndefined();
  });
});
