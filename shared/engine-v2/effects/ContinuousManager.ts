/**
 * Engine V2 — Continuous manager.
 *
 * Idempotent re-fold: reset every "Continuous"-half field on every instance,
 * then iterate every live continuous-bearing source (leader + field + stage
 * for both sides), evaluate each continuous's condition, and apply the
 * registered ContinuousHandler.
 *
 * Property: refold(refold(s)) === refold(s). Enforced by the per-instance
 * reset before any application.
 *
 * Re-entrancy: refold is a no-op if state.continuousApplyDepth > 0. Lets
 * action handlers safely refold without nested loops.
 *
 * Cross-references:
 * - Implementation spec §8
 * - Plan v1 §4.1 / C29
 */

import type { Card } from '../cards/Card.js';
import { continuousHandlers } from '../registry/types.js';
import { type CardInstance, type GameState, type PlayerId } from '../state/types.js';
import { evaluateCondition } from './EffectDispatcher.js';

/**
 * Field names this manager resets BEFORE every refold tick. Single source of
 * truth — any new continuous half-field must be added here AND to the
 * `resets` declaration on the corresponding ContinuousHandler in the
 * registry.
 */
export const CONTINUOUS_RESET_FIELDS: ReadonlyArray<keyof CardInstance> = [
  'powerModifierContinuous',
  'basePowerOverrideContinuous',
  'costModifierContinuous',
  'grantedKeywordsContinuous',
  'immunityContinuous',
  'attackLockedContinuous',
  'counterBonus',
  'damageImmunityAttribute',
  'restrictEffectType',
];

function liveSources(state: GameState, side: PlayerId): CardInstance[] {
  const pl = state.players[side];
  const out: CardInstance[] = [pl.leader, ...pl.field];
  if (pl.stage !== null) out.push(pl.stage);
  return out;
}

export const ContinuousManager = {
  refold(state: GameState): GameState {
    // Re-entrancy guard
    if (state.continuousApplyDepth > 0) return state;
    state.continuousApplyDepth += 1;

    try {
      // (1) Reset Continuous-half on every instance
      for (const inst of Object.values(state.instances)) {
        inst.powerModifierContinuous = undefined;
        inst.basePowerOverrideContinuous = undefined;
        inst.costModifierContinuous = undefined;
        inst.grantedKeywordsContinuous = undefined;
        inst.immunityContinuous = undefined;
        inst.attackLockedContinuous = undefined;
        inst.counterBonus = undefined;
        inst.damageImmunityAttribute = undefined;
        inst.restrictEffectType = undefined;
      }

      // (2) Apply each live source's continuous effects
      for (const side of ['A', 'B'] as PlayerId[]) {
        for (const source of liveSources(state, side)) {
          const card = state.cardLibrary[source.cardId] as Card | undefined;
          const list = card?.effectSpecV2?.continuous ?? [];
          for (const eff of list) {
            const ctx = {
              sourceInstanceId: source.instanceId,
              controller: source.controller,
            };
            if (!evaluateCondition(state, ctx, eff.condition)) continue;
            const handler = continuousHandlers.get(eff.action.kind);
            state = handler.fold(state, source, eff.action);
          }
        }
      }
    } finally {
      state.continuousApplyDepth -= 1;
    }

    return state;
  },
} as const;
