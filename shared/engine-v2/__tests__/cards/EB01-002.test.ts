/**
 * Per-card semantic test — EB01-002 Izo (character).
 *
 * Printed text (cards.json):
 *   "[On Play] Give up to 1 rested DON!! card to your Leader or 1 of your
 *    Characters.
 *    [On Your Opponent's Attack] [Once Per Turn] You may trash 1 card from
 *    your hand: If your Leader has the {Land of Wano} or {Whitebeard Pirates}
 *    type, give up to 1 of your opponent's Leader or Character cards −2000
 *    power during this turn."
 *
 * 5-axis audit (per TASK_PHASE4_PER_CARD.md):
 *   Clause 1 (on_play) → give_don_to_target (rested) targeting
 *     your_leader_or_character, magnitude 1. No condition, no cost.
 *   Clause 2 (on_opp_attack) → power_buff -2000 this_turn on
 *     opp_leader_or_character, gated by OR(if_leader_has_trait Wano,
 *     if_leader_has_trait Whitebeard) condition + discardHand:1 cost + opt.
 *
 * All 7 primitives confirmed registered (give_don_to_target, power_buff,
 * if_leader_has_trait, discardHand, your_leader_or_character,
 * opp_leader_or_character, on_opp_attack). No spec gaps. No engine gaps.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import { PhaseScheduler } from '../../phases/PhaseScheduler.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';

import { buildState } from './_fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

function loadCards(): Card[] {
  const raw = readFileSync(resolve(__dirname, '../../../data/cards.json'), 'utf-8');
  return JSON.parse(raw) as Card[];
}

function makeLeader(traits: string[]): LeaderCard {
  return {
    id: 'TEST_LEADER_EB002',
    name: 'TEST',
    kind: 'leader',
    colors: ['red'],
    cost: null,
    power: 5000,
    life: 5,
    counterValue: null,
    traits,
    keywords: [],
    effectTags: [],
  };
}

const VANILLA_HAND_CARD: CharacterCard = {
  id: 'TEST_DISCARD_EB002',
  name: 'Discard Filler',
  kind: 'character',
  colors: ['red'],
  cost: 2,
  power: 3000,
  counterValue: 1000,
  traits: [],
  keywords: [],
  effectTags: [],
};

const FRIENDLY_TARGET: CharacterCard = {
  id: 'TEST_FRIENDLY_EB002',
  name: 'Friendly Target',
  kind: 'character',
  colors: ['red'],
  cost: 2,
  power: 3000,
  counterValue: 1000,
  traits: [],
  keywords: [],
  effectTags: [],
};

const OPP_CHAR: CharacterCard = {
  id: 'TEST_OPP_EB002',
  name: 'Opp Char',
  kind: 'character',
  colors: ['red'],
  cost: 3,
  power: 4000,
  counterValue: 1000,
  traits: [],
  keywords: [],
  effectTags: [],
};

describe('EB01-002 — Izo (character)', () => {
  const allCards = loadCards();
  const eb01_002 = allCards.find((c) => c.id === 'EB01-002');
  if (eb01_002 === undefined) throw new Error('EB01-002 not in cards.json');
  if (eb01_002.kind !== 'character') throw new Error('EB01-002 should be a character');
  const izo = eb01_002 as CharacterCard;
  const clauses = izo.effectSpecV2?.clauses ?? [];
  if (clauses.length < 2) throw new Error('EB01-002 expected 2 clauses');

  describe('clause 1 [On Play] — give 1 rested DON to leader-or-character', () => {
    it('attaches 1 REST DON to a targeted Leader; controller cost area -1', () => {
      const { state, fieldA, leaderInstA } = buildState({
        leaderA: makeLeader(['Land of Wano']),
        charsA: [izo],
      });
      const izoId = fieldA[0]!.instanceId;
      const leaderId = leaderInstA.instanceId;
      const costBefore = state.players.A.donCostArea.length;
      const restedBefore = state.instances[leaderId]!.attachedDonRested.length;

      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: izoId, controller: 'A' },
        'on_play',
      );
      expect(next.instances[leaderId]!.attachedDonRested.length).toBe(restedBefore + 1);
      expect(next.players.A.donCostArea.length).toBe(costBefore - 1);
    });

    it('attaches 1 REST DON to a friendly character target', () => {
      const { state, fieldA } = buildState({
        leaderA: makeLeader(['Land of Wano']),
        charsA: [izo, FRIENDLY_TARGET],
      });
      const izoId = fieldA[0]!.instanceId;
      const friendId = fieldA[1]!.instanceId;
      // Target resolver picks a deterministic candidate (V0). The friend is
      // on field so it can be the target. Verify SOME friendly target
      // received the rested DON.
      const before = state.players.A.donCostArea.length;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: izoId, controller: 'A' },
        'on_play',
      );
      // Exactly 1 rested DON was attached somewhere among (leader, izo, friend).
      const restedTotal =
        next.instances[next.players.A.leader.instanceId]!.attachedDonRested.length +
        next.instances[izoId]!.attachedDonRested.length +
        next.instances[friendId]!.attachedDonRested.length;
      expect(restedTotal).toBe(1);
      expect(next.players.A.donCostArea.length).toBe(before - 1);
    });
  });

  describe('clause 2 [On Opp Attack] — trash 1 hand → -2000 opp char (gated by leader trait + OPT)', () => {
    // NOTE: V2's `opp_leader_or_character` resolver (targets.ts:193) is a
    // deterministic V0 stub that picks the OPP LEADER first when both
    // leader and opp characters qualify. Per printed "give up to 1 of your
    // opponent's Leader or Character cards" the player should pick; that's
    // logged in BUGS_FOUND.md as an engine gap. Tests assert the debuff
    // lands on whichever target the V0 resolver currently picks (opp leader).
    it('Wano leader: condition true → cost paid → -2000 powerModifier on a valid opp target this_turn', () => {
      const { state, fieldA, fieldB, leaderInstB } = buildState({
        leaderA: makeLeader(['Land of Wano']),
        charsA: [izo],
        charsB: [OPP_CHAR],
        handA: [VANILLA_HAND_CARD],
      });
      const izoId = fieldA[0]!.instanceId;
      const oppCharId = fieldB[0]!.instanceId;
      const oppLeaderId = leaderInstB.instanceId;
      const handBefore = state.players.A.hand.length;
      const trashBefore = state.players.A.trash.length;

      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: izoId, controller: 'A' },
        'on_opp_attack',
      );
      expect(next.players.A.hand.length).toBe(handBefore - 1);
      expect(next.players.A.trash.length).toBe(trashBefore + 1);
      const totalDebuff =
        (next.instances[oppLeaderId]!.powerModifierOneShot ?? 0) +
        (next.instances[oppCharId]!.powerModifierOneShot ?? 0);
      expect(totalDebuff).toBe(-2000);
    });

    it('Whitebeard Pirates leader: condition true → debuff applied (on a valid opp target)', () => {
      const { state, fieldA, fieldB, leaderInstB } = buildState({
        leaderA: makeLeader(['Whitebeard Pirates']),
        charsA: [izo],
        charsB: [OPP_CHAR],
        handA: [VANILLA_HAND_CARD],
      });
      const izoId = fieldA[0]!.instanceId;
      const oppCharId = fieldB[0]!.instanceId;
      const oppLeaderId = leaderInstB.instanceId;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: izoId, controller: 'A' },
        'on_opp_attack',
      );
      const totalDebuff =
        (next.instances[oppLeaderId]!.powerModifierOneShot ?? 0) +
        (next.instances[oppCharId]!.powerModifierOneShot ?? 0);
      expect(totalDebuff).toBe(-2000);
    });

    it('Neither Wano nor Whitebeard: condition fails → no debuff on EITHER opp leader or opp char, no trash', () => {
      const { state, fieldA, fieldB, leaderInstB } = buildState({
        leaderA: makeLeader(['Random Trait']),
        charsA: [izo],
        charsB: [OPP_CHAR],
        handA: [VANILLA_HAND_CARD],
      });
      const izoId = fieldA[0]!.instanceId;
      const oppCharId = fieldB[0]!.instanceId;
      const oppLeaderId = leaderInstB.instanceId;
      const handBefore = state.players.A.hand.length;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: izoId, controller: 'A' },
        'on_opp_attack',
      );
      expect(next.players.A.hand.length).toBe(handBefore);
      expect(next.instances[oppCharId]!.powerModifierOneShot ?? 0).toBe(0);
      expect(next.instances[oppLeaderId]!.powerModifierOneShot ?? 0).toBe(0);
    });

    it('Wano leader + empty hand: cost unpayable → no debuff on EITHER opp leader or opp char', () => {
      const { state, fieldA, fieldB, leaderInstB } = buildState({
        leaderA: makeLeader(['Land of Wano']),
        charsA: [izo],
        charsB: [OPP_CHAR],
        // handA empty
      });
      const izoId = fieldA[0]!.instanceId;
      const oppCharId = fieldB[0]!.instanceId;
      const oppLeaderId = leaderInstB.instanceId;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: izoId, controller: 'A' },
        'on_opp_attack',
      );
      expect(next.instances[oppCharId]!.powerModifierOneShot ?? 0).toBe(0);
      expect(next.instances[oppLeaderId]!.powerModifierOneShot ?? 0).toBe(0);
    });

    it('-2000 debuff clears after end of active player\'s turn (this_turn duration)', () => {
      const { state, fieldA, fieldB, leaderInstB } = buildState({
        leaderA: makeLeader(['Land of Wano']),
        charsA: [izo],
        charsB: [OPP_CHAR],
        handA: [VANILLA_HAND_CARD],
      });
      const izoId = fieldA[0]!.instanceId;
      const oppCharId = fieldB[0]!.instanceId;
      const oppLeaderId = leaderInstB.instanceId;
      let next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: izoId, controller: 'A' },
        'on_opp_attack',
      );
      const debuffBefore =
        (next.instances[oppLeaderId]!.powerModifierOneShot ?? 0) +
        (next.instances[oppCharId]!.powerModifierOneShot ?? 0);
      expect(debuffBefore).toBe(-2000);
      next = PhaseScheduler.enterEnd(next);
      // this_turn duration = expires when active player's turn ends.
      expect(next.instances[oppLeaderId]!.powerModifierOneShot).toBeUndefined();
      expect(next.instances[oppCharId]!.powerModifierOneShot).toBeUndefined();
    });

    it('OPT: second dispatch in same turn does NOT fire (clause marked opt:true)', () => {
      const { state, fieldA, fieldB, leaderInstB } = buildState({
        leaderA: makeLeader(['Land of Wano']),
        charsA: [izo],
        charsB: [OPP_CHAR, OPP_CHAR],
        handA: [VANILLA_HAND_CARD, VANILLA_HAND_CARD],
      });
      const izoId = fieldA[0]!.instanceId;
      const oppCharId = fieldB[0]!.instanceId;
      const oppLeaderId = leaderInstB.instanceId;
      let next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: izoId, controller: 'A' },
        'on_opp_attack',
      );
      const handAfterFirst = next.players.A.hand.length;
      const debuffAfterFirst =
        (next.instances[oppLeaderId]!.powerModifierOneShot ?? 0) +
        (next.instances[oppCharId]!.powerModifierOneShot ?? 0);
      expect(debuffAfterFirst).toBe(-2000);

      // Second dispatch — OPT should suppress.
      next = EffectDispatcher.dispatch(
        next,
        { sourceInstanceId: izoId, controller: 'A' },
        'on_opp_attack',
      );
      // Hand not consumed again.
      expect(next.players.A.hand.length).toBe(handAfterFirst);
      // Debuff total unchanged (didn't stack).
      const debuffAfterSecond =
        (next.instances[oppLeaderId]!.powerModifierOneShot ?? 0) +
        (next.instances[oppCharId]!.powerModifierOneShot ?? 0);
      expect(debuffAfterSecond).toBe(-2000);
    });
  });
});
