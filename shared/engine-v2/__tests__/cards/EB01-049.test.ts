/**
 * Per-card semantic test — EB01-049 T-Bone (character).
 * "[On Play] K.O. up to 1 of your opponent's Characters with a cost of 2 or less."
 * Spec: on_play / removal_ko / opp_character costMax:2.
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
  id: 'TEST_L_EB049',
  name: 'L',
  kind: 'leader',
  colors: ['black'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

function opp(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['black'], cost, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB01-049 — T-Bone', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-049');
  if (eb === undefined || eb.kind !== 'character') throw new Error('EB01-049 invalid');
  const tbone = eb as CharacterCard;
  const clause = tbone.effectSpecV2!.clauses![0]!;

  it('spec shape: on_play / removal_ko / opp_character costMax:2', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('removal_ko');
    expect(clause.target!.kind).toBe('opp_character');
    expect((clause.target as { filter: { costMax: number } }).filter.costMax).toBe(2);
  });

  it('KOs a cost-2 opp char', () => {
    const o = opp('TEST_OPP_C2', 2);
    const { state, fieldA, fieldB } = buildState({ leaderA: L, charsA: [tbone], charsB: [o] });
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oId)).toBe(false);
    expect(next.players.B.trash).toContain(oId);
  });

  it('does NOT KO cost-3 opp char', () => {
    const o = opp('TEST_OPP_C3', 3);
    const { state, fieldA, fieldB } = buildState({ leaderA: L, charsA: [tbone], charsB: [o] });
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oId)).toBe(true);
  });
});
