// EB01-012 Cavendish.
//   "[On Play]/[When Attacking] If your Leader has the {Supernovas} type
//    and you have no other [Cavendish] Characters, set up to 2 of your
//    DON!! cards as active."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_012 = ALL_CARDS.find(c => c.id === 'EB01-012')!;

function boot(leaderTraits: string[]) {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['green'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: leaderTraits, keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['green'],
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

function placeCav(s: any, instanceId: string) {
  // Use a CharacterCard literal named "Cavendish" — the engine looks up by
  // cardId.name, not card-set id, for if_no_other_with_name.
  const cav: CharacterCard = {
    id: 'CAV', name: 'Cavendish', kind: 'character', colors: ['green'],
    cost: 5, power: 6000, counterValue: 1000,
    traits: ['Supernovas', 'Beautiful Pirates'], keywords: [], effectTags: [],
  };
  s.cardLibrary[cav.id] = cav;
  s.instances[instanceId] = {
    instanceId, cardId: cav.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances[instanceId]);
}

describe('EB01-012 — Cavendish', () => {
  const onPlay = EB01_012.effectSpecV2!.clauses![0];

  it('condition TRUE: Supernovas leader + the source Cavendish is the only one', () => {
    const s = boot(['Supernovas']);
    placeCav(s, 'cav1');
    expect(evaluateConditionV2(s, 'A', onPlay.condition, 'cav1')).toBe(true);
  });

  it('condition FALSE: Supernovas leader but ANOTHER Cavendish on field', () => {
    const s = boot(['Supernovas']);
    placeCav(s, 'cav1');
    placeCav(s, 'cav2');
    // Evaluating from cav1's perspective — cav2 is "another" Cavendish.
    expect(evaluateConditionV2(s, 'A', onPlay.condition, 'cav1')).toBe(false);
  });

  it('condition FALSE: leader lacks Supernovas trait', () => {
    const s = boot(['Whitebeard Pirates']);
    placeCav(s, 'cav1');
    expect(evaluateConditionV2(s, 'A', onPlay.condition, 'cav1')).toBe(false);
  });

  it('action: set_active_don 2 — moves 2 rested DON to cost area', () => {
    const s = boot(['Supernovas']);
    placeCav(s, 'cav1');
    // Force-rest 2 cost-area DON to set up the test.
    s.players.A.donRested.push(s.players.A.donCostArea.shift()!, s.players.A.donCostArea.shift()!);
    const restedBefore = s.players.A.donRested.length;
    const costBefore = s.players.A.donCostArea.length;
    applyActionV2(s, { sourceInstanceId: 'cav1', controller: 'A' }, onPlay.action, []);
    expect(s.players.A.donRested.length).toBe(restedBefore - 2);
    expect(s.players.A.donCostArea.length).toBe(costBefore + 2);
  });

  it('action: clamps to available rested DON when fewer than magnitude', () => {
    const s = boot(['Supernovas']);
    placeCav(s, 'cav1');
    s.players.A.donRested = [s.players.A.donCostArea.shift()!];
    applyActionV2(s, { sourceInstanceId: 'cav1', controller: 'A' }, onPlay.action, []);
    expect(s.players.A.donRested.length).toBe(0);
  });
});
