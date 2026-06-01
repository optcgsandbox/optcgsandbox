// EB02-037 Franky.
//   "[On Play]/[When Attacking] If your Leader has the {Straw Hat
//    Crew} type and the number of DON!! cards on your field is equal
//    to or less than the number on your opponent's field, add up to
//    1 DON!! card from your DON!! deck and rest it."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_037 = ALL_CARDS.find(c => c.id === 'EB02-037')!;

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

describe('EB02-037 — Franky', () => {
  const [onPlay] = EB02_037.effectSpecV2!.clauses!;

  it('condition TRUE: SHC leader + own DON <= opp DON', () => {
    const s = boot(['Straw Hat Crew']);
    s.players.A.donCostArea = ['a'];
    s.players.B.donCostArea = ['b1', 'b2'];
    expect(evaluateConditionV2(s, 'A', onPlay.condition, 'src')).toBe(true);
  });

  it('condition FALSE: non-SHC leader', () => {
    const s = boot(['Other']);
    s.players.A.donCostArea = ['a'];
    s.players.B.donCostArea = ['b1', 'b2'];
    expect(evaluateConditionV2(s, 'A', onPlay.condition, 'src')).toBe(false);
  });

  it('condition FALSE: own DON > opp DON', () => {
    const s = boot(['Straw Hat Crew']);
    s.players.A.donCostArea = ['a1', 'a2'];
    s.players.B.donCostArea = ['b1'];
    expect(evaluateConditionV2(s, 'A', onPlay.condition, 'src')).toBe(false);
  });

  it('action: ramp 1 rested → rested DON', () => {
    const s = boot(['Straw Hat Crew']);
    const rBefore = s.players.A.donRested.length;
    const dBefore = s.players.A.donDeck.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, onPlay.action, []);
    expect(s.players.A.donRested.length).toBe(rBefore + 1);
    expect(s.players.A.donDeck.length).toBe(dBefore - 1);
  });
});
