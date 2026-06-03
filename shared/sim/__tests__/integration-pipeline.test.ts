/**
 * Card Effect Execution Layer — full pipeline integration test.
 *
 * Verifies the engine → sim → mutation → apply pipeline end-to-end on
 * a real card scenario:
 *
 *   1. Host engine calls processSimEvent(state, ctx, 'when_attacking', library)
 *   2. Trigger 'when_attacking' translates to sim trigger ON_ATTACK
 *   3. simHandleEvent finds EB01-001's compiled effect
 *   4. Condition (HAS_CHARACTER + cost_gte 5) passes
 *   5. requires_don gate passes
 *   6. ADD_POWER mutation emitted
 *   7. applyMutations sets powerModifierOneShot=1000 on the leader
 *
 * Also verifies UNSUPPORTED entries are no-ops and unmapped engine
 * triggers don't crash.
 */

import { describe, it, expect } from 'vitest';
import type { CharacterCard, LeaderCard } from '../../engine-v2/cards/Card.js';
import { buildState } from '../../engine-v2/__tests__/cards/_fixtures.js';
import { processSimEvent, previewSimEvent, buildSimEvent } from '../integrate.js';
import type { CardEffectsLibrary } from '../types.js';

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
  keywords: [],
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

const ODEN_LIB: CardEffectsLibrary = {
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

describe('end-to-end pipeline', () => {
  it('engine ON_ATTACK trigger applies +1000 power to leader via sim', () => {
    const c5 = wanoChar('WANO_5', 5);
    const built = buildState({
      leaderA: ODEN,
      charsA: [c5],
      donInCostA: 5,
    });
    const initialPower = built.state.instances[built.leaderInstA.instanceId]!.powerModifierOneShot ?? 0;

    const result = processSimEvent(
      built.state,
      {
        controller: 'A',
        sourceInstanceId: built.leaderInstA.instanceId,
        attackingInstanceId: built.leaderInstA.instanceId,
      },
      'when_attacking',
      ODEN_LIB,
    );

    const finalInst = result.instances[built.leaderInstA.instanceId]!;
    expect(finalInst.powerModifierOneShot).toBe(initialPower + 1000);
    expect(finalInst.powerModifierExpiresInTurns).toBe(1);
  });

  it('no Wano char of cost 5+ on field → no mutation applied', () => {
    const c2 = wanoChar('WANO_2', 2);
    const built = buildState({
      leaderA: ODEN,
      charsA: [c2],
      donInCostA: 5,
    });
    const before = built.state.instances[built.leaderInstA.instanceId]!.powerModifierOneShot ?? 0;
    const result = processSimEvent(
      built.state,
      {
        controller: 'A',
        sourceInstanceId: built.leaderInstA.instanceId,
        attackingInstanceId: built.leaderInstA.instanceId,
      },
      'when_attacking',
      ODEN_LIB,
    );
    expect(result.instances[built.leaderInstA.instanceId]!.powerModifierOneShot ?? 0).toBe(before);
  });

  it('engine triggers that do NOT map to sim triggers leave state unchanged', () => {
    const built = buildState({ leaderA: ODEN, donInCostA: 5 });
    const before = JSON.stringify(built.state.instances);
    const result = processSimEvent(
      built.state,
      { controller: 'A', sourceInstanceId: built.leaderInstA.instanceId },
      'at_opp_refresh', // not in ENGINE_TO_SIM_TRIGGER
      ODEN_LIB,
    );
    expect(JSON.stringify(result.instances)).toBe(before);
  });

  it('UNSUPPORTED library entry skips silently — no state change', () => {
    const lib: CardEffectsLibrary = {
      'EB01-001': { status: 'UNSUPPORTED', reason: 'continuous aura unsupported' },
    };
    const c5 = wanoChar('WANO_5', 5);
    const built = buildState({ leaderA: ODEN, charsA: [c5], donInCostA: 5 });
    const before = JSON.stringify(built.state.instances);
    const result = processSimEvent(
      built.state,
      {
        controller: 'A',
        sourceInstanceId: built.leaderInstA.instanceId,
        attackingInstanceId: built.leaderInstA.instanceId,
      },
      'when_attacking',
      lib,
    );
    expect(JSON.stringify(result.instances)).toBe(before);
  });

  it('previewSimEvent returns mutations without applying them', () => {
    const c5 = wanoChar('WANO_5', 5);
    const built = buildState({ leaderA: ODEN, charsA: [c5], donInCostA: 5 });
    const before = built.state.instances[built.leaderInstA.instanceId]!.powerModifierOneShot ?? 0;
    const muts = previewSimEvent(
      built.state,
      {
        controller: 'A',
        sourceInstanceId: built.leaderInstA.instanceId,
        attackingInstanceId: built.leaderInstA.instanceId,
      },
      'when_attacking',
      ODEN_LIB,
    );
    expect(muts.length).toBe(1);
    expect(muts[0]?.kind).toBe('ADD_POWER');
    // State unchanged.
    expect(built.state.instances[built.leaderInstA.instanceId]!.powerModifierOneShot ?? 0).toBe(before);
  });

  it('buildSimEvent returns null for unmapped engine triggers', () => {
    expect(buildSimEvent('at_opp_refresh', { controller: 'A' })).toBeNull();
  });

  it('buildSimEvent produces correct SimEvent for mapped triggers', () => {
    const ev = buildSimEvent('on_play', { controller: 'A', sourceInstanceId: 'X' });
    expect(ev).toEqual({ trigger: 'ON_PLAY', controller: 'A', sourceInstanceId: 'X' });
  });
});

describe('mutation applier — verify ADD_POWER lifecycle', () => {
  it('END_OF_TURN duration writes expiry 0', () => {
    const c5 = wanoChar('WANO_5', 5);
    const built = buildState({ leaderA: ODEN, charsA: [c5], donInCostA: 5 });
    const lib: CardEffectsLibrary = {
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
              { action: 'ADD_POWER', target: 'SELF_LEADER', amount: 500, duration: 'END_OF_TURN' },
            ],
          },
        ],
      },
    };
    const result = processSimEvent(
      built.state,
      { controller: 'A', attackingInstanceId: built.leaderInstA.instanceId },
      'when_attacking',
      lib,
    );
    expect(result.instances[built.leaderInstA.instanceId]!.powerModifierOneShot).toBe(500);
    expect(result.instances[built.leaderInstA.instanceId]!.powerModifierExpiresInTurns).toBe(0);
  });

  it('PERMANENT duration writes to continuous field', () => {
    const c5 = wanoChar('WANO_5', 5);
    const built = buildState({ leaderA: ODEN, charsA: [c5], donInCostA: 5 });
    const lib: CardEffectsLibrary = {
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
              { action: 'ADD_POWER', target: 'SELF_LEADER', amount: 1500, duration: 'PERMANENT' },
            ],
          },
        ],
      },
    };
    const result = processSimEvent(
      built.state,
      { controller: 'A', attackingInstanceId: built.leaderInstA.instanceId },
      'when_attacking',
      lib,
    );
    expect(result.instances[built.leaderInstA.instanceId]!.powerModifierContinuous).toBe(1500);
    expect(result.instances[built.leaderInstA.instanceId]!.powerModifierOneShot ?? 0).toBe(0);
  });
});
