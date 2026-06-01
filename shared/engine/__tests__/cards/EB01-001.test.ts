// Per-card playability verification for EB01-001 Kouzuki Oden (leader).
//
// Printed text (cards.json):
//   "All of your {Land of Wano} type Character cards without a Counter have
//    a +1000 Counter, according to the rules.
//    [DON!! x1] [When Attacking] If you have a {Land of Wano} type Character
//    with a cost of 5 or more, this Leader gains +1000 power until the start
//    of your next turn."
//
// These tests assert the engine's *actual* behaviour matches the printed
// text — not just that the spec describes it. They cover:
//   - Continuous `aura_counter_buff`: chars with printed counter 0/null
//     gain +1000 counter bonus; chars with printed counter > 0 do not.
//   - Triggered clause: when [DON!! x1] + a Land-of-Wano cost-5+ char are
//     present, when_attacking grants leader +1000 power.
//   - Duration `opp_next_turn`: the buff survives the caster's endTurn
//     (i.e. it is still present after one turn boundary) and clears at the
//     next endTurn (start of caster's next turn).

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
const EB01_001 = ALL_CARDS.find(c => c.id === 'EB01-001')!;

function placeOnFieldA(state: any, card: CharacterCard, instanceId: string) {
  state.cardLibrary[card.id] = card;
  state.instances[instanceId] = {
    instanceId,
    cardId: card.id,
    controller: 'A',
    rested: false,
    attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] },
    summoningSick: false,
  };
  state.players.A.field.push(state.instances[instanceId]);
}

function bootWithLeader(leader: LeaderCard) {
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['red'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  }));
  let s = initialState({
    seed: 1,
    decks: {
      A: { leader, cards: filler },
      B: { leader: { ...leader, id: 'LB', name: 'LB' }, cards: filler },
    },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

describe('EB01-001 — Kouzuki Oden (leader)', () => {
  // Build the leader card from the live cards.json entry so the test reflects
  // shipped data, not a hand-written stub.
  const leaderCard: LeaderCard = {
    id: EB01_001.id,
    name: EB01_001.name,
    kind: 'leader',
    colors: EB01_001.colors as ('red' | 'green' | 'blue' | 'purple' | 'black' | 'yellow')[],
    cost: null,
    power: (EB01_001 as { power: number }).power,
    life: (EB01_001 as { life: number }).life,
    counterValue: null,
    traits: EB01_001.traits,
    keywords: (EB01_001 as { keywords: string[] }).keywords,
    effectTags: (EB01_001 as { effectTags: string[] }).effectTags,
  };

  describe('continuous aura_counter_buff — "Land of Wano chars without a counter gain +1000"', () => {
    it('grants +1000 counter bonus to a Land-of-Wano char with printed counter 0', () => {
      const s = bootWithLeader(leaderCard);
      const zeroCounterChar: CharacterCard = {
        id: 'LOW_ZERO', name: 'Wano Zero', kind: 'character', colors: ['red'],
        cost: 3, power: 4000, counterValue: 0,
        traits: ['Land of Wano'], keywords: [], effectTags: [],
      };
      placeOnFieldA(s, zeroCounterChar, 'zc');

      applyContinuousEffectsV2ToInstance(s, s.players.A.leader.instanceId, EB01_001.effectSpecV2!.continuous!);
      const inst = s.instances['zc'] as unknown as { counterBonus?: number };
      expect(inst.counterBonus).toBe(1000);
    });

    it('does NOT grant counter bonus to a Land-of-Wano char with printed counter 2000', () => {
      const s = bootWithLeader(leaderCard);
      const haveCounterChar: CharacterCard = {
        id: 'LOW_HAS', name: 'Wano Has', kind: 'character', colors: ['red'],
        cost: 3, power: 4000, counterValue: 2000,
        traits: ['Land of Wano'], keywords: [], effectTags: [],
      };
      placeOnFieldA(s, haveCounterChar, 'hc');

      applyContinuousEffectsV2ToInstance(s, s.players.A.leader.instanceId, EB01_001.effectSpecV2!.continuous!);
      const inst = s.instances['hc'] as unknown as { counterBonus?: number };
      expect(inst.counterBonus ?? 0).toBe(0);
    });

    it('does NOT grant counter bonus to a non-Land-of-Wano char with printed counter 0', () => {
      const s = bootWithLeader(leaderCard);
      const otherChar: CharacterCard = {
        id: 'NLOW', name: 'Not Wano', kind: 'character', colors: ['red'],
        cost: 3, power: 4000, counterValue: 0,
        traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
      };
      placeOnFieldA(s, otherChar, 'nw');

      applyContinuousEffectsV2ToInstance(s, s.players.A.leader.instanceId, EB01_001.effectSpecV2!.continuous!);
      const inst = s.instances['nw'] as unknown as { counterBonus?: number };
      expect(inst.counterBonus ?? 0).toBe(0);
    });
  });

  describe('clause [DON!! x1][When Attacking] — leader +1000 power until start of your next turn', () => {
    function setupWithDonAndCostFiveChar() {
      const s = bootWithLeader(leaderCard);
      // [DON!! x1]: attach 1 DON to leader.
      const leaderId = s.players.A.leader.instanceId;
      const donId = s.players.A.donCostArea[0];
      s.instances[leaderId].attachedDon.push(donId);
      s.players.A.leader.attachedDon.push(donId);
      s.players.A.donCostArea.shift();

      // Need a Land-of-Wano cost-5+ Character on A's field for the condition.
      const cost5: CharacterCard = {
        id: 'LOW_C5', name: 'Wano Cost5', kind: 'character', colors: ['red'],
        cost: 5, power: 6000, counterValue: 1000,
        traits: ['Land of Wano'], keywords: [], effectTags: [],
      };
      placeOnFieldA(s, cost5, 'c5');
      return s;
    }

    it('condition is true when DON attached + cost-5+ Land-of-Wano char on field', () => {
      const s = setupWithDonAndCostFiveChar();
      const clause = EB01_001.effectSpecV2!.clauses![0];
      const leaderId = s.players.A.leader.instanceId;
      expect(evaluateConditionV2(s, 'A', clause.condition, leaderId)).toBe(true);
    });

    it('condition is false when no DON attached', () => {
      const s = setupWithDonAndCostFiveChar();
      // Strip the DON we attached in setup.
      const leaderId = s.players.A.leader.instanceId;
      s.instances[leaderId].attachedDon = [];
      s.players.A.leader.attachedDon = [];
      const clause = EB01_001.effectSpecV2!.clauses![0];
      expect(evaluateConditionV2(s, 'A', clause.condition, leaderId)).toBe(false);
    });

    it('condition is false when no Land-of-Wano cost-5+ char on field', () => {
      const s = setupWithDonAndCostFiveChar();
      // Replace cost5 char with a cost-3 one.
      s.players.A.field = [];
      const cost3: CharacterCard = {
        id: 'LOW_C3', name: 'Wano Cost3', kind: 'character', colors: ['red'],
        cost: 3, power: 3000, counterValue: 1000,
        traits: ['Land of Wano'], keywords: [], effectTags: [],
      };
      placeOnFieldA(s, cost3, 'c3small');
      const clause = EB01_001.effectSpecV2!.clauses![0];
      const leaderId = s.players.A.leader.instanceId;
      expect(evaluateConditionV2(s, 'A', clause.condition, leaderId)).toBe(false);
    });

    it('applying the action grants leader +1000 powerModifier', () => {
      const s = setupWithDonAndCostFiveChar();
      const clause = EB01_001.effectSpecV2!.clauses![0];
      const leaderId = s.players.A.leader.instanceId;
      // Target kind = 'self' → resolves to the source instance (leader).
      applyActionV2(s, { sourceInstanceId: leaderId, controller: 'A' }, clause.action, [leaderId]);
      expect(s.instances[leaderId].powerModifier).toBe(1000);
      expect(s.players.A.leader.powerModifier).toBe(1000);
    });

    it('duration "opp_next_turn": buff PERSISTS through caster\'s endTurn', () => {
      const s = setupWithDonAndCostFiveChar();
      const clause = EB01_001.effectSpecV2!.clauses![0];
      const leaderId = s.players.A.leader.instanceId;
      applyActionV2(s, { sourceInstanceId: leaderId, controller: 'A' }, clause.action, [leaderId]);
      // End caster's (A's) turn — buff should survive into opp's turn.
      const s2 = endTurn(s);
      expect(s2.instances[leaderId].powerModifier).toBe(1000);
      expect(s2.players.A.leader.powerModifier).toBe(1000);
    });

    it('duration "opp_next_turn": buff CLEARS at end of opp\'s turn (= start of caster\'s next turn)', () => {
      const s = setupWithDonAndCostFiveChar();
      const clause = EB01_001.effectSpecV2!.clauses![0];
      const leaderId = s.players.A.leader.instanceId;
      applyActionV2(s, { sourceInstanceId: leaderId, controller: 'A' }, clause.action, [leaderId]);
      const s2 = endTurn(s);          // A's turn ends — buff persists.
      const s3 = endTurn(s2);         // B's turn ends — buff should now expire.
      expect(s3.instances[leaderId].powerModifier).toBeUndefined();
      expect(s3.players.A.leader.powerModifier).toBeUndefined();
    });

    it('a normal "this_turn" power_buff still expires at the first endTurn (no regression)', () => {
      const s = setupWithDonAndCostFiveChar();
      const leaderId = s.players.A.leader.instanceId;
      // Direct apply with duration:'this_turn'.
      applyActionV2(
        s,
        { sourceInstanceId: leaderId, controller: 'A' },
        { kind: 'power_buff', magnitude: 2000, duration: 'this_turn' },
        [leaderId],
      );
      expect(s.instances[leaderId].powerModifier).toBe(2000);
      const s2 = endTurn(s);
      expect(s2.instances[leaderId].powerModifier).toBeUndefined();
    });
  });
});
