/**
 * Engine V2 — replacement-trigger handlers.
 *
 * Replacement effects are dispatched by `ReplacementManager.tryReplace`,
 * which already runs the per-replacement condition + cost + action pipeline.
 * The replacement HANDLER registry exists for boot-time validation —
 * `validateCardsAgainstRegistry` requires every replacement trigger
 * referenced by cards to have a registered handler.
 *
 * The handler signature is a passthrough: ReplacementManager already
 * decided whether to replace; the handler returns the post-mutation state
 * with `replaced: true`. We register one handler per trigger name; the
 * registered handler is effectively presence-only because the real work
 * is done in ReplacementManager.
 *
 * Cross-references:
 * - Implementation spec §10
 * - Plan v1 §3.1 (replacement trigger names)
 */

import { type ReplacementHandler, replacementHandlers } from '../types.js';

const passthrough: ReplacementHandler = (state) => ({ replaced: true, state });

export function registerReplacementHandlers(): void {
  replacementHandlers.register('would_be_ko', passthrough);
  replacementHandlers.register('would_be_removed', passthrough);
  replacementHandlers.register('would_take_damage', passthrough);
  replacementHandlers.register('on_life_flip', passthrough);
}
