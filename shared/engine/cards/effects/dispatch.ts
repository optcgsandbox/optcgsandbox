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
//   activate_main    → searcher, draw, removal_ko, removal_bounce,
//                      removal_cost_reduce, recursion, ramp, lifegain,
//                      life_to_hand, disruption, power_buff, cost_reduction
//   trigger          → searcher, draw, removal_ko, removal_bounce,
//                      removal_cost_reduce, recursion, ramp, lifegain,
//                      life_to_hand, disruption, power_buff, cost_reduction
//                      (dispatched from applyAction.resolveTrigger when
//                      controller activates a flipped life card)
//   at_start_of_game → searcher, draw, ramp, lifegain
//                      (dispatched from chooseFirstPlayer once per leader,
//                       chooser's first per CR §5-2-1-5-1)
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
    'set_power_zero',
    'cost_reduction',
    // V3-5:
    'rest_opp_don',
    'mill',
    'reveal_opp_hand',
    'take_from_opp_hand',
    'search_deck',
    'exile',
    'play_for_free',
    'rest_target',
    'move_to_top',
  ]),
  when_attacking: new Set<EffectTag>(['power_buff', 'draw']),
  on_block: new Set<EffectTag>(['draw', 'lifegain']),
  on_ko: new Set<EffectTag>(['draw', 'lifegain', 'recursion', 'disruption']),
  // Phase C / D12 (CR §10-2-13): ACTIVATE_MAIN rests the card and fires its
  // intent tags. Same tag surface as on_play — the cost (rest) and trigger
  // distinguish activation from play.
  activate_main: new Set<EffectTag>([
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
    'set_power_zero',
    'cost_reduction',
    // V3-5:
    'rest_opp_don',
    'mill',
    'reveal_opp_hand',
    'take_from_opp_hand',
    'search_deck',
    'exile',
    'rest_target',
    'move_to_top',
  ]),
  // D15 (CR §5-2-1-5-1): at-start-of-game effects fire after first/second is
  // chosen, before the mulligan window opens. No field exists yet so removal /
  // power_buff / cost_reduction make no sense. Searcher / draw / ramp /
  // lifegain (the typical "draw N" or "search and add to hand" pattern) are
  // the v0 surface.
  at_start_of_game: new Set<EffectTag>([
    'searcher',
    'draw',
    'ramp',
    'lifegain',
  ]),
  // Phase D / D11 (CR §10-1-5): when a life card with [Trigger] is flipped
  // and the controller activates, fire the same effect-tag surface as on_play.
  // Card-level trigger semantics (exile/banish/special play) are NOT here —
  // those need card-specific handlers; this dispatch covers the common
  // "draw/search/remove/buff" trigger effects.
  trigger: new Set<EffectTag>([
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
    'set_power_zero',
    'cost_reduction',
    // V3-5: triggers can fire pretty much anything; include the new tags.
    'rest_opp_don',
    'mill',
    'reveal_opp_hand',
    'take_from_opp_hand',
    'search_deck',
    'exile',
    'play_for_free',
    'rest_target',
    'move_to_top',
  ]),
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

  // D18 (CR §10-2-13-5): [Once Per Turn] gate. If the source card has the
  // `once_per_turn` keyword AND this trigger already fired on this card this
  // turn, skip the entire fire. effectsUsed is cleared in endTurn (per D4),
  // so the slot reopens next turn. Partial-pay failure is NOT a concern here
  // — action handlers (activateMain etc.) validate cost BEFORE calling
  // fireEffects, so a failed cost-pay returns no-op without ever reaching
  // this function.
  const isOpt = card.keywords.includes('once_per_turn');
  if (isOpt && inst.perTurn.effectsUsed.includes(trigger)) return state;

  const allowed = TAGS_BY_TRIGGER[trigger];
  if (allowed.size === 0) return state;

  // Batch 4 (audit 2026-05-30): clone ONCE here, then pass the same `cur`
  // through every template in the chain. Templates are now mutate-in-place
  // (see comment header in templates.ts). Previous shape did per-template
  // structuredClone — O(N) clones of the full GameState (including
  // cardLibrary) per fire. The pre-clone-then-mutate pattern matches the
  // rest of applyAction.ts and stays correct across early-return no-op
  // templates (vanilla / blocker / cost_reduction / etc. that return their
  // input unchanged).
  let cur: GameState = structuredClone(state);
  let fired = false;
  for (const tag of card.effectTags) {
    if (!allowed.has(tag)) continue;
    const handler = TEMPLATES[tag as keyof typeof TEMPLATES];
    if (!handler) continue;
    fired = true;
    const ctx: EffectContext = {
      sourceInstanceId: instanceId,
      controller,
      trigger,
      targetInstanceId: options.targetInstanceId,
      param: options.param,
    };
    cur = handler(cur, ctx);
  }

  // D18: mark the OPT slot used. `cur` is always a clone (Batch 4: cloned
  // pre-loop), so direct mutation is safe — no defensive re-clone needed.
  if (fired && isOpt) {
    const out = cur;
    const after = out.instances[instanceId];
    if (after && !after.perTurn.effectsUsed.includes(trigger)) {
      after.perTurn.effectsUsed.push(trigger);
      const pl = out.players[after.controller];
      if (pl.leader.instanceId === instanceId && !pl.leader.perTurn.effectsUsed.includes(trigger)) {
        pl.leader.perTurn.effectsUsed.push(trigger);
      }
      for (const f of pl.field) {
        if (f.instanceId === instanceId && !f.perTurn.effectsUsed.includes(trigger)) {
          f.perTurn.effectsUsed.push(trigger);
        }
      }
      if (pl.stage && pl.stage.instanceId === instanceId && !pl.stage.perTurn.effectsUsed.includes(trigger)) {
        pl.stage.perTurn.effectsUsed.push(trigger);
      }
    }
    return out;
  }

  return cur;
}
