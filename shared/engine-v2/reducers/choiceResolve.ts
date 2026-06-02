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

import { EffectDispatcher } from '../effects/EffectDispatcher.js';
import { finalizeEndTurn } from '../phases/PhaseScheduler.js';
import { PhaseScheduler } from '../phases/PhaseScheduler.js';
import type {
  ActionResolveChooseOne,
  ActionResolveDiscard,
  ActionResolvePeek,
  ActionResolveTargetPick,
  ActionResolveTrigger,
} from '../protocol/actions.js';
import { actionHandlers } from '../registry/types.js';
import type { EffectClauseV2 } from '../spec/types.js';
import { OTHER_PLAYER, type GameState, type PlayerId } from '../state/types.js';
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
    // Fire the life card's `trigger` clause.
    next = EffectDispatcher.dispatch(next, {
      sourceInstanceId: pt.lifeCardInstanceId,
      controller: pt.controller,
    }, 'trigger');
  }

  // Wipe this-battle power modifiers (attack chain ends here).
  for (const side of ['A', 'B'] as PlayerId[]) {
    const pl = next.players[side];
    pl.leader.powerModifierThisBattle = undefined;
    for (const inst of pl.field) inst.powerModifierThisBattle = undefined;
    if (pl.stage !== null) pl.stage.powerModifierThisBattle = undefined;
  }

  next.phase = pt.resumePhase;
  next.pending = null;
  (next.history as Array<unknown>).push({
    type: 'TRIGGER_RESOLVED',
    instanceId: pt.lifeCardInstanceId,
    activated: action.activate,
  });
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

  const ctx = {
    sourceInstanceId: pc.sourceInstanceId,
    controller: pc.controller,
  };

  // Fire the chosen action directly (skip the per-clause condition+cost+OPT
  // bookkeeping — the parent dispatch already cleared those).
  let next = state;
  if (actionHandlers.has(clause.action.kind)) {
    const handler = actionHandlers.get(clause.action.kind);
    next = handler(next, ctx, clause.action, []);
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
  if (!pt.candidateIds.includes(action.pickedId)) return state;

  // TODO: per-action continuation context not yet persisted; the picked
  // target gets handed back to the calling action handler via a deferred
  // queue (Phase 3 work). For now, just restore phase + clear pending.
  state.phase = pt.resumePhase;
  state.pending = null;
  (state.history as Array<unknown>).push({
    type: 'TARGET_PICKED',
    sourceInstanceId: pt.sourceInstanceId,
    pickedId: action.pickedId,
  });
  return state;
}

export function registerChoiceResolveReducers(): void {
  registerActionReducer('RESOLVE_TRIGGER', resolveTriggerReducer);
  registerActionReducer('RESOLVE_PEEK', resolvePeekReducer);
  registerActionReducer('RESOLVE_DISCARD', resolveDiscardReducer);
  registerActionReducer('RESOLVE_CHOOSE_ONE', resolveChooseOneReducer);
  registerActionReducer('RESOLVE_TARGET_PICK', resolveTargetPickReducer);
}
