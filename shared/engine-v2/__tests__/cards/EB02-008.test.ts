/**
 * Per-card semantic test — EB02-008 The Peak ([Main] event).
 * "[Main] Look at 4 cards from the top of your deck; reveal up to 1 card
 *  with a cost of 4 or more and add it to your hand. Then, place the rest
 *  at the bottom of your deck in any order."
 * Spec: on_play / searcher_peek lookCount:4 addCount:1 filter{costMin:4}.
 *
 * Engine gap (already logged under EB01-009): searcher_peek leftover goes
 * to TOP not BOTTOM. Behavioral hand-add test passes; leftover-bottom test
 * uses it.fails.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, EventCard, LeaderCard } from '../../cards/Card.js';
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
  id: 'TEST_L_EB02008', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function deckChar(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-008 — The Peak', () => {
  const c = loadCards().find((x) => x.id === 'EB02-008');
  if (c === undefined || c.kind !== 'event') throw new Error('EB02-008 invalid');
  const ev = c as EventCard;
  const clause = ev.effectSpecV2!.clauses![0]!;

  function attach(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[ev.id] = ev;
    const inst = makeInst(ev.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

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

  it('shape: on_play / searcher_peek lookCount:4 addCount:1 filter.costMin:4', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('searcher_peek');
    const a = clause.action as { lookCount: number; addCount: number; filter: { costMin: number } };
    expect(a.lookCount).toBe(4);
    expect(a.addCount).toBe(1);
    expect(a.filter.costMin).toBe(4);
  });

  it('cost-4 within top 4 → added to hand', () => {
    const candidate = deckChar('TEST_C4', 4);
    const fillers = [deckChar('TEST_F1', 1), deckChar('TEST_F2', 1), deckChar('TEST_F3', 1)];
    const { state } = buildState({ leaderA: L });
    seedDeck(state, [candidate, ...fillers]);
    const srcId = attach(state);
    const candInstId = state.players.A.deck[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand).toContain(candInstId);
  });

  it('cost-3 within top 4 → NOT added to hand (boundary exclusive)', () => {
    const lowCost = deckChar('TEST_C3', 3);
    const fillers = [deckChar('TEST_F1B', 1), deckChar('TEST_F2B', 1), deckChar('TEST_F3B', 1)];
    const { state } = buildState({ leaderA: L });
    seedDeck(state, [lowCost, ...fillers]);
    const srcId = attach(state);
    const lowId = state.players.A.deck[0]!;
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand).not.toContain(lowId);
    expect(next.players.A.hand.length).toBe(handBefore);
  });

  it(
    'leftover top-4 non-picked cards go to BOTTOM of deck (closes cluster-A engine gap; searcher_peek default leftoverPlacement="bottom")',
    () => {
      const cand = deckChar('TEST_PICK', 4);
      const fillers = [deckChar('TEST_LO_1', 1), deckChar('TEST_LO_2', 1), deckChar('TEST_LO_3', 1)];
      const tail = deckChar('TEST_TAIL', 1);
      const { state } = buildState({ leaderA: L });
      const ids = seedDeck(state, [cand, ...fillers, tail]);
      const srcId = attach(state);
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
      );
      const tailIdx = next.players.A.deck.indexOf(ids[4]!);
      const filler1Idx = next.players.A.deck.indexOf(ids[1]!);
      // Leftovers should be AFTER the pre-existing tail (i.e. moved to bottom).
      expect(filler1Idx).toBeGreaterThan(tailIdx);
    },
  );
});
