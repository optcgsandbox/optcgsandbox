// EB02-003 Tony Tony.Chopper (red Drum Kingdom).
//   "[DON!! x2] [Opponent's Turn] This Character gains +2000 power.
//    [On Play] If your Leader has the {Straw Hat Crew} type, give up to
//    1 rested DON!! card to your Leader or 1 of your Characters."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_003 = ALL_CARDS.find(c => c.id === 'EB02-003')!;

function boot(traits: string[]) {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['red'], cost: null,
    power: 5000, life: 5, counterValue: null, traits, keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['red'],
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

function placeChop(s: any, attachedDon: number) {
  const c: CharacterCard = {
    id: 'CH', name: 'Chopper', kind: 'character', colors: ['red'],
    cost: 3, power: 3000, counterValue: 1000,
    traits: ['Animal', 'Drum Kingdom', 'Straw Hat Crew'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['ch'] = {
    instanceId: 'ch', cardId: c.id, controller: 'A',
    rested: false,
    attachedDon: attachedDon > 0 ? s.players.A.donCostArea.splice(0, attachedDon) : [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['ch']);
}

describe('EB02-003 — Tony Tony.Chopper (red Drum)', () => {
  const clause = EB02_003.effectSpecV2!.clauses![0];
  const cont = EB02_003.effectSpecV2!.continuous!;

  it('on-play condition TRUE: Straw Hat Crew leader', () => {
    const s = boot(['Straw Hat Crew']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('on-play condition FALSE: other leader', () => {
    const s = boot(['Other']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(false);
  });

  it('on-play: give_don_to_target attaches 1 DON to leader', () => {
    const s = boot(['Straw Hat Crew']);
    const leaderId = s.players.A.leader.instanceId;
    const cBefore = s.players.A.donCostArea.length;
    const attBefore = s.instances[leaderId].attachedDon.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, [leaderId]);
    expect(s.instances[leaderId].attachedDon.length).toBe(attBefore + 1);
    expect(s.players.A.donCostArea.length).toBe(cBefore - 1);
  });

  it('continuous: +2000 power when 2 DON attached + opp turn', () => {
    const s = boot(['Straw Hat Crew']);
    placeChop(s, 2);
    s.activePlayer = 'B';
    applyContinuousEffectsV2ToInstance(s, 'ch', cont);
    expect(s.instances['ch'].powerModifier).toBe(2000);
  });

  it('continuous: no buff on own turn', () => {
    const s = boot(['Straw Hat Crew']);
    placeChop(s, 2);
    applyContinuousEffectsV2ToInstance(s, 'ch', cont);
    expect(s.instances['ch'].powerModifier ?? 0).toBe(0);
  });

  it('continuous: no buff with 1 DON attached', () => {
    const s = boot(['Straw Hat Crew']);
    placeChop(s, 1);
    s.activePlayer = 'B';
    applyContinuousEffectsV2ToInstance(s, 'ch', cont);
    expect(s.instances['ch'].powerModifier ?? 0).toBe(0);
  });
});
