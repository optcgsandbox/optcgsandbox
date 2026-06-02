/**
 * Engine V2 — CardInstance reset helper.
 *
 * Called when an instance leaves the field (bounce / KO / exile / etc.).
 * Resets every transient field so the instance re-entering play is fresh.
 *
 * Cross-references:
 * - Implementation spec §5.8
 * - Plan v1 §4.9 + Bug class C25 (bounce leaves stale state)
 */

import type { CardInstance } from '../types.js';

/**
 * Reset all transient (non-permanent) fields on `inst`.
 * Mutates in place. The instance's identity (instanceId, cardId, controller)
 * is preserved.
 *
 * Reset list (every field that's NOT Permanent on CardInstance):
 *  - Zone state: rested, summoningSick
 *  - Continuous fields (all)
 *  - OneShot fields (all)
 *  - Per-turn: effectsUsed, hasAttacked
 *  - Mid-game flags: restLockedUntilTurn, endOfTurnTrash
 *  - Look-behind stamps: lastBouncedColors, lastDiscardedName
 *  - effectsNegated
 *
 * NOT reset (caller responsibility):
 *  - attachedDon / attachedDonRested — drained separately via detachAllAttachedDon
 */
export function resetInstanceTransientState(inst: CardInstance): void {
  // Zone state
  inst.rested = false;
  inst.summoningSick = false;

  // Per-turn
  inst.perTurn = { hasAttacked: false, effectsUsed: [] };

  // Continuous — let ContinuousManager rebuild; setting to undefined here
  // ensures stale continuous data doesn't survive the move.
  inst.powerModifierContinuous = undefined;
  inst.costModifierContinuous = undefined;
  inst.basePowerOverrideContinuous = undefined;
  inst.grantedKeywordsContinuous = undefined;
  inst.counterBonus = undefined;
  inst.immunityContinuous = undefined;
  inst.attackLockedContinuous = undefined;
  inst.damageImmunityAttribute = undefined;
  inst.restrictEffectType = undefined;

  // OneShot
  inst.powerModifierOneShot = undefined;
  inst.powerModifierExpiresInTurns = undefined;
  inst.costModifierOneShot = undefined;
  inst.costModifierExpiresInTurns = undefined;
  inst.basePowerOverrideOneShot = undefined;
  inst.basePowerOverrideExpiresInTurns = undefined;
  inst.grantedKeywordsOneShot = undefined;
  inst.immunityOneShot = undefined;
  inst.attackLockedOneShot = undefined;
  inst.powerModifierThisBattle = undefined;

  // Mid-game flags
  inst.restLockedUntilTurn = undefined;
  inst.endOfTurnTrash = undefined;
  inst.lastBouncedColors = undefined;
  inst.lastDiscardedName = undefined;
  inst.effectsNegated = undefined;
}
