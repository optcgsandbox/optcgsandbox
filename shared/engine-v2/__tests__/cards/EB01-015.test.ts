/**
 * Per-card semantic test — EB01-015 Scratchmen Apoo (character).
 *
 * Printed text (cards.json):
 *   "[On Play] Rest up to 1 of your opponent's Characters with a cost
 *    of 2 or less."
 *
 * Validates the target resolver (opp_character with costMax filter)
 * and the rest_target action.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { actionHandlers, targetResolvers } from '../../registry/types.js';
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
  id: 'TEST_LEADER',
  name: 'Vanilla Leader',
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
  const apoo = allCards.find((c) => c.id === 'EB01-015');
  if (apoo === undefined) throw new Error('EB01-015 not in cards.json');
  if (apoo.kind !== 'character') throw new Error('EB01-015 should be a character');
  const clause = apoo.effectSpecV2?.clauses?.[0];
  if (clause === undefined || clause.target === undefined) {
    throw new Error('EB01-015 missing clause / target');
  }

  describe('target resolution — opp_character with costMax', () => {
    it('INCLUDES a cost-1 opp char', () => {
      const c1 = oppChar('TEST_C1', 1);
      const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [c1] });
      const c1Id = fieldB[0]!.instanceId;
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: 'src', controller: 'A' }, clause.target);
      expect(ids).toContain(c1Id);
    });

    it('INCLUDES a cost-2 opp char (boundary)', () => {
      const c2 = oppChar('TEST_C2', 2);
      const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [c2] });
      const c2Id = fieldB[0]!.instanceId;
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: 'src', controller: 'A' }, clause.target);
      expect(ids).toContain(c2Id);
    });

    it('EXCLUDES a cost-3 opp char', () => {
      const c3 = oppChar('TEST_C3', 3);
      const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [c3] });
      const c3Id = fieldB[0]!.instanceId;
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: 'src', controller: 'A' }, clause.target);
      expect(ids).not.toContain(c3Id);
    });

    it('does NOT return own leader', () => {
      const { state, leaderInstA } = buildState({ leaderA: VANILLA_LEADER });
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: 'src', controller: 'A' }, clause.target);
      expect(ids).not.toContain(leaderInstA.instanceId);
    });
  });

  describe('rest_target action', () => {
    it('rests the targeted opp char', () => {
      const c1 = oppChar('TEST_REST_C1', 1);
      const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [c1] });
      const c1Id = fieldB[0]!.instanceId;
      expect(state.instances[c1Id]!.rested).toBe(false);

      const handler = actionHandlers.get(clause.action.kind);
      const next = handler(
        state,
        { sourceInstanceId: 'src', controller: 'A' },
        clause.action,
        [c1Id],
      );
      expect(next.instances[c1Id]!.rested).toBe(true);
    });
  });
});
