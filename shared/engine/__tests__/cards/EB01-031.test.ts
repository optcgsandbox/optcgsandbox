// EB01-031 Kalifa.
//   "[On Play] DON!! −1: If your Leader has the {Water Seven} type, add
//    up to 2 Character cards with a cost of 4 or less from your trash to
//    your hand."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { canPayClauseCost, payClauseCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_031 = ALL_CARDS.find(c => c.id === 'EB01-031')!;

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

function trashChar(s: any, id: string, cost: number) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['purple'],
    cost, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.trash.push(id);
}

describe('EB01-031 — Kalifa', () => {
  const clause = EB01_031.effectSpecV2!.clauses![0];

  it('condition TRUE: leader Water Seven', () => {
    const s = boot(['Water Seven']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('condition FALSE: non-Water-Seven leader', () => {
    const s = boot(['Other']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(false);
  });

  it('cost payable when cost-area has 1+ DON', () => {
    const s = boot(['Water Seven']);
    expect(canPayClauseCost(s, 'A', 'src', clause.cost!)).toBe(true);
  });

  it('cost moves 1 cost-area DON to DON deck (not rested)', () => {
    const s = boot(['Water Seven']);
    const costBefore = s.players.A.donCostArea.length;
    const deckBefore = s.players.A.donDeck.length;
    payClauseCost(s, 'A', 'src', clause.cost!);
    expect(s.players.A.donCostArea.length).toBe(costBefore - 1);
    expect(s.players.A.donDeck.length).toBe(deckBefore + 1);
  });

  it('action: recursion magnitude 2 pulls up to 2 cost<=4 chars from trash', () => {
    const s = boot(['Water Seven']);
    trashChar(s, 'c1', 3);
    trashChar(s, 'c2', 4);
    trashChar(s, 'c3', 5); // too expensive
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain('c1');
    expect(s.players.A.hand).toContain('c2');
    expect(s.players.A.hand).not.toContain('c3');
  });

  it('action stops at magnitude=2 even if more match', () => {
    const s = boot(['Water Seven']);
    trashChar(s, 'a', 2);
    trashChar(s, 'b', 2);
    trashChar(s, 'c', 2);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    const handHits = ['a', 'b', 'c'].filter((id) => s.players.A.hand.includes(id));
    expect(handHits.length).toBe(2);
  });
});
