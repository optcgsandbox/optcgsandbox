/**
 * Card Effect Execution Layer — type definitions.
 *
 * Source of truth: docs/OP_SIM_ENGINE_SPEC_V1.md.
 * Every enum value, condition field, selector, filter, action, and duration
 * mirrors the spec verbatim. Do NOT add primitives here that the spec
 * doesn't list — if a card needs more, mark it UNSUPPORTED.
 */

import type { CardId, InstanceId, PlayerId } from '../engine-v2/state/types.js';

// ────────────────────────────────────────────────────────────────────
// TRIGGERS — 21 values, see docs/OP_SIM_ENGINE_SPEC_V1.md L25-47
// ────────────────────────────────────────────────────────────────────

export type Trigger =
  | 'ON_PLAY'
  | 'ON_ATTACK'
  | 'ON_BLOCK'
  | 'ON_KO'
  | 'ON_REST'
  | 'ON_ACTIVATE_MAIN'
  | 'ON_OPPONENT_ATTACK'
  | 'ON_TURN_START'
  | 'ON_TURN_END'
  | 'ON_DON_ATTACH'
  | 'ON_CHARACTER_PLAYED'
  | 'ON_CHARACTER_KO'
  | 'ON_TRIGGER'
  | 'ON_COUNTER'
  | 'ON_BATTLE_START'
  | 'ON_BATTLE_END'
  | 'ON_LIFE_LOST'
  | 'ON_CARD_ADDED_TO_HAND'
  | 'ON_CARD_TRASHED'
  | 'ON_CHARACTER_RESTED'
  | 'ON_CHARACTER_ACTIVATED';

// ────────────────────────────────────────────────────────────────────
// CONDITIONS — 25 values, see docs/OP_SIM_ENGINE_SPEC_V1.md L55-79
// ────────────────────────────────────────────────────────────────────

export type ConditionType =
  | 'HAS_DON'
  | 'HAS_CHARACTER'
  | 'HAS_TRAIT'
  | 'HAS_COLOR'
  | 'HAS_COST_AT_LEAST'
  | 'HAS_COST_AT_MOST'
  | 'HAS_POWER_AT_LEAST'
  | 'HAS_POWER_AT_MOST'
  | 'LEADER_IS'
  | 'COUNT_CHARACTERS'
  | 'COUNT_RESTED_CHARACTERS'
  | 'COUNT_ACTIVE_CHARACTERS'
  | 'COUNT_TRAIT'
  | 'COUNT_COLOR'
  | 'LIFE_AT_OR_BELOW'
  | 'LIFE_AT_OR_ABOVE'
  | 'HAND_SIZE_AT_LEAST'
  | 'HAND_SIZE_AT_MOST'
  | 'TRASH_SIZE_AT_LEAST'
  | 'TURN_PLAYER'
  | 'EXISTS_TARGET'
  | 'NO_TARGET_EXISTS'
  | 'IS_RESTED'
  | 'IS_ACTIVE'
  | 'HAS_ATTRIBUTE';

export type Owner = 'SELF' | 'OPPONENT';

/**
 * Condition spec. Extra fields depend on `type`. The fields below are the
 * complete set used by the conditions enumerated above; unused fields are
 * optional. No conditions outside these are supported.
 */
export interface ConditionSpec {
  readonly type: ConditionType;
  readonly owner?: Owner;
  readonly trait?: string;
  readonly color?: string;
  readonly cost?: number;
  readonly cost_gte?: number;
  readonly cost_lte?: number;
  readonly power?: number;
  readonly power_gte?: number;
  readonly power_lte?: number;
  readonly attribute?: string;
  readonly name?: string; // LEADER_IS
  readonly amount?: number; // COUNT_*, LIFE_*, HAND_SIZE_*, TRASH_SIZE_*, HAS_DON
  readonly amount_gte?: number;
  readonly amount_lte?: number;
}

// ────────────────────────────────────────────────────────────────────
// SELECTORS — 19 values, see docs/OP_SIM_ENGINE_SPEC_V1.md L87-111
// ────────────────────────────────────────────────────────────────────

export type Selector =
  | 'SELF_LEADER'
  | 'OPPONENT_LEADER'
  | 'SELF_CHARACTER'
  | 'OPPONENT_CHARACTER'
  | 'SELF_HAND'
  | 'OPPONENT_HAND'
  | 'SELF_DECK'
  | 'OPPONENT_DECK'
  | 'SELF_TRASH'
  | 'OPPONENT_TRASH'
  | 'SELF_LIFE'
  | 'OPPONENT_LIFE'
  | 'THIS_CARD'
  | 'ATTACKING_CHARACTER'
  | 'ATTACKING_LEADER'
  | 'TARGET_CHARACTER'
  | 'TARGET_LEADER'
  | 'ALL_SELF_CHARACTERS'
  | 'ALL_OPPONENT_CHARACTERS';

// ────────────────────────────────────────────────────────────────────
// SELECTOR FILTERS — 15 keys, see docs/OP_SIM_ENGINE_SPEC_V1.md L120-135
// ────────────────────────────────────────────────────────────────────

export interface SelectorFilters {
  readonly trait?: string;
  readonly color?: string;
  readonly cost?: number;
  readonly cost_gte?: number;
  readonly cost_lte?: number;
  readonly power?: number;
  readonly power_gte?: number;
  readonly power_lte?: number;
  readonly attribute?: string;
  readonly type?: string;
  readonly is_rested?: boolean;
  readonly is_active?: boolean;
  readonly has_counter?: boolean;
  readonly without_counter?: boolean;
  readonly owner?: Owner;
}

export interface SelectorRef {
  readonly selector: Selector;
  readonly filters?: SelectorFilters;
}

// ────────────────────────────────────────────────────────────────────
// ACTIONS — 28 values across 7 categories,
// see docs/OP_SIM_ENGINE_SPEC_V1.md L150-218
// ────────────────────────────────────────────────────────────────────

export type Action =
  // POWER / COUNTER
  | 'ADD_POWER'
  | 'SET_POWER'
  | 'ADD_COUNTER'
  // CARD MOVEMENT
  | 'DRAW'
  | 'TRASH'
  | 'PLAY'
  | 'ADD_TO_HAND'
  | 'RETURN_TO_HAND'
  | 'RETURN_TO_DECK_TOP'
  | 'RETURN_TO_DECK_BOTTOM'
  // BOARD STATE
  | 'REST'
  | 'ACTIVATE'
  | 'KO'
  | 'ATTACH_DON'
  | 'DETACH_DON'
  // SEARCH / REVEAL
  | 'SEARCH_DECK'
  | 'REVEAL_CARDS'
  | 'LOOK_AT_TOP'
  | 'REORDER_CARDS'
  | 'SHUFFLE_DECK'
  // LIFE
  | 'ADD_LIFE'
  | 'TAKE_LIFE'
  | 'TRASH_LIFE'
  // STATUS EFFECTS
  | 'GAIN_RUSH'
  | 'GAIN_BLOCKER'
  | 'GAIN_DOUBLE_ATTACK'
  | 'GAIN_BANISH'
  | 'GAIN_COUNTER_EFFECT'
  // RESOURCE ACTIONS
  | 'DISCARD'
  | 'TRASH_FROM_HAND'
  | 'TRASH_FROM_FIELD'
  | 'SEND_TO_TRASH';

// ────────────────────────────────────────────────────────────────────
// DURATIONS — 4 values, see docs/OP_SIM_ENGINE_SPEC_V1.md L227-232
// ────────────────────────────────────────────────────────────────────

export type Duration = 'THIS_BATTLE' | 'END_OF_TURN' | 'START_OF_NEXT_TURN' | 'PERMANENT';

// ────────────────────────────────────────────────────────────────────
// EFFECT STRUCTURE — see docs/OP_SIM_ENGINE_SPEC_V1.md L240-264
// ────────────────────────────────────────────────────────────────────

/**
 * One action within a card-effect's `effects` array.
 *
 * The `target` is a Selector OR a SelectorRef (selector + filters).
 * `amount`, `count`, and `duration` are optional and only used by actions
 * that need them (ADD_POWER → amount + duration, DRAW → count, REST → no
 * amount/duration).
 */
export interface EffectAction {
  readonly action: Action;
  readonly target?: Selector | SelectorRef;
  readonly amount?: number;
  readonly count?: number;
  readonly duration?: Duration;
}

/**
 * A complete card-effect spec. One card may have multiple of these (one
 * per printed clause). Triggered when an event matches `trigger` AND all
 * `conditions` evaluate true AND `requires_don` is met.
 */
export interface EffectSpec {
  readonly trigger: Trigger;
  readonly requires_don?: number;
  readonly conditions?: ReadonlyArray<ConditionSpec>;
  readonly effects: ReadonlyArray<EffectAction>;
}

// ────────────────────────────────────────────────────────────────────
// SIM EVENT — what the host engine passes to the sim layer
// ────────────────────────────────────────────────────────────────────

/**
 * Event payload emitted by the host engine. The sim layer reads this and
 * dispatches matching card effects. The host engine owns event timing.
 */
export interface SimEvent {
  readonly trigger: Trigger;
  readonly controller: PlayerId;
  readonly sourceInstanceId?: InstanceId;
  readonly targetInstanceId?: InstanceId;
  readonly attackingInstanceId?: InstanceId;
  readonly defendingInstanceId?: InstanceId;
}

// ────────────────────────────────────────────────────────────────────
// SIM MUTATION — what the sim layer returns to the host engine
// ────────────────────────────────────────────────────────────────────

/**
 * One state change the sim layer wants the host engine to apply.
 *
 * Mutations are pure data: they describe WHAT changes but do NOT apply
 * the change. The host engine is responsible for application, animation
 * timing, and persistence.
 *
 * `target` is resolved to a concrete InstanceId or PlayerId by the sim
 * before returning. UNSUPPORTED conditions/selectors/actions produce a
 * mutation with `kind: 'UNSUPPORTED'` and a `reason`.
 */
export type SimMutation =
  | {
      readonly kind: Action;
      readonly target: InstanceId | PlayerId;
      readonly amount?: number;
      readonly count?: number;
      readonly duration?: Duration;
      readonly sourceCardId?: CardId;
      readonly sourceInstanceId?: InstanceId;
    }
  | {
      readonly kind: 'UNSUPPORTED';
      readonly reason: string;
      readonly sourceCardId?: CardId;
      readonly sourceInstanceId?: InstanceId;
    };

// ────────────────────────────────────────────────────────────────────
// CARD LIBRARY — per-card effects keyed by CardId
// ────────────────────────────────────────────────────────────────────

/**
 * Per-card effect specs, loaded from card data at startup.
 * One card may have multiple effects (one per printed clause).
 *
 * The compiler (docs/OP_SIM_COMPILER_CONTRACT.md) produces these from
 * each card's effectText. Cards whose text cannot be represented receive
 * the special UNSUPPORTED form.
 */
export type CardEffects =
  | { readonly status: 'OK'; readonly effects: ReadonlyArray<EffectSpec> }
  | { readonly status: 'UNSUPPORTED'; readonly reason: string };

export type CardEffectsLibrary = Readonly<Record<CardId, CardEffects>>;
