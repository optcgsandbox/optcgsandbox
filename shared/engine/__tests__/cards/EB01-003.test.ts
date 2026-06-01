// Per-card playability verification for EB01-003 Kid & Killer (character).
// Printed text:
//   "[Rush] (This card can attack on the turn in which it is played.)
//    [When Attacking] If your opponent has 2 or less Life cards, this
//    Character gains +2000 power during this turn."
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
const EB01_003 = ALL_CARDS.find(c => c.id === 'EB01-003')!;

function placeOnFieldA(state: any, card: CharacterCard, instanceId: string) {
  state.cardLibrary[card.id] = card;
  state.instances[instanceId] = {
    instanceId, cardId: card.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  state.players.A.field.push(state.instances[instanceId]);
}

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
    decks: {
      A: { leader: lead, cards: filler },
      B: { leader: { ...lead, id: 'LB', name: 'LB' }, cards: filler },
    },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

describe('EB01-003 — Kid & Killer (character)', () => {
  it('continuous: grants "rush" keyword to self', () => {
    const s = boot();
    const kk: CharacterCard = {
      id: 'KK', name: 'KK', kind: 'character', colors: ['red'],
      cost: 4, power: 5000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    placeOnFieldA(s, kk, 'kk1');
    applyContinuousEffectsV2ToInstance(s, 'kk1', EB01_003.effectSpecV2!.continuous!);
    expect(s.instances['kk1'].grantedKeywords).toContain('rush');
  });

  it('condition TRUE when opp life = 2', () => {
    const s = boot();
    s.players.B.life = s.players.B.life.slice(0, 2);
    const clause = EB01_003.effectSpecV2!.clauses![0];
    expect(evaluateConditionV2(s, 'A', clause.condition, 'kk1')).toBe(true);
  });

  it('condition TRUE when opp life = 0', () => {
    const s = boot(); s.players.B.life = [];
    const clause = EB01_003.effectSpecV2!.clauses![0];
    expect(evaluateConditionV2(s, 'A', clause.condition, 'kk1')).toBe(true);
  });

  it('condition FALSE when opp life = 3', () => {
    const s = boot(); s.players.B.life = s.players.B.life.slice(0, 3);
    const clause = EB01_003.effectSpecV2!.clauses![0];
    expect(evaluateConditionV2(s, 'A', clause.condition, 'kk1')).toBe(false);
  });

  it('action applies +2000 powerModifier to self', () => {
    const s = boot();
    const kk: CharacterCard = {
      id: 'KK', name: 'KK', kind: 'character', colors: ['red'],
      cost: 4, power: 5000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    placeOnFieldA(s, kk, 'kk1');
    applyActionV2(s, { sourceInstanceId: 'kk1', controller: 'A' }, EB01_003.effectSpecV2!.clauses![0].action, ['kk1']);
    expect(s.instances['kk1'].powerModifier).toBe(2000);
  });

  it('+2000 buff cleared at endTurn (this_turn duration)', () => {
    const s = boot();
    const kk: CharacterCard = {
      id: 'KK', name: 'KK', kind: 'character', colors: ['red'],
      cost: 4, power: 5000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    placeOnFieldA(s, kk, 'kk1');
    applyActionV2(s, { sourceInstanceId: 'kk1', controller: 'A' }, EB01_003.effectSpecV2!.clauses![0].action, ['kk1']);
    expect(endTurn(s).instances['kk1'].powerModifier).toBeUndefined();
  });
});
