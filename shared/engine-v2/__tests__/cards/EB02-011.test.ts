/**
 * Per-card semantic test — EB02-011 Arlong (character).
 * "[On Play] If your Leader has the {Fish-Man} or {East Blue} type, give
 *  up to 1 rested DON!! card to 1 of your Leader. Then, up to 1 of your
 *  opponent's Characters with a cost of 5 or less cannot be rested until
 *  the end of your opponent's next turn."
 * Spec: TWO on_play clauses (both gated by OR(Fish-Man, East Blue)):
 *   1) give_don_to_target magnitude:1 rested:true / your_leader
 *   2) rest_lock_until_phase until:opp_next_end_phase / opp_character costMax:5
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';

import { buildState } from './_fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

function loadCards(): Card[] {
  const raw = readFileSync(resolve(__dirname, '../../../data/cards.json'), 'utf-8');
  return JSON.parse(raw) as Card[];
}

const FM_LEADER: LeaderCard = {
  id: 'TEST_FM_LEADER', name: 'L', kind: 'leader', colors: ['green'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: ['Fish-Man'], keywords: [], effectTags: [],
};

function opp(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['green'], cost, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-011 — Arlong', () => {
  const c = loadCards().find((x) => x.id === 'EB02-011');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-011 invalid');
  const arl = c as CharacterCard;
  const clauses = arl.effectSpecV2!.clauses!;

  it('shape: 2 on_play clauses with OR(Fish-Man, East Blue) gate', () => {
    expect(clauses).toHaveLength(2);
    for (const cl of clauses) {
      expect(cl.trigger).toBe('on_play');
      expect(cl.condition!.type).toBe('or');
    }
    expect(clauses[0]!.action.kind).toBe('give_don_to_target');
    expect(clauses[0]!.target!.kind).toBe('your_leader');
    expect(clauses[1]!.action.kind).toBe('rest_lock_until_phase');
    expect((clauses[1]!.action as { until: string }).until).toBe('opp_next_end_phase');
    expect((clauses[1]!.target as { filter: { costMax: number } }).filter.costMax).toBe(5);
  });

  it('Fish-Man leader: 1 rested DON to leader + cost-5 opp char becomes rest-locked', () => {
    const o = opp('TEST_OPP_RESTLOCK', 5);
    const { state, fieldA, fieldB, leaderInstA } = buildState({
      leaderA: FM_LEADER, charsA: [arl], charsB: [o],
    });
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.instances[leaderInstA.instanceId]!.attachedDonRested?.length ?? 0).toBe(1);
    expect(next.instances[oId]!.restLockedUntilTurn).toBeDefined();
    void fieldB;
  });

  it('East Blue leader: OR branch fires (rest-lock applies)', () => {
    const ebLeader: LeaderCard = { ...FM_LEADER, id: 'TEST_EB_LEADER_11', traits: ['East Blue'] };
    const o = opp('TEST_OPP_EB_11', 5);
    const { state, fieldA, fieldB } = buildState({
      leaderA: ebLeader, charsA: [arl], charsB: [o],
    });
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.instances[oId]!.restLockedUntilTurn).toBeDefined();
  });

  it('non-Fish-Man non-East-Blue leader: condition OR false → no DON to leader, no rest-lock', () => {
    const otherLeader: LeaderCard = { ...FM_LEADER, id: 'TEST_OTHER_11', traits: ['Other'] };
    const o = opp('TEST_OPP_OTHER_11', 5);
    const { state, fieldA, fieldB, leaderInstA } = buildState({
      leaderA: otherLeader, charsA: [arl], charsB: [o],
    });
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.instances[leaderInstA.instanceId]!.attachedDonRested?.length ?? 0).toBe(0);
    expect(next.instances[oId]!.restLockedUntilTurn).toBeUndefined();
  });

  it('cost-6 opp char NOT rest-locked (filter exclude)', () => {
    const o = opp('TEST_OPP_C6_11', 6);
    const { state, fieldA, fieldB } = buildState({
      leaderA: FM_LEADER, charsA: [arl], charsB: [o],
    });
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.instances[oId]!.restLockedUntilTurn).toBeUndefined();
  });
});
