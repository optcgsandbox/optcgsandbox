/**
 * Engine V2 — Medium tier AI: heuristic priority queue.
 *
 * Port of V1 shared/engine/ai/MediumAi.ts. No forward search.
 * Categorize every legal action, score within category, take the
 * highest-scoring action in the highest-priority non-empty bucket.
 *
 * V1 reference: shared/engine/ai/MediumAi.ts (143 lines).
 */

import type { Card } from '../cards/Card.js';
import { effectivePower } from '../state/derived/power.js';
import type { Action } from '../protocol/actions.js';
import { getLegalActions } from '../rules/legality.js';
import type { GameState, PlayerId } from '../state/types.js';
import { viewForPlayer } from '../view/ViewModule.js';
import type { AiDriver, AiTier } from './AiDriver.js';

type ActionCategory =
  | 'LETHAL'
  | 'REMOVE_THREAT'
  | 'TRADE_UP'
  | 'CURVE_PLAY'
  | 'GIVE_DON'
  | 'ATTACK_LEADER'
  | 'END_TURN'
  | 'SKIP_REACTIVE'
  | 'OTHER';

const ORDER: ActionCategory[] = [
  'LETHAL',
  'REMOVE_THREAT',
  'TRADE_UP',
  'CURVE_PLAY',
  'GIVE_DON',
  'ATTACK_LEADER',
  'OTHER',
  'SKIP_REACTIVE',
  'END_TURN',
];

interface Scored {
  readonly action: Action;
  readonly category: ActionCategory;
  readonly score: number;
}

export class MediumAi implements AiDriver {
  readonly tier: AiTier = 'medium';

  async chooseAction(state: GameState, player: PlayerId, _deadlineMs: number): Promise<Action> {
    const view = viewForPlayer(state, player);
    const legal = getLegalActions(view, player).filter((a) => a.type !== 'CONCEDE');
    if (legal.length === 0) return { type: 'END_TURN' };

    const scored: Scored[] = legal.map((action) => {
      const { category, score } = classify(action, view, player);
      return { action, category, score };
    });

    for (const cat of ORDER) {
      const bucket = scored.filter((s) => s.category === cat);
      if (bucket.length === 0) continue;
      bucket.sort((a, b) => b.score - a.score);
      return bucket[0]!.action;
    }
    return { type: 'END_TURN' };
  }
}

function classify(
  action: Action,
  state: GameState,
  me: PlayerId,
): { category: ActionCategory; score: number } {
  const opp: PlayerId = me === 'A' ? 'B' : 'A';
  const myZones = state.players[me];
  const oppZones = state.players[opp];

  if (action.type === 'END_TURN') return { category: 'END_TURN', score: 0 };
  if (action.type === 'SKIP_BLOCKER' || action.type === 'SKIP_COUNTER') {
    return { category: 'SKIP_REACTIVE', score: 0 };
  }

  if (action.type === 'DECLARE_ATTACK') {
    const attacker = state.instances[action.attackerInstanceId];
    const target = state.instances[action.targetInstanceId];
    if (attacker === undefined || target === undefined) return { category: 'OTHER', score: 0 };
    const tCard = state.cardLibrary[target.cardId] as Card | undefined;
    const aPow = effectivePower(state, attacker);
    const tPow = effectivePower(state, target);

    if (tCard?.kind === 'leader') {
      if (oppZones.life.length === 0 && aPow >= tPow) {
        return { category: 'LETHAL', score: 99999 };
      }
      return {
        category: 'ATTACK_LEADER',
        score: aPow - tPow + 1000 - oppZones.life.length * 200,
      };
    }
    if (tCard?.kind === 'character') {
      const printedTargetPower = tCard.power;
      if (aPow >= tPow) {
        if (printedTargetPower >= 5000) return { category: 'REMOVE_THREAT', score: printedTargetPower };
        return { category: 'TRADE_UP', score: printedTargetPower };
      }
      return { category: 'OTHER', score: -1000 };
    }
  }

  if (action.type === 'PLAY_CARD') {
    const inst = state.instances[action.instanceId];
    if (inst === undefined) return { category: 'OTHER', score: 0 };
    const card = state.cardLibrary[inst.cardId] as Card | undefined;
    if (card?.kind === 'character') {
      return { category: 'CURVE_PLAY', score: card.power + card.cost * 100 };
    }
    return { category: 'OTHER', score: 0 };
  }

  if (action.type === 'ATTACH_DON') {
    const inst = state.instances[action.targetInstanceId];
    if (inst === undefined) return { category: 'OTHER', score: 0 };
    const card = state.cardLibrary[inst.cardId] as Card | undefined;
    const isOurThreat = card?.kind === 'character' && !inst.summoningSick && !inst.rested && !inst.perTurn.hasAttacked;
    const isOurLeader = card?.kind === 'leader' && !myZones.leader.rested && !myZones.leader.perTurn.hasAttacked;
    if (isOurThreat === true || isOurLeader === true) {
      return { category: 'GIVE_DON', score: 100 };
    }
    return { category: 'OTHER', score: -50 };
  }

  return { category: 'OTHER', score: 0 };
}
