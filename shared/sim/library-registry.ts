/**
 * Per-game card-effects library registry.
 *
 * Module-singleton that holds the active CardEffectsLibrary. The host
 * engine sets it once at game start (or never, in which case the sim
 * runs against an empty library and produces zero mutations).
 *
 * Rationale: the engine's reducer signatures cannot accept the library
 * as an argument without refactoring every reducer; storing it on
 * GameState would be a state-shape change (banned by the integration
 * contract). The singleton is the minimum-friction integration that
 * preserves both constraints.
 *
 * This module is part of the sim layer and is not part of the engine.
 * The engine only reads from it indirectly via `safeProcessSimEvent`.
 */

import type { CardEffectsLibrary } from './types.js';

let _library: CardEffectsLibrary = {};

/**
 * Install the active card-effects library. Call once at game start.
 * Subsequent calls REPLACE the prior library (so reloading a save or
 * starting a new game leaves no stale entries).
 */
export function setCardEffectsLibrary(lib: CardEffectsLibrary): void {
  _library = lib;
}

/** Read the active library. Returns the empty object if unset. */
export function getCardEffectsLibrary(): CardEffectsLibrary {
  return _library;
}

/**
 * Reset to empty. Useful between tests so prior-test entries don't
 * leak into new-test setups.
 */
export function clearCardEffectsLibrary(): void {
  _library = {};
}
