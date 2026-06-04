/**
 * Engine V2 — snapshot regression test: trash_own_life_until zone deltas.
 *
 * Pattern: capture life.length + trash.length pre; execute handler;
 * assert ONLY the two-zone deltas. Optionally verify FIFO order via
 * specific ID checks on the trash side.
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
  id: 'LIFE_SNAP_L', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function seedLife(state: ReturnType<typeof buildState>['state'], n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `life-${i}`;
    state.players.A.life.push(id);
    ids.push(id);
  }
  return ids;
}

describe('trash_own_life_until snapshot — life + trash deltas', () => {
  it('n=1, life=4 → life delta -3, trash delta +3; top 3 life IDs land in trash in order', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const lifeIds = seedLife(state, 4);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = {
      lifeSize: state.players.A.life.length,
      trashSize: state.players.A.trash.length,
    };

    actionHandlers.get('trash_own_life_until')(state, ctx, {
      kind: 'trash_own_life_until', n: 1,
    }, []);

    expect(state.players.A.life.length - pre.lifeSize).toBe(-3);
    expect(state.players.A.trash.length - pre.trashSize).toBe(3);
    // Specific ID assertions: top 3 (FIFO indices 0,1,2) are in trash; index 3 remains in life
    expect(state.players.A.trash).toEqual([lifeIds[0]!, lifeIds[1]!, lifeIds[2]!]);
    expect(state.players.A.life).toEqual([lifeIds[3]!]);
  });

  it('n=0, life=4 → life delta -4, trash delta +4 (trash all)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const lifeIds = seedLife(state, 4);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = {
      lifeSize: state.players.A.life.length,
      trashSize: state.players.A.trash.length,
    };

    actionHandlers.get('trash_own_life_until')(state, ctx, {
      kind: 'trash_own_life_until', n: 0,
    }, []);

    expect(state.players.A.life.length - pre.lifeSize).toBe(-4);
    expect(state.players.A.trash.length - pre.trashSize).toBe(4);
    expect(state.players.A.life).toEqual([]);
    expect(state.players.A.trash).toEqual(lifeIds);
  });

  it('n=5, life=2 → no deltas (life already ≤ target)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const lifeIds = seedLife(state, 2);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = {
      lifeSize: state.players.A.life.length,
      trashSize: state.players.A.trash.length,
    };

    actionHandlers.get('trash_own_life_until')(state, ctx, {
      kind: 'trash_own_life_until', n: 5,
    }, []);

    expect(state.players.A.life.length - pre.lifeSize).toBe(0);
    expect(state.players.A.trash.length - pre.trashSize).toBe(0);
    expect(state.players.A.life).toEqual(lifeIds);
  });

  it('life=[] (empty) → no crash; deltas remain zero', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = {
      lifeSize: state.players.A.life.length,
      trashSize: state.players.A.trash.length,
    };

    expect(() => {
      actionHandlers.get('trash_own_life_until')(state, ctx, {
        kind: 'trash_own_life_until', n: 1,
      }, []);
    }).not.toThrow();

    expect(state.players.A.life.length).toBe(pre.lifeSize);
    expect(state.players.A.trash.length).toBe(pre.trashSize);
  });

  it('missing n field, life=3 → defaults to 1; life delta -2, trash delta +2', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    seedLife(state, 3);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = {
      lifeSize: state.players.A.life.length,
      trashSize: state.players.A.trash.length,
    };

    actionHandlers.get('trash_own_life_until')(state, ctx, {
      kind: 'trash_own_life_until',
    }, []);

    expect(state.players.A.life.length - pre.lifeSize).toBe(-2);
    expect(state.players.A.trash.length - pre.trashSize).toBe(2);
  });
});
