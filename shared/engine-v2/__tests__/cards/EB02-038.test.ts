/**
 * Per-card semantic test — EB02-038 Magellan (character).
 * "[On Play] Play up to 1 {Impel Down} type Character card with a cost of
 *  2 or less from your hand."
 * Spec: on_play / play_for_free from:hand filter{trait:Impel Down, costMax:2, kind:character}.
 *
 * Engine gap re-ref EB01-013: play_for_free no clause-target → no-op.
 * Positive uses it.fails.
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
  id: 'TEST_L_EB02038', name: 'L', kind: 'leader', colors: ['purple'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function impelDownChar(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['purple'], cost, power: 2000,
    counterValue: 1000, traits: ['Impel Down'], keywords: [], effectTags: [],
  };
}

function nonImpel(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['purple'], cost, power: 2000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-038 — Magellan', () => {
  const c = loadCards().find((x) => x.id === 'EB02-038');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-038 invalid');
  const mag = c as CharacterCard;
  const clause = mag.effectSpecV2!.clauses![0]!;

  it('shape: on_play / play_for_free from:hand filter{trait:Impel Down, costMax:2, kind:character}', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('play_for_free');
    const a = clause.action as { from: string; filter: { trait: string; costMax: number; kind: string } };
    expect(a.from).toBe('hand');
    expect(a.filter.trait).toBe('Impel Down');
    expect(a.filter.costMax).toBe(2);
    expect(a.filter.kind).toBe('character');
  });

  it('cost-3 Impel Down in hand: NOT played (costMax exclude)', () => {
    const big = impelDownChar('TEST_BIG_E38', 3);
    const { state, fieldA, handAInstances } = buildState({
      leaderA: L, charsA: [mag], handA: [big],
    });
    const id = handAInstances[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(id);
    expect(next.players.A.hand).toContain(id);
  });

  it('cost-2 non-Impel-Down in hand: NOT played (trait exclude)', () => {
    const other = nonImpel('TEST_OTHER_E38', 2);
    const { state, fieldA, handAInstances } = buildState({
      leaderA: L, charsA: [mag], handA: [other],
    });
    const id = handAInstances[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(id);
    expect(next.players.A.hand).toContain(id);
  });

  it(
    'cost-2 Impel Down in hand: played onto field',
    () => {
      const cand = impelDownChar('TEST_CAND_E38', 2);
      const { state, fieldA, handAInstances } = buildState({
        leaderA: L, charsA: [mag], handA: [cand],
      });
      const candId = handAInstances[0]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
      );
      expect(next.players.A.field.map((i) => i.instanceId)).toContain(candId);
    },
  );
});
