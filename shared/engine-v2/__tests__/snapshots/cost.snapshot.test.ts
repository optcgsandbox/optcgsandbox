/**
 * Engine V2 — snapshot regression test: selfPowerCost zone-delta baselines.
 *
 * Pattern: capture leader's powerModifierOneShot + powerModifierExpiresInTurns
 * pre-cost; pay the cost; assert ONLY the deltas on those two fields.
 * No unrelated zone assertions; no full state.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { costHandlers } from '../../registry/types.js';
import { PhaseScheduler } from '../../phases/PhaseScheduler.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';
import type { LeaderCard } from '../../cards/Card.js';

import { buildState } from '../cards/_fixtures.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

const L: LeaderCard = {
  id: 'COST_SNAP_L', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

describe('selfPowerCost snapshot — leader modifier deltas', () => {
  it('5000 magnitude → powerModifierOneShot delta of -5000, expiresInTurns = 0', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = {
      modifier: state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0,
      expires: state.instances[leaderInstA.instanceId]!.powerModifierExpiresInTurns,
    };

    costHandlers.get('selfPowerCost').pay(state, ctx, { selfPowerCost: 5000 });

    const post = state.instances[leaderInstA.instanceId]!;
    expect((post.powerModifierOneShot ?? 0) - pre.modifier).toBe(-5000);
    expect(post.powerModifierExpiresInTurns).toBe(0);
    expect(pre.expires).toBeUndefined();
  });

  it('stacking: two 5000 payments → -10000 total modifier; expiresInTurns stays at 0', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0;

    costHandlers.get('selfPowerCost').pay(state, ctx, { selfPowerCost: 5000 });
    costHandlers.get('selfPowerCost').pay(state, ctx, { selfPowerCost: 5000 });

    const post = state.instances[leaderInstA.instanceId]!;
    expect((post.powerModifierOneShot ?? 0) - pre).toBe(-10000);
    expect(post.powerModifierExpiresInTurns).toBe(0);
  });

  it('0 magnitude → no delta on modifier or expiresInTurns', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = {
      modifier: state.instances[leaderInstA.instanceId]!.powerModifierOneShot,
      expires: state.instances[leaderInstA.instanceId]!.powerModifierExpiresInTurns,
    };

    costHandlers.get('selfPowerCost').pay(state, ctx, { selfPowerCost: 0 });

    const post = state.instances[leaderInstA.instanceId]!;
    expect(post.powerModifierOneShot).toBe(pre.modifier); // both undefined
    expect(post.powerModifierExpiresInTurns).toBe(pre.expires);
  });

  it('enterEnd cleanup: cost-applied modifier present after pay; cleared after enterEnd', () => {
    let { state, leaderInstA } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    costHandlers.get('selfPowerCost').pay(state, ctx, { selfPowerCost: 5000 });

    // Snapshot after pay
    expect(state.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBe(-5000);
    expect(state.instances[leaderInstA.instanceId]!.powerModifierExpiresInTurns).toBe(0);

    state = PhaseScheduler.enterEnd(state);

    // Delta: both cleared by lifecycle tick
    expect(state.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBeUndefined();
    expect(state.instances[leaderInstA.instanceId]!.powerModifierExpiresInTurns).toBeUndefined();
  });

  it('mixing positive + cost-debuff: power_buff +1000 then selfPowerCost 5000 → net -4000', () => {
    // power_buff applied via action handler (positive), then cost handler (negative).
    // Final delta is the algebraic sum.
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0;

    // Use power_buff action to apply +1000 first (mirrors actions.ts:96-100)
    const inst = state.instances[leaderInstA.instanceId]!;
    inst.powerModifierOneShot = (inst.powerModifierOneShot ?? 0) + 1000;
    inst.powerModifierExpiresInTurns = 0;
    costHandlers.get('selfPowerCost').pay(state, ctx, { selfPowerCost: 5000 });

    expect((state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0) - pre).toBe(-4000);
    expect(state.instances[leaderInstA.instanceId]!.powerModifierExpiresInTurns).toBe(0);
  });
});
