// EB01-034 Ms. Wednesday.
//   "[Blocker]
//    [On Your Opponent's Attack] [Once Per Turn] DON!! −1: If your
//    Leader's type includes 'Baroque Works', add up to 1 DON!! card
//    from your DON!! deck and set it as active."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { canPayClauseCost, payClauseCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_034 = ALL_CARDS.find(c => c.id === 'EB01-034')!;

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

function placeMs(s: any) {
  const c: CharacterCard = {
    id: 'MW', name: 'Ms. Wednesday', kind: 'character', colors: ['purple'],
    cost: 3, power: 4000, counterValue: 1000,
    traits: ['Baroque Works'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['mw'] = {
    instanceId: 'mw', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['mw']);
}

describe('EB01-034 — Ms. Wednesday', () => {
  const clause = EB01_034.effectSpecV2!.clauses![0];

  it('continuous: blocker keyword granted', () => {
    const s = boot(['Baroque Works']);
    placeMs(s);
    applyContinuousEffectsV2ToInstance(s, 'mw', EB01_034.effectSpecV2!.continuous!);
    expect(s.instances['mw'].grantedKeywords).toContain('blocker');
  });

  it('condition TRUE: Baroque Works leader', () => {
    const s = boot(['Baroque Works']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('cost: donCostReturnToDeck consumes 1 cost-area DON to deck', () => {
    const s = boot(['Baroque Works']);
    placeMs(s);
    expect(canPayClauseCost(s, 'A', 'mw', clause.cost!)).toBe(true);
    const costBefore = s.players.A.donCostArea.length;
    const deckBefore = s.players.A.donDeck.length;
    payClauseCost(s, 'A', 'mw', clause.cost!);
    expect(s.players.A.donCostArea.length).toBe(costBefore - 1);
    expect(s.players.A.donDeck.length).toBe(deckBefore + 1);
  });

  it('action: ramp rested:false → active DON in cost area', () => {
    const s = boot(['Baroque Works']);
    placeMs(s);
    const costBefore = s.players.A.donCostArea.length;
    const restedBefore = s.players.A.donRested.length;
    applyActionV2(s, { sourceInstanceId: 'mw', controller: 'A' }, clause.action, []);
    expect(s.players.A.donCostArea.length).toBe(costBefore + 1);
    expect(s.players.A.donRested.length).toBe(restedBefore);
  });
});
