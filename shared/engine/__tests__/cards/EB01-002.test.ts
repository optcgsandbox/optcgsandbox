// Per-card playability verification for EB01-002 Izo (character).
//
// Printed text (cards.json):
//   "[On Play] Give up to 1 rested DON!! card to your Leader or 1 of your
//    Characters.
//    [On Your Opponent's Attack] [Once Per Turn] You may trash 1 card from
//    your hand: If your Leader has the {Land of Wano} or {Whitebeard Pirates}
//    type, give up to 1 of your opponent's Leader or Character cards −2000
//    power during this turn."
//
// These tests assert the engine's *actual* behaviour matches the printed
// text — not just that the spec describes it.

import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_002 = ALL_CARDS.find(c => c.id === 'EB01-002')!;

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

function bootWanoLeader() {
  const wanoLeader: LeaderCard = {
    id: 'WANO_L', name: 'Wano Leader', kind: 'leader', colors: ['red'], cost: null,
    power: 5000, life: 5, counterValue: null,
    traits: ['Land of Wano'], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['red'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  }));
  let s = initialState({
    seed: 1,
    decks: {
      A: { leader: wanoLeader, cards: filler },
      B: { leader: { ...wanoLeader, id: 'LB', name: 'LB', traits: [] }, cards: filler },
    },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  // After setup A is "active" but the initial endTurn flips to B and fires B's
  // refresh/draw/don. Cycle one more time so A starts a proper turn with DON
  // dealt to A's cost area.
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

describe('EB01-002 — Izo (character)', () => {
  describe('clause [On Play] — "Give up to 1 rested DON to your Leader or 1 of your Characters"', () => {
    it('attaches 1 DON from cost area to the targeted Leader', () => {
      const s = bootWanoLeader();
      const leaderId = s.players.A.leader.instanceId;
      const costBefore = s.players.A.donCostArea.length;
      const attachedBefore = s.instances[leaderId].attachedDon.length;

      const clause = EB01_002.effectSpecV2!.clauses![0];
      applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, [leaderId]);

      expect(s.instances[leaderId].attachedDon.length).toBe(attachedBefore + 1);
      expect(s.players.A.donCostArea.length).toBe(costBefore - 1);
    });

    it('attaches 1 DON to a friendly Character when that\'s the chosen target', () => {
      const s = bootWanoLeader();
      const ally: CharacterCard = {
        id: 'ALLY', name: 'Ally', kind: 'character', colors: ['red'],
        cost: 2, power: 3000, counterValue: 1000,
        traits: [], keywords: [], effectTags: [],
      };
      placeOnFieldA(s, ally, 'ally1');
      const costBefore = s.players.A.donCostArea.length;
      const attachedBefore = s.instances['ally1'].attachedDon.length;

      const clause = EB01_002.effectSpecV2!.clauses![0];
      applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['ally1']);

      expect(s.instances['ally1'].attachedDon.length).toBe(attachedBefore + 1);
      expect(s.players.A.donCostArea.length).toBe(costBefore - 1);
    });
  });

  describe('clause [On Opp Attack] — "trash 1: -2000 to opp leader/char this turn"', () => {
    function setupOppCharWithLeader(leaderTraits: string[]) {
      const leader: LeaderCard = {
        id: 'L_TRAIT', name: 'L', kind: 'leader', colors: ['red'], cost: null,
        power: 5000, life: 5, counterValue: null,
        traits: leaderTraits, keywords: [], effectTags: [],
      };
      const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
        id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['red'],
        cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
      }));
      let s = initialState({
        seed: 1,
        decks: {
          A: { leader, cards: filler },
          B: { leader: { ...leader, id: 'LB', name: 'LB', traits: [] }, cards: filler },
        },
      });
      s = setupGame(s);
      s = closeMulliganKeepBoth(s);
      s = endTurn(s);
      s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
      return s;
    }

    it('condition TRUE when Leader has {Land of Wano}', () => {
      const s = setupOppCharWithLeader(['Land of Wano']);
      const clause = EB01_002.effectSpecV2!.clauses![1];
      expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
    });

    it('condition TRUE when Leader has {Whitebeard Pirates}', () => {
      const s = setupOppCharWithLeader(['Whitebeard Pirates']);
      const clause = EB01_002.effectSpecV2!.clauses![1];
      expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
    });

    it('condition FALSE when Leader has neither trait', () => {
      const s = setupOppCharWithLeader(['Straw Hat Crew']);
      const clause = EB01_002.effectSpecV2!.clauses![1];
      expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(false);
    });

    it('applies -2000 powerModifier to opp leader target', () => {
      const s = setupOppCharWithLeader(['Land of Wano']);
      const oppLeaderId = s.players.B.leader.instanceId;
      const clause = EB01_002.effectSpecV2!.clauses![1];
      applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, [oppLeaderId]);
      expect(s.instances[oppLeaderId].powerModifier).toBe(-2000);
    });

    it('applies -2000 powerModifier to opp character target', () => {
      const s = setupOppCharWithLeader(['Land of Wano']);
      const oppChar: CharacterCard = {
        id: 'OPP_C', name: 'Opp', kind: 'character', colors: ['red'],
        cost: 3, power: 4000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
      };
      s.cardLibrary[oppChar.id] = oppChar;
      s.instances['oc1'] = {
        instanceId: 'oc1', cardId: oppChar.id, controller: 'B',
        rested: false, attachedDon: [],
        perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
      };
      s.players.B.field.push(s.instances['oc1']);

      const clause = EB01_002.effectSpecV2!.clauses![1];
      applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['oc1']);
      expect(s.instances['oc1'].powerModifier).toBe(-2000);
    });

    it('-2000 power debuff expires at end of caster\'s turn (this_turn duration)', () => {
      const s = setupOppCharWithLeader(['Land of Wano']);
      const oppLeaderId = s.players.B.leader.instanceId;
      const clause = EB01_002.effectSpecV2!.clauses![1];
      applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, [oppLeaderId]);
      const s2 = endTurn(s);
      expect(s2.instances[oppLeaderId].powerModifier).toBeUndefined();
    });
  });
});
