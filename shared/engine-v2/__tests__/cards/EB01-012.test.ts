/**
 * Per-card semantic test — EB01-012 Cavendish (character).
 *
 * Printed text (cards.json):
 *   "[On Play]/[When Attacking] If your Leader has the {Supernovas} type
 *    and you have no other [Cavendish] Characters, set up to 2 of your
 *    DON!! cards as active."
 *
 * Validates the dual condition (leader trait + no-other-by-name) and
 * the set_active_don action (rested DON → active cost area).
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { evaluateCondition } from '../../effects/EffectDispatcher.js';
import { actionHandlers } from '../../registry/types.js';
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

function makeLeader(traits: string[]): LeaderCard {
  return {
    id: 'TEST_LEADER_EB012',
    name: 'TEST_LEADER',
    kind: 'leader',
    colors: ['green'],
    cost: null,
    power: 5000,
    life: 5,
    counterValue: null,
    traits,
    keywords: [],
    effectTags: [],
  };
}

const CAV: CharacterCard = {
  id: 'TEST_CAV',
  name: 'Cavendish',
  kind: 'character',
  colors: ['green'],
  cost: 5,
  power: 6000,
  counterValue: 1000,
  traits: ['Supernovas', 'Beautiful Pirates'],
  keywords: [],
  effectTags: [],
};

describe('EB01-012 — Cavendish (character)', () => {
  const allCards = loadCards();
  const eb01012 = allCards.find((c) => c.id === 'EB01-012');
  if (eb01012 === undefined) throw new Error('EB01-012 not in cards.json');
  if (eb01012.kind !== 'character') throw new Error('EB01-012 should be a character');
  const clause = eb01012.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-012 missing clause');

  describe('condition — Supernovas leader AND no other Cavendish', () => {
    it('TRUE when Supernovas leader + sole Cavendish on field', () => {
      const { state, fieldA } = buildState({ leaderA: makeLeader(['Supernovas']), charsA: [CAV] });
      expect(
        evaluateCondition(
          state,
          { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
          clause.condition,
        ),
      ).toBe(true);
    });

    it('FALSE when ANOTHER Cavendish is on field', () => {
      const { state, fieldA } = buildState({
        leaderA: makeLeader(['Supernovas']),
        charsA: [CAV, CAV],
      });
      expect(
        evaluateCondition(
          state,
          { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
          clause.condition,
        ),
      ).toBe(false);
    });

    it('FALSE when leader lacks Supernovas trait', () => {
      const { state, fieldA } = buildState({
        leaderA: makeLeader(['Whitebeard Pirates']),
        charsA: [CAV],
      });
      expect(
        evaluateCondition(
          state,
          { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
          clause.condition,
        ),
      ).toBe(false);
    });
  });

  describe('action — set_active_don moves 2 rested DON → cost area', () => {
    it('moves 2 rested DON to cost area when 2 are available', () => {
      const { state, fieldA } = buildState({ leaderA: makeLeader(['Supernovas']), charsA: [CAV] });
      // Move 2 cost-area DON into rested pool to set up.
      state.players.A.donRested.push(
        state.players.A.donCostArea.shift()!,
        state.players.A.donCostArea.shift()!,
      );
      const restedBefore = state.players.A.donRested.length;
      const costBefore = state.players.A.donCostArea.length;
      const handler = actionHandlers.get(clause.action.kind);
      const next = handler(
        state,
        { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
        clause.action,
        [],
      );
      expect(next.players.A.donRested.length).toBe(restedBefore - 2);
      expect(next.players.A.donCostArea.length).toBe(costBefore + 2);
    });

    it('clamps to available rested DON when fewer than 2 are available', () => {
      const { state, fieldA } = buildState({ leaderA: makeLeader(['Supernovas']), charsA: [CAV] });
      state.players.A.donRested = [state.players.A.donCostArea.shift()!];
      const handler = actionHandlers.get(clause.action.kind);
      const next = handler(
        state,
        { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
        clause.action,
        [],
      );
      expect(next.players.A.donRested.length).toBe(0);
    });
  });
});
