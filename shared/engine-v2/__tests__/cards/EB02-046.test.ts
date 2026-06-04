/**
 * Per-card semantic test — EB02-046 Hildon (character).
 * "[On Play] Trash 2 cards from the top of your deck and give up to 1 of
 *  your opponent's Characters −1 cost during this turn."
 * Spec: 2 on_play clauses [mill_self 2, removal_cost_reduce 1 this_turn opp_character].
 *
 * Note: `removal_cost_reduce` magnitude in spec is positive (1); the engine
 * handler clamps to negative via `-Math.abs(raw)`, producing -1 cost.
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

const L: LeaderCard = {
  id: 'TEST_L_EB02046', name: 'L', kind: 'leader', colors: ['black'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function oppChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['black'], cost: 5, power: 5000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-046 — Hildon', () => {
  const c = loadCards().find((x) => x.id === 'EB02-046');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-046 invalid');
  const h = c as CharacterCard;
  const clauses = h.effectSpecV2!.clauses!;

  it('shape: 2 on_play clauses [mill_self 2, removal_cost_reduce 1 this_turn opp_character]', () => {
    expect(clauses).toHaveLength(2);
    expect(clauses[0]!.trigger).toBe('on_play');
    expect(clauses[0]!.action.kind).toBe('mill_self');
    expect((clauses[0]!.action as { magnitude: number }).magnitude).toBe(2);
    expect(clauses[1]!.trigger).toBe('on_play');
    expect(clauses[1]!.action.kind).toBe('removal_cost_reduce');
    expect((clauses[1]!.action as { magnitude: number; duration: string }).magnitude).toBe(1);
    expect((clauses[1]!.action as { magnitude: number; duration: string }).duration).toBe('this_turn');
    expect(clauses[1]!.target!.kind).toBe('opp_character');
  });

  it('mill 2: top 2 deck cards move to trash; removal_cost_reduce sets opp char costModifier to -1', () => {
    const opp = oppChar('TEST_OPP_E46');
    const { state, fieldA, fieldB } = buildState({ leaderA: L, charsA: [h], charsB: [opp] });
    // Seed 3 deck cards on player A so mill 2 has cards to consume.
    const deckIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const card: CharacterCard = {
        id: `TEST_DECK_${i}_E46`, name: `Deck${i}`, kind: 'character', colors: ['black'],
        cost: 1, power: 1000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
      };
      state.cardLibrary[card.id] = card;
      const inst = makeInst(card.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.deck.push(inst.instanceId);
      deckIds.push(inst.instanceId);
    }
    const oppId = fieldB[0]!.instanceId;
    const deckBefore = state.players.A.deck.length;
    const trashBefore = state.players.A.trash.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    // Mill: deck -2, trash +2, with the top 2 ids now in trash.
    expect(next.players.A.deck.length).toBe(deckBefore - 2);
    expect(next.players.A.trash.length).toBe(trashBefore + 2);
    expect(next.players.A.trash).toContain(deckIds[0]!);
    expect(next.players.A.trash).toContain(deckIds[1]!);
    // Cost reduction: -1.
    expect(next.instances[oppId]!.costModifierOneShot ?? 0).toBe(-1);
  });

  it('removal_cost_reduce: no opp char on field → mill still fires; no cost modifier applied', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [h] });
    for (let i = 0; i < 2; i++) {
      const card: CharacterCard = {
        id: `TEST_MILL_${i}_E46`, name: `M${i}`, kind: 'character', colors: ['black'],
        cost: 1, power: 1000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
      };
      state.cardLibrary[card.id] = card;
      const inst = makeInst(card.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.deck.push(inst.instanceId);
    }
    const deckBefore = state.players.A.deck.length;
    const trashBefore = state.players.A.trash.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.deck.length).toBe(deckBefore - 2);
    expect(next.players.A.trash.length).toBe(trashBefore + 2);
  });
});
