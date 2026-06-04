/**
 * Engine V2 — hardening unit test: sequence sub-action target resolution.
 *
 * Validates the cluster-B fix in `actions2.ts:sequence`:
 *   - sub-action declaring its own `target` resolves via targetResolvers,
 *     independently of the parent clause's resolved targets
 *   - sub-action without `target` inherits parent targets unchanged
 *   - sub-action whose target resolves to [] is skipped (chain continues)
 *
 * Scope: direct sequence-handler call.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { actionHandlers } from '../../registry/types.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';
import type { CharacterCard, LeaderCard } from '../../cards/Card.js';

import { buildState } from '../cards/_fixtures.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

const L: LeaderCard = {
  id: 'TEST_SEQ_L', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function ch(id: string, cost = 2): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('sequence sub-action target resolution', () => {
  it('sub-action with explicit `target` resolves independently of parent targets', () => {
    // sequence with two power_buff sub-actions, each targeting different sides:
    //   sub 1: target=your_leader, magnitude=+1000 this_turn
    //   sub 2: target=opp_character, magnitude=-2000 this_turn
    // Parent clause has no target; without cluster-B fix, both subs would
    // see empty parent targets and silently no-op.
    const own = ch('SEQ_OWN_1');
    const opp = ch('SEQ_OPP_1');
    const { state, leaderInstA, fieldB } = buildState({
      leaderA: L, charsA: [own], charsB: [opp],
    });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('sequence')(state, ctx, {
      kind: 'sequence',
      actions: [
        { kind: 'power_buff', magnitude: 1000, duration: 'this_turn', target: { kind: 'your_leader' } },
        { kind: 'power_buff', magnitude: -2000, duration: 'this_turn', target: { kind: 'opp_character' } },
      ],
    }, []);
    expect(state.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBe(1000);
    expect(state.instances[fieldB[0]!.instanceId]!.powerModifierOneShot).toBe(-2000);
  });

  it('sub-action with NO `target` inherits parent `targets` unchanged', () => {
    // sequence sub-actions both have no target — they inherit the parent
    // clause's targets list. Verify both buff the same instance.
    const own = ch('SEQ_OWN_2');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [own] });
    const ownId = fieldA[0]!.instanceId;
    const ctx = { sourceInstanceId: ownId, controller: 'A' as const };
    actionHandlers.get('sequence')(state, ctx, {
      kind: 'sequence',
      actions: [
        { kind: 'power_buff', magnitude: 1000, duration: 'this_turn' },
        { kind: 'power_buff', magnitude: 500,  duration: 'this_turn' },
      ],
    }, [ownId]);
    expect(state.instances[ownId]!.powerModifierOneShot).toBe(1500);
  });

  it('sub-action whose target resolves to [] is skipped; chain continues to next sub', () => {
    // First sub-action targets opp_character — opp has none → resolves [].
    // Second sub-action targets your_leader — should still fire.
    const { state, leaderInstA } = buildState({
      leaderA: L,
      // No charsB → opp_character resolves empty
    });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('sequence')(state, ctx, {
      kind: 'sequence',
      actions: [
        { kind: 'power_buff', magnitude: -2000, duration: 'this_turn', target: { kind: 'opp_character' } },
        { kind: 'power_buff', magnitude: 3000,  duration: 'this_turn', target: { kind: 'your_leader' } },
      ],
    }, []);
    expect(state.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBe(3000);
  });

  it('chained_actions alias behaves identically to sequence', () => {
    const own = ch('SEQ_OWN_3');
    const { state, leaderInstA, fieldA } = buildState({ leaderA: L, charsA: [own] });
    void fieldA;
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('chained_actions')(state, ctx, {
      kind: 'chained_actions',
      actions: [
        { kind: 'power_buff', magnitude: 500, duration: 'this_turn', target: { kind: 'your_leader' } },
      ],
    }, []);
    expect(state.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBe(500);
  });

  it('empty actions array → no-op', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    expect(() => {
      actionHandlers.get('sequence')(state, ctx, { kind: 'sequence', actions: [] }, []);
    }).not.toThrow();
    expect(state.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBeUndefined();
  });
});
