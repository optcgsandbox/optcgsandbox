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
  type ClauseScratch,
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
import {
  attachScratchToPending,
  newClauseScratch,
  writeBinding,
} from './clauseScratch.js';

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

      // Per-clause ClauseScratch — clause-local cross-step binding context.
      // Created here, destroyed at clause completion, OR moved into
      // state.pending.<kind>.scratch on suspension (see end of loop).
      const scratch: ClauseScratch = newClauseScratch();
      const clauseCtx: HandlerCtx = { ...ctx, scratch };

      // (1) Condition
      if (!evaluateCondition(working, clauseCtx, clause.condition)) continue;

      // (2) Target
      let targets: ReadonlyArray<InstanceId> = [];
      let oppChoiceSuspended = false;
      if (clause.target !== undefined) {
        const resolver = targetResolvers.get(clause.target.kind);
        targets = resolver(working, clauseCtx, clause.target);
        // Empty target with required cardinality means clause cannot fire.
        if (targets.length === 0) continue;
        // Auto-bind: if clause.target.bind is declared, write the first
        // resolved instance into ctx.scratch[bind] for later steps to read.
        const tBind = (clause.target as { bind?: unknown }).bind;
        if (typeof tBind === 'string' && tBind !== '' && targets[0] !== undefined) {
          writeBinding(working, scratch, tBind, targets[0]);
        }
        // P-OPP-FORCED-ACTION: when target.oppSelect === true, the
        // OPPONENT (not ctx.controller) picks which candidate the action
        // acts on. Suspend into PendingChoose with controller=opponent
        // and one option per candidate; the option's action carries
        // `_preBoundTargets` so resolveChooseOneReducer passes them
        // through without re-resolving. Single-candidate case auto-fires.
        // Most target resolvers default count to 1 (targets.ts:35-38),
        // so re-resolve with a wide count to gather all candidates for
        // the opp to choose among.
        const oppSel = (clause.target as { oppSelect?: unknown }).oppSelect === true;
        if (oppSel) {
          const wideTarget = { ...clause.target, count: 99 } as typeof clause.target;
          targets = resolver(working, clauseCtx, wideTarget);
          if (targets.length === 0) continue;
        }
        if (oppSel && targets.length > 1) {
          const oppController = ctx.controller === 'A' ? 'B' : 'A';
          const options = targets.map((cid) => ({
            trigger: clause.trigger,
            action: { ...clause.action, _preBoundTargets: [cid] },
            verified: 'human-reviewed',
          }));
          working.pending = {
            kind: 'choose_one',
            pendingChoose: {
              controller: oppController,
              sourceInstanceId: ctx.sourceInstanceId,
              options,
              resumePhase: working.phase,
              scratch: clauseCtx.scratch,
            },
          };
          working.phase = 'choose_one';
          oppChoiceSuspended = true;
        }
      }
      if (oppChoiceSuspended) break;

      // (3,4) Cost — atomic: snapshot working before pay loop; restore on
      // partial-pay failure (closes CR-1 audit finding).
      if (clause.cost !== undefined) {
        let allCanPay = true;
        for (const key of Object.keys(clause.cost)) {
          // `bind` is a meta-key on the cost shape, not a cost-handler kind.
          // Skip it during the canPay/pay walk.
          if (key === 'bind') continue;
          const cost = costHandlers.get(key);
          if (!cost.canPay(working, clauseCtx, clause.cost)) {
            allCanPay = false;
            break;
          }
        }
        if (!allCanPay) continue;
        const preCostSnapshot = structuredClone(working);
        let payState: typeof working = working;
        let payFailed = false;
        for (const key of Object.keys(clause.cost)) {
          if (key === 'bind') continue;
          const cost = costHandlers.get(key);
          const next = cost.pay(payState, clauseCtx, clause.cost);
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
        // Auto-bind on cost: if clause.cost.bind is declared, write the
        // cost-step's primary chosen card into ctx.scratch[bind]. Cost
        // handlers that resolve a card (discard-from-hand-by-filter,
        // trash-self, return-self, etc.) write a sentinel binding to
        // clauseCtx.scratch under the literal key '_costPicked'. The
        // dispatcher renames it to the declared bind name here.
        const cBind = (clause.cost as { bind?: unknown }).bind;
        if (typeof cBind === 'string' && cBind !== '' && scratch['_costPicked'] !== undefined) {
          scratch[cBind] = scratch['_costPicked']!;
          delete scratch['_costPicked'];
        }
      }

      // (5) Action
      const actionHandler = actionHandlers.get(clause.action.kind);
      working = actionHandler(working, clauseCtx, clause.action, targets);

      // Auto-bind on action: if clause.action.bind is declared, write the
      // primary resolved target (targets[0]) into ctx.scratch[bind]. Action
      // handlers can override this by writing their own binding via the
      // clauseCtx.scratch reference before returning.
      const aBind = (clause.action as { bind?: unknown }).bind;
      if (typeof aBind === 'string' && aBind !== '' && targets[0] !== undefined) {
        writeBinding(working, scratch, aBind, targets[0]);
      }

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

      // (8) Pending-state pause (Plan §1.3 + §4.12). If clause i's action
      // suspended the engine (peek/choose_one/discard/attack_target_pick),
      // subsequent clauses must NOT fire on the un-resumed state. Move the
      // ClauseScratch onto the inner pending payload so RESOLVE_* can
      // restore it. Then break — let the host resume via the pending
      // decision.
      if (working.pending !== null) {
        working = attachScratchToPending(working, scratch);
        break;
      }
    }

    return working;
  },
} as const;
