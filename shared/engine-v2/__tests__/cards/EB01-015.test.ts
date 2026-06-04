/**
 * Per-card semantic test — EB01-015 Scratchmen Apoo (character).
 *
 * Printed text (cards.json):
 *   "[On Play] Rest up to 1 of your opponent's Characters with a cost of
 *    2 or less."
 *
 * 5-axis: clause on_play / action rest_target / target opp_character with
 *   filter costMax:2.
 *
 * All primitives registered. No spec gap. No engine gap.
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
import { targetResolvers } from '../../registry/types.js';
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

const VANILLA_LEADER: LeaderCard = {
  id: 'TEST_LEADER_EB015',
  name: 'TEST',
  kind: 'leader',
  colors: ['green'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

function oppChar(id: string, cost: number): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['green'],
    cost,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-015 — Scratchmen Apoo (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-015');
  if (eb === undefined) throw new Error('EB01-015 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-015 should be a character');
  const apoo = eb as CharacterCard;
  const clause = apoo.effectSpecV2?.clauses?.[0];
  if (clause === undefined || clause.target === undefined) {
    throw new Error('EB01-015 missing clause/target');
  }

  describe('target resolver — opp_character with costMax:2', () => {
    it('INCLUDES a cost-1 opp char', () => {
      const c = oppChar('TEST_C1', 1);
      const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [c] });
      const cId = fieldB[0]!.instanceId;
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: 'src', controller: 'A' }, clause.target);
      expect(ids).toContain(cId);
    });

    it('INCLUDES a cost-2 opp char (boundary, inclusive)', () => {
      const c = oppChar('TEST_C2', 2);
      const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [c] });
      const cId = fieldB[0]!.instanceId;
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: 'src', controller: 'A' }, clause.target);
      expect(ids).toContain(cId);
    });

    it('EXCLUDES a cost-3 opp char', () => {
      const c = oppChar('TEST_C3', 3);
      const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [c] });
      const cId = fieldB[0]!.instanceId;
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: 'src', controller: 'A' }, clause.target);
      expect(ids).not.toContain(cId);
    });

    it('does NOT return own leader', () => {
      const { state, leaderInstA } = buildState({ leaderA: VANILLA_LEADER });
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: 'src', controller: 'A' }, clause.target);
      expect(ids).not.toContain(leaderInstA.instanceId);
    });
  });

  describe('on_play dispatch — rests the targeted cost ≤ 2 opp char', () => {
    it('rests cost-1 opp char', () => {
      const c = oppChar('TEST_REST_C1', 1);
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [apoo],
        charsB: [c],
      });
      const apooId = fieldA[0]!.instanceId;
      const oppId = fieldB[0]!.instanceId;
      expect(state.instances[oppId]!.rested).toBe(false);
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: apooId, controller: 'A' },
        'on_play',
      );
      expect(next.instances[oppId]!.rested).toBe(true);
    });

    it('does NOT rest cost-3 opp char (filter excludes target)', () => {
      const c = oppChar('TEST_REST_C3', 3);
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [apoo],
        charsB: [c],
      });
      const apooId = fieldA[0]!.instanceId;
      const oppId = fieldB[0]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: apooId, controller: 'A' },
        'on_play',
      );
      expect(next.instances[oppId]!.rested).toBe(false);
    });
  });
});
