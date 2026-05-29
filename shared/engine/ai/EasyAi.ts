// Easy AI — random legal action + suicide-attack filter.
// Per docs/optcg-sim/ai-architecture.md §1 Easy tier:
// "Random + legality filter (no suicide attacks, no obvious self-KO)".

import type { Action } from '../../protocol/actions';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import type { CardInstance, GameState, PlayerId } from '../GameState';
import { getLegalActions } from '../rules/legality';
import { Random } from '../Random';
import type { AiDriver, AiTier } from './AiDriver';

export class EasyAi implements AiDriver {
  readonly tier: AiTier = 'easy';
  private rng: Random;

  constructor(seed: number) {
    this.rng = new Random(seed);
  }

  async chooseAction(state: GameState, player: PlayerId, _deadlineMs: number): Promise<Action> {
    const legal = getLegalActions(state, player);
    if (legal.length === 0) return { type: 'END_TURN' };

    // Filter out RESIGN — Easy AI never resigns.
    const candidates = legal.filter((a) => a.type !== 'RESIGN');
    if (candidates.length === 0) return { type: 'END_TURN' };

    // Filter out clearly bad attacks: attacker power < target power → no life damage,
    // no KO, just rests the attacker. Net loss.
    const filtered = candidates.filter((action) => {
      if (action.type !== 'DECLARE_ATTACK') return true;
      return !isSuicideAttack(state, player, action.attackerInstanceId, action.targetInstanceId);
    });

    const pool = filtered.length > 0 ? filtered : candidates;
    return pool[this.rng.nextInt(pool.length)];
  }
}

function isSuicideAttack(
  state: GameState,
  player: PlayerId,
  attackerId: string,
  targetId: string,
): boolean {
  const attacker = state.instances[attackerId];
  const target = state.instances[targetId];
  if (!attacker || !target) return false;
  const attackerCard = state.cardLibrary[attacker.cardId];
  const targetCard = state.cardLibrary[target.cardId];

  const attackerPower = basePower(attackerCard) + attacker.attachedDon * 1000;
  const targetPower = basePower(targetCard) + target.attachedDon * 1000;

  // For leader attacks: a fizzle (attacker < target) just wastes the attack action
  // and rests the attacker — count as suicide.
  if (targetCard.kind === 'leader') return attackerPower < targetPower;

  // Character attack: clear no-win if attacker < target. (Equal power = both KO'd
  // for non-leader, but in our v0 attacker doesn't KO so we'd lose tempo with no upside.)
  if (targetCard.kind === 'character') return attackerPower < targetPower;
  // Marks counter-side player not us; void check.
  void player;

  return false;
}

function basePower(card: Card): number {
  if (card.kind === 'leader') return (card as LeaderCard).power;
  if (card.kind === 'character') return (card as CharacterCard).power;
  return 0;
}
// Re-export for tests that need to compose with instances.
export type { CardInstance };
