/**
 * Engine V2 — snapshot regression test: magnitude formula → effect output.
 *
 * Pattern: feed a magnitude (literal or formula object) into a real action
 * (power_buff on the leader) and assert ONLY the resulting numeric output
 * on the target's powerModifierOneShot. This tests the full
 * `resolveCount → resolveMagnitude → action handler` chain in one
 * direction without snapshotting full state.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { actionHandlers } from '../../registry/types.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';
import { resolveMagnitude } from '../../registry/handlers/formula.js';
import type { LeaderCard } from '../../cards/Card.js';

import { buildState } from '../cards/_fixtures.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

const L: LeaderCard = {
  id: 'MAG_SNAP_L', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

describe('magnitude snapshot — formula → resolveMagnitude output', () => {
  it('literal magnitude 1000 → returns 1000 (pass-through)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    expect(resolveMagnitude(state, ctx, 1000)).toBe(1000);
  });

  it('per_count own_rested_don_count / 3 perUnit 1000 with 6 rested DON → 2000', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    for (let i = 0; i < 6; i++) state.players.A.donRested.push(`r-${i}`);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    expect(resolveMagnitude(state, ctx, {
      kind: 'per_count', countSource: 'own_rested_don_count', divisor: 3, perUnit: 1000,
    })).toBe(2000);
  });

  it('match_opp_don with opp donCostArea=4 → 4', () => {
    const { state, leaderInstA } = buildState({ leaderA: L, donInCostB: 4 });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    expect(resolveMagnitude(state, ctx, { kind: 'match_opp_don' })).toBe(4);
  });

  it('read_state own_hand_count with hand size 3 → 3', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    state.players.A.hand.push('h-1', 'h-2', 'h-3');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    expect(resolveMagnitude(state, ctx, { kind: 'read_state', source: 'own_hand_count' })).toBe(3);
  });
});

describe('magnitude snapshot — formula consumed by power_buff action delta', () => {
  it('literal magnitude → leader.powerModifierOneShot delta equals magnitude', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0;
    actionHandlers.get('power_buff')(state, ctx, {
      kind: 'power_buff', magnitude: 1500, duration: 'this_turn',
    }, [leaderInstA.instanceId]);
    const post = state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0;
    expect(post - pre).toBe(1500);
  });

  it('formula magnitude (per_count) → action receives evaluated value', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    // Seed 6 rested DON so per_count own_rested_don_count / 3 * 1000 = 2000
    for (let i = 0; i < 6; i++) state.players.A.donRested.push(`r-${i}`);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0;
    actionHandlers.get('power_buff')(state, ctx, {
      kind: 'power_buff',
      magnitude: { kind: 'per_count', countSource: 'own_rested_don_count', divisor: 3, perUnit: 1000 },
      duration: 'this_turn',
    }, [leaderInstA.instanceId]);
    const post = state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0;
    expect(post - pre).toBe(2000);
  });

  it('formula match_opp_don → action receives opp donCostArea length', () => {
    const { state, leaderInstA } = buildState({ leaderA: L, donInCostB: 7 });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0;
    actionHandlers.get('power_buff')(state, ctx, {
      kind: 'power_buff',
      magnitude: { kind: 'match_opp_don' },
      duration: 'this_turn',
    }, [leaderInstA.instanceId]);
    const post = state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0;
    expect(post - pre).toBe(7);
  });

  it('formula read_state own_hand_count → action receives hand size', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    state.players.A.hand.push('h1', 'h2', 'h3', 'h4');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0;
    actionHandlers.get('power_buff')(state, ctx, {
      kind: 'power_buff',
      magnitude: { kind: 'read_state', source: 'own_hand_count' },
      duration: 'this_turn',
    }, [leaderInstA.instanceId]);
    const post = state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0;
    expect(post - pre).toBe(4);
  });
});
