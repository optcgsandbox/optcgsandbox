// EB01-026 Prince Bellett.
//   "[DON!! x1] [When Attacking] If you have 1 or less cards in your
//    hand, return up to 1 Character with a cost of 3 or less to the
//    owner's hand."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2, resolveTargetV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_026 = ALL_CARDS.find(c => c.id === 'EB01-026')!;

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

function placePrince(s: any, attachedDon: number) {
  const p: CharacterCard = {
    id: 'PB', name: 'Prince Bellett', kind: 'character', colors: ['blue'],
    cost: 2, power: 2000, counterValue: 2000, traits: ['Impel Down'], keywords: [], effectTags: [],
  };
  s.cardLibrary[p.id] = p;
  s.instances['pb'] = {
    instanceId: 'pb', cardId: p.id, controller: 'A',
    rested: false,
    attachedDon: attachedDon > 0 ? s.players.A.donCostArea.splice(0, attachedDon) : [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['pb']);
}

function placeOppChar(s: any, id: string, cost: number) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['blue'],
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

describe('EB01-026 — Prince Bellett', () => {
  const clause = EB01_026.effectSpecV2!.clauses![0];

  it('condition TRUE: 1 DON attached + hand size 1', () => {
    const s = boot();
    placePrince(s, 1);
    s.players.A.hand = s.players.A.hand.slice(0, 1);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'pb')).toBe(true);
  });

  it('condition FALSE: 0 DON attached', () => {
    const s = boot();
    placePrince(s, 0);
    s.players.A.hand = [];
    expect(evaluateConditionV2(s, 'A', clause.condition, 'pb')).toBe(false);
  });

  it('condition FALSE: hand size 2', () => {
    const s = boot();
    placePrince(s, 1);
    while (s.players.A.hand.length < 2) s.players.A.hand.push('x' + s.players.A.hand.length);
    s.players.A.hand = s.players.A.hand.slice(0, 2);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'pb')).toBe(false);
  });

  it('target excludes cost-4 opp char (cap is 3)', () => {
    const s = boot();
    placePrince(s, 1);
    placeOppChar(s, 'big', 4);
    const ids = resolveTargetV2(s, 'A', 'pb', clause.target);
    expect(ids).not.toContain('big');
  });

  it('action bounces a cost-2 opp char to its owner\'s hand', () => {
    const s = boot();
    placePrince(s, 1);
    placeOppChar(s, 'small', 2);
    applyActionV2(s, { sourceInstanceId: 'pb', controller: 'A' }, clause.action, ['small']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'small')).toBe(false);
    expect(s.players.B.hand).toContain('small');
  });
});
