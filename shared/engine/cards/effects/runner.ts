// EffectSpec runner — Stage 0 of the card-effect extraction method.
// Per docs/optcg-sim/card-effect-extraction-method.md §Stage 0.
//
// `runEffectSpec(state, ctx, specs)` walks the ordered list of EffectSpec
// clauses on a card, checks each clause's `condition` against state, picks
// a target if needed, and dispatches the action by reusing the existing
// templates from templates.ts. Returns the chained state.
//
// Engine-pure: no UI, no LLM. The LLM only produces specs; this runner is
// deterministic.

import type {
  EffectCondition,
  EffectSpec,
  EffectSpecAction,
  EffectSpecTarget,
  EffectSpecTrigger,
} from '../Card';
import type { GameState, PlayerId } from '../../GameState';
import { TEMPLATES } from './templates';
import type { EffectContext } from './types';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

/** Check whether the clause's condition holds for the given state. */
export function evaluateCondition(
  state: GameState,
  controller: PlayerId,
  cond: EffectCondition | undefined,
): boolean {
  if (!cond || cond.type === 'always') return true;
  const me = state.players[controller];
  const opp = state.players[OTHER[controller]];
  switch (cond.type) {
    case 'if_leader_is': {
      const card = state.cardLibrary[me.leader.cardId];
      return card?.name === cond.name;
    }
    case 'if_leader_has_trait': {
      const card = state.cardLibrary[me.leader.cardId];
      return Array.isArray(card?.traits) && card.traits.includes(cond.trait);
    }
    case 'if_don_min':
      return me.donCostArea.length >= cond.n;
    case 'if_own_life_max':
      return me.life.length <= cond.n;
    case 'if_opp_life_max':
      return opp.life.length <= cond.n;
    case 'if_hand_max':
      return me.hand.length <= cond.n;
    case 'if_trash_min':
      return me.trash.length >= cond.n;
  }
}

/** Pick a default target instance id from state given a target descriptor.
 *  V0 picks deterministically; future UI work will let the controller
 *  choose for ambiguous targets. */
export function resolveTarget(
  state: GameState,
  controller: PlayerId,
  sourceInstanceId: string,
  target: EffectSpecTarget | undefined,
  magnitude: number | undefined,
): string | undefined {
  const me = state.players[controller];
  const opp = state.players[OTHER[controller]];
  switch (target) {
    case undefined:
      return undefined;
    case 'self':
      return sourceInstanceId;
    case 'your_leader':
      return me.leader.instanceId;
    case 'opp_leader':
      return opp.leader.instanceId;
    case 'your_character':
      return me.field[0]?.instanceId;
    case 'opp_character':
      return opp.field[0]?.instanceId;
    case 'opp_character_cost_max': {
      // Pick opp's first character whose printed cost ≤ magnitude.
      const cap = magnitude ?? Infinity;
      const hit = opp.field.find((inst) => {
        const card = state.cardLibrary[inst.cardId];
        return card && typeof card.cost === 'number' && card.cost <= cap;
      });
      return hit?.instanceId;
    }
    case 'top_of_deck':
      return me.deck[0];
    case 'top_of_opp_deck':
      return opp.deck[0];
    case 'opp_hand':
      return opp.hand[0];
    case 'own_trash':
      return me.trash[me.trash.length - 1];
  }
}

/** Map EffectSpecAction → the templates.ts handler key. Most actions map
 *  1:1 to existing templates; a few aliases for clarity. */
function templateKeyFor(action: EffectSpecAction): keyof typeof TEMPLATES {
  if (action === 'searcher_peek') return 'searcher';
  return action as keyof typeof TEMPLATES;
}

/** Run the spec list against state. Returns the post-resolution state.
 *  Each clause is evaluated AGAINST the chained state — earlier clauses
 *  affect later clauses' conditions. */
export function runEffectSpec(
  state: GameState,
  ctx: { sourceInstanceId: string; controller: PlayerId; trigger: EffectSpecTrigger },
  specs: EffectSpec[],
): GameState {
  let cur = state;
  for (const spec of specs) {
    if (spec.trigger !== ctx.trigger) continue;
    if (!evaluateCondition(cur, ctx.controller, spec.condition)) continue;

    const key = templateKeyFor(spec.action);
    const handler = TEMPLATES[key];
    if (!handler) continue;

    const targetInstanceId = resolveTarget(
      cur,
      ctx.controller,
      ctx.sourceInstanceId,
      spec.target,
      spec.magnitude,
    );
    // Param: numeric magnitude, or params object for windowed flows. The
    // running template treats undefined as "use template default."
    let param: EffectContext['param'];
    if (spec.params) param = spec.params as unknown as EffectContext['param'];
    else if (typeof spec.magnitude === 'number') param = spec.magnitude;
    else param = undefined;

    const tCtx: EffectContext = {
      sourceInstanceId: ctx.sourceInstanceId,
      controller: ctx.controller,
      trigger: ctx.trigger,
      targetInstanceId,
      param,
    };
    cur = handler(cur, tCtx);
  }
  return cur;
}
