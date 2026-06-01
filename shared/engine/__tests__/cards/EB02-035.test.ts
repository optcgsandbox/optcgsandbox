// EB02-035 Sanji & Pudding.
//   "[Your Turn] [Once Per Turn] When 2 or more DON!! cards on your
//    field are returned to your DON!! deck, add up to 1 DON!! card
//    from your DON!! deck and set it as active.
//    [On Play] If the number of DON!! cards on your field is equal to
//    or less than the number on your opponent's field, draw 1 card."
//
// V0 engine notes:
// - on_own_don_returned trigger is not yet wired to dispatch spec
//   clauses (gap noted). on-don count threshold of 2 is also missing.
// - on-play draw clause works via standard if_own_don_le_opp condition.
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_035 = ALL_CARDS.find(c => c.id === 'EB02-035')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['purple'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['purple'],
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

describe('EB02-035 — Sanji & Pudding', () => {
  const [donReturnClause, onPlayDraw] = EB02_035.effectSpecV2!.clauses!;

  it('don-return clause: ramp 1 active', () => {
    const s = boot();
    const cBefore = s.players.A.donCostArea.length;
    const deckBefore = s.players.A.donDeck.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, donReturnClause.action, []);
    expect(s.players.A.donCostArea.length).toBe(cBefore + 1);
    expect(s.players.A.donDeck.length).toBe(deckBefore - 1);
  });

  it('on-play condition TRUE when own DON <= opp DON', () => {
    const s = boot();
    s.players.A.donCostArea = ['a1'];
    s.players.B.donCostArea = ['b1', 'b2'];
    expect(evaluateConditionV2(s, 'A', onPlayDraw.condition, 'src')).toBe(true);
  });

  it('on-play condition FALSE when own DON > opp DON', () => {
    const s = boot();
    s.players.A.donCostArea = ['a1', 'a2', 'a3'];
    s.players.B.donCostArea = ['b1'];
    expect(evaluateConditionV2(s, 'A', onPlayDraw.condition, 'src')).toBe(false);
  });

  it('on-play action draws 1', () => {
    const s = boot();
    const before = s.players.A.hand.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, onPlayDraw.action, []);
    expect(s.players.A.hand.length).toBe(before + 1);
  });
});
