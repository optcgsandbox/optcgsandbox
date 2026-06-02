/**
 * Engine V2 — Hard tier AI: 1-ply lookahead + state-value heuristic.
 *
 * For each legal action: simulate via applyAction → score resulting state
 * with a heuristic that reads only zones the AI is allowed to inspect
 * (no opp hand peek, no own life peek, no own deck order peek). Pick the
 * action with the highest score; ties broken by category bias.
 *
 * Simulator runs on real GameState (physics requires it), but evaluator
 * refuses to read hidden info. AI never makes decisions contingent on
 * knowledge a human wouldn't have.
 *
 * Port of V1 shared/engine/ai/HardAi.ts (305 lines).
 */

import type { Card } from '../cards/Card.js';
import type { Action } from '../protocol/actions.js';
import { applyAction } from '../reducers/applyAction.js';
import { getLegalActions } from '../rules/legality.js';
import { effectivePower } from '../state/derived/power.js';
import type {
  CardInstance,
  GameState,
  PlayerId,
} from '../state/types.js';
import { drawProbability } from '../view/ViewModule.js';
import type { AiDriver, AiTier } from './AiDriver.js';

export class HardAi implements AiDriver {
  readonly tier: AiTier = 'hard';

  async chooseAction(state: GameState, player: PlayerId, _deadlineMs: number): Promise<Action> {
    const legal = getLegalActions(state, player).filter((a) => a.type !== 'CONCEDE');
    if (legal.length === 0) return { type: 'END_TURN' };

    let best: Action = legal[0]!;
    let bestScore = -Infinity;

    for (const action of legal) {
      let next: GameState;
      try {
        next = simulateAction(state, player, action);
      } catch {
        continue;
      }
      const score = evaluateForPlayer(next, player) + categoryBonus(action, state, player);
      if (score > bestScore) {
        bestScore = score;
        best = action;
      }
    }
    return best;
  }
}

function simulateAction(state: GameState, player: PlayerId, action: Action): GameState {
  let s = applyAction(state, player, action, { checkInvariants: false }).state;
  let safety = 0;
  while (safety++ < 32) {
    const opp: PlayerId = player === 'A' ? 'B' : 'A';
    if (s.phase === 'block_window') {
      s = applyAction(s, opp, { type: 'SKIP_BLOCKER' }, { checkInvariants: false }).state;
      continue;
    }
    if (s.phase === 'counter_window') {
      s = applyAction(s, opp, { type: 'SKIP_COUNTER' }, { checkInvariants: false }).state;
      continue;
    }
    if (s.phase === 'peek_choice' && s.pending?.kind === 'peek') {
      const pp = s.pending.pendingPeek;
      const ranked = pp.peekedIds
        .map((id) => {
          const inst = s.instances[id];
          const card = inst !== undefined ? (s.cardLibrary[inst.cardId] as Card | undefined) : undefined;
          const cost = card !== undefined && card.kind === 'character' ? card.cost : 0;
          return { id, cost };
        })
        .sort((a, b) => b.cost - a.cost);
      const pick = ranked.slice(0, pp.addCount).map((r) => r.id);
      s = applyAction(s, pp.controller, { type: 'RESOLVE_PEEK', pickedIds: pick }, { checkInvariants: false }).state;
      continue;
    }
    if (s.phase === 'discard_choice' && s.pending?.kind === 'discard') {
      const pd = s.pending.pendingDiscard;
      const handSide: PlayerId = pd.revealedFrom === 'self_hand' ? pd.controller : (pd.controller === 'A' ? 'B' : 'A');
      const oppHand = s.players[handSide].hand;
      let bestId: string | null = null;
      let bestCost = -1;
      for (const id of oppHand) {
        const inst = s.instances[id];
        const card = inst !== undefined ? (s.cardLibrary[inst.cardId] as Card | undefined) : undefined;
        const cost = card !== undefined && card.kind === 'character' ? card.cost : 0;
        if (cost > bestCost) {
          bestCost = cost;
          bestId = id;
        }
      }
      s = applyAction(s, pd.controller, { type: 'RESOLVE_DISCARD', pickedId: bestId }, { checkInvariants: false }).state;
      continue;
    }
    if (s.phase === 'trigger_window' && s.pending?.kind === 'trigger') {
      const owner = s.pending.pendingTrigger.controller;
      const decline = applyAction(s, owner, { type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null }, { checkInvariants: false }).state;
      const activate = applyAction(s, owner, { type: 'RESOLVE_TRIGGER', activate: true, targetInstanceId: null }, { checkInvariants: false }).state;
      const declineScore = evaluateForPlayer(decline, player);
      const activateScore = evaluateForPlayer(activate, player);
      s = activateScore > declineScore ? activate : decline;
      continue;
    }
    break;
  }
  return s;
}

const WEIGHTS = {
  lifePerCard: 5000,
  powerPerPoint: 1,
  handPerCard: 300,
  donActive: 250,
  donRested: 150,
  threatPerKilo: 200,
  lethalLifeDiscount: 1000,
  lethalBonus: 50_000,
  drawFinisher: 800,
} as const;

export function evaluateForPlayer(state: GameState, viewer: PlayerId): number {
  if (state.result !== null) {
    if (state.result.loser === viewer) return -1_000_000;
    return 1_000_000;
  }

  const opp: PlayerId = viewer === 'A' ? 'B' : 'A';
  const me = state.players[viewer];
  const them = state.players[opp];

  const lifeAdv = (me.life.length - them.life.length) * WEIGHTS.lifePerCard;
  const myBoard = fieldPowerSum(state, me.field, me.leader, true);
  const oppBoard = fieldPowerSum(state, them.field, them.leader, false);
  const boardAdv = (myBoard - oppBoard) * WEIGHTS.powerPerPoint;
  const handAdv = (me.hand.length - them.hand.length) * WEIGHTS.handPerCard;
  const myDon = me.donCostArea.length * WEIGHTS.donActive + me.donRested.length * WEIGHTS.donRested;
  const oppDon = them.donCostArea.length * WEIGHTS.donActive + them.donRested.length * WEIGHTS.donRested;
  const donAdv = myDon - oppDon;
  const biggestOppThreat = biggestThreatPower(state, them.field);
  const threatPenalty = (biggestOppThreat / 1000) * WEIGHTS.threatPerKilo;

  const swing = fieldPowerSum(state, me.field, me.leader, true);
  const oppDefence = effectivePower(state, them.leader) + them.life.length * WEIGHTS.lethalLifeDiscount;
  const lethalBonus = swing >= oppDefence ? WEIGHTS.lethalBonus : 0;

  const finisherP = drawProbability(state, viewer, isFinisher);
  const drawTerm = finisherP * WEIGHTS.drawFinisher;

  return lifeAdv + boardAdv + handAdv + donAdv - threatPenalty + lethalBonus + drawTerm;
}

function fieldPowerSum(state: GameState, field: CardInstance[], leader: CardInstance, tempo: boolean): number {
  let sum = 0;
  const leaderUsable = tempo ? !leader.rested && leader.perTurn.hasAttacked === false : true;
  if (leaderUsable) sum += effectivePower(state, leader);
  for (const inst of field) {
    const usable = tempo
      ? !inst.summoningSick && !inst.rested && inst.perTurn.hasAttacked === false
      : true;
    if (usable) sum += effectivePower(state, inst);
  }
  return sum;
}

function biggestThreatPower(state: GameState, field: CardInstance[]): number {
  let max = 0;
  for (const inst of field) {
    const p = effectivePower(state, inst);
    if (p > max) max = p;
  }
  return max;
}

function isFinisher(card: Card): boolean {
  if (card.kind !== 'character') return false;
  return card.cost >= 7 || card.power >= 8000;
}

function categoryBonus(action: Action, state: GameState, me: PlayerId): number {
  if (action.type === 'END_TURN') return -500;
  if (action.type === 'SKIP_BLOCKER' || action.type === 'SKIP_COUNTER') return -100;
  if (action.type === 'DECLARE_ATTACK') {
    const opp: PlayerId = me === 'A' ? 'B' : 'A';
    if (action.targetInstanceId === state.players[opp].leader.instanceId) {
      return state.players[opp].life.length <= 1 ? 5000 : 100;
    }
    return 50;
  }
  if (action.type === 'ATTACH_DON') {
    const target = state.instances[action.targetInstanceId];
    if (target !== undefined && (target.rested || target.perTurn.hasAttacked)) return -2000;
    return 100;
  }
  if (action.type === 'PLAY_CARD') return 200;
  return 0;
}
