/**
 * Per-card semantic test — EB01-026 Prince Bellett (character).
 *
 * Printed text (cards.json):
 *   "[DON!! x1] [When Attacking] If you have 1 or less cards in your hand,
 *    return up to 1 Character with a cost of 3 or less to the owner's hand."
 *
 * 5-axis: clause when_attacking, AND(if_attached_don_min 1, if_hand_max 1),
 *   action removal_bounce, target any_character filter{costMax:3}.
 *
 * All primitives registered.
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

const VANILLA_LEADER: LeaderCard = {
  id: 'TEST_LEADER_EB026',
  name: 'TEST',
  kind: 'leader',
  colors: ['blue'],
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
    colors: ['blue'],
    cost,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-026 — Prince Bellett (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-026');
  if (eb === undefined) throw new Error('EB01-026 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-026 should be a character');
  const bellett = eb as CharacterCard;
  const clause = bellett.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-026 missing clause');

  it('clause shape: when_attacking / AND(don≥1, hand≤1) / removal_bounce / any_character costMax:3', () => {
    expect(clause.trigger).toBe('when_attacking');
    expect(clause.condition!.type).toBe('and');
    const cond = clause.condition as { type: string; conditions: ReadonlyArray<{ type: string; n: number }> };
    expect(cond.conditions.map((c) => c.type)).toEqual(['if_attached_don_min', 'if_hand_max']);
    expect(clause.action.kind).toBe('removal_bounce');
    expect(clause.target!.kind).toBe('any_character');
    expect((clause.target as { filter: { costMax: number } }).filter.costMax).toBe(3);
  });

  it('bounces a cost-3 opp character when conditions hold', () => {
    const opp = oppChar('TEST_OPP_C3', 3);
    const { state, fieldA, fieldB } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [bellett],
      charsB: [opp],
    });
    const bId = fieldA[0]!.instanceId;
    const oppId = fieldB[0]!.instanceId;
    state.instances[bId]!.attachedDon = [state.players.A.donCostArea.shift()!];
    expect(state.players.A.hand.length).toBe(0); // hand ≤ 1 ✓
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: bId, controller: 'A' },
      'when_attacking',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(false);
    expect(next.players.B.hand).toContain(oppId);
  });

  it('does NOT bounce cost-4 opp char (filter excludes)', () => {
    const opp = oppChar('TEST_OPP_C4', 4);
    const { state, fieldA, fieldB } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [bellett],
      charsB: [opp],
    });
    const bId = fieldA[0]!.instanceId;
    const oppId = fieldB[0]!.instanceId;
    state.instances[bId]!.attachedDon = [state.players.A.donCostArea.shift()!];
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: bId, controller: 'A' },
      'when_attacking',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(true);
  });

  it('does NOT fire when no DON attached (DON gate)', () => {
    const opp = oppChar('TEST_OPP_C3_B', 3);
    const { state, fieldA, fieldB } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [bellett],
      charsB: [opp],
    });
    const bId = fieldA[0]!.instanceId;
    const oppId = fieldB[0]!.instanceId;
    // No DON attached.
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: bId, controller: 'A' },
      'when_attacking',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(true);
  });

  it('does NOT fire when hand size > 1 (hand_max gate)', () => {
    const opp = oppChar('TEST_OPP_C3_C', 3);
    const handCardA = oppChar('TEST_HND_A', 1);
    const handCardB = oppChar('TEST_HND_B', 1);
    const { state, fieldA, fieldB } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [bellett],
      charsB: [opp],
      handA: [handCardA, handCardB],
    });
    const bId = fieldA[0]!.instanceId;
    const oppId = fieldB[0]!.instanceId;
    state.instances[bId]!.attachedDon = [state.players.A.donCostArea.shift()!];
    expect(state.players.A.hand.length).toBe(2);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: bId, controller: 'A' },
      'when_attacking',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(true);
  });
});
