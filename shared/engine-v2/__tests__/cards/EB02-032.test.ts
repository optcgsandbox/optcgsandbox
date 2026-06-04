/**
 * Per-card semantic test — EB02-032 Iceburg (character).
 * "[On Play] If you have 3 or more DON!! cards on your field, look at 7
 *  cards from the top of your deck; reveal up to 1 [Galley-La Company] and
 *  add it to your hand. Then, place the rest at the bottom of your deck in
 *  any order and play up to 1 [Galley-La Company] from your hand."
 * Spec: 2 on_play clauses gated if_don_min 3:
 *   1) searcher_peek lookCount:7 addCount:1 filter{nameIs:'Galley-La Company'}
 *   2) play_for_free from:hand filter{nameIs:'Galley-La Company'}
 *
 * Engine gap re-ref EB01-013: play_for_free no clause-target → no-op.
 * Behavioral positive uses it.fails.
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
  id: 'TEST_L_EB02032', name: 'L', kind: 'leader', colors: ['purple'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function glcChar(id: string): CharacterCard {
  return {
    id, name: 'Galley-La Company', kind: 'character', colors: ['purple'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

function fillerChar(id: string): CharacterCard {
  return {
    id, name: 'Filler', kind: 'character', colors: ['purple'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-032 — Iceburg', () => {
  const c = loadCards().find((x) => x.id === 'EB02-032');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-032 invalid');
  const ice = c as CharacterCard;
  const clauses = ice.effectSpecV2!.clauses!;

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

  it('shape: 2 on_play clauses gated if_don_min 3 [searcher_peek 7/1 Galley-La Company, play_for_free hand Galley-La Company]', () => {
    expect(clauses).toHaveLength(2);
    for (const cl of clauses) {
      expect(cl.trigger).toBe('on_play');
      expect((cl.condition as { type: string; n: number }).type).toBe('if_don_min');
      expect((cl.condition as { type: string; n: number }).n).toBe(3);
    }
    expect(clauses[0]!.action.kind).toBe('searcher_peek');
    const a0 = clauses[0]!.action as { lookCount: number; addCount: number; filter: { nameIs: string } };
    expect(a0.lookCount).toBe(7);
    expect(a0.addCount).toBe(1);
    expect(a0.filter.nameIs).toBe('Galley-La Company');
    expect(clauses[1]!.action.kind).toBe('play_for_free');
    const a1 = clauses[1]!.action as { from: string; filter: { nameIs: string } };
    expect(a1.from).toBe('hand');
    expect(a1.filter.nameIs).toBe('Galley-La Company');
  });

  it('with 3+ DON + Galley-La Company in top 7: searched out (lands on field or hand depending on play_for_free hand-scan)', () => {
    const cand = glcChar('TEST_GLC_E32');
    const fillers = [
      fillerChar('TEST_F1_E32'), fillerChar('TEST_F2_E32'),
      fillerChar('TEST_F3_E32'), fillerChar('TEST_F4_E32'),
      fillerChar('TEST_F5_E32'), fillerChar('TEST_F6_E32'),
    ];
    const { state } = buildState({ leaderA: L, charsA: [ice], donInCostA: 10 });
    const ids = seedDeck(state, [cand, ...fillers]);
    const candId = ids[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: state.players.A.field[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(
      next.players.A.field.some((i) => i.instanceId === candId)
        || next.players.A.hand.includes(candId),
    ).toBe(true);
  });

  it('with 2 DON (condition fail): cand NOT added', () => {
    const cand = glcChar('TEST_GLC_FAIL_E32');
    const fillers = [
      fillerChar('TEST_FA_E32'), fillerChar('TEST_FB_E32'),
      fillerChar('TEST_FC_E32'), fillerChar('TEST_FD_E32'),
      fillerChar('TEST_FE_E32'), fillerChar('TEST_FF_E32'),
    ];
    const { state } = buildState({ leaderA: L, charsA: [ice], donInCostA: 2 });
    const ids = seedDeck(state, [cand, ...fillers]);
    const candId = ids[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: state.players.A.field[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand).not.toContain(candId);
  });

  it(
    'play_for_free clause plays Galley-La Company from hand',
    () => {
      const handCand = glcChar('TEST_HAND_GLC_E32');
      const { state, handAInstances } = buildState({
        leaderA: L, charsA: [ice], handA: [handCand], donInCostA: 10,
      });
      const handId = handAInstances[0]!.instanceId;
      seedDeck(state, [
        fillerChar('TEST_FX1_E32'), fillerChar('TEST_FX2_E32'), fillerChar('TEST_FX3_E32'),
        fillerChar('TEST_FX4_E32'), fillerChar('TEST_FX5_E32'), fillerChar('TEST_FX6_E32'),
        fillerChar('TEST_FX7_E32'),
      ]);
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: state.players.A.field[0]!.instanceId, controller: 'A' }, 'on_play',
      );
      expect(next.players.A.field.map((i) => i.instanceId)).toContain(handId);
    },
  );
});
