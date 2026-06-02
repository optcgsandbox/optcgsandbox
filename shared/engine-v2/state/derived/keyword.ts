/**
 * Engine V2 — canonical keyword + immunity + attack-lock helpers.
 *
 * SINGLE SOURCE OF TRUTH. No call site may read `card.keywords.includes(...)`
 * directly — must use `instHasKeyword()`. Enforced by ESLint
 * `no-direct-keywords-read`.
 *
 * Cross-references:
 * - Implementation spec §5.4 + §5.5 + §5.6
 * - Plan v1 §4.4 + Bug class C6 / C9 / C12 / C18 (granted-keyword consumption)
 */

import type { CardInstance, GameState } from '../types.js';
import type { Card, Keyword } from '../../cards/Card.js';

/**
 * True if `inst` has `kw` from ANY of three sources:
 *   1. Printed keyword on `card.keywords`        (permanent)
 *   2. Continuous-granted `grantedKeywordsContinuous` (rebuilt each refold)
 *   3. One-shot granted `grantedKeywordsOneShot.{keyword}` (expires by `until`)
 */
export function instHasKeyword(state: GameState, inst: CardInstance, kw: Keyword | string): boolean {
  const card = state.cardLibrary[inst.cardId] as Card | undefined;
  if (card?.keywords.includes(kw as Keyword)) return true;
  if (inst.grantedKeywordsContinuous?.includes(kw)) return true;
  if (inst.grantedKeywordsOneShot?.some((g) => g.keyword === kw)) return true;
  return false;
}

/**
 * Returns true if `inst` is immune to `againstTag` via continuous OR one-shot.
 * If `againstTag` is undefined, returns true if any immunity is set.
 */
export function instHasImmunity(inst: CardInstance, againstTag?: string): boolean {
  const oneShot = inst.immunityOneShot;
  const cont = inst.immunityContinuous;
  if (!oneShot && !cont) return false;
  if (!againstTag) return true; // any immunity present
  if (oneShot?.against === againstTag) return true;
  if (cont?.against === againstTag) return true;
  return false;
}

/** True if inst.attackLockedOneShot is set OR inst.attackLockedContinuous is true. */
export function instAttackLocked(inst: CardInstance): boolean {
  return inst.attackLockedOneShot !== undefined || inst.attackLockedContinuous === true;
}

/**
 * Sum of DON in cost area + rested + all attached (across leader/field/stage).
 * Used by `if_own_don_le_opp` condition + similar reads.
 */
export function totalDon(state: GameState, side: CardInstance['controller']): number {
  const pl = state.players[side];
  let attached = 0;
  attached += pl.leader.attachedDon.length + pl.leader.attachedDonRested.length;
  for (const f of pl.field) attached += f.attachedDon.length + f.attachedDonRested.length;
  if (pl.stage !== null) attached += pl.stage.attachedDon.length + pl.stage.attachedDonRested.length;
  return pl.donCostArea.length + pl.donRested.length + attached;
}
