// EB01-036 Minochihuahua.
//   "[Rush]
//    [On K.O.] If your Leader has the {Impel Down} type, add up to 1
//    DON!! card from your DON!! deck and rest it."
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
const EB01_036 = ALL_CARDS.find(c => c.id === 'EB01-036')!;

function boot(traits: string[]) {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['purple'], cost: null,
    power: 5000, life: 5, counterValue: null, traits, keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['purple'],
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

function placeMino(s: any) {
  const c: CharacterCard = {
    id: 'MIN', name: 'Minochihuahua', kind: 'character', colors: ['purple'],
    cost: 4, power: 5000, counterValue: null,
    traits: ['Impel Down', 'Jailer Beast'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['min'] = {
    instanceId: 'min', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['min']);
}

describe('EB01-036 — Minochihuahua', () => {
  const clause = EB01_036.effectSpecV2!.clauses![0];

  it('continuous grants rush', () => {
    const s = boot(['Impel Down']);
    placeMino(s);
    applyContinuousEffectsV2ToInstance(s, 'min', EB01_036.effectSpecV2!.continuous!);
    expect(s.instances['min'].grantedKeywords).toContain('rush');
  });

  it('condition TRUE: Impel Down leader', () => {
    const s = boot(['Impel Down']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('action: ramp 1 rested:true → rested DON', () => {
    const s = boot(['Impel Down']);
    placeMino(s);
    const restedBefore = s.players.A.donRested.length;
    const deckBefore = s.players.A.donDeck.length;
    applyActionV2(s, { sourceInstanceId: 'min', controller: 'A' }, clause.action, []);
    expect(s.players.A.donRested.length).toBe(restedBefore + 1);
    expect(s.players.A.donDeck.length).toBe(deckBefore - 1);
  });
});
