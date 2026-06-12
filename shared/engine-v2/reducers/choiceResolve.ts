/**
 * Engine V2 — choice-resolution reducers.
 *
 * Each RESOLVE_* action consumes a `PendingState` of the matching kind,
 * restores `state.phase` to `pending.resumePhase`, and clears `state.pending`.
 *
 * Per-kind reducers:
 *   - RESOLVE_TRIGGER         → fire the life card's `trigger` clause if
 *                                action.activate; restore phase
 *   - RESOLVE_PEEK            → keep `action.pickedIds`; rest returns to top
 *                                of deck in original peek order
 *   - RESOLVE_DISCARD         → move `action.pickedId` from the relevant
 *                                hand (opp or self) → trash
 *   - RESOLVE_CHOOSE_ONE      → fire chosen sub-action via actionHandlers
 *   - RESOLVE_TARGET_PICK     → TODO (requires per-action continuation
 *                                context not yet persisted)
 *
 * Cross-references:
 * - Implementation spec §11.2
 * - Plan v2 §1.3 (decision dispatch table)
 */

import { CostPayer } from '../effects/CostPayer.js';
import { EffectDispatcher, evaluateCondition } from '../effects/EffectDispatcher.js';
import { safeProcessSimEvent } from '../../sim/integrate.js';
import { finalizeEndTurn } from '../phases/PhaseScheduler.js';
import { PhaseScheduler } from '../phases/PhaseScheduler.js';
import type {
  ActionResolveChooseOne,
  ActionResolveDiscard,
  ActionResolveEffectOffer,
  ActionResolvePeek,
  ActionResolveSearcherPeek,
  ActionResolveTargetPick,
  ActionResolveTrigger,
} from '../protocol/actions.js';
import { writeBinding } from '../effects/clauseScratch.js';
import { finishSearcherPeek } from '../registry/handlers/actions3.js';
import { actionHandlers, targetResolvers } from '../registry/types.js';
import { makeOptKey, markOptUsed } from '../state/derived/opt.js';
import type { EffectClauseV2 } from '../spec/types.js';
import { OTHER_PLAYER, type GameState, type InstanceId, type PlayerId } from '../state/types.js';
import { continueLeaderDamage } from './attackFlow.js';
import { registerActionReducer } from './registry.js';

// ─── RESOLVE_TRIGGER
function resolveTriggerReducer(
  state: GameState,
  action: ActionResolveTrigger,
  player: PlayerId,
): GameState {
  if (state.pending === null || state.pending.kind !== 'trigger') return state;
  const pt = state.pending.pendingTrigger;
  if (pt.controller !== player) return state;

  let next = state;
  if (action.activate === true) {
    // Fire the life card's `trigger` clause. Thread ClauseScratch from
    // the pending payload so cross-step bindings written before the
    // pending-suspension are restored.
    next = EffectDispatcher.dispatch(next, {
      sourceInstanceId: pt.lifeCardInstanceId,
      controller: pt.controller,
      scratch: pt.scratch,
    }, 'trigger');
    next = safeProcessSimEvent(next, { sourceInstanceId: pt.lifeCardInstanceId, controller: pt.controller }, 'trigger');
  }

  (next.history as Array<unknown>).push({
    type: 'TRIGGER_RESOLVED',
    instanceId: pt.lifeCardInstanceId,
    activated: action.activate,
  });

  // F-8B — the trigger's effect itself may suspend into a clause-induced
  // choice window (e.g. a [Trigger] that activates a Main searcher_peek for
  // a human seat). Do NOT clobber that pending with the completion block
  // below — rewrite its resumePhase to the trigger's own resume target so
  // the choice resolver lands the game in the right phase, then yield.
  // Limitation (documented): if remainingLifeFlips > 0 AND the trigger
  // effect suspended, the owed Double-Attack flips take precedence and the
  // suspension is dropped (pre-F-8B behavior); no current card combines
  // a multi-flip attack with a suspending trigger in one window.
  if (
    next.pending !== null &&
    next.pending.kind === 'searcher_peek' &&
    (pt.remainingLifeFlips ?? 0) === 0
  ) {
    next.pending = {
      kind: 'searcher_peek',
      pendingSearcherPeek: {
        ...next.pending.pendingSearcherPeek,
        resumePhase: pt.resumePhase,
      },
    };
    return next;
  }
  // F-8D — same handoff for trigger effects that suspended into the
  // generic target picker.
  if (
    next.pending !== null &&
    next.pending.kind === 'attack_target_pick' &&
    (pt.remainingLifeFlips ?? 0) === 0
  ) {
    next.pending = {
      kind: 'attack_target_pick',
      pendingTargetPick: {
        ...next.pending.pendingTargetPick,
        resumePhase: pt.resumePhase,
      },
    };
    return next;
  }

  // F8A-F3 [Double Attack] (CR §10-1-2): if this trigger window interrupted
  // a multi-flip damage procedure, continue the remaining flips. Remaining
  // flips are always non-banish — banished damage never opens a trigger
  // window in the first place (CR §10-1-3).
  const remaining = pt.remainingLifeFlips ?? 0;
  if (remaining > 0 && next.result === null) {
    next = continueLeaderDamage(next, pt.controller, remaining, false);
    // Suspended again on another trigger window — leave the new pending in
    // place for the next RESOLVE_TRIGGER (battle modifiers stay until the
    // procedure fully completes, mirroring the first suspension).
    if (
      next.pending !== null &&
      next.pending.kind === 'trigger' &&
      next.pending.pendingTrigger !== pt
    ) {
      return next;
    }
  }

  // Wipe this-battle power modifiers (attack chain ends here).
  for (const side of ['A', 'B'] as PlayerId[]) {
    const pl = next.players[side];
    pl.leader.powerModifierThisBattle = undefined;
    for (const inst of pl.field) inst.powerModifierThisBattle = undefined;
    if (pl.stage !== null) pl.stage.powerModifierThisBattle = undefined;
  }

  if (next.result === null) {
    next.phase = pt.resumePhase;
  }
  next.pending = null;
  return next;
}

// ─── RESOLVE_EFFECT_OFFER (F-8D addendum)
function resolveEffectOfferReducer(
  state: GameState,
  action: ActionResolveEffectOffer,
  player: PlayerId,
): GameState {
  if (state.pending === null || state.pending.kind !== 'effect_offer') return state;
  const po = state.pending.pendingEffectOffer;
  if (po.controller !== player) return state;

  let next: GameState = state;
  next.pending = null;
  next.phase = po.resumePhase;

  if (action.accept !== true) {
    // Declined — NOTHING was paid. Record + run the card's remaining
    // same-trigger clauses (the offer break would otherwise drop them).
    (next.history as Array<unknown>).push({
      type: 'EFFECT_DECLINED',
      sourceInstanceId: po.sourceInstanceId,
      controller: po.controller,
      trigger: po.trigger,
      clauseIndex: po.clauseIndex,
    });
    return EffectDispatcher.dispatch(
      next,
      { sourceInstanceId: po.sourceInstanceId, controller: po.controller },
      po.trigger,
      po.clauseIndex + 1,
    );
  }

  // Accepted — re-enter the clause pipeline AT this clause with the offer
  // marked answered: target resolution → cost payment → action → tail.
  // Any further suspension (target picker / searcher) captures the correct
  // resumePhase because we restored it above.
  next = EffectDispatcher.dispatch(
    next,
    { sourceInstanceId: po.sourceInstanceId, controller: po.controller },
    po.trigger,
    po.clauseIndex,
    { offerAcceptedIndex: po.clauseIndex },
  );
  return next;
}

// ─── RESOLVE_SEARCHER_PEEK (F-8B)
function resolveSearcherPeekReducer(
  state: GameState,
  action: ActionResolveSearcherPeek,
  player: PlayerId,
): GameState {
  if (state.pending === null || state.pending.kind !== 'searcher_peek') return state;
  const sp = state.pending.pendingSearcherPeek;
  if (sp.controller !== player) return state;

  // Validation — reject (state unchanged) on any malformed resolution:
  const lookedAt = new Set(sp.lookedAtInstanceIds);
  const valid = new Set(sp.validPickInstanceIds);
  const picked = action.pickedInstanceIds;
  if (picked.length > sp.pickLimit) return state;
  if (picked.length === 0 && !sp.mayChooseNone) return state;
  if (new Set(picked).size !== picked.length) return state; // duplicates
  for (const id of picked) {
    if (!lookedAt.has(id)) return state; // outside the looked-at set
    if (!valid.has(id)) return state; // fails the printed filter
  }

  // Leftover order: explicit order must be an exact permutation of
  // lookedAt − picked; otherwise default to original looked-at order.
  const pickedSet = new Set(picked);
  const defaultLeftover = sp.lookedAtInstanceIds.filter((id) => !pickedSet.has(id));
  let leftover: ReadonlyArray<InstanceId> = defaultLeftover;
  if (action.bottomOrderInstanceIds !== undefined) {
    const order = action.bottomOrderInstanceIds;
    const orderSet = new Set(order);
    const isPermutation =
      order.length === defaultLeftover.length &&
      orderSet.size === order.length &&
      defaultLeftover.every((id) => orderSet.has(id));
    if (!isPermutation) return state;
    leftover = order;
  }

  const next = finishSearcherPeek(state, sp.controller, sp.sourceInstanceId, {
    peekedIds: sp.lookedAtInstanceIds,
    pickedIds: picked,
    leftoverIds: leftover,
    playInsteadOfHand: sp.playInsteadOfHand,
    rested: sp.rested,
    placement: sp.placement,
  });
  // finishSearcherPeek may have dispatched on_play for played characters; a
  // nested suspend there would have replaced pending — only clear if the
  // searcher pending is still ours.
  if (next.pending !== null && next.pending.kind === 'searcher_peek') {
    next.pending = null;
    next.phase = sp.resumePhase;
  } else if (next.pending === null) {
    next.phase = sp.resumePhase;
  }
  return next;
}

// ─── RESOLVE_PEEK
function resolvePeekReducer(
  state: GameState,
  action: ActionResolvePeek,
  player: PlayerId,
): GameState {
  if (state.pending === null || state.pending.kind !== 'peek') return state;
  const pp = state.pending.pendingPeek;
  if (pp.controller !== player) return state;
  // Validate picked count
  if (action.pickedIds.length > pp.addCount) return state;
  for (const id of action.pickedIds) {
    if (!pp.peekedIds.includes(id)) return state;
  }

  const pl = state.players[pp.controller];

  // Move picked → hand
  for (const id of action.pickedIds) pl.hand.push(id);

  // Remaining peekedIds (not picked) return to TOP of deck in original order.
  const remaining = pp.peekedIds.filter((id) => !action.pickedIds.includes(id));
  // The peek pulled cards off the top in array order; put remaining back on
  // top in the SAME order so a subsequent peek sees them in the same sequence.
  for (let i = remaining.length - 1; i >= 0; i--) {
    pl.deck.unshift(remaining[i]!);
  }

  state.phase = pp.resumePhase;
  state.pending = null;
  (state.history as Array<unknown>).push({
    type: 'PEEK_RESOLVED',
    pickedIds: action.pickedIds,
    returnedIds: remaining,
  });
  return state;
}

// ─── RESOLVE_DISCARD
function resolveDiscardReducer(
  state: GameState,
  action: ActionResolveDiscard,
  player: PlayerId,
): GameState {
  if (state.pending === null || state.pending.kind !== 'discard') return state;
  const pd = state.pending.pendingDiscard;
  // Acting player varies by revealedFrom:
  //   self_hand: pd.controller must equal `player`
  //   opp_hand: pd.controller's OPPONENT discards their own card (i.e., the
  //             player picking is pd.controller's opponent — but per V1
  //             semantics, the source effect's controller picks; defer to pd.controller)
  if (pd.controller !== player) return state;

  // Locate the target hand based on revealedFrom.
  const targetSide: PlayerId =
    pd.revealedFrom === 'self_hand'
      ? pd.controller
      // For opp_hand: the discarded card is in opp's hand
      : (pd.controller === 'A' ? 'B' : 'A');
  const targetPl = state.players[targetSide];

  if (action.pickedId === null) {
    // No valid discard; just resume.
    state.phase = pd.resumePhase;
    state.pending = null;
    return state;
  }
  const idx = targetPl.hand.indexOf(action.pickedId);
  if (idx === -1) return state;

  targetPl.hand.splice(idx, 1);
  targetPl.trash.push(action.pickedId);

  (state.history as Array<unknown>).push({
    type: 'CARD_DISCARDED',
    instanceId: action.pickedId,
    fromSide: targetSide,
    reason: pd.revealedFrom,
  });

  // F-7k BUG-008.A — CR §6-5-7 requires discarding DOWN TO 10 at end of turn.
  // Engine sets `pendingDiscard.count = excess` when opening the window
  // (`shared/engine-v2/phases/PhaseScheduler.ts:336-346`). The reducer must
  // decrement on each click and KEEP the window open until count === 0;
  // otherwise a player with hand=12 can satisfy the limit by discarding
  // only 1 card. Pre-fix: window closed after a single discard regardless
  // of count.
  if (pd.count > 1) {
    state.pending = {
      kind: 'discard',
      pendingDiscard: { ...pd, count: pd.count - 1 },
    };
    return state;
  }

  state.phase = pd.resumePhase;
  state.pending = null;

  // CR-3 audit fix: if the discard was triggered by hand-size limit at end of
  // turn (revealedFrom === 'self_hand' AND resumePhase === 'end'), the
  // pass-turn block in PhaseScheduler.enterEnd was skipped. Finalize now and
  // chain into the next player's turn.
  if (pd.revealedFrom === 'self_hand' && pd.resumePhase === 'end') {
    const ap = pd.controller;
    const opp = OTHER_PLAYER[ap];
    let next = finalizeEndTurn(state, ap, opp);
    if (next.result !== null) return next;
    next = PhaseScheduler.enterRefresh(next);
    if (next.result !== null) return next;
    next = PhaseScheduler.enterDraw(next);
    if (next.result !== null) return next;
    next = PhaseScheduler.enterDon(next);
    if (next.result !== null) return next;
    return PhaseScheduler.enterMain(next);
  }
  return state;
}

// ─── RESOLVE_CHOOSE_ONE
function resolveChooseOneReducer(
  state: GameState,
  action: ActionResolveChooseOne,
  player: PlayerId,
): GameState {
  if (state.pending === null || state.pending.kind !== 'choose_one') return state;
  const pc = state.pending.pendingChoose;
  if (pc.controller !== player) return state;
  if (action.optionIndex < 0 || action.optionIndex >= pc.options.length) return state;

  const clause = pc.options[action.optionIndex] as EffectClauseV2;

  // Reconstitute ctx with ClauseScratch from the pending payload so
  // option-clause execution can read bindings written before the
  // choose-one suspension.
  const ctx = {
    sourceInstanceId: pc.sourceInstanceId,
    controller: pc.controller,
    scratch: pc.scratch,
  };

  let next = state;

  // Evaluate the option's own condition before firing (EB02-045 second
  // option gates on if_opp_hand_min:5).
  if (clause.condition !== undefined && !evaluateCondition(next, ctx, clause.condition)) {
    // Condition failed — skip the action but still resume + clear.
    next.phase = pc.resumePhase;
    next.pending = null;
    (next.history as Array<unknown>).push({
      type: 'CHOICE_RESOLVED',
      sourceInstanceId: pc.sourceInstanceId,
      optionIndex: action.optionIndex,
      conditionFailed: true,
    });
    return next;
  }

  // Pay the option's own cost if present (2 cards: OP03-028, OP15-054).
  // Atomicity: snapshot before pay; restore on failure.
  if (clause.cost !== undefined) {
    if (!CostPayer.canPay(next, ctx, clause.cost)) {
      next.phase = pc.resumePhase;
      next.pending = null;
      (next.history as Array<unknown>).push({
        type: 'CHOICE_RESOLVED',
        sourceInstanceId: pc.sourceInstanceId,
        optionIndex: action.optionIndex,
        costUnpayable: true,
      });
      return next;
    }
    const paid = CostPayer.pay(next, ctx, clause.cost);
    if (paid === null) {
      next.phase = pc.resumePhase;
      next.pending = null;
      return next;
    }
    next = paid;
  }

  // Resolve the option's own target list. If the option's action carries
  // `_preBoundTargets` (P-LIFE-POSITION / P-OPP-FORCED-ACTION), use those
  // directly instead of re-resolving — preserves the candidate already
  // selected when the parent clause suspended.
  let targets: ReadonlyArray<InstanceId> = [];
  const preBound = (clause.action as { _preBoundTargets?: unknown })._preBoundTargets;
  if (Array.isArray(preBound)) {
    targets = preBound as ReadonlyArray<InstanceId>;
  } else if (clause.target !== undefined && targetResolvers.has(clause.target.kind)) {
    targets = targetResolvers.get(clause.target.kind)(next, ctx, clause.target);
  }

  if (actionHandlers.has(clause.action.kind)) {
    const handler = actionHandlers.get(clause.action.kind);
    next = handler(next, ctx, clause.action, targets);
  }

  next.phase = pc.resumePhase;
  next.pending = null;
  (next.history as Array<unknown>).push({
    type: 'CHOICE_RESOLVED',
    sourceInstanceId: pc.sourceInstanceId,
    optionIndex: action.optionIndex,
  });
  return next;
}

// ─── RESOLVE_TARGET_PICK (stub)
function resolveTargetPickReducer(
  state: GameState,
  action: ActionResolveTargetPick,
  player: PlayerId,
): GameState {
  if (state.pending === null || state.pending.kind !== 'attack_target_pick') return state;
  const pt = state.pending.pendingTargetPick;
  if (pt.controller !== player) return state;

  // Normalise picks: pickedIds wins; pickedId null = choose none.
  const picked: ReadonlyArray<InstanceId> =
    action.pickedIds !== undefined
      ? action.pickedIds
      : action.pickedId === null
        ? []
        : [action.pickedId];

  // Validation — reject (state unchanged) on malformed resolutions.
  const limit = pt.pickLimit ?? 1;
  if (picked.length > limit) return state;
  if (picked.length === 0 && pt.mayChooseNone !== true) return state;
  // Exact-count picks ("place 1 card") reject partials too — the player
  // must select exactly pickLimit cards; there is no skip at this stage
  // (declining happened at the effect_offer, if the clause was optional).
  if (pt.exactCount === true && picked.length !== limit) return state;
  if (new Set(picked).size !== picked.length) return state;
  for (const id of picked) {
    if (!pt.candidateIds.includes(id)) return state;
  }

  // F-8D — COST-PAYMENT pick: the suspension happened BEFORE the clause's
  // cost was paid (dispatcher step 3.5). Re-enter the dispatcher AT this
  // clause with the picks recorded under the cost key; the pay loop then
  // consumes them via ctx.chosenCostIds (handlers fall back to V0 head-pick
  // only when no picks are present, i.e. AI / sim / server).
  if (pt.costPick !== undefined && pt.trigger !== undefined && pt.clauseIndex !== undefined) {
    const next: GameState = state;
    next.pending = null;
    next.phase = pt.resumePhase;
    (next.history as Array<unknown>).push({
      type: 'COST_PICKED',
      sourceInstanceId: pt.sourceInstanceId,
      controller: pt.controller,
      costKey: pt.costPick.costKey,
      pickedIds: picked,
      trigger: pt.trigger,
      clauseIndex: pt.clauseIndex,
    });
    return EffectDispatcher.dispatch(
      next,
      { sourceInstanceId: pt.sourceInstanceId, controller: pt.controller },
      pt.trigger,
      pt.clauseIndex,
      {
        offerAcceptedIndex: pt.costPick.offerAccepted ? pt.clauseIndex : undefined,
        chosenCostIds: { ...pt.costPick.chosen, [pt.costPick.costKey]: picked },
      },
    );
  }

  // F-8D continuation (plan-gap A7 closed): run the suspended clause's
  // action on the picked targets. Cost was paid BEFORE suspension
  // (dispatcher step 3/4) — zero picks still consume the effect (and its
  // OPT) per CR pay-then-resolve.
  let next: GameState = state;
  if (pt.clause !== undefined) {
    const ctx = {
      sourceInstanceId: pt.sourceInstanceId,
      controller: pt.controller,
      scratch: pt.scratch,
    };
    if (picked.length > 0) {
      const tBind = (pt.clause.target as { bind?: unknown } | undefined)?.bind;
      if (typeof tBind === 'string' && tBind !== '' && pt.scratch !== undefined && picked[0] !== undefined) {
        writeBinding(next, pt.scratch, tBind, picked[0]);
      }
      const handler = actionHandlers.get(pt.clause.action.kind);
      next = handler(next, ctx, pt.clause.action, picked);
      (next.history as Array<unknown>).push({
        type: 'CLAUSE_FIRED',
        sourceInstanceId: pt.sourceInstanceId,
        controller: pt.controller,
        trigger: pt.trigger,
        clauseIndex: pt.clauseIndex,
        actionKind: pt.clause.action.kind,
      });
    }
    if (pt.clause.opt === true) {
      const inst = next.instances[pt.sourceInstanceId];
      const optKey = pt.optKey ??
        (pt.trigger !== undefined && pt.clauseIndex !== undefined
          ? makeOptKey('opt', pt.trigger, pt.clauseIndex)
          : undefined);
      if (inst !== undefined && optKey !== undefined) {
        markOptUsed(inst, optKey);
      }
    }
  }

  (next.history as Array<unknown>).push({
    type: 'TARGET_PICKED',
    sourceInstanceId: pt.sourceInstanceId,
    controller: pt.controller,
    pickedId: picked[0],
    pickedIds: picked,
    choseNone: picked.length === 0,
    actionKind: pt.clause?.action.kind,
  });

  // Restore phase + clear OUR pending FIRST (so any tail suspension below
  // captures the correct resumePhase) — unless the action itself suspended
  // into a different window, which then owns the phase.
  if (next.pending !== null && next.pending.kind === 'attack_target_pick') {
    next.pending = null;
    next.phase = pt.resumePhase;
  } else if (next.pending === null) {
    next.phase = pt.resumePhase;
  }

  // F-8D — clause-tail resumption: run the card's REMAINING same-trigger
  // clauses (the dispatcher break at suspension would otherwise silently
  // drop them — 115 corpus cards put more clauses after a choice-target
  // clause). The tail may itself suspend into another picker/searcher;
  // that new pending stands on its own.
  if (
    pt.clause !== undefined &&
    pt.trigger !== undefined &&
    pt.clauseIndex !== undefined &&
    next.pending === null
  ) {
    next = EffectDispatcher.dispatch(
      next,
      { sourceInstanceId: pt.sourceInstanceId, controller: pt.controller },
      pt.trigger,
      pt.clauseIndex + 1,
    );
  }
  return next;
}

export function registerChoiceResolveReducers(): void {
  registerActionReducer('RESOLVE_TRIGGER', resolveTriggerReducer);
  registerActionReducer('RESOLVE_PEEK', resolvePeekReducer);
  registerActionReducer('RESOLVE_DISCARD', resolveDiscardReducer);
  registerActionReducer('RESOLVE_CHOOSE_ONE', resolveChooseOneReducer);
  registerActionReducer('RESOLVE_TARGET_PICK', resolveTargetPickReducer);
  registerActionReducer('RESOLVE_SEARCHER_PEEK', resolveSearcherPeekReducer);
  registerActionReducer('RESOLVE_EFFECT_OFFER', resolveEffectOfferReducer);
}
