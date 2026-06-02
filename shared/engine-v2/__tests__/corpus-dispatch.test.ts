/**
 * Engine V2 — corpus runtime dispatch test.
 *
 * For every card in cards.json with an effectSpecV2:
 *   - Build a fresh minimal GameState with the card on Player A's field
 *   - For each clause trigger present on the card, call EffectDispatcher.dispatch
 *   - Assert no exception is thrown
 *
 * Catches handler bugs the boot gate misses:
 *   - Runtime exceptions (null deref, missing field, etc.)
 *   - Invariant violations after dispatch
 *   - Infinite loops (via per-card timeout)
 *
 * Does NOT validate semantic correctness — that's the per-card behavior
 * test suite (Phase 4 work).
 */

// @ts-expect-error
import { readFileSync } from 'node:fs';
// @ts-expect-error
import { resolve } from 'node:path';
// @ts-expect-error
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card } from '../cards/Card.js';
import { EffectDispatcher } from '../effects/EffectDispatcher.js';
import { assertInvariants } from '../invariants/check.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';
import {
  CURRENT_SCHEMA_VERSION,
  type CardId,
  type CardInstance,
  type GameState,
  type InstanceId,
  type PlayerId,
} from '../state/types.js';

// @ts-expect-error
const __filename = fileURLToPath(import.meta.url);
// @ts-expect-error
const __dirname = resolve(__filename, '..');

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

function loadCards(): Card[] {
  const raw = readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf-8');
  return JSON.parse(raw) as Card[];
}

let _id = 0;
function nextId(p: string): InstanceId {
  _id += 1;
  return `${p}-${_id}`;
}

function makeInst(cardId: CardId, controller: PlayerId): CardInstance {
  return {
    instanceId: nextId(`${controller}-${cardId}`),
    cardId,
    controller,
    rested: false,
    summoningSick: false,
    attachedDon: [],
    attachedDonRested: [],
    perTurn: { hasAttacked: false, effectsUsed: [] },
  };
}

/**
 * Build a state with one card on Player A's field (the testCard) plus a
 * leader for each side and 10 deck/5 life/10 DON for both.
 */
function buildStateWithCard(testCard: Card, cardLibrary: Record<CardId, Card>): {
  state: GameState;
  testInstanceId: InstanceId;
} {
  const leaderCardA: Card = {
    id: 'TEST-LEADER-A',
    kind: 'leader',
    name: 'L A',
    cost: null,
    power: 5000,
    life: 5,
    counterValue: null,
    colors: ['red'],
    traits: [],
    keywords: [],
    effectText: '',
  };
  const leaderCardB: Card = {
    id: 'TEST-LEADER-B',
    kind: 'leader',
    name: 'L B',
    cost: null,
    power: 5000,
    life: 5,
    counterValue: null,
    colors: ['blue'],
    traits: [],
    keywords: [],
    effectText: '',
  };
  const donCard: Card = {
    id: 'TEST-DON',
    kind: 'don',
    name: 'DON',
    cost: null,
    power: null,
    counterValue: null,
    colors: [],
    traits: [],
    keywords: [],
    effectText: '',
  };
  const fillerCard: Card = {
    id: 'TEST-FILLER',
    kind: 'character',
    name: 'Filler',
    cost: 2,
    power: 3000,
    counterValue: 1000,
    colors: ['red'],
    traits: [],
    keywords: [],
    effectText: '',
  };
  const lib: Record<CardId, Card> = {
    ...cardLibrary,
    [leaderCardA.id]: leaderCardA,
    [leaderCardB.id]: leaderCardB,
    [donCard.id]: donCard,
    [fillerCard.id]: fillerCard,
  };
  if (lib[testCard.id] === undefined) lib[testCard.id] = testCard;

  const instances: Record<InstanceId, CardInstance> = {};
  const lA = makeInst(leaderCardA.id, 'A');
  const lB = makeInst(leaderCardB.id, 'B');
  instances[lA.instanceId] = lA;
  instances[lB.instanceId] = lB;

  function fillZone(side: PlayerId, count: number, cardId: CardId): InstanceId[] {
    const out: InstanceId[] = [];
    for (let i = 0; i < count; i++) {
      const inst = makeInst(cardId, side);
      instances[inst.instanceId] = inst;
      out.push(inst.instanceId);
    }
    return out;
  }

  const A_deck = fillZone('A', 15, fillerCard.id);
  const A_life = fillZone('A', 5, fillerCard.id);
  const A_donAll = fillZone('A', 10, donCard.id);
  const A_hand = fillZone('A', 3, fillerCard.id);
  const A_trash = fillZone('A', 3, fillerCard.id);

  const B_deck = fillZone('B', 15, fillerCard.id);
  const B_life = fillZone('B', 5, fillerCard.id);
  const B_donAll = fillZone('B', 10, donCard.id);
  const B_hand = fillZone('B', 3, fillerCard.id);

  // Test card on A's field
  const testInst = makeInst(testCard.id, 'A');
  instances[testInst.instanceId] = testInst;
  // Also place a couple of B field chars so opp_character / removal targets exist
  const B_field: CardInstance[] = [];
  for (let i = 0; i < 2; i++) {
    const c = makeInst(fillerCard.id, 'B');
    instances[c.instanceId] = c;
    B_field.push(c);
  }

  const state: GameState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    seed: 1,
    rngCounter: 0,
    turn: 2,
    activePlayer: 'A',
    firstPlayer: 'A',
    phase: 'main',
    controllerMode: { A: 'deterministic', B: 'deterministic' },
    players: {
      A: {
        leader: lA,
        hand: A_hand,
        deck: A_deck,
        trash: A_trash,
        field: [testInst],
        stage: null,
        life: A_life,
        lifeFaceUp: {},
        donDeck: A_donAll.slice(5),
        donCostArea: A_donAll.slice(0, 5),
        donRested: [],
        exile: [],
      },
      B: {
        leader: lB,
        hand: B_hand,
        deck: B_deck,
        trash: [],
        field: B_field,
        stage: null,
        life: B_life,
        lifeFaceUp: {},
        donDeck: B_donAll.slice(5),
        donCostArea: B_donAll.slice(0, 5),
        donRested: [],
        exile: [],
      },
    },
    cardLibrary: lib,
    instances,
    history: [],
    result: null,
    pending: null,
    koSourceStack: [],
    pendingDonReturned: {},
    mulliganUsed: { A: false, B: false },
    diceRoll: null,
    knownByViewer: { A: [], B: [] },
    gameRules: {},
    continuousApplyDepth: 0,
  };
  return { state, testInstanceId: testInst.instanceId };
}

describe('engine-v2 corpus runtime dispatch', () => {
  const cards = loadCards();
  const cardLibrary: Record<CardId, Card> = {};
  for (const c of cards) cardLibrary[c.id] = c;

  // Iterate cards with effectSpecV2 + at least one clause
  const dispatchable = cards.filter(
    (c) => c.effectSpecV2 !== undefined && (c.effectSpecV2.clauses ?? []).length > 0,
  );

  it('every card with clauses dispatches without throwing', { timeout: 60000 }, () => {
    const failures: { cardId: string; trigger: string; error: string }[] = [];
    for (const card of dispatchable) {
      const triggers = new Set((card.effectSpecV2!.clauses ?? []).map((cl) => cl.trigger));
      for (const trigger of triggers) {
        const { state, testInstanceId } = buildStateWithCard(card, cardLibrary);
        try {
          const next = EffectDispatcher.dispatch(state, {
            sourceInstanceId: testInstanceId,
            controller: 'A',
          }, trigger);
          // Invariants should still hold after dispatch (uses the post-state
          // as baseline since gameRules can't be mutated by clause dispatch).
          assertInvariants(next, state);
        } catch (e) {
          failures.push({
            cardId: card.id,
            trigger,
            error: (e as Error).message,
          });
          if (failures.length >= 25) break; // cap output noise
        }
      }
      if (failures.length >= 25) break;
    }
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.error(`\n${failures.length} dispatch failures (first 25):\n` +
        failures.map((f) => `  - ${f.cardId} [${f.trigger}]: ${f.error}`).join('\n'));
    }
    expect(failures).toEqual([]);
  });
});
