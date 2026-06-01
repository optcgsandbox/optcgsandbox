// EB01-050 "...I Want to Live!!" (event).
//   "[Counter] If you have 30 or more cards in your trash, add up to 1
//    card from the top of your deck to the top of your Life cards."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_050 = ALL_CARDS.find(c => c.id === 'EB01-050')!;

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

describe('EB01-050 — ...I Want to Live!!', () => {
  const clause = EB01_050.effectSpecV2!.clauses![0];

  it('condition FALSE when trash < 30', () => {
    const s = boot();
    s.players.A.trash = [];
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(false);
  });

  it('condition TRUE when trash >= 30', () => {
    const s = boot();
    s.players.A.trash = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('action moves top of deck to top of life', () => {
    const s = boot();
    const top = s.players.A.deck[0];
    const lifeBefore = s.players.A.life.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.life.length).toBe(lifeBefore + 1);
    expect(s.players.A.life[0]).toBe(top);
  });
});
