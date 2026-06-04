/**
 * Per-card semantic test — EB01-054 Gan.Fall (character).
 * "[Blocker] ... [On Play] If your opponent has 1 or less Life cards, K.O.
 *  up to 1 of your opponent's Characters with a cost of 3 or less."
 * Spec: continuous grant blocker. Clause on_play / if_opp_life_max n:1 /
 *   removal_ko / opp_character costMax:3.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { ContinuousManager } from '../../effects/ContinuousManager.js';
import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';

import { buildState, makeInst } from './_fixtures.js';

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
  id: 'TEST_L_EB054', name: 'L', kind: 'leader', colors: ['yellow'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function opp(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['yellow'], cost, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

function seedOppLife(state: ReturnType<typeof buildState>['state'], n: number): void {
  for (let i = 0; i < n; i++) {
    const id = `B-LIFE-${i}`;
    state.instances[id] = makeInst('__VANILLA', 'B');
    state.instances[id].instanceId = id;
    state.players.B.life.push(id);
  }
}

describe('EB01-054 — Gan.Fall', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-054');
  if (eb === undefined || eb.kind !== 'character') throw new Error('EB01-054 invalid');
  const gf = eb as CharacterCard;
  const clause = gf.effectSpecV2!.clauses![0]!;

  it('clause shape: on_play / if_opp_life_max n:1 / removal_ko / opp_character costMax:3', () => {
    expect(clause.trigger).toBe('on_play');
    expect((clause.condition as { n: number }).n).toBe(1);
    expect(clause.action.kind).toBe('removal_ko');
    expect((clause.target as { filter: { costMax: number } }).filter.costMax).toBe(3);
  });

  it('continuous grants blocker', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [gf] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
  });

  it('opp life=1, cost-3 opp char gets KO\'d', () => {
    const o = opp('TEST_OPP_KO_54', 3);
    const { state, fieldA, fieldB } = buildState({ leaderA: L, charsA: [gf], charsB: [o] });
    seedOppLife(state, 1);
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oId)).toBe(false);
  });

  it('opp life=2 → condition false → no KO', () => {
    const o = opp('TEST_OPP_NOKO_54', 3);
    const { state, fieldA, fieldB } = buildState({ leaderA: L, charsA: [gf], charsB: [o] });
    seedOppLife(state, 2);
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oId)).toBe(true);
  });
});
