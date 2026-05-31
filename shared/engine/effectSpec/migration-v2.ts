// Migration cut-over — Phase A.3.10.
//
// The v2 runner becomes the active dispatch path when:
//   1. `EFFECT_SPEC_V2_ENABLED` flag is true (default), AND
//   2. The card has a non-empty `effectSpecV2` field.
//
// Otherwise the engine falls through to v1 `effectSpec` (Stage 0 runner)
// or, failing that, legacy `effectTags` tag dispatch (the V3 path).
//
// Rollback: set `EFFECT_SPEC_V2_ENABLED=false` (env var) — the runner
// short-circuits and the engine behaves exactly as it did pre-A.3.10.

import type { GameState, PlayerId } from '../GameState';
import type { Card } from '../cards/Card';
import { applyActionV2, evaluateConditionV2, resolveTargetV2 } from './runner-v2';
import { applyContinuousEffectsV2ToInstance } from './continuous-v2';
import { tryApplyReplacement } from './replacements-v2';
import type { EffectClauseV2, EffectTriggerV2 } from './types-v2';

/** Feature flag — `false` rolls back to v1 dispatch. Default true. */
export const EFFECT_SPEC_V2_ENABLED: boolean = (() => {
  try {
    // Vite-style env var when running in browser/build context.
    const meta = (globalThis as { import?: { meta?: { env?: Record<string, string> } } }).import;
    const flag = meta?.meta?.env?.VITE_EFFECT_SPEC_V2;
    if (flag === 'false' || flag === '0') return false;
  } catch {
    // Node env (tests) — ignore, default true.
  }
  try {
    // Node env (tests). Cast through `any` since the Vite tsconfig doesn't
    // include node types and we want this to compile in both targets.
    const proc = (globalThis as { process?: { env?: Record<string, string> } }).process;
    if (proc?.env?.VITE_EFFECT_SPEC_V2 === 'false') return false;
  } catch {
    // Browser without process — ignore.
  }
  return true;
})();

/** Should fireEffects route through the v2 runner for this card? */
export function shouldUseV2(card: Card | undefined): boolean {
  if (!EFFECT_SPEC_V2_ENABLED) return false;
  if (!card) return false;
  return Array.isArray(card.effectSpecV2?.clauses) && card.effectSpecV2!.clauses.length > 0;
}

/** Fire all v2 clauses on a card for a given trigger. Returns the
 *  post-fire state. Used by dispatch.ts as the primary route when
 *  `shouldUseV2(card)` is true. */
export function fireV2Effects(
  state: GameState,
  sourceInstanceId: string,
  trigger: EffectTriggerV2,
  controller: PlayerId,
): GameState {
  const inst = state.instances[sourceInstanceId];
  if (!inst) return state;
  const card = state.cardLibrary[inst.cardId];
  if (!shouldUseV2(card)) return state;
  const clauses = card.effectSpecV2!.clauses.filter((c) => c.trigger === trigger);
  if (clauses.length === 0) return state;

  let cur = structuredClone(state);
  for (const clause of clauses) {
    if (!evaluateConditionV2(cur, controller, clause.condition)) continue;
    const targets = resolveTargetV2(cur, controller, sourceInstanceId, clause.target);
    cur = applyActionV2(cur, { sourceInstanceId, controller }, clause.action, targets);
  }
  return cur;
}

/** Re-export helpers so callers don't dig into the underlying modules. */
export { applyActionV2, applyContinuousEffectsV2ToInstance, tryApplyReplacement };
export type { EffectClauseV2 };
