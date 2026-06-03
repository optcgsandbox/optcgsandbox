/**
 * Shared fixtures for per-card semantic tests (Plan §5.2 layer).
 *
 * Goal: each per-card test file stays focused on assertions for that
 * card's printed text. State construction, instance creation, and the
 * "place an opponent character" helpers all live here.
 */

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import {
  CURRENT_SCHEMA_VERSION,
  type CardId,
  type CardInstance,
  type GameState,
  type InstanceId,
  type PlayerId,
} from '../../state/types.js';

let _id = 0;
export function nextInstanceId(prefix: string): InstanceId {
  _id += 1;
  return `${prefix}-${_id}`;
}

export function makeInst(cardId: CardId, controller: PlayerId): CardInstance {
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

/** Vanilla red 2-cost character with 3000 power + 1000 counter. Used as
 *  filler when the test doesn't care about the card's effect. */
export const VANILLA_FILLER: CharacterCard = {
  id: '__VANILLA',
  name: 'Vanilla',
  kind: 'character',
  colors: ['red'],
  cost: 2,
  power: 3000,
  counterValue: 1000,
  traits: [],
  keywords: [],
  effectTags: ['vanilla'],
};

export interface BuildOpts {
  leaderA: LeaderCard;
  leaderB?: LeaderCard;
  /** Characters to place face-up on player A's field at game start. */
  charsA?: CharacterCard[];
  /** Characters to place face-up on player B's field at game start. */
  charsB?: CharacterCard[];
  /** Card IDs to put in A's hand (used to test play-from-hand flows). */
  handA?: CharacterCard[];
  /** Card IDs to put in B's hand. */
  handB?: CharacterCard[];
  /** Active DON in A's cost area. Default 10. */
  donInCostA?: number;
  /** Active DON in B's cost area. Default 10. */
  donInCostB?: number;
  /** Turn number. Default 2 so first-player-no-draw doesn't bite. */
  turn?: number;
  /** Phase. Default 'main'. */
  phase?: GameState['phase'];
}

export interface BuiltState {
  state: GameState;
  leaderInstA: CardInstance;
  leaderInstB: CardInstance;
  fieldA: CardInstance[];
  fieldB: CardInstance[];
  handAInstances: CardInstance[];
  handBInstances: CardInstance[];
}

/** Build a minimal GameState for per-card testing. Each call is fresh:
 *  the instance-id counter is monotonic so IDs are unique across tests but
 *  no state is shared between calls. */
export function buildState(opts: BuildOpts): BuiltState {
  const {
    leaderA,
    leaderB = { ...leaderA, id: `${leaderA.id}__OPP`, name: `${leaderA.name} (opp)` },
    charsA = [],
    charsB = [],
    handA = [],
    handB = [],
    donInCostA = 10,
    donInCostB = 10,
    turn = 2,
    phase = 'main',
  } = opts;

  const lib: Record<CardId, Card> = {};
  const registerCard = (c: Card): void => {
    lib[c.id] = c;
  };
  registerCard(leaderA);
  registerCard(leaderB);
  for (const c of charsA) registerCard(c);
  for (const c of charsB) registerCard(c);
  for (const c of handA) registerCard(c);
  for (const c of handB) registerCard(c);

  const leaderInstA = makeInst(leaderA.id, 'A');
  const leaderInstB = makeInst(leaderB.id, 'B');
  const fieldA = charsA.map((c) => makeInst(c.id, 'A'));
  const fieldB = charsB.map((c) => makeInst(c.id, 'B'));
  const handAInsts = handA.map((c) => makeInst(c.id, 'A'));
  const handBInsts = handB.map((c) => makeInst(c.id, 'B'));

  const instances: Record<InstanceId, CardInstance> = {
    [leaderInstA.instanceId]: leaderInstA,
    [leaderInstB.instanceId]: leaderInstB,
  };
  for (const i of fieldA) instances[i.instanceId] = i;
  for (const i of fieldB) instances[i.instanceId] = i;
  for (const i of handAInsts) instances[i.instanceId] = i;
  for (const i of handBInsts) instances[i.instanceId] = i;

  // DON instances. Each side gets a stable pool of donInCost in cost area.
  const makeDonInst = (id: InstanceId, controller: PlayerId): CardInstance => ({
    instanceId: id,
    cardId: '__DON',
    controller,
    rested: false,
    summoningSick: false,
    attachedDon: [],
    attachedDonRested: [],
    perTurn: { hasAttacked: false, effectsUsed: [] },
  });
  const donA: InstanceId[] = [];
  const donB: InstanceId[] = [];
  for (let i = 0; i < donInCostA; i++) {
    const id = nextInstanceId('A-DON');
    instances[id] = makeDonInst(id, 'A');
    donA.push(id);
  }
  for (let i = 0; i < donInCostB; i++) {
    const id = nextInstanceId('B-DON');
    instances[id] = makeDonInst(id, 'B');
    donB.push(id);
  }

  const state: GameState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    seed: 1,
    rngCounter: 0,
    turn,
    activePlayer: 'A',
    firstPlayer: 'A',
    phase,
    controllerMode: { A: 'deterministic', B: 'deterministic' },
    players: {
      A: {
        leader: leaderInstA,
        hand: handAInsts.map((i) => i.instanceId),
        deck: [],
        trash: [],
        field: fieldA,
        stage: null,
        life: [],
        lifeFaceUp: {},
        donDeck: [],
        donCostArea: donA,
        donRested: [],
        exile: [],
      },
      B: {
        leader: leaderInstB,
        hand: handBInsts.map((i) => i.instanceId),
        deck: [],
        trash: [],
        field: fieldB,
        stage: null,
        life: [],
        lifeFaceUp: {},
        donDeck: [],
        donCostArea: donB,
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
  return {
    state,
    leaderInstA,
    leaderInstB,
    fieldA,
    fieldB,
    handAInstances: handAInsts,
    handBInstances: handBInsts,
  };
}
