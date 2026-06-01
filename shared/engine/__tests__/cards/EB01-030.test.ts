// EB01-030 Loguetown (stage).
//   "[Activate: Main] You may place this card and 1 card from your hand
//    at the bottom of your deck in any order: Draw 2 cards."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { canPayClauseCost, payClauseCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard, StageCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_030 = ALL_CARDS.find(c => c.id === 'EB01-030')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['blue'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['blue'],
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

function placeStage(s: any) {
  const stg: StageCard = {
    id: 'LOG', name: 'Loguetown', kind: 'stage', colors: ['blue'],
    cost: 2, counterValue: null, traits: ['East Blue'], effectTags: [],
  };
  s.cardLibrary[stg.id] = stg;
  s.instances['lg'] = {
    instanceId: 'lg', cardId: stg.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.stage = s.instances['lg'];
}

describe('EB01-030 — Loguetown', () => {
  const clause = EB01_030.effectSpecV2!.clauses![0];

  it('cost payable when hand has 1+ card and stage exists', () => {
    const s = boot();
    placeStage(s);
    expect(canPayClauseCost(s, 'A', 'lg', clause.cost!)).toBe(true);
  });

  it('cost NOT payable with empty hand', () => {
    const s = boot();
    placeStage(s);
    s.players.A.hand = [];
    expect(canPayClauseCost(s, 'A', 'lg', clause.cost!)).toBe(false);
  });

  it('paying cost: stage moves to bottom of deck + 1 hand card to bottom', () => {
    const s = boot();
    placeStage(s);
    const handHead = s.players.A.hand[0];
    payClauseCost(s, 'A', 'lg', clause.cost!);
    expect(s.players.A.stage).toBeNull();
    expect(s.players.A.deck).toContain('lg');
    expect(s.players.A.deck).toContain(handHead);
  });

  it('action draws 2', () => {
    const s = boot();
    placeStage(s);
    const before = s.players.A.hand.length;
    applyActionV2(s, { sourceInstanceId: 'lg', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand.length).toBe(before + 2);
  });
});
