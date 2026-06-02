/**
 * Engine V2 — DON detach helper.
 *
 * SINGLE SOURCE OF TRUTH for "when a CardInstance leaves a zone, where do its
 * attached DON go." Per CR §6-5-5-4: ALL detached DON returns to `donRested`
 * regardless of prior active/rested state.
 *
 * Enforced by ESLint `no-direct-attached-don-write` — call sites cannot
 * splice attachedDon/attachedDonRested directly outside this helper.
 *
 * Cross-references:
 * - Implementation spec §5.7
 * - Plan v1 §4.8 + Bug class C5 / C14 / C16
 */

import type { CardInstance, GameState, PlayerId } from '../types.js';

/**
 * Detach ALL DON from `inst` (both active and rested), pushing each to
 * `destSide.donRested`. Mutates state in place.
 *
 * @param state - the GameState
 * @param inst - the CardInstance whose DON to drain
 * @param destSide - which player's donRested receives them
 *                   (usually the controller of `inst`, but exile may differ)
 */
export function detachAllAttachedDon(
  state: GameState,
  inst: CardInstance,
  destSide: PlayerId,
): GameState {
  const pl = state.players[destSide];
  while (inst.attachedDon.length > 0) {
    const donId = inst.attachedDon.shift();
    if (donId !== undefined) pl.donRested.push(donId);
  }
  while (inst.attachedDonRested.length > 0) {
    const donId = inst.attachedDonRested.shift();
    if (donId !== undefined) pl.donRested.push(donId);
  }
  return state;
}
