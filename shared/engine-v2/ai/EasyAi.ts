/**
 * Engine V2 — Easy tier AI: random legal action + suicide-attack filter.
 *
 * Port of V1 shared/engine/ai/EasyAi.ts. Adapted for engine-v2 Action type
 * (CONCEDE instead of RESIGN) + getLegalActions + viewForPlayer.
 *
 * Decision model:
 *   1. Get legal actions from engine-v2's rules/legality.
 *   2. Strip CONCEDE (Easy never resigns).
 *   3. Drop DECLARE_ATTACK options where attacker power < target power
 *      (suicide / fizzle).
 *   4. Pick uniform-random from remaining; fall back to END_TURN if empty.
 *
 * AI uses redacted viewForPlayer state so it can't cheat by reading opp hand.
 *
 * Cross-references:
 * - V1: shared/engine/ai/EasyAi.ts
 * - Spec: docs/optcg-sim/ai-architecture.md §1
 */

import type { Card } from '../cards/Card.js';
import { Random } from '../state/RngService.js';
import type { Action } from '../protocol/actions.js';
import type { GameState, PlayerId } from '../state/types.js';
import { getLegalActions } from '../rules/legality.js';
import { viewForPlayer } from '../view/ViewModule.js';
import type { AiDriver, AiTier } from './AiDriver.js';

export class EasyAi implements AiDriver {
  readonly tier: AiTier = 'easy';
  private rng: Random;

  constructor(seed: number) {
    this.rng = new Random(seed);
  }

  async chooseAction(state: GameState, player: PlayerId, _deadlineMs: number): Promise<Action> {
    // AI sees redacted state — info hiding enforced.
    const view = viewForPlayer(state, player);
    const legal = getLegalActions(view, player);
    if (legal.length === 0) return { type: 'END_TURN' };

    // Easy never concedes.
    const candidates = legal.filter((a) => a.type !== 'CONCEDE');
    if (candidates.length === 0) return { type: 'END_TURN' };

    // Drop suicide attacks.
    const filtered = candidates.filter((a) => {
      if (a.type !== 'DECLARE_ATTACK') return true;
      return !isSuicideAttack(view, player, a.attackerInstanceId, a.targetInstanceId);
    });
    const pool = filtered.length > 0 ? filtered : candidates;
    const idx = this.rng.nextInt(pool.length);
    return pool[idx]!;
  }
}

function basePower(card: Card | undefined): number {
  if (card === undefined) return 0;
  if (card.kind === 'leader' || card.kind === 'character') return card.power;
  return 0;
}

function isSuicideAttack(
  state: GameState,
  _player: PlayerId,
  attackerId: string,
  targetId: string,
): boolean {
  const attacker = state.instances[attackerId];
  const target = state.instances[targetId];
  if (attacker === undefined || target === undefined) return false;
  const attackerCard = state.cardLibrary[attacker.cardId] as Card | undefined;
  const targetCard = state.cardLibrary[target.cardId] as Card | undefined;

  const aPow = basePower(attackerCard)
    + attacker.attachedDon.length * 1000
    + attacker.attachedDonRested.length * 1000
    + (attacker.powerModifierContinuous ?? 0)
    + (attacker.powerModifierOneShot ?? 0);
  const tPow = basePower(targetCard)
    + target.attachedDon.length * 1000
    + target.attachedDonRested.length * 1000
    + (target.powerModifierContinuous ?? 0)
    + (target.powerModifierOneShot ?? 0);

  return aPow < tPow;
}
