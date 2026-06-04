/**
 * Per-card semantic test — EB02-016 Chopperman (character).
 * "Also treat this card's name as [Tony Tony.Chopper] according to the rules.
 *  [On Play] Play up to 1 {Animal} type Character card with a cost of 3 or
 *  less from your hand."
 * Spec: on_play / play_for_free from:hand filter{trait:Animal, costMax:3, kind:character}
 *   + rules.nameAliases:['Tony Tony.Chopper'].
 *
 * Engine gap re-ref EB01-013/020/033/043: play_for_free no clause-target
 *   → action no-op. Behavioral positive uses it.fails.
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
  id: 'TEST_L_EB02016', name: 'L', kind: 'leader', colors: ['green'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function animalChar(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['green'], cost, power: 2000,
    counterValue: 1000, traits: ['Animal'], keywords: [], effectTags: [],
  };
}

function nonAnimal(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['green'], cost, power: 2000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-016 — Chopperman', () => {
  const c = loadCards().find((x) => x.id === 'EB02-016');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-016 invalid');
  const cm = c as CharacterCard;
  const clause = cm.effectSpecV2!.clauses![0]!;
  const spec = cm.effectSpecV2 as { rules?: { nameAliases?: string[] } };

  it('shape: on_play / play_for_free from:hand filter{trait:Animal, costMax:3, kind:character}', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('play_for_free');
    const f = (clause.action as { from: string; filter: { trait: string; costMax: number; kind: string } });
    expect(f.from).toBe('hand');
    expect(f.filter.trait).toBe('Animal');
    expect(f.filter.costMax).toBe(3);
    expect(f.filter.kind).toBe('character');
  });

  it('spec.rules.nameAliases includes Tony Tony.Chopper', () => {
    expect(spec.rules?.nameAliases).toContain('Tony Tony.Chopper');
  });

  it('cost-4 Animal in hand: NOT played (costMax exclude)', () => {
    const big = animalChar('TEST_BIG_ANIMAL_E16', 4);
    const { state, fieldA, handAInstances } = buildState({
      leaderA: L, charsA: [cm], handA: [big],
    });
    const bigInstId = handAInstances[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(bigInstId);
    expect(next.players.A.hand).toContain(bigInstId);
  });

  it('non-Animal cost-1 in hand: NOT played (trait filter exclude)', () => {
    const tinyHuman = nonAnimal('TEST_TINY_HUMAN_E16', 1);
    const { state, fieldA, handAInstances } = buildState({
      leaderA: L, charsA: [cm], handA: [tinyHuman],
    });
    const id = handAInstances[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(id);
    expect(next.players.A.hand).toContain(id);
  });

  it(
    'cost-3 Animal in hand: played onto field',
    () => {
      const cand = animalChar('TEST_CAND_ANIMAL_E16', 3);
      const { state, fieldA, handAInstances } = buildState({
        leaderA: L, charsA: [cm], handA: [cand],
      });
      const candInstId = handAInstances[0]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
      );
      expect(next.players.A.field.map((i) => i.instanceId)).toContain(candInstId);
    },
  );
});
