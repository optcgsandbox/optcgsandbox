/**
 * Per-card semantic test — EB02-024 Sogeking (character).
 * "Also treat this card's name as [Usopp] according to the rules.
 *  [On Play] Draw 2 cards and place 2 cards from your hand at the bottom
 *  of your deck in any order. Then, return up to 1 Character with a cost
 *  of 1 or less to the owner's hand."
 * Spec: THREE on_play clauses:
 *   1) draw 2
 *   2) bottom_of_deck_from_hand magnitude:2
 *   3) removal_bounce / any_character costMax:1
 *   + rules.nameAliases:['Usopp']
 *
 * Engine gap (re-ref EB01-013 family): clause 2 has no `target` field, so
 * the bottom_of_deck_from_hand handler receives empty targets. Behavioral
 * assertion uses it.fails.
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
  id: 'TEST_L_EB02024', name: 'L', kind: 'leader', colors: ['blue'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function deckChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['blue'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

function oppCostChar(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['blue'], cost, power: 2000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

function handChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['blue'], cost: 2, power: 2000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-024 — Sogeking', () => {
  const c = loadCards().find((x) => x.id === 'EB02-024');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-024 invalid');
  const so = c as CharacterCard;
  const clauses = so.effectSpecV2!.clauses!;
  const spec = so.effectSpecV2 as { rules?: { nameAliases?: string[] } };

  function seedDeck(state: ReturnType<typeof buildState>['state'], cards: CharacterCard[]): string[] {
    const ids: string[] = [];
    for (const card of cards) {
      state.cardLibrary[card.id] = card;
      const inst = makeInst(card.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.deck.push(inst.instanceId);
      ids.push(inst.instanceId);
    }
    return ids;
  }

  it('shape: 3 on_play clauses [draw 2, bottom_of_deck_from_hand 2, removal_bounce any_character costMax:1]', () => {
    expect(clauses).toHaveLength(3);
    expect(clauses[0]!.action.kind).toBe('draw');
    expect((clauses[0]!.action as { magnitude: number }).magnitude).toBe(2);
    expect(clauses[1]!.action.kind).toBe('bottom_of_deck_from_hand');
    expect((clauses[1]!.action as { magnitude: number }).magnitude).toBe(2);
    expect(clauses[2]!.action.kind).toBe('removal_bounce');
    expect(clauses[2]!.target!.kind).toBe('any_character');
    expect((clauses[2]!.target as { filter: { costMax: number } }).filter.costMax).toBe(1);
  });

  it('rules.nameAliases includes Usopp', () => {
    expect(spec.rules?.nameAliases).toContain('Usopp');
  });

  it('full on_play resolution: draw 2 + bottom_of_deck_from_hand 2 → net hand 0; drawn ids end at deck bottom', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [so] });
    const ids = seedDeck(state, [
      deckChar('TEST_D1_E24'), deckChar('TEST_D2_E24'),
      deckChar('TEST_D3_E24'),
    ]);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    // Three on_play clauses fire end-to-end:
    //   (1) draw 2          → hand grows by 2 (ids[0], ids[1] from deck top)
    //   (2) bottom_of_deck_from_hand 2 → moves first 2 hand cards back to
    //       deck bottom (under empty starting hand, that's ids[0] + ids[1])
    //   (3) removal_bounce  → no opp char on field, target resolves empty,
    //       clause is skipped by dispatcher's empty-target gate
    // Net hand delta = +2 − 2 = 0; ids[0] and ids[1] now at deck bottom.
    expect(next.players.A.hand.length).toBe(handBefore);
    expect(next.players.A.deck).toContain(ids[0]!);
    expect(next.players.A.deck).toContain(ids[1]!);
    // Deck top still ids[2] (third seeded card), not the moved-back drawn ones.
    expect(next.players.A.deck[0]).toBe(ids[2]!);
    // Drawn ids ended up at the back (bottom-of-deck routing).
    const lastTwo = next.players.A.deck.slice(-2);
    expect(lastTwo).toContain(ids[0]!);
    expect(lastTwo).toContain(ids[1]!);
  });

  it('removal_bounce: cost-1 opp char returned to owner hand', () => {
    const o = oppCostChar('TEST_OPP_C1_E24', 1);
    const { state, fieldA, fieldB } = buildState({ leaderA: L, charsA: [so], charsB: [o] });
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.B.field.map((i) => i.instanceId)).not.toContain(oId);
    expect(next.players.B.hand).toContain(oId);
  });

  it('removal_bounce: cost-2 opp char NOT bounced (filter exclude)', () => {
    const o = oppCostChar('TEST_OPP_C2_E24', 2);
    const { state, fieldA, fieldB } = buildState({ leaderA: L, charsA: [so], charsB: [o] });
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.B.field.map((i) => i.instanceId)).toContain(oId);
    expect(next.players.B.hand).not.toContain(oId);
  });

  it(
    'bottom_of_deck_from_hand: 2 cards move hand → deck (closes cluster-E engine gap; handler now scans own hand by magnitude when clause-target is omitted)',
    () => {
      const h1 = handChar('TEST_HAND1_E24');
      const h2 = handChar('TEST_HAND2_E24');
      const { state, fieldA, handAInstances } = buildState({
        leaderA: L, charsA: [so], handA: [h1, h2],
      });
      const h1Id = handAInstances[0]!.instanceId;
      const h2Id = handAInstances[1]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
      );
      const handIds = next.players.A.hand;
      const deckIds = next.players.A.deck;
      // Both hand cards expected to have moved to bottom of deck.
      expect(handIds).not.toContain(h1Id);
      expect(handIds).not.toContain(h2Id);
      expect(deckIds).toContain(h1Id);
      expect(deckIds).toContain(h2Id);
    },
  );
});
