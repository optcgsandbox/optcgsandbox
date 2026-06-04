/**
 * Engine V2 — hardening unit test: formula magnitude resolution.
 *
 * Validates `formula.ts:resolveMagnitude` against every formula shape used
 * by the corpus: literal pass-through, per_count, match_opp_don, read_state,
 * and the no-state/source fallback safety path used by continuous handlers
 * that don't carry a (state, source) context.
 *
 * Scope: pure function isolation — no dispatcher, no card data.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { resolveMagnitude } from '../../registry/handlers/formula.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';
import type { LeaderCard } from '../../cards/Card.js';

import { buildState } from '../cards/_fixtures.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

const L: LeaderCard = {
  id: 'TEST_FORMULA_L', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

describe('readMagnitude / resolveMagnitude', () => {
  it('literal number passes through', () => {
    const { state } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: state.players.A.leader.instanceId, controller: 'A' as const };
    expect(resolveMagnitude(state, ctx, 5)).toBe(5);
    expect(resolveMagnitude(state, ctx, -3)).toBe(-3);
    expect(resolveMagnitude(state, ctx, 0)).toBe(0);
  });

  it('per_count formula — own_rested_don_count divisor:3 perUnit:1000 (6 rested → 2000)', () => {
    const { state } = buildState({ leaderA: L });
    // Synthesize 6 rested DON entries on player A (push instance IDs only;
    // the count is what readCountSource reads).
    for (let i = 0; i < 6; i++) state.players.A.donRested.push(`fake-rested-${i}`);
    const ctx = { sourceInstanceId: state.players.A.leader.instanceId, controller: 'A' as const };
    const magnitude = { kind: 'per_count', countSource: 'own_rested_don_count', divisor: 3, perUnit: 1000 };
    expect(resolveMagnitude(state, ctx, magnitude)).toBe(2000);
  });

  it('per_count formula — floor() semantics: 5 rested DON / divisor 3 → 1000 (not 1666)', () => {
    const { state } = buildState({ leaderA: L });
    for (let i = 0; i < 5; i++) state.players.A.donRested.push(`fake-rested-${i}`);
    const ctx = { sourceInstanceId: state.players.A.leader.instanceId, controller: 'A' as const };
    const magnitude = { kind: 'per_count', countSource: 'own_rested_don_count', divisor: 3, perUnit: 1000 };
    expect(resolveMagnitude(state, ctx, magnitude)).toBe(1000);
  });

  it('match_opp_don formula — opponent donCostArea length', () => {
    // donInCostB seeds 10 active DON for player B by default.
    const { state } = buildState({ leaderA: L, donInCostB: 7 });
    const ctx = { sourceInstanceId: state.players.A.leader.instanceId, controller: 'A' as const };
    expect(resolveMagnitude(state, ctx, { kind: 'match_opp_don' })).toBe(7);
  });

  it('read_state formula — own_hand_count', () => {
    const { state } = buildState({ leaderA: L });
    state.players.A.hand.push('fake-hand-1', 'fake-hand-2', 'fake-hand-3', 'fake-hand-4');
    const ctx = { sourceInstanceId: state.players.A.leader.instanceId, controller: 'A' as const };
    expect(resolveMagnitude(state, ctx, { kind: 'read_state', source: 'own_hand_count' })).toBe(4);
  });

  it('undefined / null / non-object → fallback', () => {
    const { state } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: state.players.A.leader.instanceId, controller: 'A' as const };
    expect(resolveMagnitude(state, ctx, undefined, 0)).toBe(0);
    expect(resolveMagnitude(state, ctx, null, 0)).toBe(0);
    expect(resolveMagnitude(state, ctx, undefined, 42)).toBe(42);
    expect(resolveMagnitude(state, ctx, 'not-a-number' as unknown, 7)).toBe(7);
  });

  it('unknown formula kind → fallback', () => {
    const { state } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: state.players.A.leader.instanceId, controller: 'A' as const };
    expect(resolveMagnitude(state, ctx, { kind: 'no_such_formula' }, 99)).toBe(99);
  });

  it('per_count divisor 0 → fallback (defensive)', () => {
    const { state } = buildState({ leaderA: L });
    for (let i = 0; i < 6; i++) state.players.A.donRested.push(`f-${i}`);
    const ctx = { sourceInstanceId: state.players.A.leader.instanceId, controller: 'A' as const };
    expect(resolveMagnitude(state, ctx, { kind: 'per_count', countSource: 'own_rested_don_count', divisor: 0, perUnit: 1000 }, 0)).toBe(0);
  });

  it('per_count unknown countSource → 0', () => {
    const { state } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: state.players.A.leader.instanceId, controller: 'A' as const };
    expect(resolveMagnitude(state, ctx, { kind: 'per_count', countSource: 'no_such_source', divisor: 1, perUnit: 1000 }, 0)).toBe(0);
  });
});
