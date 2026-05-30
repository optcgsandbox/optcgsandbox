// Effect dispatch (D14). Source: docs/optcg-sim/rules-reference.md §9 / CR §8.
//
// `fireEffects` is the single entry point that turns "this instance hit
// trigger X" into "every relevant template handler in TEMPLATES runs in
// sequence, chaining state". Action handlers in applyAction.ts call this
// at the right moments (on_play, on_ko, when_attacking, on_block).
//
// Trigger → tag mapping (v0):
//   on_play          → searcher, draw, removal_ko, removal_bounce,
//                      removal_cost_reduce, recursion, ramp, lifegain,
//                      life_to_hand, disruption, power_buff, cost_reduction
//   when_attacking   → power_buff, draw                  (intent-only stubs run)
//   on_block         → draw, lifegain                    (intent-only stubs run)
//   on_ko            → draw, lifegain, recursion, disruption  (intent-only stubs run)
//   activate_main    → (handled separately by ACTIVATE_MAIN action; not yet wired)
//   trigger          → handled in applyAction.resolveTrigger directly
//
// `blocker`, `rush`, `double_attack`, `counter_event`, `counter_character`,
// `vanilla` are passive markers — calling their templates is a no-op by
// design, which is fine; they're cheap and self-documenting.
//
// Resolution order (CR §8-6): when multiple sources fire on the SAME
// simultaneous trigger, turn-player effects resolve first, then non-turn.
// The current call sites in applyAction.ts dispatch ONE source per action
// (the just-played card, the just-attacking card, etc.), so this is moot
// for now. When chain effects or simultaneous board fires are introduced
// (e.g. mass KO from a board wipe → multiple on_ko fires), the resolver
// here should be extended to sort by `turnPlayerFirst(state, fires)`
// before chaining. Acknowledged limitation; see §15.1 D14 in rules-reference.md.

import type { GameState, PlayerId } from '../../GameState';
import type { EffectTag } from '../Card';
import { TEMPLATES } from './templates';
import type { EffectContext, EffectTrigger } from './types';

/** Tags that should attempt to fire on the given trigger. Anything not
 *  listed is skipped (so passive markers like `vanilla` / `blocker` /
 *  `rush` cost zero per-action). */
const TAGS_BY_TRIGGER: Record<EffectTrigger, ReadonlySet<EffectTag>> = {
  on_play: new Set<EffectTag>([
    'searcher',
    'draw',
    'removal_ko',
    'removal_bounce',
    'removal_cost_reduce',
    'recursion',
    'ramp',
    'lifegain',
    'life_to_hand',
    'disruption',
    'power_buff',
    'cost_reduction',
  ]),
  when_attacking: new Set<EffectTag>(['power_buff', 'draw']),
  on_block: new Set<EffectTag>(['draw', 'lifegain']),
  on_ko: new Set<EffectTag>(['draw', 'lifegain', 'recursion', 'disruption']),
  activate_main: new Set<EffectTag>(),
  trigger: new Set<EffectTag>(),
};

/** Fire every relevant template on `instance` for the given `trigger`.
 *
 *  Chains template handlers sequentially: each handler takes the current
 *  state, returns the next, which is fed into the next handler. The
 *  source's `card.effectTags` are iterated in declaration order so card
 *  data can encode intent (e.g. ['ramp', 'draw'] fires ramp first).
 *
 *  Returns the new state. If the instance no longer exists, or the card
 *  is unknown, returns `state` unchanged (defensive — KO fires reach this
 *  after the instance has already been moved to trash, which is fine
 *  because we keep a snapshot of `cardId` in `state.instances`).
 */
export function fireEffects(
  state: GameState,
  instanceId: string,
  trigger: EffectTrigger,
  controller: PlayerId,
  options: { targetInstanceId?: string; param?: number } = {},
): GameState {
  const inst = state.instances[instanceId];
  if (!inst) return state;
  const card = state.cardLibrary[inst.cardId];
  if (!card) return state;

  const allowed = TAGS_BY_TRIGGER[trigger];
  if (allowed.size === 0) return state;

  let cur = state;
  for (const tag of card.effectTags) {
    if (!allowed.has(tag)) continue;
    const handler = TEMPLATES[tag as keyof typeof TEMPLATES];
    if (!handler) continue;
    const ctx: EffectContext = {
      sourceInstanceId: instanceId,
      controller,
      trigger,
      targetInstanceId: options.targetInstanceId,
      param: options.param,
    };
    cur = handler(cur, ctx);
  }
  return cur;
}
