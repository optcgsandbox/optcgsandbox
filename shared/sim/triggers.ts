/**
 * Trigger matching.
 *
 * The 21 triggers from docs/OP_SIM_ENGINE_SPEC_V1.md L25-47. Matching is
 * literal — event.trigger === spec.trigger. No fuzzy matching, no
 * aliases. If a card spec uses a trigger value not in this list, the
 * compiler should already have rejected it (the type system enforces).
 */

import type { Trigger, EffectSpec, SimEvent } from './types.js';

/** All 21 trigger values, for runtime enumeration. */
export const ALL_TRIGGERS: ReadonlyArray<Trigger> = [
  'ON_PLAY',
  'ON_ATTACK',
  'ON_BLOCK',
  'ON_KO',
  'ON_REST',
  'ON_ACTIVATE_MAIN',
  'ON_OPPONENT_ATTACK',
  'ON_TURN_START',
  'ON_TURN_END',
  'ON_DON_ATTACH',
  'ON_CHARACTER_PLAYED',
  'ON_CHARACTER_KO',
  'ON_TRIGGER',
  'ON_COUNTER',
  'ON_BATTLE_START',
  'ON_BATTLE_END',
  'ON_LIFE_LOST',
  'ON_CARD_ADDED_TO_HAND',
  'ON_CARD_TRASHED',
  'ON_CHARACTER_RESTED',
  'ON_CHARACTER_ACTIVATED',
];

/** True if the spec's trigger matches this event's trigger. */
export function matchesTrigger(spec: EffectSpec, event: SimEvent): boolean {
  return spec.trigger === event.trigger;
}
