/**
 * Engine V2 — test fixtures.
 *
 * Minimal helpers to build a runnable GameState for smoke tests.
 */

import type { Card } from '../cards/Card.js';
import {
  CURRENT_SCHEMA_VERSION,
  type CardId,
  type CardInstance,
  type GameState,
  type InstanceId,
  type PlayerId,
} from '../state/types.js';

let _instanceCounter = 0;

export function nextInstanceId(prefix: string): InstanceId {
  _instanceCounter += 1;
  return `${prefix}-${_instanceCounter}`;
}

export function resetInstanceCounter(): void {
  _instanceCounter = 0;
}

export function makeInstance(cardId: CardId, controller: PlayerId): CardInstance {
  return {
    instanceId: nextInstanceId(`${controller}-${cardId}`),
    cardId,
    controller,
    rested: false,
    summoningSick: false,
    attachedDon: [],
    attachedDonRested: [],
    perTurn: { hasAttacked: false, effectsUsed: [] },
  };
}

export const TEST_LEADER_RED: Card = {
  id: 'TEST-LEADER-RED',
  kind: 'leader',
  name: 'Test Red Leader',
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  colors: ['red'],
  traits: ['StrawHatCrew'],
  keywords: [],
  effectText: '',
};

export const TEST_CHAR_VANILLA: Card = {
  id: 'TEST-CHAR-VANILLA',
  kind: 'character',
  name: 'Test Vanilla 3K',
  cost: 2,
  power: 3000,
  counterValue: 1000,
  colors: ['red'],
  traits: ['StrawHatCrew'],
  keywords: [],
  effectText: '',
};

export const TEST_CHAR_RUSH: Card = {
  id: 'TEST-CHAR-RUSH',
  kind: 'character',
  name: 'Test Rush 4K',
  cost: 3,
  power: 4000,
  counterValue: 1000,
  colors: ['red'],
  traits: ['StrawHatCrew'],
  keywords: ['rush'],
  effectText: 'Rush.',
};

export const TEST_DON: Card = {
  id: 'TEST-DON',
  kind: 'don',
  name: 'DON!!',
  cost: null,
  power: null,
  counterValue: null,
  colors: [],
  traits: [],
  keywords: [],
  effectText: '',
};

/**
 * Build a minimal 2-player game state in main phase:
 *   - Both players have leader + 5 deck cards (vanilla) + 5 life + 10 DON
 *   - Active player = A; turn = 1; phase = 'main'
 *   - First player = A (no draw on first turn)
 */
export function buildBasicGameState(): GameState {
  resetInstanceCounter();
  const cardLibrary: Record<CardId, Card> = {
    [TEST_LEADER_RED.id]: TEST_LEADER_RED,
    [TEST_CHAR_VANILLA.id]: TEST_CHAR_VANILLA,
    [TEST_CHAR_RUSH.id]: TEST_CHAR_RUSH,
    [TEST_DON.id]: TEST_DON,
  };
  const instances: Record<InstanceId, CardInstance> = {};

  function addPlayer(side: PlayerId, donCount: number): {
    leader: CardInstance;
    deck: InstanceId[];
    life: InstanceId[];
    donDeck: InstanceId[];
  } {
    const leader = makeInstance(TEST_LEADER_RED.id, side);
    instances[leader.instanceId] = leader;

    const deck: InstanceId[] = [];
    for (let i = 0; i < 15; i++) {
      const inst = makeInstance(TEST_CHAR_VANILLA.id, side);
      instances[inst.instanceId] = inst;
      deck.push(inst.instanceId);
    }
    const life: InstanceId[] = [];
    for (let i = 0; i < 5; i++) {
      const inst = makeInstance(TEST_CHAR_VANILLA.id, side);
      instances[inst.instanceId] = inst;
      life.push(inst.instanceId);
    }
    const donDeck: InstanceId[] = [];
    for (let i = 0; i < donCount; i++) {
      const inst = makeInstance(TEST_DON.id, side);
      instances[inst.instanceId] = inst;
      donDeck.push(inst.instanceId);
    }
    return { leader, deck, life, donDeck };
  }

  const A = addPlayer('A', 10);
  const B = addPlayer('B', 10);

  const state: GameState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    seed: 42,
    rngCounter: 0,
    turn: 1,
    activePlayer: 'A',
    firstPlayer: 'A',
    phase: 'main',
    controllerMode: { A: 'deterministic', B: 'deterministic' },
    players: {
      A: {
        leader: A.leader,
        hand: [],
        deck: A.deck,
        trash: [],
        field: [],
        stage: null,
        life: A.life,
        lifeFaceUp: {},
        donDeck: A.donDeck.slice(2),
        donCostArea: A.donDeck.slice(0, 2), // 2 DON ready (first-player turn 1: +1; but for testing, give 2)
        donRested: [],
        exile: [],
      },
      B: {
        leader: B.leader,
        hand: [],
        deck: B.deck,
        trash: [],
        field: [],
        stage: null,
        life: B.life,
        lifeFaceUp: {},
        donDeck: B.donDeck,
        donCostArea: [],
        donRested: [],
        exile: [],
      },
    },
    cardLibrary,
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
  return state;
}

/** Helper: move top card of deck into hand (sidestepping draw phase logic
 *  for setup of tests that need a specific card in hand). */
export function moveTopOfDeckToHand(state: GameState, side: PlayerId): InstanceId {
  const pl = state.players[side];
  const id = pl.deck.shift();
  if (id === undefined) throw new Error('deck empty');
  pl.hand.push(id);
  return id;
}
