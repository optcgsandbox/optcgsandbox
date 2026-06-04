/**
 * Per-card semantic test — EB02-022 Usopp (character).
 * "[On Play] If you have 2 or less Characters with 5000 power or more,
 *  play up to 1 Character card with 6000 power or less and no base
 *  effect from your hand."
 * Spec: on_play / if_own_chars_max_with_min_power{n:2,minPower:5000} /
 *   play_for_free from:hand filter{powerMax:6000, kind:character, noBaseEffect:true}.
 *
 * Engine gap re-ref EB01-013/020/033/043: play_for_free no clause-target
 *   → action no-op. Positive uses it.fails.
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

const L: LeaderCard = {
  id: 'TEST_L_EB02022', name: 'L', kind: 'leader', colors: ['blue'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function vanillaChar(id: string, power: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['blue'], cost: 3, power,
    counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  };
}

function bigChar(id: string, power: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['blue'], cost: 5, power,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-022 — Usopp', () => {
  const c = loadCards().find((x) => x.id === 'EB02-022');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-022 invalid');
  const us = c as CharacterCard;
  const clause = us.effectSpecV2!.clauses![0]!;

  it('shape: on_play / if_own_chars_max_with_min_power(n:2,minPower:5000) / play_for_free from:hand powerMax:6000 noBaseEffect', () => {
    expect(clause.trigger).toBe('on_play');
    const cond = clause.condition as { type: string; n: number; minPower: number };
    expect(cond.type).toBe('if_own_chars_max_with_min_power');
    expect(cond.n).toBe(2);
    expect(cond.minPower).toBe(5000);
    expect(clause.action.kind).toBe('play_for_free');
    const a = clause.action as { from: string; filter: { powerMax: number; kind: string; noBaseEffect: boolean } };
    expect(a.from).toBe('hand');
    expect(a.filter.powerMax).toBe(6000);
    expect(a.filter.kind).toBe('character');
    expect(a.filter.noBaseEffect).toBe(true);
  });

  it('3 large allies on field (condition fail >2): no play', () => {
    const big1 = bigChar('TEST_BIG1_E22', 7000);
    const big2 = bigChar('TEST_BIG2_E22', 7000);
    const big3 = bigChar('TEST_BIG3_E22', 7000);
    const handCard = vanillaChar('TEST_HAND_E22', 4000);
    const { state, fieldA, handAInstances } = buildState({
      leaderA: L, charsA: [us, big1, big2, big3], handA: [handCard],
    });
    const handId = handAInstances[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(handId);
    expect(next.players.A.hand).toContain(handId);
  });

  it('cost-7 / 7000-power non-vanilla in hand: filter exclude (powerMax + noBaseEffect)', () => {
    const big = bigChar('TEST_BIG_HAND_E22', 7000);
    const { state, fieldA, handAInstances } = buildState({
      leaderA: L, charsA: [us], handA: [big],
    });
    const id = handAInstances[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(id);
    expect(next.players.A.hand).toContain(id);
  });

  it(
    'condition holds + 5000-vanilla in hand: positive play',
    () => {
      const cand = vanillaChar('TEST_CAND_VAN_E22', 5000);
      const { state, fieldA, handAInstances } = buildState({
        leaderA: L, charsA: [us], handA: [cand],
      });
      const candId = handAInstances[0]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
      );
      expect(next.players.A.field.map((i) => i.instanceId)).toContain(candId);
    },
  );
});
