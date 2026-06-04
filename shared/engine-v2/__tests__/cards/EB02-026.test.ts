/**
 * Per-card semantic test — EB02-026 Nefeltari Vivi (character).
 * "[On Play] If your Leader is multicolored and you have 5 or less cards
 *  in your hand, draw 2 cards."
 * Spec: on_play / AND(if_leader_multicolored, if_hand_max:5) / draw 2.
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

const MC_LEADER: LeaderCard = {
  id: 'TEST_MC', name: 'L', kind: 'leader', colors: ['blue', 'green'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

const SINGLE_LEADER: LeaderCard = {
  id: 'TEST_SC', name: 'L', kind: 'leader', colors: ['blue'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function filler(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['blue'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-026 — Nefeltari Vivi', () => {
  const c = loadCards().find((x) => x.id === 'EB02-026');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-026 invalid');
  const vivi = c as CharacterCard;
  const clause = vivi.effectSpecV2!.clauses![0]!;

  function seedDeck(state: ReturnType<typeof buildState>['state'], n: number): void {
    for (let i = 0; i < n; i++) {
      const card = filler(`TEST_VIVI_D_${i}`);
      state.cardLibrary[card.id] = card;
      const inst = makeInst(card.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.deck.push(inst.instanceId);
    }
  }

  it('shape: on_play / AND(if_leader_multicolored, if_hand_max:5) / draw 2', () => {
    expect(clause.trigger).toBe('on_play');
    const cond = clause.condition as { type: string; conditions: ReadonlyArray<{ type: string }> };
    expect(cond.conditions.map((c) => c.type)).toEqual(['if_leader_multicolored', 'if_hand_max']);
    expect(clause.action.kind).toBe('draw');
    expect((clause.action as { magnitude: number }).magnitude).toBe(2);
  });

  it('MC leader + hand≤5: draws 2', () => {
    const { state, fieldA } = buildState({ leaderA: MC_LEADER, charsA: [vivi] });
    seedDeck(state, 4);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore + 2);
  });

  it('single-color leader → no draw', () => {
    const { state, fieldA } = buildState({ leaderA: SINGLE_LEADER, charsA: [vivi] });
    seedDeck(state, 4);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore);
  });

  it('MC leader but hand=6 (>5): condition fail → no draw', () => {
    const handFiller = [
      filler('TEST_H1_E26'), filler('TEST_H2_E26'), filler('TEST_H3_E26'),
      filler('TEST_H4_E26'), filler('TEST_H5_E26'), filler('TEST_H6_E26'),
    ];
    const { state, fieldA } = buildState({
      leaderA: MC_LEADER, charsA: [vivi], handA: handFiller,
    });
    seedDeck(state, 4);
    const handBefore = state.players.A.hand.length;
    expect(handBefore).toBe(6);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore);
  });

  it('MC leader + hand=5 (boundary): draws 2 (5 or less, inclusive)', () => {
    const handFiller = [
      filler('TEST_B1_E26'), filler('TEST_B2_E26'), filler('TEST_B3_E26'),
      filler('TEST_B4_E26'), filler('TEST_B5_E26'),
    ];
    const { state, fieldA } = buildState({
      leaderA: MC_LEADER, charsA: [vivi], handA: handFiller,
    });
    seedDeck(state, 4);
    const handBefore = state.players.A.hand.length;
    expect(handBefore).toBe(5);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore + 2);
  });
});
