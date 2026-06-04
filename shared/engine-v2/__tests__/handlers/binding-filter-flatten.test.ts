/**
 * Engine V2 — hardening unit test: BindingRef filter flattening.
 *
 * `flattenBindingFilter` is a private helper in actions2.ts; its behavior
 * is exposed via `play_for_free`'s hand-scan path. This test seeds a
 * ClauseScratch with a known BindingSnapshot, then dispatches play_for_free
 * with BindingRef-shaped filters to verify:
 *   - colors BindingRef op:'eq' → cards matching binding colors pass
 *   - colors BindingRef op:'ne' → cards matching binding colors excluded
 *   - nameIs BindingRef op:'eq' → name match
 *   - missing binding → field stripped (no crash)
 *
 * Scope: direct play_for_free handler call with manually-seeded scratch
 * (uses writeBinding for the canonical scratch shape).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { actionHandlers } from '../../registry/types.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';
import { newClauseScratch, writeBinding } from '../../effects/clauseScratch.js';
import type { CharacterCard, LeaderCard } from '../../cards/Card.js';

import { buildState, makeInst } from '../cards/_fixtures.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

const L: LeaderCard = {
  id: 'TEST_BF_L', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function ch(id: string, color: 'red' | 'blue' | 'green', name: string): CharacterCard {
  return {
    id, name, kind: 'character', colors: [color], cost: 2, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

function pushHand(state: ReturnType<typeof buildState>['state'], card: CharacterCard): string {
  state.cardLibrary[card.id] = card;
  const inst = makeInst(card.id, 'A');
  state.instances[inst.instanceId] = inst;
  state.players.A.hand.push(inst.instanceId);
  return inst.instanceId;
}

function seedBindingSource(state: ReturnType<typeof buildState>['state'], card: CharacterCard): string {
  state.cardLibrary[card.id] = card;
  const inst = makeInst(card.id, 'A');
  state.instances[inst.instanceId] = inst;
  return inst.instanceId;
}

describe('flattenBindingFilter — exposed via play_for_free hand-scan', () => {
  it('colors BindingRef op:"ne" excludes cards sharing the binding colors', () => {
    // Source binding "returned" represents a red character; play_for_free
    // filter excludes red cards. Hand has 1 red + 1 blue; only blue plays.
    const { state, leaderInstA } = buildState({ leaderA: L });
    const redHandId = pushHand(state, ch('BF_HAND_RED', 'red', 'RedCard'));
    const blueHandId = pushHand(state, ch('BF_HAND_BLUE', 'blue', 'BlueCard'));
    const bindingSourceId = seedBindingSource(state, ch('BF_SRC', 'red', 'Source'));

    const scratch = newClauseScratch();
    writeBinding(state, scratch, 'returned', bindingSourceId);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const, scratch };
    actionHandlers.get('play_for_free')(state, ctx, {
      kind: 'play_for_free', from: 'hand',
      filter: {
        kind: 'character',
        colors: { kind: 'binding', name: 'returned', field: 'colors', op: 'ne' },
      },
    }, []);
    expect(state.players.A.field.some((i) => i.instanceId === blueHandId)).toBe(true);
    expect(state.players.A.field.some((i) => i.instanceId === redHandId)).toBe(false);
    expect(state.players.A.hand).toContain(redHandId);
  });

  it('colors BindingRef op:"eq" only allows cards sharing the binding colors', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const redHandId = pushHand(state, ch('BF2_RED', 'red', 'Red2'));
    const blueHandId = pushHand(state, ch('BF2_BLUE', 'blue', 'Blue2'));
    const bindingSourceId = seedBindingSource(state, ch('BF2_SRC', 'red', 'Source2'));
    const scratch = newClauseScratch();
    writeBinding(state, scratch, 'returned', bindingSourceId);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const, scratch };
    actionHandlers.get('play_for_free')(state, ctx, {
      kind: 'play_for_free', from: 'hand',
      filter: {
        kind: 'character',
        colors: { kind: 'binding', name: 'returned', field: 'colors', op: 'eq' },
      },
    }, []);
    expect(state.players.A.field.some((i) => i.instanceId === redHandId)).toBe(true);
    expect(state.players.A.hand).toContain(blueHandId);
  });

  it('nameIs BindingRef op:"eq" matches only cards with binding.name', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const matchingId = pushHand(state, ch('BF3_M', 'red', 'Laboon'));
    const otherId = pushHand(state, ch('BF3_O', 'red', 'NotLaboon'));
    const bindingSourceId = seedBindingSource(state, ch('BF3_SRC', 'red', 'Laboon'));
    const scratch = newClauseScratch();
    writeBinding(state, scratch, 'discarded', bindingSourceId);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const, scratch };
    actionHandlers.get('play_for_free')(state, ctx, {
      kind: 'play_for_free', from: 'hand',
      filter: {
        kind: 'character',
        nameIs: { kind: 'binding', name: 'discarded', field: 'name', op: 'eq' },
      },
    }, []);
    expect(state.players.A.field.some((i) => i.instanceId === matchingId)).toBe(true);
    expect(state.players.A.hand).toContain(otherId);
  });

  it('missing binding name → field stripped, no crash, filter relaxed', () => {
    // BindingRef points to "ghost" which was never written. flattenBindingFilter
    // should strip the field and continue without throwing. With colors stripped,
    // both red and blue hand cards match (no color constraint).
    const { state, leaderInstA } = buildState({ leaderA: L });
    const redId = pushHand(state, ch('BF4_RED', 'red', 'X'));
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const, scratch: newClauseScratch() };
    expect(() => {
      actionHandlers.get('play_for_free')(state, ctx, {
        kind: 'play_for_free', from: 'hand',
        filter: {
          kind: 'character',
          colors: { kind: 'binding', name: 'ghost', field: 'colors', op: 'ne' },
        },
      }, []);
    }).not.toThrow();
    expect(state.players.A.field.some((i) => i.instanceId === redId)).toBe(true);
  });

  it('nameExcludes BindingRef strips when unresolved (no false-exclusion crash)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const cardId = pushHand(state, ch('BF5', 'red', 'AnyName'));
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const, scratch: newClauseScratch() };
    expect(() => {
      actionHandlers.get('play_for_free')(state, ctx, {
        kind: 'play_for_free', from: 'hand',
        filter: {
          kind: 'character',
          nameExcludes: { kind: 'binding', name: 'ghost', field: 'name' },
        },
      }, []);
    }).not.toThrow();
    expect(state.players.A.field.some((i) => i.instanceId === cardId)).toBe(true);
  });
});
