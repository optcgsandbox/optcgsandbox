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
import { nextCostChoiceKey } from '../registry/handlers/costChoice.js';

// F-8D — target kinds where the PLAYER chooses among board entities. These
// suspend into the generic target picker for human seats. Deterministic /
// zone-structural kinds (self, your_leader, opp_leader, all_*, top_of_deck,
// life tops, hand/trash cards) stay on the V0 resolver path.
const TARGET_CHOICE_KINDS: ReadonlySet<string> = new Set([
  'opp_character',
  'your_character',
  'any_character',
  'opp_leader_or_character',
  'your_leader_or_character',
  'opp_don_or_character',
]);

/** Human one-liner for the picker subtitle, derived from the clause's
 *  action shape — generic across families (no card-specific text). */
function describeTargetChoice(clause: EffectClauseV2): string {
  const a = clause.action as { kind?: string; magnitude?: number; keyword?: string; duration?: string };
  const upTo = 'Choose up to';
  const n = 1;
  switch (a.kind) {
    case 'power_buff': {
      const m = typeof a.magnitude === 'number' ? a.magnitude : 0;
      return `${upTo} ${n} — ${m >= 0 ? '+' : ''}${m} power${a.duration === 'this_battle' ? ' this battle' : ' this turn'}.`;
    }
    case 'removal_ko': return `${upTo} ${n} — K.O. it.`;
    case 'removal_bounce': return `${upTo} ${n} — return it to the owner's hand.`;
    case 'rest_target': return `${upTo} ${n} — rest it.`;
    case 'set_active': return `${upTo} ${n} — set it as active.`;
    case 'give_don_to_target': return `${upTo} ${n} — give it a rested DON!!.`;
    case 'give_keyword': return `${upTo} ${n} — it gains [${a.keyword ?? 'keyword'}].`;
    case 'give_cost_buff': return `${upTo} ${n} — ${typeof a.magnitude === 'number' && a.magnitude >= 0 ? '+' : ''}${a.magnitude ?? ''} cost.`;
    case 'cost_reduction':
    case 'removal_cost_reduce': return `${upTo} ${n} — reduce its cost.`;
    default: return `${upTo} ${n} target.`;
  }
}

/** F-8D addendum — generic one-liner for a clause's cost shape. NEVER emits
 *  an internal cost key: every registered key has explicit wording and the
 *  fallback humanizes camelCase ("bottomOfDeckFromHand" → "bottom of deck
 *  from hand"), so prompt copy stays readable for unmapped future keys. */
function describeCost(cost: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(cost)) {
    if (k === 'bind') continue;
    const n = typeof v === 'number' ? v : 1;
    const cards = n === 1 ? 'card' : 'cards';
    switch (k) {
      case 'donCost': parts.push(`rest ${v} DON!!`); break;
      case 'donCostReturnToDeck': parts.push(`return ${v} DON!! to your DON!! deck`); break;
      case 'discardHand': parts.push(`trash ${n} ${cards} from your hand`); break;
      case 'trashFromHand': parts.push(`trash ${n} ${cards} from your hand`); break;
      case 'discardHandFilter': parts.push('trash a matching card from your hand'); break;
      case 'restSelf': parts.push('rest this card'); break;
      case 'restSource': parts.push('rest this card'); break;
      case 'restLeader': parts.push('rest your Leader'); break;
      case 'restLeaderOrStageFilter': parts.push('rest your Leader or Stage'); break;
      case 'trashSelf': parts.push('trash this card'); break;
      case 'returnSelfChar': parts.push("return this card to the owner's hand"); break;
      case 'returnOwnCharFilter': parts.push('return one of your Characters to hand'); break;
      case 'flipLife': parts.push(`turn ${n} Life ${cards} face-up`); break;
      case 'lifeToHand': parts.push(`add ${n} Life ${cards} to your hand`); break;
      case 'restOwnCharFilter': parts.push('rest your Character(s)'); break;
      case 'koSelfCharacter': parts.push('K.O. one of your Characters'); break;
      case 'bottomOfDeckSelf': parts.push('place this card at the bottom of your deck'); break;
      case 'bottomOfDeckFromHand': parts.push(`place ${n} ${cards} from your hand at the bottom of your deck`); break;
      case 'bottomOfDeckOwnChar': parts.push('place one of your Characters at the bottom of your deck'); break;
      case 'bottomOfDeckFromTrash': parts.push(`place ${n} ${cards} from your trash at the bottom of your deck`); break;
      case 'bottomOfDeckFromTrashFilter': parts.push('place a matching card from your trash at the bottom of your deck'); break;
      case 'trashFromTrash': parts.push(`place ${n} ${cards} from your trash at the bottom of your deck`); break;
      case 'revealHand': parts.push('reveal a card from your hand'); break;
      case 'millSelf': parts.push(`trash ${n} ${cards} from the top of your deck`); break;
      case 'selfPowerCost': parts.push(`give your Leader −${n} power this turn`); break;
      default:
        // Humanize unknown keys — never show raw camelCase identifiers.
        parts.push(k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase());
        break;
    }
  }
  return parts.join(' and ');
}

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
    // F-8D — clause-tail resumption: RESOLVE_TARGET_PICK / RESOLVE_SEARCHER_PEEK
    // re-enter here with the index AFTER the suspended clause so multi-clause
    // cards don't silently lose their later printed effects (115 cards have a
    // choice-target clause followed by same-trigger clauses). Absolute clause
    // indices are preserved so OPT keys stay stable.
    startIndex = 0,
    // F-8D addendum — internal: when the player ACCEPTED an effect offer for
    // clause `offerAcceptedIndex`, skip re-offering that clause on re-entry.
    // `chosenCostIds` carries player-picked COST payment cards (cost-picker
    // resume path); cost handlers consume them via ctx.chosenCostIds.
    opts?: {
      offerAcceptedIndex?: number;
      chosenCostIds?: Readonly<Record<string, ReadonlyArray<InstanceId>>>;
    },
  ): GameState {
    const inst = state.instances[ctx.sourceInstanceId];
    if (inst === undefined) return state;
    if (inst.effectsNegated === true) return state;

    const { clauses } = getSpecForInstance(state, inst);
    if (clauses.length === 0) return state;

    let working = state;
    for (let i = startIndex; i < clauses.length; i++) {
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
      const clauseCtx: HandlerCtx = { ...ctx, scratch, chosenCostIds: opts?.chosenCostIds };

      // (1) Condition
      if (!evaluateCondition(working, clauseCtx, clause.condition)) continue;

      // (1.5) F-8D addendum — OPTIONAL-COSTED clauses ("You may pay <cost>:
      // <effect>") ask BEFORE paying for human seats. activate_main is
      // exempt: activating was already the player's explicit choice.
      // Decline pays nothing. Unpayable costs skip silently (same outcome
      // as the canPay gate below). AI / sim / server keep V0 auto-pay.
      if (
        clause.cost !== undefined &&
        trigger !== 'activate_main' &&
        working.humanControllers?.includes(ctx.controller) === true &&
        (working.pending === null || working.pending.kind === 'trigger') &&
        opts?.offerAcceptedIndex !== i
      ) {
        let payable = true;
        for (const key of Object.keys(clause.cost)) {
          if (key === 'bind') continue;
          if (!costHandlers.get(key).canPay(working, clauseCtx, clause.cost)) {
            payable = false;
            break;
          }
        }
        if (!payable) continue;
        working.pending = {
          kind: 'effect_offer',
          pendingEffectOffer: {
            controller: ctx.controller,
            sourceInstanceId: ctx.sourceInstanceId,
            clause,
            clauseIndex: i,
            trigger,
            resumePhase: working.phase,
            costSummary: describeCost(clause.cost as Record<string, unknown>),
            effectSummary: clause.target !== undefined
              ? describeTargetChoice(clause)
              : clause.action.kind.replace(/_/g, ' '),
          },
        };
        working.phase = 'effect_offer';
        break;
      }

      // (2) Target
      let targets: ReadonlyArray<InstanceId> = [];
      let oppChoiceSuspended = false;
      if (clause.target !== undefined) {
        const resolver = targetResolvers.get(clause.target.kind);
        targets = resolver(working, clauseCtx, clause.target);
        // Empty target with required cardinality means clause cannot fire.
        if (targets.length === 0) {
          // F-7t stricter — owner direction: "If card no-ops because no
          // target: That is still a UX issue." Emit NO_VALID_TARGET so
          // the presentation layer can surface a beat. Engine semantics
          // unchanged (clause still skipped).
          (working.history as Array<unknown>).push({
            type: 'NO_VALID_TARGET',
            sourceInstanceId: ctx.sourceInstanceId,
            actionKind: clause.action.kind,
            trigger,
            clauseIndex: i,
          });
          continue;
        }
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
        // (3.5) F-8D — player-choice COST payments. When a cost key pays
        // with cards the player chooses (discard/bottom-deck from hand,
        // rest/return own characters, ...) and the controller is a human
        // seat, suspend into the generic picker BEFORE paying anything.
        // Resolution re-enters this clause with opts.chosenCostIds; the
        // pay loop below then consumes the picks via ctx.chosenCostIds.
        // No-choice situations (candidates exactly equal the required
        // count) and AI / sim / server keep the V0 deterministic payment.
        if (
          working.humanControllers?.includes(ctx.controller) === true &&
          (working.pending === null || working.pending.kind === 'trigger')
        ) {
          const choice = nextCostChoiceKey(working, clauseCtx, clause.cost, opts?.chosenCostIds);
          if (choice !== null) {
            working.pending = {
              kind: 'attack_target_pick',
              pendingTargetPick: {
                controller: ctx.controller,
                sourceInstanceId: ctx.sourceInstanceId,
                candidateIds: choice.spec.candidateIds,
                resumePhase: working.phase,
                clause,
                clauseIndex: i,
                trigger,
                pickLimit: choice.spec.count,
                mayChooseNone: false,
                exactCount: true,
                filterSummary: choice.spec.summary,
                paidCost: false,
                optKey: clause.opt === true ? makeOptKey('opt', trigger, i) : undefined,
                costPick: {
                  costKey: choice.key,
                  chosen: opts?.chosenCostIds ?? {},
                  offerAccepted: opts?.offerAcceptedIndex === i,
                },
              },
            };
            working.phase = 'attack_target_pick';
            working = attachScratchToPending(working, scratch);
            break;
          }
        }
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

      // (4.5) F-8D — generic HUMAN target picker. For choice-kind targets
      // on a human-controlled seat, suspend into attack_target_pick with
      // the full clause continuation instead of using the V0 deterministic
      // auto-pick. The cost (step 3/4) is ALREADY PAID — CR pay-then-
      // resolve — so RESOLVE_TARGET_PICK only runs action + history + OPT.
      // Eligibility mirrors the F-8B searcher gate:
      //   - opt-in via state.humanControllers (sim/server/AI unchanged)
      //   - ambient pending must be null or the trigger window (suspending
      //     inside an attack window would destroy pendingAttack)
      //   - oppSelect targets keep their dedicated suspension above
      if (
        clause.target !== undefined &&
        TARGET_CHOICE_KINDS.has(clause.target.kind) &&
        (clause.target as { oppSelect?: unknown }).oppSelect !== true &&
        working.humanControllers?.includes(ctx.controller) === true &&
        (working.pending === null || working.pending.kind === 'trigger')
      ) {
        const resolver = targetResolvers.get(clause.target.kind);
        const wide = resolver(working, clauseCtx, { ...clause.target, count: 99 } as typeof clause.target);
        if (wide.length > 0) {
          working.pending = {
            kind: 'attack_target_pick',
            pendingTargetPick: {
              controller: ctx.controller,
              sourceInstanceId: ctx.sourceInstanceId,
              candidateIds: wide,
              resumePhase: working.phase,
              clause,
              clauseIndex: i,
              trigger,
              pickLimit: typeof (clause.target as { count?: unknown }).count === 'number'
                ? ((clause.target as { count?: number }).count as number)
                : 1,
              // Derived: honored `target.mandatory` flag (future data
              // passes mark exact-count prints); default optional — the
              // corpus overwhelmingly prints "up to".
              mayChooseNone: (clause.target as { mandatory?: unknown }).mandatory !== true,
              filterSummary: describeTargetChoice(clause),
              paidCost: clause.cost !== undefined,
              optKey: clause.opt === true ? makeOptKey('opt', trigger, i) : undefined,
            },
          };
          working.phase = 'attack_target_pick';
          working = attachScratchToPending(working, scratch);
          break;
        }
        // No candidates at all → same NO_VALID_TARGET semantics as step (2).
        (working.history as Array<unknown>).push({
          type: 'NO_VALID_TARGET',
          sourceInstanceId: ctx.sourceInstanceId,
          actionKind: clause.action.kind,
          trigger,
          clauseIndex: i,
        });
        continue;
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
      // subsequent clauses must NOT fire on the un-resumed state. Move
      // the ClauseScratch onto the inner pending payload so RESOLVE_*
      // can restore it. Then break — let the host resume via the pending
      // decision.
      //
      // AMBIENT pending kinds (set by an outer reducer BEFORE clauses
      // dispatch, NOT by any clause action) must be excluded from the
      // break check, otherwise they silently drop clause[1+] on
      // multi-clause cards:
      //   - `pending.kind === 'attack'` is the counter-window ambient
      //     state set by enterCounterWindow / playCounterReducer.
      //     Surfaced via OP14-078 cost-PAID + leader-MATCH observing
      //     2000 instead of printed 4000.
      //   - `pending.kind === 'trigger'` is the trigger-window ambient
      //     state set by attackFlow.ts:485 during flipTopLifeToHand,
      //     and persists across RESOLVE_TRIGGER's EffectDispatcher.dispatch
      //     call (cleared only at choiceResolve.ts:72 AFTER dispatch
      //     returns). Surfaced via OP05-109 Pagaya — multi-clause
      //     trigger (draw + mill_self) silently dropped clause[1]
      //     mill_self because the dispatcher mistook the outer ambient
      //     pending=trigger for a clause-induced suspend.
      //
      // Interactive pending kinds (peek, choose_one, discard,
      // attack_target_pick) ARE legitimate clause-induced suspends and
      // STILL stop iteration via this check.
      if (
        working.pending !== null &&
        working.pending.kind !== 'attack' &&
        working.pending.kind !== 'trigger'
      ) {
        working = attachScratchToPending(working, scratch);
        break;
      }
    }

    return working;
  },
} as const;
