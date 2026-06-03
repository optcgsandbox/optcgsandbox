/**
 * Per-card semantic test — EB01-006 Tony Tony.Chopper (character).
 *
 * Printed text (cards.json):
 *   "[Blocker]
 *    [DON!! x2] [When Attacking] Give up to 1 of your opponent's Characters
 *    −3000 power during this turn."
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
import { evaluateCondition, EffectDispatcher } from '../../effects/EffectDispatcher.js';
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
  id: 'TEST_LEADER',
  name: 'Vanilla Leader',
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

describe('EB01-006 — Tony Tony.Chopper (character)', () => {
  const allCards = loadCards();
  const chopper = allCards.find((c) => c.id === 'EB01-006');
  if (chopper === undefined) throw new Error('EB01-006 not in cards.json');
  if (chopper.kind !== 'character') throw new Error('EB01-006 should be a character');
  const chopperChar = chopper as CharacterCard;
  const clause = chopperChar.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-006 missing when_attacking clause');

  const OPP_CHAR: CharacterCard = {
    id: 'TEST_OPP_CHAR_EB006',
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

  describe('continuous — grants Blocker keyword to self', () => {
    it('grantedKeywordsContinuous includes blocker after refold', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [chopperChar] });
      const folded = ContinuousManager.refold(state);
      expect(folded.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
    });
  });

  describe('[DON!! x2] gate — condition reads source\'s attached DON count', () => {
    it('FALSE when 0 DON attached to Chopper', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [chopperChar] });
      const chopperId = fieldA[0]!.instanceId;
      expect(
        evaluateCondition(
          state,
          { sourceInstanceId: chopperId, controller: 'A' },
          clause.condition,
        ),
      ).toBe(false);
    });

    it('FALSE when only 1 DON attached', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [chopperChar] });
      const chopperId = fieldA[0]!.instanceId;
      const donId = state.players.A.donCostArea.shift()!;
      state.instances[chopperId]!.attachedDon = [donId];
      expect(
        evaluateCondition(
          state,
          { sourceInstanceId: chopperId, controller: 'A' },
          clause.condition,
        ),
      ).toBe(false);
    });

    it('TRUE when 2 DON attached', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [chopperChar] });
      const chopperId = fieldA[0]!.instanceId;
      const donIds = state.players.A.donCostArea.splice(0, 2);
      state.instances[chopperId]!.attachedDon = donIds;
      expect(
        evaluateCondition(
          state,
          { sourceInstanceId: chopperId, controller: 'A' },
          clause.condition,
        ),
      ).toBe(true);
    });

    it('cost-area DON does NOT satisfy [DON!! x2] (regression — must be attached)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [chopperChar] });
      const chopperId = fieldA[0]!.instanceId;
      // Chopper has zero attached DON, but cost area has plenty.
      expect(state.players.A.donCostArea.length).toBeGreaterThanOrEqual(2);
      expect(
        evaluateCondition(
          state,
          { sourceInstanceId: chopperId, controller: 'A' },
          clause.condition,
        ),
      ).toBe(false);
    });
  });

  describe('when_attacking action — -3000 power on opp char (gated by 2 DON)', () => {
    it('full dispatch with [DON!! x2] satisfied applies -3000 to opp target + clears at endTurn', () => {
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [chopperChar],
        charsB: [OPP_CHAR],
      });
      const chopperId = fieldA[0]!.instanceId;
      const oppCharId = fieldB[0]!.instanceId;
      // Attach 2 DON.
      const donIds = state.players.A.donCostArea.splice(0, 2);
      state.instances[chopperId]!.attachedDon = donIds;

      // EffectDispatcher will resolve the target via the clause's target.kind
      // (opp_character). With one opp char on field, it'll pick it.
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: chopperId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[oppCharId]!.powerModifierOneShot).toBe(-3000);

      const afterEnd = PhaseScheduler.enterEnd(next);
      expect(afterEnd.instances[oppCharId]!.powerModifierOneShot).toBeUndefined();
    });
  });
});
