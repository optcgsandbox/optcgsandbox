/**
 * Per-card semantic test — EB01-012 Cavendish (character).
 *
 * Printed text (cards.json):
 *   "[On Play]/[When Attacking] If your Leader has the {Supernovas} type
 *    and you have no other [Cavendish] Characters, set up to 2 of your
 *    DON!! cards as active."
 *
 * 5-axis: TWO clauses (on_play + when_attacking) each with condition
 *   AND(if_leader_has_trait Supernovas, if_no_other_with_name Cavendish)
 *   and action set_active_don magnitude:2.
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
import { EffectDispatcher, evaluateCondition } from '../../effects/EffectDispatcher.js';
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
    name: 'TEST',
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

describe('EB01-012 — Cavendish (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-012');
  if (eb === undefined) throw new Error('EB01-012 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-012 should be a character');
  // Use the REAL EB01-012 entry from cards.json so the source card carries
  // effectSpecV2.clauses (EffectDispatcher reads clauses from source's
  // card definition). Hand-built duplicates miss those clauses.
  const CAV = eb as CharacterCard;
  const clauses = eb.effectSpecV2?.clauses ?? [];
  if (clauses.length < 2) throw new Error('EB01-012 expected 2 clauses');
  const onPlay = clauses[0]!;
  const whenAttacking = clauses[1]!;

  describe('condition AND(Supernovas leader, no other Cavendish)', () => {
    it('TRUE: Supernovas leader + sole Cavendish', () => {
      const { state, fieldA } = buildState({ leaderA: makeLeader(['Supernovas']), charsA: [CAV] });
      expect(
        evaluateCondition(
          state,
          { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
          onPlay.condition,
        ),
      ).toBe(true);
    });

    it('FALSE: another Cavendish on field', () => {
      const { state, fieldA } = buildState({
        leaderA: makeLeader(['Supernovas']),
        charsA: [CAV, CAV],
      });
      expect(
        evaluateCondition(
          state,
          { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
          onPlay.condition,
        ),
      ).toBe(false);
    });

    it('FALSE: leader lacks Supernovas trait', () => {
      const { state, fieldA } = buildState({ leaderA: makeLeader(['Other']), charsA: [CAV] });
      expect(
        evaluateCondition(
          state,
          { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
          onPlay.condition,
        ),
      ).toBe(false);
    });
  });

  describe('action set_active_don 2 — moves 2 rested DON → cost area', () => {
    it('on_play: dispatch fires set_active_don 2 when condition true', () => {
      const { state, fieldA } = buildState({ leaderA: makeLeader(['Supernovas']), charsA: [CAV] });
      // Move 2 DON from cost to rested to set up.
      state.players.A.donRested.push(
        state.players.A.donCostArea.shift()!,
        state.players.A.donCostArea.shift()!,
      );
      const costBefore = state.players.A.donCostArea.length;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
        'on_play',
      );
      expect(next.players.A.donRested.length).toBe(0);
      expect(next.players.A.donCostArea.length).toBe(costBefore + 2);
    });

    it('when_attacking: dispatch fires set_active_don 2 when condition true', () => {
      const { state, fieldA } = buildState({ leaderA: makeLeader(['Supernovas']), charsA: [CAV] });
      state.players.A.donRested.push(
        state.players.A.donCostArea.shift()!,
        state.players.A.donCostArea.shift()!,
      );
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
        'when_attacking',
      );
      expect(next.players.A.donRested.length).toBe(0);
      void whenAttacking;
    });

    it('clamps to available rested DON when fewer than 2', () => {
      const { state, fieldA } = buildState({ leaderA: makeLeader(['Supernovas']), charsA: [CAV] });
      state.players.A.donRested = [state.players.A.donCostArea.shift()!];
      const costBefore = state.players.A.donCostArea.length;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
        'on_play',
      );
      expect(next.players.A.donRested.length).toBe(0);
      expect(next.players.A.donCostArea.length).toBe(costBefore + 1);
    });

    it('no action when condition false (Supernovas leader + duplicate Cavendish)', () => {
      const { state, fieldA } = buildState({
        leaderA: makeLeader(['Supernovas']),
        charsA: [CAV, CAV],
      });
      state.players.A.donRested.push(
        state.players.A.donCostArea.shift()!,
        state.players.A.donCostArea.shift()!,
      );
      const restedBefore = state.players.A.donRested.length;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
        'on_play',
      );
      expect(next.players.A.donRested.length).toBe(restedBefore);
    });
  });
});
