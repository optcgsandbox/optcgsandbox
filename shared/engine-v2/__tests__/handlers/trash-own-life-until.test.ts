/**
 * Engine V2 — hardening unit test: trash_own_life_until semantics.
 *
 * The handler treats `n` as the TARGET life count to LEAVE (not the count
 * to trash). Validates edge cases:
 *   - life already at/below target → no-op
 *   - empty life → no-op (no crash)
 *   - missing n → defaults to 1 via resolveCount
 *   - n=0 → trash all
 *
 * Scope: direct action-handler call.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { actionHandlers } from '../../registry/types.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';
import type { LeaderCard } from '../../cards/Card.js';

import { buildState } from '../cards/_fixtures.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

const L: LeaderCard = {
  id: 'TEST_TLU_L', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function seedLife(state: ReturnType<typeof buildState>['state'], n: number): void {
  for (let i = 0; i < n; i++) state.players.A.life.push(`life-${i}`);
}

describe('trash_own_life_until handler', () => {
  it('life=4, n=1 → life.length === 1 (trim 3 from top, leaving 1)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    seedLife(state, 4);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('trash_own_life_until')(state, ctx, { kind: 'trash_own_life_until', n: 1 }, []);
    expect(state.players.A.life.length).toBe(1);
    expect(state.players.A.trash.length).toBe(3);
  });

  it('life=4, n=0 → life.length === 0 (trash all)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    seedLife(state, 4);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('trash_own_life_until')(state, ctx, { kind: 'trash_own_life_until', n: 0 }, []);
    expect(state.players.A.life.length).toBe(0);
    expect(state.players.A.trash.length).toBe(4);
  });

  it('life=2, n=5 → no-op (already at/below target)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    seedLife(state, 2);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('trash_own_life_until')(state, ctx, { kind: 'trash_own_life_until', n: 5 }, []);
    expect(state.players.A.life.length).toBe(2);
    expect(state.players.A.trash.length).toBe(0);
  });

  it('life=[] (empty) → no-op (no crash)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    expect(() => {
      actionHandlers.get('trash_own_life_until')(state, ctx, { kind: 'trash_own_life_until', n: 1 }, []);
    }).not.toThrow();
    expect(state.players.A.life.length).toBe(0);
  });

  it('missing n → defaults to 1 via resolveCount, life=4 → life=1', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    seedLife(state, 4);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('trash_own_life_until')(state, ctx, { kind: 'trash_own_life_until' }, []);
    expect(state.players.A.life.length).toBe(1);
  });

  it('top-of-life is the one that gets trashed (FIFO from index 0)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    state.players.A.life.push('top', 'mid', 'bottom');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('trash_own_life_until')(state, ctx, { kind: 'trash_own_life_until', n: 2 }, []);
    expect(state.players.A.life.length).toBe(2);
    expect(state.players.A.life).toEqual(['mid', 'bottom']);
    expect(state.players.A.trash).toEqual(['top']);
  });
});
