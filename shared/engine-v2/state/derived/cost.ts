/**
 * Engine V2 — canonical cost helpers.
 *
 * SINGLE SOURCE OF TRUTH for effective cost. Enforced by ESLint
 * `no-redefine-canonical-helper`.
 *
 * Cross-references:
 * - Implementation spec §5.3
 * - Plan v1 §4.4 + Bug class C4 / C8
 */

import type { CardInstance, GameState } from '../types.js';
import { isCharacter, isEvent, isStage, type Card } from '../../cards/Card.js';

/**
 * Effective cost = printed cost + costModifierOneShot + costModifierContinuous.
 * Returns null if the card has no printed cost (leaders, DON).
 * Clamped to ≥0 (negative effective cost = 0; play is free).
 */
export function effectiveCost(state: GameState, inst: CardInstance): number | null {
  const card = state.cardLibrary[inst.cardId] as Card | undefined;
  if (!card) return null;
  if (!isCharacter(card) && !isEvent(card) && !isStage(card)) return null;

  const sum: number =
    card.cost +
    (inst.costModifierOneShot ?? 0) +
    (inst.costModifierContinuous ?? 0);

  return Math.max(0, sum);
}
