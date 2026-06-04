/**
 * Per-card semantic test — EB01-023 Edward Weevil (character).
 *
 * Printed text (cards.json): "[On Play] Draw 1 card."
 * Spec: clause trigger on_play / action draw magnitude:1. No condition.
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
  id: 'TEST_LEADER_EB023',
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

describe('EB01-023 — Edward Weevil (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-023');
  if (eb === undefined) throw new Error('EB01-023 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-023 should be a character');
  const weevil = eb as CharacterCard;
  const clause = weevil.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-023 missing clause');

  it('clause shape: on_play / draw 1', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('draw');
    expect((clause.action as { magnitude: number }).magnitude).toBe(1);
    expect(clause.condition).toBeUndefined();
  });

  it('on_play dispatch draws 1 card into hand', () => {
    const c = fillerCharacter('TEST_DRAW_1');
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [weevil] });
    state.cardLibrary[c.id] = c;
    const drawInst = makeInst(c.id, 'A');
    state.instances[drawInst.instanceId] = drawInst;
    state.players.A.deck = [drawInst.instanceId];
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore + 1);
    expect(next.players.A.hand).toContain(drawInst.instanceId);
  });

  it('on_play with empty deck → game result loss (deck-out)', () => {
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [weevil] });
    // No deck cards.
    expect(state.players.A.deck.length).toBe(0);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_play',
    );
    expect(next.result).not.toBeNull();
    expect(next.result!.loser).toBe('A');
    expect(next.result!.reason).toBe('deck_out');
  });
});
