/**
 * Per-card semantic test — EB01-006 Tony Tony.Chopper (character).
 *
 * Printed text (cards.json):
 *   "[Blocker] (After your opponent declares an attack, you may rest this
 *    card to make it the new target of the attack.)
 *    [DON!! x2] [When Attacking] Give up to 1 of your opponent's Characters
 *    −3000 power during this turn."
 *
 * 5-axis: continuous grant_keyword_to_self 'blocker' + clause when_attacking
 * with if_attached_don_min n:2 condition / power_buff -3000 this_turn /
 * opp_character target. All primitives registered. No spec gap. No engine gap.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { ContinuousManager } from '../../effects/ContinuousManager.js';
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

const VANILLA_LEADER: LeaderCard = {
  id: 'TEST_LEADER_EB006',
  name: 'TEST',
  kind: 'leader',
  colors: ['red'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

const OPP_CHAR: CharacterCard = {
  id: 'TEST_OPP_EB006',
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

describe('EB01-006 — Tony Tony.Chopper (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-006');
  if (eb === undefined) throw new Error('EB01-006 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-006 should be a character');
  const chopper = eb as CharacterCard;

  describe('continuous — [Blocker] keyword grant', () => {
    it('grantedKeywordsContinuous includes blocker after refold', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [chopper] });
      const next = ContinuousManager.refold(state);
      expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
    });
  });

  describe('clause [DON!! x2][When Attacking] — opp char -3000 this_turn', () => {
    it('NO buff with 0 DON attached (gate fails)', () => {
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [chopper],
        charsB: [OPP_CHAR],
      });
      const chId = fieldA[0]!.instanceId;
      const oppId = fieldB[0]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: chId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[oppId]!.powerModifierOneShot ?? 0).toBe(0);
    });

    it('NO buff with 1 DON attached (below threshold)', () => {
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [chopper],
        charsB: [OPP_CHAR],
      });
      const chId = fieldA[0]!.instanceId;
      const oppId = fieldB[0]!.instanceId;
      // Attach 1 DON to chopper.
      const donId = state.players.A.donCostArea.shift()!;
      state.instances[chId]!.attachedDon.push(donId);
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: chId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[oppId]!.powerModifierOneShot ?? 0).toBe(0);
    });

    it('-3000 buff with 2 attached DON (boundary, inclusive)', () => {
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [chopper],
        charsB: [OPP_CHAR],
      });
      const chId = fieldA[0]!.instanceId;
      const oppId = fieldB[0]!.instanceId;
      // Attach 2 DON to chopper.
      state.instances[chId]!.attachedDon.push(
        state.players.A.donCostArea.shift()!,
        state.players.A.donCostArea.shift()!,
      );
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: chId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[oppId]!.powerModifierOneShot).toBe(-3000);
    });

    it('cost-area DON does NOT satisfy [DON!! x2] (must be attached, not just in cost area)', () => {
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [chopper],
        charsB: [OPP_CHAR],
      });
      const chId = fieldA[0]!.instanceId;
      const oppId = fieldB[0]!.instanceId;
      // Cost area has plenty of DON; nothing attached.
      expect(state.players.A.donCostArea.length).toBeGreaterThanOrEqual(2);
      expect(state.instances[chId]!.attachedDon.length).toBe(0);
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: chId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[oppId]!.powerModifierOneShot ?? 0).toBe(0);
    });

    it('-3000 debuff clears after end of active player\'s turn (this_turn)', () => {
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [chopper],
        charsB: [OPP_CHAR],
      });
      const chId = fieldA[0]!.instanceId;
      const oppId = fieldB[0]!.instanceId;
      state.instances[chId]!.attachedDon.push(
        state.players.A.donCostArea.shift()!,
        state.players.A.donCostArea.shift()!,
      );
      let next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: chId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[oppId]!.powerModifierOneShot).toBe(-3000);
      next = PhaseScheduler.enterEnd(next);
      expect(next.instances[oppId]!.powerModifierOneShot).toBeUndefined();
    });
  });
});
