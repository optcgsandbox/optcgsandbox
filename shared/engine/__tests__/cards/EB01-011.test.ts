// EB01-011 Mini-Merry (stage).
//   "[Activate: Main] You may rest this card and place 1 of your
//    Characters with 1000 base power at the bottom of your deck: Draw 1 card."
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
const EB01_011 = ALL_CARDS.find(c => c.id === 'EB01-011')!;

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
    id: 'EB01-011', name: 'Mini-Merry', kind: 'stage', colors: ['red'],
    cost: 1, counterValue: null, traits: ['Straw Hat Crew'], effectTags: [],
  };
  s.cardLibrary[stg.id] = stg;
  s.instances['mm'] = {
    instanceId: 'mm', cardId: stg.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.stage = s.instances['mm'];
}

function placeChar(s: any, id: string, basePower: number, donAttached = 0) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['red'],
    cost: 1, power: basePower, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'A',
    rested: false,
    attachedDon: donAttached > 0 ? s.players.A.donCostArea.splice(0, donAttached) : [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances[id]);
}

describe('EB01-011 — Mini-Merry', () => {
  const clause = EB01_011.effectSpecV2!.clauses![0];

  it('cost payable when 1000-base char exists on field', () => {
    const s = boot();
    placeStage(s);
    placeChar(s, 'cv', 1000);
    expect(canPayClauseCost(s, 'A', 'mm', clause.cost!)).toBe(true);
  });

  it('cost NOT payable without a 1000-base char', () => {
    const s = boot();
    placeStage(s);
    placeChar(s, 'cv', 2000);
    expect(canPayClauseCost(s, 'A', 'mm', clause.cost!)).toBe(false);
  });

  it('cost payable when 1000-base char has 2 DON attached (base power, not effective)', () => {
    const s = boot();
    placeStage(s);
    placeChar(s, 'cv', 1000, 2);
    expect(canPayClauseCost(s, 'A', 'mm', clause.cost!)).toBe(true);
  });

  it('paying cost rests this stage AND bottoms the matching char', () => {
    const s = boot();
    placeStage(s);
    placeChar(s, 'cv', 1000);
    payClauseCost(s, 'A', 'mm', clause.cost!);
    expect(s.players.A.stage!.rested).toBe(true);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'cv')).toBe(false);
    expect(s.players.A.deck[s.players.A.deck.length - 1]).toBe('cv');
  });

  it('action draws 1', () => {
    const s = boot();
    placeStage(s);
    placeChar(s, 'cv', 1000);
    const handBefore = s.players.A.hand.length;
    applyActionV2(s, { sourceInstanceId: 'mm', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand.length).toBe(handBefore + 1);
  });
});
