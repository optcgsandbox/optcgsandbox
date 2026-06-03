/**
 * Per-card semantic test — EB01-001 Kouzuki Oden (leader).
 *
 * Printed text (cards.json):
 *   "All of your {Land of Wano} type Character cards without a Counter have
 *    a +1000 Counter, according to the rules.
 *    [DON!! x1] [When Attacking] If you have a {Land of Wano} type Character
 *    with a cost of 5 or more, this Leader gains +1000 power until the start
 *    of your next turn."
 *
 * Asserts the engine's *actual* behaviour matches the printed text. Plan §5.2
 * per-card semantic layer.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { ContinuousManager } from '../../effects/ContinuousManager.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';
import {
  CURRENT_SCHEMA_VERSION,
  type CardId,
  type CardInstance,
  type GameState,
  type InstanceId,
} from '../../state/types.js';

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

let _id = 0;
function nextId(prefix: string): InstanceId {
  _id += 1;
  return `${prefix}-${_id}`;
}

function makeInst(cardId: CardId, controller: 'A' | 'B'): CardInstance {
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

interface SetupOpts {
  leader: LeaderCard;
  charsA?: CharacterCard[];
  charsB?: CharacterCard[];
}

function buildState({ leader, charsA = [], charsB = [] }: SetupOpts): {
  state: GameState;
  leaderInst: CardInstance;
  charsA: CardInstance[];
  charsB: CardInstance[];
} {
  const lib: Record<CardId, Card> = {};
  lib[leader.id] = leader;
  for (const c of charsA) lib[c.id] = c;
  for (const c of charsB) lib[c.id] = c;

  const oppLeader: LeaderCard = { ...leader, id: 'OPP_LEADER' };
  lib[oppLeader.id] = oppLeader;

  const leaderInst = makeInst(leader.id, 'A');
  const oppLeaderInst = makeInst(oppLeader.id, 'B');
  const aFieldInsts = charsA.map((c) => makeInst(c.id, 'A'));
  const bFieldInsts = charsB.map((c) => makeInst(c.id, 'B'));

  const instances: Record<InstanceId, CardInstance> = {
    [leaderInst.instanceId]: leaderInst,
    [oppLeaderInst.instanceId]: oppLeaderInst,
  };
  for (const i of aFieldInsts) instances[i.instanceId] = i;
  for (const i of bFieldInsts) instances[i.instanceId] = i;

  const state: GameState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    seed: 1,
    rngCounter: 0,
    turn: 1,
    activePlayer: 'A',
    firstPlayer: 'A',
    phase: 'main',
    controllerMode: { A: 'deterministic', B: 'deterministic' },
    players: {
      A: {
        leader: leaderInst,
        hand: [],
        deck: [],
        trash: [],
        field: aFieldInsts,
        stage: null,
        life: [],
        lifeFaceUp: {},
        donDeck: [],
        donCostArea: [],
        donRested: [],
        exile: [],
      },
      B: {
        leader: oppLeaderInst,
        hand: [],
        deck: [],
        trash: [],
        field: bFieldInsts,
        stage: null,
        life: [],
        lifeFaceUp: {},
        donDeck: [],
        donCostArea: [],
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
    cardsTrashedThisResolution: 0,
  };
  return { state, leaderInst, charsA: aFieldInsts, charsB: bFieldInsts };
}

describe('EB01-001 — Kouzuki Oden (leader)', () => {
  const allCards = loadCards();
  const eb01_001 = allCards.find((c) => c.id === 'EB01-001');
  if (eb01_001 === undefined) throw new Error('EB01-001 not in cards.json');
  if (eb01_001.kind !== 'leader') throw new Error('EB01-001 should be a leader');

  const leader = eb01_001 as LeaderCard;

  describe('continuous aura_counter_buff — "Land of Wano chars without a counter gain +1000"', () => {
    it('grants +1000 counter bonus to a Land-of-Wano char with printed counter 0', () => {
      const zeroCounterChar: CharacterCard = {
        id: 'TEST_LOW_ZERO',
        name: 'Wano Zero',
        kind: 'character',
        colors: ['red'],
        cost: 3,
        power: 4000,
        counterValue: 0,
        traits: ['Land of Wano'],
        keywords: [],
        effectTags: [],
      };
      const { state, charsA } = buildState({ leader, charsA: [zeroCounterChar] });
      const folded = ContinuousManager.refold(state);
      const inst = folded.instances[charsA[0]!.instanceId]!;
      expect(inst.counterBonus).toBe(1000);
    });

    it('does NOT grant counter bonus to a Land-of-Wano char with printed counter 2000', () => {
      const hasCounterChar: CharacterCard = {
        id: 'TEST_LOW_HAS',
        name: 'Wano Has',
        kind: 'character',
        colors: ['red'],
        cost: 3,
        power: 4000,
        counterValue: 2000,
        traits: ['Land of Wano'],
        keywords: [],
        effectTags: [],
      };
      const { state, charsA } = buildState({ leader, charsA: [hasCounterChar] });
      const folded = ContinuousManager.refold(state);
      const inst = folded.instances[charsA[0]!.instanceId]!;
      expect(inst.counterBonus ?? 0).toBe(0);
    });

    it('does NOT grant counter bonus to a non-Land-of-Wano char', () => {
      const otherChar: CharacterCard = {
        id: 'TEST_NLOW',
        name: 'Not Wano',
        kind: 'character',
        colors: ['red'],
        cost: 3,
        power: 4000,
        counterValue: 0,
        traits: ['Straw Hat Crew'],
        keywords: [],
        effectTags: [],
      };
      const { state, charsA } = buildState({ leader, charsA: [otherChar] });
      const folded = ContinuousManager.refold(state);
      const inst = folded.instances[charsA[0]!.instanceId]!;
      expect(inst.counterBonus ?? 0).toBe(0);
    });

    it('refold idempotence — applying twice yields the same counterBonus', () => {
      const zeroCounterChar: CharacterCard = {
        id: 'TEST_LOW_IDEM',
        name: 'Wano Idem',
        kind: 'character',
        colors: ['red'],
        cost: 3,
        power: 4000,
        counterValue: 0,
        traits: ['Land of Wano'],
        keywords: [],
        effectTags: [],
      };
      const { state, charsA } = buildState({ leader, charsA: [zeroCounterChar] });
      const once = ContinuousManager.refold(state);
      const twice = ContinuousManager.refold(once);
      const inst = twice.instances[charsA[0]!.instanceId]!;
      expect(inst.counterBonus).toBe(1000);
    });
  });
});
