// EB01-006 Tony Tony.Chopper.
//   "[Blocker] (...)
//    [DON!! x2] [When Attacking] Give up to 1 of your opponent's
//    Characters −3000 power during this turn."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_006 = ALL_CARDS.find(c => c.id === 'EB01-006')!;

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

function placeChopper(s: any, attachedDon: number) {
  const chop: CharacterCard = {
    id: 'CH', name: 'Chopper', kind: 'character', colors: ['red'],
    cost: 3, power: 4000, counterValue: 1000,
    traits: ['Animal', 'Straw Hat Crew'], keywords: [], effectTags: [],
  };
  s.cardLibrary[chop.id] = chop;
  s.instances['ch1'] = {
    instanceId: 'ch1', cardId: chop.id, controller: 'A',
    rested: false,
    attachedDon: s.players.A.donCostArea.splice(0, attachedDon),
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['ch1']);
}

function placeOppChar(s: any, id: string) {
  const c: CharacterCard = {
    id: 'OC', name: 'OC', kind: 'character', colors: ['red'],
    cost: 3, power: 4000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'B',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.B.field.push(s.instances[id]);
}

describe('EB01-006 — Tony Tony.Chopper', () => {
  const clause = EB01_006.effectSpecV2!.clauses![0];

  it('continuous grants "blocker" keyword to self', () => {
    const s = boot();
    placeChopper(s, 0);
    applyContinuousEffectsV2ToInstance(s, 'ch1', EB01_006.effectSpecV2!.continuous!);
    expect(s.instances['ch1'].grantedKeywords).toContain('blocker');
  });

  it('[DON!! x2] gate FALSE when 0 DON attached to Chopper', () => {
    const s = boot();
    placeChopper(s, 0);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'ch1')).toBe(false);
  });

  it('[DON!! x2] gate FALSE when only 1 DON attached', () => {
    const s = boot();
    placeChopper(s, 1);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'ch1')).toBe(false);
  });

  it('[DON!! x2] gate TRUE when 2 DON attached', () => {
    const s = boot();
    placeChopper(s, 2);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'ch1')).toBe(true);
  });

  it('[DON!! x2] gate is NOT satisfied by 2 unattached DON in cost area', () => {
    // Regression for the old `if_don_min` spec — cost area DON should NOT
    // satisfy a DON!! x cost on a character.
    const s = boot();
    placeChopper(s, 0);
    // confirm cost area has DON
    expect(s.players.A.donCostArea.length).toBeGreaterThanOrEqual(2);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'ch1')).toBe(false);
  });

  it('action applies -3000 powerModifier to opp char this turn', () => {
    const s = boot();
    placeChopper(s, 2);
    placeOppChar(s, 'oc1');
    applyActionV2(s, { sourceInstanceId: 'ch1', controller: 'A' }, clause.action, ['oc1']);
    expect(s.instances['oc1'].powerModifier).toBe(-3000);
    expect(endTurn(s).instances['oc1'].powerModifier).toBeUndefined();
  });
});
