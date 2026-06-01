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
import { runEffectSpec } from './runner';
import type { EffectContext, EffectTrigger } from './types';
import { fireV2Effects, shouldUseV2 } from '../../effectSpec/migration-v2';
import type { EffectTriggerV2 } from '../../effectSpec/types-v2';

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
  // chosen, before the mulligan window opens. V1 tag-based fallback removed
  // 2026-06-01 — extracted effectTags ('ramp', 'draw', etc.) were ghost-firing
  // game-start effects on cards whose printed text never authorized them
  // (e.g., adding DON to opp before their actual DON phase). V2 card specs
  // (cardEffectSpecs) are now the sole authority for game-start effects.
  at_start_of_game: new Set<EffectTag>(),
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

  // A.3.10: prefer the v2 spec when the card carries one AND the migration
  // flag is enabled. Falls through to v1 effectSpec → tag dispatch when
  // v2 isn't applicable. Triggers are largely overlapping but use the v2
  // alias when they match.
  if (shouldUseV2(card)) {
    const v2trigger = trigger as EffectTriggerV2;
    const after = fireV2Effects(state, instanceId, v2trigger, controller);
    if (after !== state) return after;
  }
  // When V2 spec is verified-authoritative (human-reviewed or ground-truth),
  // the absence of a matching clause is intentional: do NOTHING for this
  // trigger. Skipping the V1 effectTag fallback prevents auto-extracted
  // tags (e.g., 'ramp' on OP01-060 Doflamingo from a "DON!! −1" regex hit,
  // or 'ramp' on OP01-091 King whose V2 spec is continuous-only with no
  // clauses) from firing ghost effects at game start / on triggers the
  // printed text never authorized. This check runs regardless of whether
  // `shouldUseV2` returned true — continuous-only specs have clauses.length
  // === 0 (shouldUseV2 → false) but their verified status still makes V1
  // ghost-tag firing inappropriate. Cards not yet migrated to V2
  // (verified === 'auto' / 'flagged' / unset) still fall through.
  {
    const verified = (card as { effectSpecV2?: { verified?: string } }).effectSpecV2?.verified;
    if (verified === 'human-reviewed' || verified === 'ground-truth') {
      return state;
    }
  }

  // Stage 0: prefer structured `effectSpec` when present. The runner resolves
  // condition + target + action against state and chains. Falls back to the
  // legacy tag dispatch when the card has no specs (or none matching the
  // trigger). Hybrid is fine — specs and tags can coexist while the corpus
  // is being migrated.
  if (Array.isArray(card.effectSpec) && card.effectSpec.length > 0) {
    const matches = card.effectSpec.filter((s) => s.trigger === trigger);
    if (matches.length > 0) {
      const ran = runEffectSpec(state, { sourceInstanceId: instanceId, controller, trigger }, matches);
      // V3 OPT enforcement still runs on the spec path so once_per_turn
      // guards don't get bypassed by switching to specs.
      if (card.keywords.includes('once_per_turn')) {
        const after = ran.instances[instanceId];
        if (after && !after.perTurn.effectsUsed.includes(trigger)) {
          after.perTurn.effectsUsed.push(trigger);
          const pl = ran.players[after.controller];
          if (pl.leader.instanceId === instanceId && !pl.leader.perTurn.effectsUsed.includes(trigger)) {
            pl.leader.perTurn.effectsUsed.push(trigger);
          }
          for (const f of pl.field) {
            if (f.instanceId === instanceId && !f.perTurn.effectsUsed.includes(trigger)) {
              f.perTurn.effectsUsed.push(trigger);
            }
          }
        }
      }
      return ran;
    }
  }

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
    // V3 per-card param binding: prefer caller-provided param (options.param),
    // fall back to card.templateParams[tag] when present. Templates default
    // their magnitude if neither is provided.
    const tplParam = card.templateParams?.[tag];
    const param = options.param !== undefined ? options.param : (tplParam as EffectContext['param']);
    const ctx: EffectContext = {
      sourceInstanceId: instanceId,
      controller,
      trigger,
      targetInstanceId: options.targetInstanceId,
      param,
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
