// EB02-010 Monkey.D.Luffy (leader).
//   "[Activate: Main] [Once Per Turn] DON!! −2: If the only Characters
//    on your field are {Straw Hat Crew} type Characters, set up to 2
//    of your DON!! cards as active. Then, this Leader gains +1000
//    power until the end of your opponent's next turn."
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
const EB02_010 = ALL_CARDS.find(c => c.id === 'EB02-010')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['green'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
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

function placeChar(s: any, id: string, traits: string[]) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['green'],
    cost: 2, power: 3000, counterValue: 1000, traits, keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances[id]);
}

describe('EB02-010 — Monkey.D.Luffy (G/P leader)', () => {
  const clause = EB02_010.effectSpecV2!.clauses![0];

  it('condition TRUE: only SHC chars on field', () => {
    const s = boot();
    placeChar(s, 'sh', ['Straw Hat Crew']);
    expect(evaluateConditionV2(s, 'A', clause.condition, s.players.A.leader.instanceId)).toBe(true);
  });

  it('condition FALSE: a non-SHC char present', () => {
    const s = boot();
    placeChar(s, 'sh', ['Straw Hat Crew']);
    placeChar(s, 'other', ['Other']);
    expect(evaluateConditionV2(s, 'A', clause.condition, s.players.A.leader.instanceId)).toBe(false);
  });

  it('cost donCost:2 consumes 2 from cost area', () => {
    const s = boot();
    // Make sure at least 2 DON in cost area.
    while (s.players.A.donCostArea.length < 2) s.players.A.donCostArea.push(`d${s.players.A.donCostArea.length}`);
    const before = s.players.A.donCostArea.length;
    expect(canPayClauseCost(s, 'A', s.players.A.leader.instanceId, clause.cost!)).toBe(true);
    payClauseCost(s, 'A', s.players.A.leader.instanceId, clause.cost!);
    expect(s.players.A.donCostArea.length).toBe(before - 2);
  });

  it('action sequence: set_active_don then +1000 power to leader (opp_next_turn duration)', () => {
    const s = boot();
    // Set up 2 rested DON to be activated.
    s.players.A.donRested = [s.players.A.donCostArea.shift()!, s.players.A.donCostArea.shift()!];
    const restedBefore = s.players.A.donRested.length;
    const leaderId = s.players.A.leader.instanceId;
    applyActionV2(s, { sourceInstanceId: leaderId, controller: 'A' }, clause.action, [leaderId]);
    expect(s.players.A.donRested.length).toBe(restedBefore - 2);
    expect(s.instances[leaderId].powerModifier).toBe(1000);
    // Survives one endTurn (opp_next_turn lasts through opp turn).
    const s2 = endTurn(s);
    expect(s2.instances[leaderId].powerModifier).toBe(1000);
    const s3 = endTurn(s2);
    expect(s3.instances[leaderId].powerModifier).toBeUndefined();
  });
});
