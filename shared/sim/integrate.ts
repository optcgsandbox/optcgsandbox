/**
 * Engine ↔ Sim integration layer.
 *
 * Provides the single function the host engine calls when it fires an
 * event:
 *
 *   processSimEvent(state, ctx, trigger, library) → GameState
 *
 * The host engine continues to control turn flow, phases, combat, DON,
 * dice, mulligan, and animation. The sim layer only consumes events
 * and returns mutations. This module:
 *
 *   1. Translates the engine's lowercase trigger name + HandlerCtx into
 *      the sim's SimEvent shape.
 *   2. Invokes simHandleEvent.
 *   3. Applies the returned mutations to the state.
 *   4. Returns the resulting state.
 *
 * The contract guarantees:
 *
 *   - The sim layer is PURE (no side effects beyond the returned
 *     mutation list).
 *   - The host engine remains source of truth for ALL rules.
 *   - UNSUPPORTED mutations are SKIPPED (no crash, no state change).
 *   - No duplication of rule logic — the sim only encodes per-card
 *     effects, never phase / combat / DON mechanics.
 */

import type { GameState, InstanceId, PlayerId } from '../engine-v2/state/types.js';
import { applyMutations } from './apply.js';
import { simHandleEvent } from './index.js';
import { getCardEffectsLibrary } from './library-registry.js';
import type { CardEffectsLibrary, SimEvent, SimMutation, Trigger } from './types.js';

// ────────────────────────────────────────────────────────────────────
// Trigger-name translation: engine (lowercase) ↔ sim (UPPERCASE)
//
// The engine emits triggers as lowercase strings (e.g. 'on_play',
// 'when_attacking', 'on_ko'). The sim spec uses UPPERCASE
// (e.g. 'ON_PLAY', 'ON_ATTACK', 'ON_KO'). This map is the ONE place the
// translation lives — neither side leaks its naming convention.
// ────────────────────────────────────────────────────────────────────

export const ENGINE_TO_SIM_TRIGGER: Readonly<Record<string, Trigger>> = {
  on_play: 'ON_PLAY',
  when_attacking: 'ON_ATTACK',
  on_block: 'ON_BLOCK',
  on_ko: 'ON_KO',
  on_become_rested: 'ON_REST',
  activate_main: 'ON_ACTIVATE_MAIN',
  on_opp_attack: 'ON_OPPONENT_ATTACK',
  at_start_of_game: 'ON_TURN_START',
  at_end_of_turn: 'ON_TURN_END',
  at_end_of_turn_self: 'ON_TURN_END',
  on_own_don_returned: 'ON_DON_ATTACH',
  on_opp_play_character: 'ON_CHARACTER_PLAYED',
  on_own_char_removed_by_opp_effect: 'ON_CHARACTER_KO',
  trigger: 'ON_TRIGGER',
  on_self_activate_event: 'ON_COUNTER',
  on_attack_deal_damage: 'ON_BATTLE_START',
  on_battle_ko: 'ON_BATTLE_END',
  on_life_changed: 'ON_LIFE_LOST',
  on_hand_trashed_by_effect: 'ON_CARD_TRASHED',
  on_damage_taken: 'ON_LIFE_LOST',
  on_opp_char_bounce_by_me: 'ON_CARD_ADDED_TO_HAND',
};

/** Reverse map for tests / debug. */
export const SIM_TO_ENGINE_TRIGGER: Readonly<Record<Trigger, string>> = Object.fromEntries(
  Object.entries(ENGINE_TO_SIM_TRIGGER).map(([engine, sim]) => [sim, engine]),
) as Record<Trigger, string>;

// ────────────────────────────────────────────────────────────────────
// Engine HandlerCtx shape (mirrors registry/types.ts HandlerCtx)
// ────────────────────────────────────────────────────────────────────

/**
 * Minimum context the engine passes when an event fires. Mirrors
 * registry/types.ts HandlerCtx without forcing a dependency on it.
 */
export interface EngineEventCtx {
  readonly sourceInstanceId?: InstanceId | undefined;
  readonly controller: PlayerId;
  readonly attackingInstanceId?: InstanceId | undefined;
  readonly defendingInstanceId?: InstanceId | undefined;
  readonly targetInstanceId?: InstanceId | undefined;
}

// ────────────────────────────────────────────────────────────────────
// Public entry point
// ────────────────────────────────────────────────────────────────────

/**
 * Build a SimEvent from the engine's trigger + ctx. Returns null if
 * the engine trigger has no sim mapping (e.g., engine-internal
 * triggers that no card spec ever uses — `at_opp_refresh`,
 * `on_self_kod_by_opp_effect`).
 */
export function buildSimEvent(
  engineTrigger: string,
  ctx: EngineEventCtx,
): SimEvent | null {
  const trigger = ENGINE_TO_SIM_TRIGGER[engineTrigger];
  if (trigger === undefined) return null;
  return {
    trigger,
    controller: ctx.controller,
    ...(ctx.sourceInstanceId !== undefined ? { sourceInstanceId: ctx.sourceInstanceId } : {}),
    ...(ctx.targetInstanceId !== undefined ? { targetInstanceId: ctx.targetInstanceId } : {}),
    ...(ctx.attackingInstanceId !== undefined ? { attackingInstanceId: ctx.attackingInstanceId } : {}),
    ...(ctx.defendingInstanceId !== undefined ? { defendingInstanceId: ctx.defendingInstanceId } : {}),
  };
}

/**
 * The single integration entry point the host engine calls.
 *
 * Translates the engine event into a SimEvent, runs the sim layer to
 * compute mutations, applies them in place, and returns the state.
 *
 * If the engine trigger has no sim mapping, no work is done and the
 * state is returned unchanged.
 *
 * If the sim returns an `UNSUPPORTED` mutation among its list, that
 * single mutation is skipped (the applier short-circuits on
 * `kind: 'UNSUPPORTED'`); other mutations in the same list still
 * apply. The engine never crashes on UNSUPPORTED.
 */
export function processSimEvent(
  state: GameState,
  ctx: EngineEventCtx,
  engineTrigger: string,
  library: CardEffectsLibrary,
): GameState {
  const event = buildSimEvent(engineTrigger, ctx);
  if (event === null) return state;
  const mutations: SimMutation[] = simHandleEvent(state, event, library);
  if (mutations.length === 0) return state;
  return applyMutations(state, mutations);
}

/**
 * Convenience: get the mutations the sim WOULD produce without
 * applying them. Useful for logging, replay, or pre-flight checks.
 */
export function previewSimEvent(
  state: GameState,
  ctx: EngineEventCtx,
  engineTrigger: string,
  library: CardEffectsLibrary,
): SimMutation[] {
  const event = buildSimEvent(engineTrigger, ctx);
  if (event === null) return [];
  return simHandleEvent(state, event, library);
}

/**
 * Safe wrapper for the host engine. Reads the active library from the
 * registry, calls processSimEvent inside a try/catch, and logs any
 * failure without propagating. Game flow CONTINUES on sim failure.
 *
 * This is the function the engine reducers call after their existing
 * EffectDispatcher.dispatch invocation.
 */
export function safeProcessSimEvent(
  state: GameState,
  ctx: EngineEventCtx,
  engineTrigger: string,
): GameState {
  try {
    const library = getCardEffectsLibrary();
    return processSimEvent(state, ctx, engineTrigger, library);
  } catch (err) {
    // Sim must NEVER break game flow per the integration contract.
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.error(`[sim] processSimEvent failed for trigger "${engineTrigger}":`, err);
    }
    return state;
  }
}
