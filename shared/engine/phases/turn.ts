// Per-turn phase transitions. Source: rules-reference.md §1.4.
//
// Order: Refresh → Draw → DON → Main → (attacks fold into main) → End.

import type { GameState, PlayerId } from '../GameState';
import { RULES } from '../GameState';
import { publishTrigger } from '../effectSpec/triggerBus-v2';
import { applyActionV2, evaluateConditionV2, resolveTargetV2 } from '../effectSpec/runner-v2';
import type { EffectClauseV2, EffectTriggerV2 } from '../effectSpec/types-v2';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

/** Walk `controller`'s field+leader+stage and fire any effectSpecV2 clauses
 *  whose trigger matches. Used at phase boundaries to honor
 *  `at_end_of_turn_self` etc. on cards already in play. */
function broadcastTriggerToOwnField(
  state: GameState,
  trigger: EffectTriggerV2,
  controller: PlayerId,
): GameState {
  const pl = state.players[controller];
  const candidates = [pl.leader, ...pl.field, ...(pl.stage ? [pl.stage] : [])];
  for (const inst of candidates) {
    const card = state.cardLibrary[inst.cardId] as
      | { effectSpecV2?: { clauses?: EffectClauseV2[] } } | undefined;
    const clauses = card?.effectSpecV2?.clauses ?? [];
    for (const clause of clauses) {
      if (clause.trigger !== trigger) continue;
      if (clause.condition && !evaluateConditionV2(state, controller, clause.condition, inst.instanceId)) continue;
      const targets = resolveTargetV2(state, controller, inst.instanceId, clause.target);
      state = applyActionV2(state, { sourceInstanceId: inst.instanceId, controller }, clause.action, targets);
    }
  }
  return state;
}

/** Active player un-rests their leader, characters, and all DON.
 *
 *  D5 fix (CR §6-2-3): Before the rested→active flip, detach all DON attached
 *  to the active player's leader / characters / stage and move them to the
 *  rested pool. Per CR §6-2-3 attached DON stays attached until the START of
 *  the controller's NEXT Refresh, then enters the cost area as RESTED; the
 *  subsequent §6-2-4 active-flip then turns them face-up alongside the rest
 *  of the rested DON. Previously this was done at end-of-own-turn, which
 *  caused the opponent to visually see the leader without its attached DON
 *  during their turn — a visible (not cosmetic) divergence. */
export function runRefreshPhase(state: GameState): GameState {
  const next: GameState = structuredClone(state);
  const p = next.players[next.activePlayer];
  // A.3.9: opp's view of "their refresh starting" — publish at_opp_refresh
  // to the v2 bus. No subscribers in V0.
  publishTrigger('at_opp_refresh', next, { refreshingPlayer: next.activePlayer });

  // D5 (CR §6-2-3): detach attached DON BEFORE the rest→active flip so the
  // returning DON itself comes back active this Refresh (consistent with §6-2-4
  // setting "all rested cards" in the player's areas to active).
  for (const inst of p.field) {
    while (inst.attachedDon.length > 0) {
      p.donRested.push(inst.attachedDon.shift()!);
    }
  }
  while (p.leader.attachedDon.length > 0) {
    p.donRested.push(p.leader.attachedDon.shift()!);
  }
  if (p.stage) {
    while (p.stage.attachedDon.length > 0) {
      p.donRested.push(p.stage.attachedDon.shift()!);
    }
  }

  p.leader.rested = false;
  for (const inst of p.field) {
    inst.rested = false;
    inst.summoningSick = false; // Can attack starting this turn.
  }
  // D1 (CR §3-8): Stage also lives in Leader/Char/Stage area for refresh purposes
  //               (CR §6-2-4 sets all rested cards in those areas to active).
  if (p.stage) {
    p.stage.rested = false;
  }
  // All rested DON returns to active pool (donCostArea).
  while (p.donRested.length > 0) {
    p.donCostArea.push(p.donRested.shift()!);
  }

  next.phase = 'draw';
  next.history.push({ type: 'PHASE_CHANGED', phase: 'draw' });
  return next;
}

/** Active player draws 1. First player skips on turn 1 (rules-reference.md §1.4 / CR §6-3-1).
 *  "First player" is whoever was declared first via CHOOSE_FIRST/CHOOSE_SECOND,
 *  not always A — see GameState.firstPlayer. If firstPlayer is null (legacy
 *  test paths that bypass the dice-roll window), no skip is applied. */
export function runDrawPhase(state: GameState): GameState {
  const next: GameState = structuredClone(state);
  const p = next.players[next.activePlayer];

  const isFirstPlayerFirstTurn =
    next.turn === 1 &&
    next.firstPlayer !== null &&
    next.activePlayer === next.firstPlayer;
  if (!isFirstPlayerFirstTurn) {
    if (p.deck.length === 0) {
      next.result = { winner: OTHER[next.activePlayer], reason: 'deck_out' };
      next.history.push({ type: 'GAME_ENDED', result: next.result });
      return next;
    }
    const drawn = p.deck.shift()!;
    p.hand.push(drawn);
    next.history.push({ type: 'CARD_DRAWN', player: next.activePlayer, instanceId: drawn });
  }

  next.phase = 'don';
  next.history.push({ type: 'PHASE_CHANGED', phase: 'don' });
  return next;
}

/** Active player adds DON. 1 on first player's first turn (CR §6-4-1), 2
 *  otherwise (CR §6-4-2). "First player" follows GameState.firstPlayer, not a
 *  hardcoded A. If firstPlayer is null (legacy test paths), default to 2. */
export function runDonPhase(state: GameState): GameState {
  const next: GameState = structuredClone(state);
  const p = next.players[next.activePlayer];

  const isFirstPlayerFirstTurn =
    next.turn === 1 &&
    next.firstPlayer !== null &&
    next.activePlayer === next.firstPlayer;
  const count = isFirstPlayerFirstTurn ? RULES.DON_PER_TURN_FIRST : RULES.DON_PER_TURN_AFTER_FIRST;
  const dealt = Math.min(count, p.donDeck.length);
  for (let i = 0; i < dealt; i++) {
    p.donCostArea.push(p.donDeck.shift()!);
  }
  if (dealt > 0) {
    next.history.push({ type: 'DON_DEALT', player: next.activePlayer, count: dealt });
  }

  next.phase = 'main';
  next.history.push({ type: 'PHASE_CHANGED', phase: 'main' });
  return next;
}

/** Active player ends turn. Per-turn flags reset; turn handoff.
 *
 *  D5 fix (CR §6-2-3): attached DON is NOT detached here. Per CR §6-2-3
 *  attached DON stays attached until the START of the controller's next
 *  Refresh — see `runRefreshPhase` for the detach + move-to-rested step.
 *  This matters visually: during the opponent's turn the leader still
 *  displays its attached DON instead of "floating" rested in the cost area. */
export function endTurn(state: GameState): GameState {
  let next: GameState = structuredClone(state);
  const p = next.players[next.activePlayer];

  // Per-turn flags reset at end-of-turn (they're per-turn, not per-refresh).
  for (const inst of p.field) {
    inst.perTurn = { hasAttacked: false, effectsUsed: [] };
  }
  p.leader.perTurn = { hasAttacked: false, effectsUsed: [] };
  // D1 + D4: Stage participates in end-of-turn per-card flag reset.
  if (p.stage) {
    p.stage.perTurn = { hasAttacked: false, effectsUsed: [] };
  }

  // D16 (CR §4-12): turn-scoped power modifiers from `Set Power to 0` expire
  // at end of the turn they were applied. Clear on BOTH players' chars/leader/
  // stage (the modifier could sit on the active player's target via opp
  // effect, or the inactive player's target — both end at this boundary).
  // Mirror via state.instances map AND each per-zone struct since other
  // engine paths read from per-zone.
  // EB01-001 + others: `power_buff` with `duration: 'opp_next_turn'` stamps
  // `powerModifierExpiresInTurns` so the buff survives caster's endTurn and
  // clears only at the next endTurn boundary (start of caster's next turn).
  // Decrement when > 0, clear when reaches 0. costModifier remains turn-scoped
  // for now (no card uses cost duration > this_turn yet — added when needed).
  // Per-zone structs (leader, field[], stage) share references with
  // `next.instances` after structuredClone (structuredClone preserves
  // shared refs). To avoid double-ticking the same instance — which would
  // decrement `powerModifierExpiresInTurns` twice and wipe an opp_next_turn
  // buff that should still be live — we tick each instance exactly once via
  // the instances map, and clear `costModifier` (no duration tracking) in
  // the same single pass.
  const tickPower = (i: { powerModifier?: number; powerModifierExpiresInTurns?: number }) => {
    if ((i.powerModifierExpiresInTurns ?? 0) > 0) {
      i.powerModifierExpiresInTurns = (i.powerModifierExpiresInTurns ?? 0) - 1;
    } else {
      delete i.powerModifier;
      delete i.powerModifierExpiresInTurns;
    }
  };
  for (const id in next.instances) {
    const inst = next.instances[id];
    tickPower(inst);
    delete inst.costModifier;
    delete inst.lastBouncedColors;
  }
  // V3-2: nextPlayCostModifier expires at end of turn if not consumed by a play.
  for (const pid of ['A', 'B'] as PlayerId[]) {
    delete next.players[pid].nextPlayCostModifier;
  }

  next.history.push({ type: 'TURN_ENDED', player: next.activePlayer });
  // A.3.9: publish end-of-turn triggers BEFORE flipping activePlayer so
  // subscribers see "whose turn is ending" via state.activePlayer.
  publishTrigger('at_end_of_turn_self', next, { player: next.activePlayer });
  publishTrigger('at_end_of_turn', next, { player: next.activePlayer });
  // EB02-015 Bonney etc.: also fire matching effectSpecV2 clauses on
  // cards currently in play. TriggerBus has no spec-side subscribers, so
  // dispatch directly to field instances here.
  next = broadcastTriggerToOwnField(next, 'at_end_of_turn_self', next.activePlayer);
  next.activePlayer = OTHER[next.activePlayer];
  next.turn += 1;
  next.phase = 'refresh';
  return next;
}
