// EB02-026 Nefeltari Vivi.
//   "[On Play] If your Leader is multicolored and you have 5 or less
//    cards in your hand, draw 2 cards."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_026 = ALL_CARDS.find(c => c.id === 'EB02-026')!;

function boot(leaderColors: ('red'|'green'|'blue'|'purple'|'black'|'yellow')[]) {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: leaderColors, cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['blue'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  }));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: lead, cards: filler }, B: { leader: { ...lead, id: 'LB', name: 'LB', colors: ['blue'] }, cards: filler } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

describe('EB02-026 — Nefeltari Vivi', () => {
  const clause = EB02_026.effectSpecV2!.clauses![0];

  it('condition TRUE: multicolored leader + hand <= 5', () => {
    const s = boot(['blue', 'green']);
    s.players.A.hand = s.players.A.hand.slice(0, 5);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('condition FALSE: mono-color leader', () => {
    const s = boot(['blue']);
    s.players.A.hand = s.players.A.hand.slice(0, 5);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(false);
  });

  it('condition FALSE: hand > 5', () => {
    const s = boot(['blue', 'green']);
    while (s.players.A.hand.length < 6) s.players.A.hand.push('x' + s.players.A.hand.length);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(false);
  });

  it('action draws 2', () => {
    const s = boot(['blue', 'green']);
    const before = s.players.A.hand.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand.length).toBe(before + 2);
  });
});
