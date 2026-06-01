// EB02-009 Thousand Sunny (stage).
//   "[Activate: Main] You may rest this Stage: Give up to 1 of your
//    currently given DON!! cards to 1 of your {Straw Hat Crew} type
//    Characters."
//
// V0: transfer_attached_don sources from leader.attachedDon. Text allows
// any "currently given" DON (leader / char / stage). For testability we
// stage 1 DON on leader and verify the transfer.
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
const EB02_009 = ALL_CARDS.find(c => c.id === 'EB02-009')!;

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
    id: 'TS', name: 'Thousand Sunny', kind: 'stage', colors: ['red'],
    cost: 2, counterValue: null, traits: ['Straw Hat Crew'], effectTags: [],
  };
  s.cardLibrary[stg.id] = stg;
  s.instances['ts'] = {
    instanceId: 'ts', cardId: stg.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.stage = s.instances['ts'];
}

function placeSHChar(s: any) {
  const c: CharacterCard = {
    id: 'SH', name: 'SH', kind: 'character', colors: ['red'],
    cost: 3, power: 4000, counterValue: 1000,
    traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['sh'] = {
    instanceId: 'sh', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['sh']);
}

describe('EB02-009 — Thousand Sunny', () => {
  const clause = EB02_009.effectSpecV2!.clauses![0];

  it('cost restSelf rests this stage', () => {
    const s = boot();
    placeStage(s);
    expect(canPayClauseCost(s, 'A', 'ts', clause.cost!)).toBe(true);
    payClauseCost(s, 'A', 'ts', clause.cost!);
    expect(s.players.A.stage!.rested).toBe(true);
  });

  it('transfers 1 DON from leader to Straw Hat char target', () => {
    const s = boot();
    placeStage(s);
    placeSHChar(s);
    // Attach 1 DON to leader.
    const donId = s.players.A.donCostArea.shift()!;
    s.players.A.leader.attachedDon.push(donId);
    s.instances[s.players.A.leader.instanceId].attachedDon.push(donId);
    applyActionV2(s, { sourceInstanceId: 'ts', controller: 'A' }, clause.action, ['sh']);
    expect(s.instances['sh'].attachedDon).toContain(donId);
    expect(s.players.A.leader.attachedDon).not.toContain(donId);
  });
});
