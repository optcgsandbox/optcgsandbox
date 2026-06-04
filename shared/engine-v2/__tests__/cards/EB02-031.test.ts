/**
 * Per-card semantic test — EB02-031 Hope ([Main] event).
 * "[Main] Look at 4 cards from the top of your deck; reveal up to 1 card
 *  with a cost of 4 or more and add it to your hand. Then, place the rest
 *  at the bottom of your deck in any order."
 * Spec: on_play / searcher_peek lookCount:4 addCount:1 filter{costMin:4}.
 * Same effect family as EB02-008 / EB02-020.
 *
 * Engine gap re-ref EB01-009 / EB02-008: searcher_peek leftover unshifts
 *   to TOP not BOTTOM. Leftover-bottom assertion uses it.fails.
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
  id: 'TEST_L_EB02031', name: 'L', kind: 'leader', colors: ['blue'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function deckChar(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['blue'], cost, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-031 — Hope', () => {
  const c = loadCards().find((x) => x.id === 'EB02-031');
  if (c === undefined || c.kind !== 'event') throw new Error('EB02-031 invalid');
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

  it('cost-4 in top 4: added to hand', () => {
    const cand = deckChar('TEST_C4_E31', 4);
    const fillers = [deckChar('TEST_F1_E31', 1), deckChar('TEST_F2_E31', 1), deckChar('TEST_F3_E31', 1)];
    const { state } = buildState({ leaderA: L });
    seedDeck(state, [cand, ...fillers]);
    const srcId = attach(state);
    const candId = state.players.A.deck[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand).toContain(candId);
  });

  it('cost-3 in top 4: NOT added (boundary exclusive)', () => {
    const low = deckChar('TEST_C3_E31', 3);
    const fillers = [deckChar('TEST_FA_E31', 1), deckChar('TEST_FB_E31', 1), deckChar('TEST_FC_E31', 1)];
    const { state } = buildState({ leaderA: L });
    seedDeck(state, [low, ...fillers]);
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
    'leftover top-4 non-picks go to BOTTOM (closes cluster-A engine gap)',
    () => {
      const cand = deckChar('TEST_PICK_E31', 4);
      const fillers = [deckChar('TEST_LO1_E31', 1), deckChar('TEST_LO2_E31', 1), deckChar('TEST_LO3_E31', 1)];
      const tail = deckChar('TEST_TAIL_E31', 1);
      const { state } = buildState({ leaderA: L });
      const ids = seedDeck(state, [cand, ...fillers, tail]);
      const srcId = attach(state);
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
      );
      const tailIdx = next.players.A.deck.indexOf(ids[4]!);
      const filler1Idx = next.players.A.deck.indexOf(ids[1]!);
      expect(filler1Idx).toBeGreaterThan(tailIdx);
    },
  );
});
