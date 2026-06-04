/**
 * Per-card semantic test — EB02-014 Sarfunkel (character).
 * "[On Play] Play up to 1 [Gaimon] from your hand."
 * Spec: on_play / play_for_free from:'hand' filter{nameIs:Gaimon}.
 *
 * Engine gap re-ref (EB01-013/020/033/043): play_for_free has no
 * clause-target → engine no-ops. Positive behavioral test uses it.fails.
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
  id: 'TEST_L_EB02014', name: 'L', kind: 'leader', colors: ['green'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function gaimon(): CharacterCard {
  return {
    id: 'TEST_GAIMON_E14', name: 'Gaimon', kind: 'character', colors: ['green'],
    cost: 1, power: 1000, counterValue: 1000, traits: ['East Blue'], keywords: [], effectTags: [],
  };
}

function notGaimon(): CharacterCard {
  return {
    id: 'TEST_NOT_GAIMON_E14', name: 'NotGaimon', kind: 'character', colors: ['green'],
    cost: 1, power: 1000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-014 — Sarfunkel', () => {
  const c = loadCards().find((x) => x.id === 'EB02-014');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-014 invalid');
  const sa = c as CharacterCard;
  const clause = sa.effectSpecV2!.clauses![0]!;

  it('shape: on_play / play_for_free from:hand filter.nameIs:Gaimon', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('play_for_free');
    expect((clause.action as { from: string; filter: { nameIs: string } }).from).toBe('hand');
    expect((clause.action as { from: string; filter: { nameIs: string } }).filter.nameIs).toBe('Gaimon');
  });

  it('no Gaimon in hand: nothing leaves hand, field stays at just Sarfunkel', () => {
    const filler = notGaimon();
    const { state, fieldA, handAInstances } = buildState({
      leaderA: L, charsA: [sa], handA: [filler],
    });
    const handBefore = handAInstances[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand).toContain(handBefore);
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(handBefore);
  });

  it(
    'Gaimon in hand: positive play_for_free puts Gaimon on field',
    () => {
      const gai = gaimon();
      const { state, fieldA, handAInstances } = buildState({
        leaderA: L, charsA: [sa], handA: [gai],
      });
      const gaiInstId = handAInstances[0]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
      );
      expect(next.players.A.field.map((i) => i.instanceId)).toContain(gaiInstId);
    },
  );
});
