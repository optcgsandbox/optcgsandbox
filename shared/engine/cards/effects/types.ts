// Effect handler interface. Per docs/optcg-sim/rules-reference.md §2 +
// docs/optcg-sim/ai-architecture.md §2.
//
// Each card-specific effect is a function: (state, context) → next state.
// EffectTag (defined on Card) determines which handler runs.

import type { Action } from '../../../protocol/actions';
import type { GameState, PlayerId } from '../../GameState';
import type { EffectTag, Card } from '../Card';

export type EffectTrigger =
  | 'on_play'         // card just entered the field/event resolution
  | 'on_ko'           // card was KO'd
  | 'when_attacking'  // declaring an attack
  | 'on_block'        // declared a block
  | 'activate_main'   // main-phase activation
  | 'trigger';        // life-card trigger reveal

export interface EffectContext {
  /** The instance whose effect is resolving. */
  sourceInstanceId: string;
  /** The player controlling sourceInstanceId. */
  controller: PlayerId;
  /** Trigger that caused this effect to fire. */
  trigger: EffectTrigger;
  /** Optional target chosen by the controller. */
  targetInstanceId?: string;
  /** Optional further parameter (e.g. number for searches). */
  param?: number;
}

export type EffectFn = (state: GameState, ctx: EffectContext) => GameState;

/** Optional: handlers that need a target pick can implement this. */
export type EffectTargetEnumerator = (state: GameState, ctx: EffectContext) => Action[];

export interface EffectHandler {
  tag: EffectTag;
  apply: EffectFn;
  /** Returns legal target picks; if omitted, effect is auto-resolved. */
  enumerateTargets?: EffectTargetEnumerator;
}

/** Effect registry: tag → handler. Composed by importing each effect module. */
export type EffectRegistry = Partial<Record<EffectTag, EffectHandler>>;

// Helper: get effect tags from a card.
export function tagsOf(card: Card): readonly EffectTag[] {
  return card.effectTags;
}
