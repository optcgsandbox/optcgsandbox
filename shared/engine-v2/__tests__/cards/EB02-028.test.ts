/**
 * Per-card semantic test — EB02-028 Portgas.D.Ace (character).
 * "[On Play] If your Leader's type includes "Whitebeard Pirates", look at
 *  5 cards from the top of your deck; reveal up to 1 Character card with a
 *  cost of 2 and add it to your hand. Then, place the rest at the bottom of
 *  your deck in any order and play up to 1 Character card with a cost of 2
 *  from your hand rested."
 * Spec: 2 on_play clauses gated by Whitebeard Pirates:
 *   1) searcher_peek lookCount:5 addCount:1 filter{costMin:2, costMax:2, kind:character}
 *   2) play_for_free from:hand filter{costMin:2, costMax:2, kind:character} rested:true
 *
 * Engine gap re-ref EB01-013: play_for_free no clause-target → no-op.
 * Positive uses it.fails.
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

const WB_LEADER: LeaderCard = {
  id: 'TEST_WB_L_E28', name: 'L', kind: 'leader', colors: ['blue'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: ['Whitebeard Pirates'], keywords: [], effectTags: [],
};

const NON_WB_LEADER: LeaderCard = {
  id: 'TEST_NON_WB_L_E28', name: 'L', kind: 'leader', colors: ['blue'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: ['Other'], keywords: [], effectTags: [],
};

function deckChar(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['blue'], cost, power: 2000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-028 — Portgas.D.Ace', () => {
  const c = loadCards().find((x) => x.id === 'EB02-028');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-028 invalid');
  const ace = c as CharacterCard;
  const clauses = ace.effectSpecV2!.clauses!;

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

  it('shape: 2 on_play clauses gated Whitebeard Pirates [searcher_peek 5/1 cost-2 char, play_for_free hand cost-2 char rested]', () => {
    expect(clauses).toHaveLength(2);
    for (const cl of clauses) {
      expect(cl.trigger).toBe('on_play');
      expect((cl.condition as { type: string; typeString: string }).type).toBe('if_leader_has_type');
      expect((cl.condition as { type: string; typeString: string }).typeString).toBe('Whitebeard Pirates');
    }
    expect(clauses[0]!.action.kind).toBe('searcher_peek');
    const a0 = clauses[0]!.action as { lookCount: number; addCount: number; filter: { costMin: number; costMax: number; kind: string } };
    expect(a0.lookCount).toBe(5);
    expect(a0.addCount).toBe(1);
    expect(a0.filter.costMin).toBe(2);
    expect(a0.filter.costMax).toBe(2);
    expect(a0.filter.kind).toBe('character');
    expect(clauses[1]!.action.kind).toBe('play_for_free');
    const a1 = clauses[1]!.action as { from: string; filter: { costMin: number; costMax: number; kind: string }; rested: boolean };
    expect(a1.from).toBe('hand');
    expect(a1.filter.costMin).toBe(2);
    expect(a1.filter.costMax).toBe(2);
    expect(a1.filter.kind).toBe('character');
    expect(a1.rested).toBe(true);
  });

  it('WB leader + cost-2 char in top 5: searched out (lands on field or hand depending on play_for_free hand-scan)', () => {
    const cand = deckChar('TEST_C2_E28', 2);
    const fillers = [
      deckChar('TEST_F1_E28', 5), deckChar('TEST_F2_E28', 5),
      deckChar('TEST_F3_E28', 5), deckChar('TEST_F4_E28', 5),
    ];
    const { state, fieldA } = buildState({ leaderA: WB_LEADER, charsA: [ace] });
    const ids = seedDeck(state, [cand, ...fillers]);
    const candId = ids[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(
      next.players.A.field.some((i) => i.instanceId === candId)
        || next.players.A.hand.includes(candId),
    ).toBe(true);
  });

  it('non-WB leader: condition fail → cand stays in deck', () => {
    const cand = deckChar('TEST_C2N_E28', 2);
    const fillers = [
      deckChar('TEST_FN1_E28', 5), deckChar('TEST_FN2_E28', 5),
      deckChar('TEST_FN3_E28', 5), deckChar('TEST_FN4_E28', 5),
    ];
    const { state, fieldA } = buildState({ leaderA: NON_WB_LEADER, charsA: [ace] });
    const ids = seedDeck(state, [cand, ...fillers]);
    const candId = ids[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand).not.toContain(candId);
    expect(next.players.A.deck).toContain(candId);
  });

  it('WB leader + cost-3 char in top 5: filter exclude (costMax)', () => {
    const cand = deckChar('TEST_C3_E28', 3);
    const fillers = [
      deckChar('TEST_F1B_E28', 5), deckChar('TEST_F2B_E28', 5),
      deckChar('TEST_F3B_E28', 5), deckChar('TEST_F4B_E28', 5),
    ];
    const { state, fieldA } = buildState({ leaderA: WB_LEADER, charsA: [ace] });
    const ids = seedDeck(state, [cand, ...fillers]);
    const candId = ids[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand).not.toContain(candId);
  });

  it(
    'WB leader + cost-2 char in hand: play_for_free puts it on field',
    () => {
      const handCand = deckChar('TEST_HAND2_E28', 2);
      const { state, fieldA, handAInstances } = buildState({
        leaderA: WB_LEADER, charsA: [ace], handA: [handCand],
      });
      const handId = handAInstances[0]!.instanceId;
      seedDeck(state, [
        deckChar('TEST_FZ_E28', 5),
      ]);
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
      );
      expect(next.players.A.field.map((i) => i.instanceId)).toContain(handId);
    },
  );
});
