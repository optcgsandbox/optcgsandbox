/**
 * Engine V2 — canonical power helpers.
 *
 * SINGLE SOURCE OF TRUTH for effective power. No other helper, no inline
 * computation, no AI duplicate may compute "what does this card hit for."
 * Enforced by ESLint `no-redefine-canonical-helper` + `no-inlined-power-math`.
 *
 * Reads all 3 lifecycle layers (Permanent / Continuous / OneShot) plus
 * attached DON. PURE — no state mutation.
 *
 * Cross-references:
 * - Implementation spec §5.1 + §5.2
 * - Plan v1 §4.4 (canonical helpers) + Bug class C4 / C40 / C41
 */

import type { CardInstance, GameState } from '../types.js';
import { isCharacter, isLeader, type Card } from '../../cards/Card.js';

/**
 * Effective power for combat math, attack-target legality, filter matching.
 * Unclamped — callers that need a non-negative display value use
 * `effectivePowerForDisplay()` instead.
 *
 * Formula:
 *   base = (oneShot ?? continuous ?? card.power) for chars/leaders, else 0
 *   + attached DON (active + rested) × 1000   [CR §6-5-5-2: only while the
 *     instance's controller is the active player — "+1000 power during YOUR
 *     turn per attached DON" (docs/optcg-sim/rules-reference.md:223).
 *     F8A-F2: was unconditional, letting defenders keep the bonus on the
 *     opponent's turn.]
 *   + powerModifierOneShot                    [one-shot writes from power_buff actions]
 *   + powerModifierContinuous                 [continuous re-application]
 *   + powerModifierThisBattle                 [B2: battle-scoped, cleared at pendingAttack=null]
 */
export function effectivePower(state: GameState, inst: CardInstance): number {
  const card = state.cardLibrary[inst.cardId] as Card | undefined;
  if (!card) return 0;

  const printed: number = isCharacter(card) || isLeader(card) ? card.power : 0;
  const base: number =
    inst.basePowerOverrideOneShot ?? inst.basePowerOverrideContinuous ?? printed;

  const donCount: number =
    state.activePlayer === inst.controller
      ? inst.attachedDon.length + inst.attachedDonRested.length
      : 0;

  return (
    base +
    donCount * 1000 +
    (inst.powerModifierOneShot ?? 0) +
    (inst.powerModifierContinuous ?? 0) +
    (inst.powerModifierThisBattle ?? 0)
  );
}

/** Display-only power: clamped to ≥0 for UI rendering. */
export function effectivePowerForDisplay(state: GameState, inst: CardInstance): number {
  return Math.max(0, effectivePower(state, inst));
}
