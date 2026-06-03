/**
 * Card Effect Execution Layer — integration smoke test.
 *
 * Real-card scenario: EB01-001 Kouzuki Oden, clause 2 — the part the
 * engine spec CAN represent. Clause 1 (continuous Counter aura) is
 * UNSUPPORTED per docs/OP_SIM_ENGINE_SPEC_V1.md trigger list and
 * therefore not implemented.
 *
 * Clause 2 (verbatim):
 *   "[DON!! x1] [When Attacking] If you have a {Land of Wano} type
 *    Character with a cost of 5 or more, this Leader gains +1000 power
 *    until the start of your next turn."
 *
 * Compiled effect spec:
 *   trigger: ON_ATTACK
 *   requires_don: 1
 *   conditions: [{ type: HAS_CHARACTER, owner: SELF, trait: 'Land of Wano', cost_gte: 5 }]
 *   effects: [{ action: ADD_POWER, target: SELF_LEADER, amount: 1000,
 *               duration: START_OF_NEXT_TURN }]
 */

import { describe, it, expect } from 'vitest';
import type { CharacterCard, LeaderCard } from '../../engine-v2/cards/Card.js';
import { buildState } from '../../engine-v2/__tests__/cards/_fixtures.js';
import { simHandleEvent } from '../index.js';
import type { CardEffectsLibrary, SimEvent, SimMutation } from '../types.js';

const ODEN: LeaderCard = {
  id: 'EB01-001',
  name: 'Kouzuki Oden',
  kind: 'leader',
  colors: ['red', 'green'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Land of Wano', 'Kouzuki Clan'],
  keywords: ['when_attacking'],
  effectTags: [],
};

function wanoChar(id: string, cost: number): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['red'],
    cost,
    power: 5000,
    counterValue: 1000,
    traits: ['Land of Wano'],
    keywords: [],
    effectTags: [],
  };
}

/** Compiled EB01-001 clause 2 only (clause 1 is UNSUPPORTED). */
const ODEN_LIBRARY: CardEffectsLibrary = {
  'EB01-001': {
    status: 'OK',
    effects: [
      {
        trigger: 'ON_ATTACK',
        requires_don: 1,
        conditions: [
          { type: 'HAS_CHARACTER', owner: 'SELF', trait: 'Land of Wano', cost_gte: 5 },
        ],
        effects: [
          {
            action: 'ADD_POWER',
            target: 'SELF_LEADER',
            amount: 1000,
            duration: 'START_OF_NEXT_TURN',
          },
        ],
      },
    ],
  },
};

describe('EB01-001 Kouzuki Oden — ON_ATTACK clause', () => {
  it('emits ADD_POWER mutation when DON >= 1 and Wano character cost >= 5 is on field', () => {
    const c5 = wanoChar('WANO_5', 5);
    const { state, leaderInstA } = buildState({
      leaderA: ODEN,
      charsA: [c5],
      donInCostA: 5,
    });
    const event: SimEvent = {
      trigger: 'ON_ATTACK',
      controller: 'A',
      attackingInstanceId: leaderInstA.instanceId,
    };
    const muts = simHandleEvent(state, event, ODEN_LIBRARY);

    expect(muts.length).toBe(1);
    const m = muts[0]!;
    expect(m.kind).toBe('ADD_POWER');
    if (m.kind === 'ADD_POWER') {
      expect(m.target).toBe(leaderInstA.instanceId);
      expect(m.amount).toBe(1000);
      expect(m.duration).toBe('START_OF_NEXT_TURN');
    }
  });

  it('emits no mutation when no Wano character cost >= 5 is on field', () => {
    const c2 = wanoChar('WANO_2', 2);
    const { state, leaderInstA } = buildState({
      leaderA: ODEN,
      charsA: [c2],
      donInCostA: 5,
    });
    const event: SimEvent = {
      trigger: 'ON_ATTACK',
      controller: 'A',
      attackingInstanceId: leaderInstA.instanceId,
    };
    const muts = simHandleEvent(state, event, ODEN_LIBRARY);
    expect(muts.length).toBe(0);
  });

  it('emits no mutation when DON < 1 (requires_don gate fails)', () => {
    const c5 = wanoChar('WANO_5', 5);
    const { state, leaderInstA } = buildState({
      leaderA: ODEN,
      charsA: [c5],
      donInCostA: 0,
    });
    const event: SimEvent = {
      trigger: 'ON_ATTACK',
      controller: 'A',
      attackingInstanceId: leaderInstA.instanceId,
    };
    const muts = simHandleEvent(state, event, ODEN_LIBRARY);
    expect(muts.length).toBe(0);
  });

  it('emits no mutation when event.trigger is not ON_ATTACK', () => {
    const c5 = wanoChar('WANO_5', 5);
    const { state, leaderInstA } = buildState({
      leaderA: ODEN,
      charsA: [c5],
      donInCostA: 5,
    });
    const event: SimEvent = {
      trigger: 'ON_PLAY',
      controller: 'A',
      attackingInstanceId: leaderInstA.instanceId,
    };
    const muts = simHandleEvent(state, event, ODEN_LIBRARY);
    expect(muts.length).toBe(0);
  });

  it('non-Wano cost-5 character does NOT satisfy the HAS_CHARACTER filter', () => {
    const nonWano: CharacterCard = {
      ...wanoChar('NONWANO', 5),
      traits: ['Other'],
    };
    const { state, leaderInstA } = buildState({
      leaderA: ODEN,
      charsA: [nonWano],
      donInCostA: 5,
    });
    const event: SimEvent = {
      trigger: 'ON_ATTACK',
      controller: 'A',
      attackingInstanceId: leaderInstA.instanceId,
    };
    const muts = simHandleEvent(state, event, ODEN_LIBRARY);
    expect(muts.length).toBe(0);
  });

  it('library entry with status UNSUPPORTED emits no mutations', () => {
    const lib: CardEffectsLibrary = {
      'EB01-001': { status: 'UNSUPPORTED', reason: 'continuous aura unsupported' },
    };
    const { state, leaderInstA } = buildState({
      leaderA: ODEN,
      charsA: [wanoChar('WANO_5', 5)],
      donInCostA: 5,
    });
    const event: SimEvent = {
      trigger: 'ON_ATTACK',
      controller: 'A',
      attackingInstanceId: leaderInstA.instanceId,
    };
    const muts: SimMutation[] = simHandleEvent(state, event, lib);
    expect(muts.length).toBe(0);
  });
});
