/**
 * Engine V2 — hardening unit test: selfPowerCost cost handler.
 *
 * Validates the cost handler's leader-debuff write contract in isolation:
 *   - amount is applied as -N to controller's leader powerModifierOneShot
 *   - expiresInTurns is set to 0 (this_turn lifecycle)
 *   - stacking accumulates correctly
 *   - 0-magnitude is a no-op
 *   - PhaseScheduler.enterEnd clears the modifier via the standard tick
 *
 * Scope: direct cost-handler call; no dispatcher.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { PhaseScheduler } from '../../phases/PhaseScheduler.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';
import { costHandlers } from '../../registry/types.js';
import type { LeaderCard } from '../../cards/Card.js';

import { buildState } from '../cards/_fixtures.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

const L: LeaderCard = {
  id: 'TEST_SPC_L', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

describe('selfPowerCost cost handler', () => {
  it('selfPowerCost: 5000 → leader powerModifierOneShot = -5000', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const handler = costHandlers.get('selfPowerCost');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    handler.pay(state, ctx, { selfPowerCost: 5000 });
    expect(state.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBe(-5000);
  });

  it('expiresInTurns is set to 0 (this_turn lifecycle)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const handler = costHandlers.get('selfPowerCost');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    handler.pay(state, ctx, { selfPowerCost: 5000 });
    expect(state.instances[leaderInstA.instanceId]!.powerModifierExpiresInTurns).toBe(0);
  });

  it('stacking twice accumulates: -5000 + -5000 = -10000', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const handler = costHandlers.get('selfPowerCost');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    handler.pay(state, ctx, { selfPowerCost: 5000 });
    handler.pay(state, ctx, { selfPowerCost: 5000 });
    expect(state.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBe(-10000);
  });

  it('selfPowerCost: 0 → no-op (no modifier write)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const handler = costHandlers.get('selfPowerCost');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    handler.pay(state, ctx, { selfPowerCost: 0 });
    expect(state.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBeUndefined();
    expect(state.instances[leaderInstA.instanceId]!.powerModifierExpiresInTurns).toBeUndefined();
  });

  it('canPay always returns true (cost is unconditional per OPTCG rules)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const handler = costHandlers.get('selfPowerCost');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    expect(handler.canPay(state, ctx, { selfPowerCost: 5000 })).toBe(true);
    expect(handler.canPay(state, ctx, { selfPowerCost: 0 })).toBe(true);
  });

  it('PhaseScheduler.enterEnd clears the modifier (this_turn lifecycle cleanup)', () => {
    let { state, leaderInstA } = buildState({ leaderA: L });
    const handler = costHandlers.get('selfPowerCost');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    handler.pay(state, ctx, { selfPowerCost: 5000 });
    expect(state.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBe(-5000);
    state = PhaseScheduler.enterEnd(state);
    expect(state.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBeUndefined();
    expect(state.instances[leaderInstA.instanceId]!.powerModifierExpiresInTurns).toBeUndefined();
  });
});
