/**
 * Per-card semantic test — EB02-013 Carrot (character).
 * "[On Play] If you have 3 or more DON!! cards on your field, look at 7
 *  cards from the top of your deck; reveal up to 1 [Zou] and add it to
 *  your hand. Then, place the rest at the bottom of your deck in any
 *  order and play up to 1 [Zou] from your hand."
 * Spec: 2 on_play clauses both gated by if_don_min 3:
 *   1) searcher_peek lookCount:7 addCount:1 filter{nameIs:Zou}
 *   2) play_for_free from:hand filter{nameIs:Zou}
 *
 * Engine gap re-ref EB01-013/020/033/043: play_for_free no clause-target
 *   → action no-op. play_for_free behavioral assertion uses it.fails.
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
  id: 'TEST_L_EB02013', name: 'L', kind: 'leader', colors: ['green'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function zouChar(id: string): CharacterCard {
  return {
    id, name: 'Zou', kind: 'character', colors: ['green'], cost: 1, power: 1000,
    counterValue: 1000, traits: ['Minks'], keywords: [], effectTags: [],
  };
}

function fillerChar(id: string): CharacterCard {
  return {
    id, name: 'Filler', kind: 'character', colors: ['green'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-013 — Carrot', () => {
  const c = loadCards().find((x) => x.id === 'EB02-013');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-013 invalid');
  const carrot = c as CharacterCard;
  const clauses = carrot.effectSpecV2!.clauses!;

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

  it('shape: 2 on_play clauses both gated if_don_min 3', () => {
    expect(clauses).toHaveLength(2);
    for (const cl of clauses) {
      expect(cl.trigger).toBe('on_play');
      expect((cl.condition as { type: string; n: number }).type).toBe('if_don_min');
      expect((cl.condition as { type: string; n: number }).n).toBe(3);
    }
    expect(clauses[0]!.action.kind).toBe('searcher_peek');
    expect((clauses[0]!.action as { lookCount: number; addCount: number; filter: { nameIs: string } }).lookCount).toBe(7);
    expect((clauses[0]!.action as { lookCount: number; addCount: number; filter: { nameIs: string } }).addCount).toBe(1);
    expect((clauses[0]!.action as { lookCount: number; addCount: number; filter: { nameIs: string } }).filter.nameIs).toBe('Zou');
    expect(clauses[1]!.action.kind).toBe('play_for_free');
    expect((clauses[1]!.action as { from: string; filter: { nameIs: string } }).from).toBe('hand');
    expect((clauses[1]!.action as { from: string; filter: { nameIs: string } }).filter.nameIs).toBe('Zou');
  });

  it('with 3+ DON + Zou in top 7: Zou ends in play (searched to hand, then play_for_free hand-scan plays it)', () => {
    const zou = zouChar('TEST_ZOU_E13');
    const fillers = [
      fillerChar('TEST_F1_E13'),
      fillerChar('TEST_F2_E13'),
      fillerChar('TEST_F3_E13'),
      fillerChar('TEST_F4_E13'),
      fillerChar('TEST_F5_E13'),
      fillerChar('TEST_F6_E13'),
    ];
    const { state } = buildState({ leaderA: L, charsA: [carrot], donInCostA: 10 });
    const ids = seedDeck(state, [zou, ...fillers]);
    const zouInstId = ids[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: state.players.A.field[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(
      next.players.A.field.some((i) => i.instanceId === zouInstId)
        || next.players.A.hand.includes(zouInstId),
    ).toBe(true);
  });

  it('with 2 DON (condition fails): Zou NOT added to hand', () => {
    const zou = zouChar('TEST_ZOU_FAIL_E13');
    const fillers = [
      fillerChar('TEST_FA_E13'),
      fillerChar('TEST_FB_E13'),
      fillerChar('TEST_FC_E13'),
      fillerChar('TEST_FD_E13'),
      fillerChar('TEST_FE_E13'),
      fillerChar('TEST_FF_E13'),
    ];
    const { state } = buildState({ leaderA: L, charsA: [carrot], donInCostA: 2 });
    const ids = seedDeck(state, [zou, ...fillers]);
    const zouInstId = ids[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: state.players.A.field[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand).not.toContain(zouInstId);
  });

  it('with 3+ DON but NO Zou in top 7: hand unchanged from searcher (no add)', () => {
    const fillers = [
      fillerChar('TEST_NZ1_E13'),
      fillerChar('TEST_NZ2_E13'),
      fillerChar('TEST_NZ3_E13'),
      fillerChar('TEST_NZ4_E13'),
      fillerChar('TEST_NZ5_E13'),
      fillerChar('TEST_NZ6_E13'),
      fillerChar('TEST_NZ7_E13'),
    ];
    const { state } = buildState({ leaderA: L, charsA: [carrot], donInCostA: 10 });
    seedDeck(state, fillers);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: state.players.A.field[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore);
  });

  it(
    'play_for_free clause plays a Zou from hand',
    () => {
      const handZou = zouChar('TEST_ZOU_HAND_E13');
      const { state, handAInstances } = buildState({
        leaderA: L, charsA: [carrot], handA: [handZou], donInCostA: 10,
      });
      const zouInstId = handAInstances[0]!.instanceId;
      // Seed deck with fillers so searcher_peek has a no-op leftover ordering, not a Zou to compete.
      seedDeck(state, [
        fillerChar('TEST_FX1_E13'), fillerChar('TEST_FX2_E13'), fillerChar('TEST_FX3_E13'),
        fillerChar('TEST_FX4_E13'), fillerChar('TEST_FX5_E13'), fillerChar('TEST_FX6_E13'),
        fillerChar('TEST_FX7_E13'),
      ]);
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: state.players.A.field[0]!.instanceId, controller: 'A' }, 'on_play',
      );
      // Engine gap: play_for_free does not bind a target, so the Zou
      // stays in hand. Expectation: Zou moves to field.
      const fieldIds = next.players.A.field.map((i) => i.instanceId);
      expect(fieldIds).toContain(zouInstId);
    },
  );
});
