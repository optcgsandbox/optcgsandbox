/**
 * Per-card semantic test — EB01-022 Inazuma (character).
 *
 * Printed text (cards.json):
 *   "[End of Your Turn] If you have 2 or less cards in your hand, draw 2 cards."
 *
 * 5-axis: clause trigger at_end_of_turn_self, condition if_hand_max n:2,
 *   action draw magnitude:2.
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

const VANILLA_LEADER: LeaderCard = {
  id: 'TEST_LEADER_EB022',
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

function fillerCharacter(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['blue'],
    cost: 1,
    power: 1000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

/** Populate A's deck with N fresh instances. */
function seedDeckA(
  state: ReturnType<typeof buildState>['state'],
  n: number,
): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = fillerCharacter(`TEST_DECK_${i}`);
    state.cardLibrary[c.id] = c;
    const inst = makeInst(c.id, 'A');
    state.instances[inst.instanceId] = inst;
    ids.push(inst.instanceId);
  }
  state.players.A.deck = [...ids];
  return ids;
}

describe('EB01-022 — Inazuma (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-022');
  if (eb === undefined) throw new Error('EB01-022 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-022 should be a character');
  const inazuma = eb as CharacterCard;
  const clause = inazuma.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-022 missing clause');

  it('clause shape: at_end_of_turn_self / if_hand_max n:2 / draw 2', () => {
    expect(clause.trigger).toBe('at_end_of_turn_self');
    expect(clause.condition!.type).toBe('if_hand_max');
    expect((clause.condition as { n: number }).n).toBe(2);
    expect(clause.action.kind).toBe('draw');
    expect((clause.action as { magnitude: number }).magnitude).toBe(2);
  });

  it('draws 2 when hand size is 0 (≤ 2)', () => {
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [inazuma] });
    seedDeckA(state, 5);
    const handBefore = state.players.A.hand.length;
    expect(handBefore).toBe(0);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'at_end_of_turn_self',
    );
    expect(next.players.A.hand.length).toBe(2);
  });

  it('draws 2 at boundary hand size 2 (≤ 2 inclusive)', () => {
    const hand1 = fillerCharacter('TEST_HAND_1');
    const hand2 = fillerCharacter('TEST_HAND_2');
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [inazuma],
      handA: [hand1, hand2],
    });
    seedDeckA(state, 5);
    expect(state.players.A.hand.length).toBe(2);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'at_end_of_turn_self',
    );
    expect(next.players.A.hand.length).toBe(4);
  });

  it('does NOT draw when hand size is 3 (> 2)', () => {
    const h1 = fillerCharacter('TEST_H1');
    const h2 = fillerCharacter('TEST_H2');
    const h3 = fillerCharacter('TEST_H3');
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [inazuma],
      handA: [h1, h2, h3],
    });
    seedDeckA(state, 5);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'at_end_of_turn_self',
    );
    expect(next.players.A.hand.length).toBe(handBefore);
  });
});
