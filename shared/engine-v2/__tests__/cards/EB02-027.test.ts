/**
 * Per-card semantic test — EB02-027 Vista (character).
 * "[On Play] Place up to 1 of your opponent's Characters with 1000 power
 *  or less at the bottom of the owner's deck."
 * Spec: on_play / bottom_of_deck_to_opp_deck / opp_character powerMax:1000.
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
  id: 'TEST_L_EB02027', name: 'L', kind: 'leader', colors: ['blue'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function opp(id: string, power: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['blue'], cost: 1, power,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-027 — Vista', () => {
  const c = loadCards().find((x) => x.id === 'EB02-027');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-027 invalid');
  const v = c as CharacterCard;
  const clause = v.effectSpecV2!.clauses![0]!;

  it('shape: on_play / bottom_of_deck_to_opp_deck / opp_character powerMax:1000', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('bottom_of_deck_to_opp_deck');
    expect((clause.target as { filter: { powerMax: number } }).filter.powerMax).toBe(1000);
  });

  it('1000-power opp char goes to bottom of B.deck', () => {
    const o = opp('TEST_OPP_PWR_1000_27', 1000);
    const { state, fieldA, fieldB } = buildState({
      leaderA: L, charsA: [v], charsB: [o],
    });
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oId)).toBe(false);
    expect(next.players.B.deck).toContain(oId);
  });

  it('2000-power opp char unaffected (filter exclude)', () => {
    const o = opp('TEST_OPP_PWR_2000_27', 2000);
    const { state, fieldA, fieldB } = buildState({
      leaderA: L, charsA: [v], charsB: [o],
    });
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oId)).toBe(true);
  });
});
