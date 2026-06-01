// EB01-046 Brook (black/Straw Hat).
//   "[On Play]/[When Attacking] Give up to 1 of your opponent's
//    Characters −1 cost during this turn. Then, K.O. up to 1 of your
//    opponent's Characters with a cost of 0."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_046 = ALL_CARDS.find(c => c.id === 'EB01-046')!;

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

function placeOppChar(s: any, id: string, cost: number) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['black'],
    cost, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'B',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.B.field.push(s.instances[id]);
}

describe('EB01-046 — Brook (black Straw Hat)', () => {
  const clauses = EB01_046.effectSpecV2!.clauses!;

  it('clause 0: -1 cost to targeted opp char', () => {
    const s = boot();
    placeOppChar(s, 'c1', 2);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clauses[0].action, ['c1']);
    expect(s.instances['c1'].costModifier).toBe(-1);
  });

  it('clause 1: KO targets cost-0 opp char (effective cost)', () => {
    const s = boot();
    placeOppChar(s, 'c0', 0);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clauses[1].action, ['c0']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'c0')).toBe(false);
  });

  it('combined: cost-1 reduced to 0, then KO targets it', () => {
    const s = boot();
    placeOppChar(s, 'c1', 1);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clauses[0].action, ['c1']);
    // Now effective cost = 0; KO clause should target it.
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clauses[1].action, ['c1']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'c1')).toBe(false);
  });

  it('cost reduction expires at endTurn', () => {
    const s = boot();
    placeOppChar(s, 'c1', 2);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clauses[0].action, ['c1']);
    expect(endTurn(s).instances['c1'].costModifier).toBeUndefined();
  });
});
