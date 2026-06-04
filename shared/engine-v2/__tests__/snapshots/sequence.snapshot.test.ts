/**
 * Engine V2 — snapshot regression test: sequence sub-action zone deltas.
 *
 * Pattern: capture pre-state values on the target zones each sub-action
 * mutates; dispatch the sequence; assert ONLY the per-sub-action delta on
 * its declared target zone. No full-state snapshot.
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
  id: 'SEQ_SNAP_L', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function ch(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost: 2, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('sequence snapshot — sub-action zone deltas', () => {
  it('explicit sub-targets: leader gets +1000, opp char gets -2000 (independent deltas)', () => {
    const own = ch('SEQ_OWN_1');
    const opp = ch('SEQ_OPP_1');
    const { state, leaderInstA, fieldB } = buildState({
      leaderA: L, charsA: [own], charsB: [opp],
    });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = {
      leaderMod: state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0,
      oppMod: state.instances[fieldB[0]!.instanceId]!.powerModifierOneShot ?? 0,
    };

    actionHandlers.get('sequence')(state, ctx, {
      kind: 'sequence',
      actions: [
        { kind: 'power_buff', magnitude: 1000, duration: 'this_turn', target: { kind: 'your_leader' } },
        { kind: 'power_buff', magnitude: -2000, duration: 'this_turn', target: { kind: 'opp_character' } },
      ],
    }, []);

    expect((state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0) - pre.leaderMod).toBe(1000);
    expect((state.instances[fieldB[0]!.instanceId]!.powerModifierOneShot ?? 0) - pre.oppMod).toBe(-2000);
  });

  it('inherited target: sub-actions without target both buff the parent-supplied instance', () => {
    const own = ch('SEQ_OWN_2');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [own] });
    const ownId = fieldA[0]!.instanceId;
    const ctx = { sourceInstanceId: ownId, controller: 'A' as const };
    const pre = state.instances[ownId]!.powerModifierOneShot ?? 0;

    actionHandlers.get('sequence')(state, ctx, {
      kind: 'sequence',
      actions: [
        { kind: 'power_buff', magnitude: 1000, duration: 'this_turn' },
        { kind: 'power_buff', magnitude: 500, duration: 'this_turn' },
      ],
    }, [ownId]);

    expect((state.instances[ownId]!.powerModifierOneShot ?? 0) - pre).toBe(1500);
  });

  it('empty-target sub-action skipped; next sub-action with valid target still applies', () => {
    // First sub: opp_character with no charsB on field → resolves [] → skipped
    // Second sub: your_leader → applies +3000
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0;

    actionHandlers.get('sequence')(state, ctx, {
      kind: 'sequence',
      actions: [
        { kind: 'power_buff', magnitude: -2000, duration: 'this_turn', target: { kind: 'opp_character' } },
        { kind: 'power_buff', magnitude: 3000, duration: 'this_turn', target: { kind: 'your_leader' } },
      ],
    }, []);

    expect((state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0) - pre).toBe(3000);
  });

  it('chained_actions alias: identical behavior to sequence', () => {
    const own = ch('SEQ_OWN_3');
    const { state, leaderInstA, fieldA } = buildState({ leaderA: L, charsA: [own] });
    void fieldA;
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0;

    actionHandlers.get('chained_actions')(state, ctx, {
      kind: 'chained_actions',
      actions: [
        { kind: 'power_buff', magnitude: 500, duration: 'this_turn', target: { kind: 'your_leader' } },
      ],
    }, []);

    expect((state.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0) - pre).toBe(500);
  });

  it('empty actions array → zero delta on any zone', () => {
    const own = ch('SEQ_OWN_4');
    const opp = ch('SEQ_OPP_4');
    const { state, leaderInstA, fieldB } = buildState({
      leaderA: L, charsA: [own], charsB: [opp],
    });
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = {
      leaderMod: state.instances[leaderInstA.instanceId]!.powerModifierOneShot,
      oppMod: state.instances[fieldB[0]!.instanceId]!.powerModifierOneShot,
    };

    actionHandlers.get('sequence')(state, ctx, { kind: 'sequence', actions: [] }, []);

    expect(state.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBe(pre.leaderMod);
    expect(state.instances[fieldB[0]!.instanceId]!.powerModifierOneShot).toBe(pre.oppMod);
  });
});
