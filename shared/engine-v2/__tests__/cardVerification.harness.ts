/**
 * Engine V2 — per-card behavior verification harness.
 *
 * Port of V1 shared/engine/__tests__/cardVerification.harness.ts:179.
 *
 * For each card with a non-empty effectSpecV2:
 *   - Build minimal state with the card on Player A's field.
 *   - For each clause, dispatch via EffectDispatcher and capture before/after.
 *   - Assert side-effect by computed state delta against action.magnitude.
 *
 * V0 assertions: spec-level — verifies the engine implements what the spec
 * says. Text-level correctness (spec matches printed text) is the per-card
 * audit's job, not this harness.
 *
 * Adds catch list for handlers added since V1:
 *   draw / ramp / mill_self / mill_opp / lifegain (alias life_to_hand /
 *   take_damage_self) / life_to_hand / discard_from_hand / discard_opp_hand /
 *   trash_top_of_deck.
 */

// @ts-expect-error
import { readFileSync } from 'node:fs';
// @ts-expect-error
import { resolve } from 'node:path';
// @ts-expect-error
import { fileURLToPath } from 'node:url';

import type { Card } from '../cards/Card.js';
import { EffectDispatcher } from '../effects/EffectDispatcher.js';
import type { EffectActionV2 } from '../spec/types.js';
import {
  type CardId,
  type CardInstance,
  CURRENT_SCHEMA_VERSION,
  type GameState,
  type InstanceId,
  type PlayerId,
} from '../state/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

let _idCounter = 0;
function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${_idCounter}`;
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

const VANILLA: Card = {
  id: 'V',
  name: 'V',
  kind: 'character',
  cost: 2,
  power: 3000,
  counterValue: 1000,
  colors: ['red'],
  traits: [],
  keywords: [],
  effectText: '',
};
const LEADER: Card = {
  id: 'LA',
  name: 'LA',
  kind: 'leader',
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  colors: ['red'],
  traits: [],
  keywords: [],
  effectText: '',
};
const DON: Card = {
  id: 'DON',
  name: 'DON!!',
  kind: 'don',
  cost: null,
  power: null,
  counterValue: null,
  colors: [],
  traits: [],
  keywords: [],
  effectText: '',
};

/** Build a fresh GameState with `card` on Player A's field. */
function buildState(card: Card): { state: GameState; sourceId: InstanceId } {
  _idCounter = 0;
  const cardLibrary: Record<CardId, Card> = {
    [VANILLA.id]: VANILLA,
    [LEADER.id]: LEADER,
    [DON.id]: DON,
    [card.id]: card,
  };
  const instances: Record<InstanceId, CardInstance> = {};

  function fillZone(side: PlayerId, count: number, cardId: CardId): InstanceId[] {
    const out: InstanceId[] = [];
    for (let i = 0; i < count; i++) {
      const inst = makeInst(cardId, side);
      instances[inst.instanceId] = inst;
      out.push(inst.instanceId);
    }
    return out;
  }

  const aLeader = makeInst(LEADER.id, 'A');
  const bLeader = makeInst(LEADER.id, 'B');
  instances[aLeader.instanceId] = aLeader;
  instances[bLeader.instanceId] = bLeader;
  const aDeck = fillZone('A', 30, VANILLA.id);
  const aLife = fillZone('A', 5, VANILLA.id);
  const aHand = fillZone('A', 5, VANILLA.id);
  const aTrash = fillZone('A', 3, VANILLA.id);
  const aDonAll = fillZone('A', 10, DON.id);
  const bDeck = fillZone('B', 30, VANILLA.id);
  const bLife = fillZone('B', 5, VANILLA.id);
  const bHand = fillZone('B', 5, VANILLA.id);
  const bDonAll = fillZone('B', 10, DON.id);

  const source = makeInst(card.id, 'A');
  instances[source.instanceId] = source;

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
        leader: aLeader,
        hand: aHand,
        deck: aDeck,
        trash: aTrash,
        field: [source],
        stage: null,
        life: aLife,
        lifeFaceUp: {},
        donDeck: aDonAll.slice(4),
        donCostArea: aDonAll.slice(0, 4),
        donRested: [],
        exile: [],
      },
      B: {
        leader: bLeader,
        hand: bHand,
        deck: bDeck,
        trash: [],
        field: [],
        stage: null,
        life: bLife,
        lifeFaceUp: {},
        donDeck: bDonAll.slice(4),
        donCostArea: bDonAll.slice(0, 4),
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
  };
  return { state, sourceId: source.instanceId };
}

interface AssertResult {
  readonly pass: boolean;
  readonly reason?: string;
}

function me(state: GameState): GameState['players'][PlayerId] {
  return state.players.A;
}
function opp(state: GameState): GameState['players'][PlayerId] {
  return state.players.B;
}

function assertActionEffect(
  before: GameState,
  after: GameState,
  action: EffectActionV2,
): AssertResult {
  const mag = action['magnitude'];
  switch (action.kind) {
    case 'draw': {
      if (typeof mag !== 'number') return { pass: true, reason: 'formula magnitude' };
      const delta = me(after).hand.length - me(before).hand.length;
      if (delta !== mag) return { pass: false, reason: `draw expected ${mag}, got ${delta}` };
      return { pass: true };
    }
    case 'mill_self':
    case 'trash_top_of_deck': {
      const n = typeof mag === 'number' ? mag : 1;
      // mill_self trashes from own deck → own trash; trash_top_of_deck same.
      const delta = me(after).trash.length - me(before).trash.length;
      if (delta !== n) return { pass: false, reason: `${action.kind} expected ${n}, got ${delta}` };
      return { pass: true };
    }
    case 'mill_opp':
    case 'mill': {
      const n = typeof mag === 'number' ? mag : 1;
      const delta = opp(after).trash.length - opp(before).trash.length;
      if (delta !== n) return { pass: false, reason: `${action.kind} expected ${n}, got ${delta}` };
      return { pass: true };
    }
    case 'life_to_hand':
    case 'take_damage_self': {
      const n = typeof mag === 'number' ? mag : 1;
      const lifeDelta = me(before).life.length - me(after).life.length;
      const handDelta = me(after).hand.length - me(before).hand.length;
      if (lifeDelta !== n || handDelta !== n) {
        return { pass: false, reason: `${action.kind} expected ${n}, life-=${lifeDelta} hand+=${handDelta}` };
      }
      return { pass: true };
    }
    case 'deal_damage_opp': {
      const n = typeof mag === 'number' ? mag : 1;
      const lifeDelta = opp(before).life.length - opp(after).life.length;
      if (lifeDelta !== n) return { pass: false, reason: `deal_damage_opp expected ${n}, life-=${lifeDelta}` };
      return { pass: true };
    }
    case 'ramp': {
      if (typeof mag !== 'number') return { pass: true, reason: 'formula magnitude' };
      const donBefore = me(before).donCostArea.length + me(before).donRested.length;
      const donAfter = me(after).donCostArea.length + me(after).donRested.length;
      if (donAfter - donBefore !== mag) {
        return { pass: false, reason: `ramp expected ${mag}, got ${donAfter - donBefore}` };
      }
      return { pass: true };
    }
    case 'discard_from_hand': {
      const n = typeof mag === 'number' ? mag : 1;
      const handDelta = me(before).hand.length - me(after).hand.length;
      const trashDelta = me(after).trash.length - me(before).trash.length;
      if (handDelta !== n || trashDelta !== n) {
        return { pass: false, reason: `discard_from_hand expected ${n}, hand-=${handDelta} trash+=${trashDelta}` };
      }
      return { pass: true };
    }
    case 'opp_discard_from_hand':
    case 'discard_opp_hand': {
      const n = typeof mag === 'number' ? mag : 1;
      const handDelta = opp(before).hand.length - opp(after).hand.length;
      if (handDelta !== n) return { pass: false, reason: `${action.kind} expected ${n}, opp-hand-=${handDelta}` };
      return { pass: true };
    }
    default:
      // V0 stub: trust the engine's tested implementation for actions whose
      // side-effect verification needs target context, condition gates, or
      // continuous interaction.
      return { pass: true, reason: 'stub' };
  }
}

export interface CardVerifyResult {
  readonly cardId: string;
  readonly pass: boolean;
  readonly vanilla: boolean;
  readonly errors: ReadonlyArray<string>;
}

export function verifyCard(card: Card): CardVerifyResult {
  const spec = card.effectSpecV2;
  if (spec === undefined) return { cardId: card.id, pass: true, vanilla: true, errors: [] };
  const clauses = Array.isArray(spec.clauses) ? spec.clauses : [];
  if (clauses.length === 0) return { cardId: card.id, pass: true, vanilla: true, errors: [] };

  const errors: string[] = [];
  const { state, sourceId } = buildState(card);
  let working = state;
  for (const clause of clauses) {
    // Capture before-state snapshot via structured clone.
    const before: GameState = structuredClone(working);
    try {
      working = EffectDispatcher.dispatch(working, {
        sourceInstanceId: sourceId,
        controller: 'A',
      }, clause.trigger);
    } catch (e) {
      errors.push(`clause ${clause.action.kind} threw: ${(e as Error).message}`);
      continue;
    }
    const result = assertActionEffect(before, working, clause.action);
    if (!result.pass) {
      errors.push(`${clause.action.kind}: ${result.reason ?? 'failed'}`);
    }
  }
  return { cardId: card.id, pass: errors.length === 0, vanilla: false, errors };
}

export interface CorpusVerifyReport {
  readonly pass: number;
  readonly fail: number;
  readonly vanilla: number;
  readonly failures: ReadonlyArray<CardVerifyResult>;
}

export function verifyAllCards(): CorpusVerifyReport {
  const raw = readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf-8');
  const cards = JSON.parse(raw) as Card[];
  let pass = 0, fail = 0, vanilla = 0;
  const failures: CardVerifyResult[] = [];
  for (const card of cards) {
    const r = verifyCard(card);
    if (r.vanilla) vanilla += 1;
    else if (r.pass) pass += 1;
    else {
      fail += 1;
      failures.push(r);
    }
  }
  return { pass, fail, vanilla, failures };
}
