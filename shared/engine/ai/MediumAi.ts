// Medium AI — heuristic priority queue. Per docs/optcg-sim/ai-architecture.md §3 + §4.
//
// No forward search. Categorize every legal action, score within category, take
// the highest-scoring action in the highest-priority non-empty bucket.

import type { Action } from '../../protocol/actions';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import type { CardInstance, GameState, PlayerId } from '../GameState';
import { getLegalActions } from '../rules/legality';
import type { AiDriver, AiTier } from './AiDriver';

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
  action: Action;
  category: ActionCategory;
  score: number;
}

export class MediumAi implements AiDriver {
  readonly tier: AiTier = 'medium';

  async chooseAction(state: GameState, player: PlayerId, _deadlineMs: number): Promise<Action> {
    const legal = getLegalActions(state, player).filter((a) => a.type !== 'RESIGN');
    if (legal.length === 0) return { type: 'END_TURN' };

    const scored: Scored[] = legal.map((action) => {
      const { category, score } = classify(action, state, player);
      return { action, category, score };
    });

    for (const cat of ORDER) {
      const bucket = scored.filter((s) => s.category === cat);
      if (bucket.length === 0) continue;
      bucket.sort((a, b) => b.score - a.score);
      return bucket[0].action;
    }
    return { type: 'END_TURN' };
  }
}

function classify(
  action: Action,
  state: GameState,
  me: PlayerId,
): { category: ActionCategory; score: number } {
  const opp = me === 'A' ? 'B' : 'A';
  const myZones = state.players[me];
  const oppZones = state.players[opp];

  if (action.type === 'END_TURN') return { category: 'END_TURN', score: 0 };
  if (action.type === 'SKIP_BLOCKER' || action.type === 'SKIP_COUNTER') {
    return { category: 'SKIP_REACTIVE', score: 0 };
  }

  if (action.type === 'DECLARE_ATTACK') {
    const attacker = state.instances[action.attackerInstanceId];
    const target = state.instances[action.targetInstanceId];
    if (!attacker || !target) return { category: 'OTHER', score: 0 };
    const aCard = state.cardLibrary[attacker.cardId];
    const tCard = state.cardLibrary[target.cardId];
    const aPow = effectivePower(aCard, attacker);
    const tPow = effectivePower(tCard, target);

    if (tCard.kind === 'leader') {
      // Lethal: opp at 0 life and a clean swing.
      if (oppZones.life.length === 0 && aPow >= tPow) {
        return { category: 'LETHAL', score: 99999 };
      }
      // Otherwise it's a life-pressure attack.
      return {
        category: 'ATTACK_LEADER',
        score: aPow - tPow + 1000 - oppZones.life.length * 200,
      };
    }
    if (tCard.kind === 'character') {
      // Trade up: opponent's character is worth more than we're risking (we don't risk much; attacker just rests).
      const targetPrintedPower = tPow;
      if (aPow >= targetPrintedPower) {
        // KO an opponent character.
        if (targetPrintedPower >= 5000) {
          return { category: 'REMOVE_THREAT', score: targetPrintedPower };
        }
        return { category: 'TRADE_UP', score: targetPrintedPower };
      }
      return { category: 'OTHER', score: -1000 };
    }
  }

  if (action.type === 'PLAY_CARD') {
    const inst = state.instances[action.instanceId];
    if (!inst) return { category: 'OTHER', score: 0 };
    const card = state.cardLibrary[inst.cardId];
    if (card.kind === 'character' && card.cost !== null && card.power !== null) {
      // Curve play: prefer to play the biggest body we can afford.
      return { category: 'CURVE_PLAY', score: card.power + card.cost * 100 };
    }
    return { category: 'OTHER', score: 0 };
  }

  if (action.type === 'ATTACH_DON') {
    // Give DON to a character / leader that will attack a leader.
    const inst = state.instances[action.targetInstanceId];
    if (!inst) return { category: 'OTHER', score: 0 };
    const card = state.cardLibrary[inst.cardId];
    const isOurThreat = card.kind === 'character' && !inst.summoningSick && !inst.rested && !inst.perTurn.hasAttacked;
    const isOurLeader = card.kind === 'leader' && !myZones.leader.rested && !myZones.leader.perTurn.hasAttacked;
    if (isOurThreat || isOurLeader) {
      return { category: 'GIVE_DON', score: 100 };
    }
    return { category: 'OTHER', score: -50 };
  }

  return { category: 'OTHER', score: 0 };
}

function effectivePower(card: Card, inst: CardInstance): number {
  let base = 0;
  if (card.kind === 'leader') base = (card as LeaderCard).power;
  if (card.kind === 'character') base = (card as CharacterCard).power;
  return base + inst.attachedDon.length * 1000;
}
