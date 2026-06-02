/**
 * Engine V2 — single clause-dispatch entry point.
 *
 * Pipeline (Plan v1 §1.1 M03 / §4.6 / C38) — every clause-firing flows
 * through the SAME 7-step shape; OPT marking is the FINAL step and only
 * runs when condition + cost + action all succeed:
 *
 *   for each clause where clause.trigger === trigger:
 *     1. evaluate condition (true if absent)
 *     2. resolve target (empty if absent)
 *     3. cost.canPay (true if absent)
 *     4. cost.pay (no-op if absent) — may return null if pay fails mid-flight
 *     5. action handler (mutates state)
 *     6. push event to history
 *     7. markOptUsed (clause.opt === true only)
 *
 * Single source of truth for OPT bookkeeping. ESLint
 * `no-direct-perTurn-effects-used-write` enforces nobody else pushes.
 *
 * Cross-references:
 * - Implementation spec §6
 * - Plan v1 §1.1 M03 + §4.6 + C9 + C33 + C38
 */

import type { Card } from '../cards/Card.js';
import { isOptUsed, makeOptKey, markOptUsed } from '../state/derived/opt.js';
import type {
  EffectClauseV2,
  EffectConditionV2,
} from '../spec/types.js';
import {
  type CardInstance,
  type GameState,
  type InstanceId,
} from '../state/types.js';
import {
  actionHandlers,
  conditionHandlers,
  costHandlers,
  type HandlerCtx,
  targetResolvers,
} from '../registry/types.js';

// ────────────────────────────────────────────────────────────────────
// evaluateCondition — exported for ContinuousManager + ReplacementManager
// ────────────────────────────────────────────────────────────────────

/** AND/OR/NOT combinators are handled here (Plan v1 §3.2);
 *  everything else delegates to a registered handler. */
export function evaluateCondition(
  state: GameState,
  ctx: HandlerCtx,
  condition: EffectConditionV2 | undefined,
): boolean {
  if (condition === undefined) return true;
  const t = condition.type;
  if (t === 'and') {
    const subs = (condition['conditions'] as ReadonlyArray<EffectConditionV2>) ?? [];
    return subs.every((c) => evaluateCondition(state, ctx, c));
  }
  if (t === 'or') {
    const subs = (condition['conditions'] as ReadonlyArray<EffectConditionV2>) ?? [];
    return subs.some((c) => evaluateCondition(state, ctx, c));
  }
  if (t === 'not') {
    const inner = condition['condition'] as EffectConditionV2 | undefined;
    return !evaluateCondition(state, ctx, inner);
  }
  const handler = conditionHandlers.get(t);
  return handler(state, ctx, condition);
}

// ────────────────────────────────────────────────────────────────────
// dispatch — fire all matching clauses on `source` for `trigger`
// ────────────────────────────────────────────────────────────────────

function getSpecForInstance(state: GameState, inst: CardInstance): {
  card: Card | undefined;
  clauses: ReadonlyArray<EffectClauseV2>;
} {
  const card = state.cardLibrary[inst.cardId] as Card | undefined;
  const clauses = card?.effectSpecV2?.clauses ?? [];
  return { card, clauses };
}

/**
 * `effectsNegated === true` on the instance suppresses ALL clause firing.
 * Replacement-trigger clauses are NOT dispatched here (they fire via
 * ReplacementManager).
 */
export const EffectDispatcher = {
  dispatch(
    state: GameState,
    ctx: HandlerCtx,
    trigger: string,
  ): GameState {
    const inst = state.instances[ctx.sourceInstanceId];
    if (inst === undefined) return state;
    if (inst.effectsNegated === true) return state;

    const { clauses } = getSpecForInstance(state, inst);
    if (clauses.length === 0) return state;

    let working = state;
    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i]!;
      if (clause.trigger !== trigger) continue;

      // Reset per-clause-resolution counters before each clause fires.
      working.cardsTrashedThisResolution = 0;

      // (0) OPT-gate — skip clauses already used this turn (closes CR-2 audit
      // finding; aligns with ReplacementManager.tryReplace OPT gate).
      if (clause.opt === true) {
        const optKey = makeOptKey('opt', trigger, i);
        const gateInst = working.instances[ctx.sourceInstanceId];
        if (gateInst !== undefined && isOptUsed(gateInst, optKey)) continue;
      }

      // (1) Condition
      if (!evaluateCondition(working, ctx, clause.condition)) continue;

      // (2) Target
      let targets: ReadonlyArray<InstanceId> = [];
      if (clause.target !== undefined) {
        const resolver = targetResolvers.get(clause.target.kind);
        targets = resolver(working, ctx, clause.target);
        // Empty target with required cardinality means clause cannot fire.
        if (targets.length === 0) continue;
      }

      // (3,4) Cost — atomic: snapshot working before pay loop; restore on
      // partial-pay failure (closes CR-1 audit finding).
      if (clause.cost !== undefined) {
        let allCanPay = true;
        for (const key of Object.keys(clause.cost)) {
          const cost = costHandlers.get(key);
          if (!cost.canPay(working, ctx, clause.cost)) {
            allCanPay = false;
            break;
          }
        }
        if (!allCanPay) continue;
        const preCostSnapshot = structuredClone(working);
        let payState: typeof working = working;
        let payFailed = false;
        for (const key of Object.keys(clause.cost)) {
          const cost = costHandlers.get(key);
          const next = cost.pay(payState, ctx, clause.cost);
          if (next === null) {
            payFailed = true;
            break;
          }
          payState = next;
        }
        if (payFailed) {
          working = preCostSnapshot;
          continue;
        }
        working = payState;
      }

      // (5) Action
      const actionHandler = actionHandlers.get(clause.action.kind);
      working = actionHandler(working, ctx, clause.action, targets);

      // (6) History event for the fired clause
      (working.history as Array<unknown>).push({
        type: 'CLAUSE_FIRED',
        sourceInstanceId: ctx.sourceInstanceId,
        controller: ctx.controller,
        trigger,
        clauseIndex: i,
        actionKind: clause.action.kind,
      });

      // (7) OPT mark — ONLY after full success (per C9 / C33)
      if (clause.opt === true) {
        const freshInst = working.instances[ctx.sourceInstanceId];
        if (freshInst !== undefined) {
          markOptUsed(freshInst, makeOptKey('opt', trigger, i));
        }
      }
    }

    return working;
  },
} as const;
