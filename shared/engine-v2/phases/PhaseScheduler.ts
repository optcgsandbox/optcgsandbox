/**
 * Engine V2 — Phase scheduler.
 *
 * Owns the per-turn phase sequence: refresh → draw → don → main → end.
 * Each `enter*` reducer (a) performs the phase's mutations, (b) broadcasts
 * the phase's triggers via TriggerEngine, (c) updates `state.phase`, and
 * (d) returns. The caller (game loop) advances through the FSM by calling
 * the next `enter*`.
 *
 * RULES (do not break):
 *   - All DON detachment goes through `detachAllAttachedDon`.
 *   - Continuous refold happens AFTER every state mutation (not yet wired —
 *     ContinuousManager is later in Phase 2).
 *   - Trigger broadcasts go through TriggerEngine (stubbed; populated when
 *     TriggerEngine module lands).
 *
 * Cross-references:
 * - Implementation spec §11
 * - Plan v1 §1.7
 * - CR §6 (turn structure)
 */

import { EffectDispatcher } from '../effects/EffectDispatcher.js';
import { triggerEmitters } from '../registry/types.js';
import type { EffectActionV2 } from '../spec/types.js';
import { actionHandlers } from '../registry/types.js';
import { detachAllAttachedDon } from '../state/derived/don.js';
import { resetInstanceTransientState } from '../state/derived/reset.js';
import {
  type CardInstance,
  type GameState,
  OTHER_PLAYER,
  type Phase,
  type PlayerId,
  STARTING_HAND_SIZE,
} from '../state/types.js';
import { PHASE_TRANSITIONS } from './transitions.js';

// ────────────────────────────────────────────────────────────────────
// Helpers (local; not exported)
// ────────────────────────────────────────────────────────────────────

function allCharsOnField(state: GameState, side: PlayerId): CardInstance[] {
  const pl = state.players[side];
  const out: CardInstance[] = [pl.leader, ...pl.field];
  if (pl.stage !== null) out.push(pl.stage);
  return out;
}

function setPhase(state: GameState, phase: Phase): GameState {
  state.phase = phase;
  return state;
}

function expectStaticNext(current: Phase): Phase {
  const next = PHASE_TRANSITIONS[current];
  if (next === 'context') {
    throw new Error(
      `PhaseScheduler: phase "${current}" has dynamic transition; ` +
        `must be resolved by per-phase reducer, not setPhase().`,
    );
  }
  return next;
}

// ────────────────────────────────────────────────────────────────────
// PhaseScheduler
// ────────────────────────────────────────────────────────────────────

export const PhaseScheduler = {
  /**
   * REFRESH phase (CR §6-1).
   *   1. Active player un-rests every character + leader they control.
   *   2. Active player un-rests every DON in their cost area; detached
   *      DON on chars becomes "rested" — they untap here.
   *   3. Resolve start-of-turn replacements (TODO: pass through ReplacementManager).
   *   4. Clear THIS_TURN OneShot fields on every instance the active player
   *      controls (powerModifierOneShot if expiresInTurns===0, etc.).
   *
   * Per CR §6-1, ALL detached DON (regardless of prior state) → donCostArea
   * UNRESTED. This is the only place that empties donRested into donCostArea
   * during the turn.
   */
  enterRefresh(state: GameState): GameState {
    // Clone so Zustand selectors on state.players[ap].* see a new ref and
    // re-render zones between paced phase pills. V1 engine cloned at the top
    // of every enter* (shared/engine/phases/turn.ts:21); engine-v2 used to
    // mutate in place, which collapsed the visible R/D/D animation.
    state = structuredClone(state);
    const ap = state.activePlayer;
    const pl = state.players[ap];
    const opp = OTHER_PLAYER[ap];

    // V1 parity (D5 / CR §6-2-3): broadcast at_opp_refresh to opp's field
    // BEFORE the rest→active flip so listeners observe pre-refresh state.
    let next = state;
    if (triggerEmitters.has('at_opp_refresh')) {
      next = triggerEmitters.get('at_opp_refresh')(next, { kind: 'at_opp_refresh' }, opp);
    }

    // V1 parity (D5 / CR §6-2-3): DETACH all attached DON from active
    // player's leader/chars/stage → donRested BEFORE the unrest flip. This
    // lets the rested→active step pick them up so they return active this
    // refresh. Visually keeps DON attached during opp's turn (cosmetic
    // divergence fix from V1).
    const apCharsForDetach: CardInstance[] = [pl.leader, ...pl.field];
    if (pl.stage !== null) apCharsForDetach.push(pl.stage);
    for (const inst of apCharsForDetach) {
      while (inst.attachedDon.length > 0) {
        const id = inst.attachedDon.shift();
        if (id !== undefined) pl.donRested.push(id);
      }
      while (inst.attachedDonRested.length > 0) {
        const id = inst.attachedDonRested.shift();
        if (id !== undefined) pl.donRested.push(id);
      }
    }

    // (1) Un-rest active player's chars
    for (const inst of allCharsOnField(next, ap)) {
      inst.rested = false;
      inst.summoningSick = false;
    }
    if (pl.stage !== null) pl.stage.rested = false;

    // (2) ALL rested DON → cost area (active). Per CR §6-2-4.
    while (pl.donRested.length > 0) {
      const id = pl.donRested.shift();
      if (id !== undefined) pl.donCostArea.push(id);
    }

    // (3) Clear active player's THIS_TURN OneShot fields. (perTurn always
    // resets here so OPT keys can fire again.)
    for (const inst of Object.values(next.instances)) {
      if (inst.controller !== ap) continue;
      inst.perTurn = { hasAttacked: false, effectsUsed: [] };
      if (inst.powerModifierExpiresInTurns === 0) {
        inst.powerModifierOneShot = undefined;
        inst.powerModifierExpiresInTurns = undefined;
      }
      if (inst.costModifierExpiresInTurns === 0) {
        inst.costModifierOneShot = undefined;
        inst.costModifierExpiresInTurns = undefined;
      }
      if (inst.basePowerOverrideExpiresInTurns === 0) {
        inst.basePowerOverrideOneShot = undefined;
        inst.basePowerOverrideExpiresInTurns = undefined;
      }
      inst.grantedKeywordsOneShot = undefined;
      inst.immunityOneShot = undefined;
      inst.attackLockedOneShot = undefined;
    }
    pl.armedReplacementsThisTurn = [];

    return setPhase(next, expectStaticNext('refresh')); // → 'draw'
  },

  /**
   * DRAW phase (CR §6-2). Active player draws 1, UNLESS this is the very
   * first turn of the first player AND `state.firstPlayer === ap` AND the
   * game rule "first-player-no-draw" applies (default rule). Per CR §6-2-1.
   */
  enterDraw(state: GameState): GameState {
    // Clone (see enterRefresh) so the new hand ref triggers the draw animation.
    state = structuredClone(state);
    const ap = state.activePlayer;
    const pl = state.players[ap];
    const skipDraw = state.turn === 1 && state.firstPlayer === ap;

    if (!skipDraw) {
      // Draw 1: deck → hand.
      const topId = pl.deck.shift();
      if (topId !== undefined) {
        pl.hand.push(topId);
      } else {
        // Deck-out: assign loss on draw-attempt-from-empty (CR §10-3-1).
        state.result = { loser: ap, reason: 'deck_out' };
      }
    }

    // TODO: TriggerEngine.broadcast(state, 'at_draw_phase', ap);
    return setPhase(state, expectStaticNext('draw')); // → 'don'
  },

  /**
   * DON phase (CR §6-3). Active player adds 2 DON from donDeck → donCostArea
   * (1 DON on the first turn). Per CR §6-3-1.
   */
  enterDon(state: GameState): GameState {
    // Clone (see enterRefresh) so the new donCostArea ref triggers the DON
    // travel animation.
    state = structuredClone(state);
    const ap = state.activePlayer;
    const pl = state.players[ap];
    const addCount = state.turn === 1 && state.firstPlayer === ap ? 1 : 2;

    let added = 0;
    while (added < addCount && pl.donDeck.length > 0) {
      const id = pl.donDeck.shift();
      if (id !== undefined) {
        pl.donCostArea.push(id);
        added += 1;
      }
    }

    // TODO: TriggerEngine.broadcast(state, 'at_don_phase', ap);
    return setPhase(state, expectStaticNext('don')); // → 'main'
  },

  /**
   * MAIN phase (CR §6-4). Active player may play characters/events/stages,
   * attach DON, attack, activate Main effects. The scheduler doesn't make
   * decisions here — it just sets the phase and broadcasts. Game loop drives
   * input via Action dispatcher; scheduler resumes on enterEnd or attack.
   */
  enterMain(state: GameState): GameState {
    // TODO: TriggerEngine.broadcast(state, 'at_main_phase', state.activePlayer);
    return setPhase(state, 'main');
  },

  /**
   * END phase (CR §6-5). Active player processes end-of-turn effects, then
   * passes turn. Per CR §6-5-5: opp.next_turn-scoped effects on chars NOT
   * controlled by the active player flip into THIS_TURN scope on the *next*
   * (now-active) player's turn.
   *
   * Hand-size limit (10) check happens here (CR §6-5-7).
   */
  enterEnd(state: GameState): GameState {
    // Clone (see enterRefresh) so end-of-turn mutations + the activePlayer
    // flip in finalizeEndTurn produce a state with new player refs.
    state = structuredClone(state);
    const ap = state.activePlayer;
    const opp = OTHER_PLAYER[ap];
    const apZ = state.players[ap];

    // (1) Drain pendingEndOfTurn — dispatch each queued action with the
    // ORIGINAL source's controller (per V1 endTurn lines 203-217).
    let next = state;
    const queue = apZ.pendingEndOfTurn ?? [];
    apZ.pendingEndOfTurn = [];
    for (const entry of queue) {
      const sourceInst = next.instances[entry.sourceInstanceId];
      const controller = sourceInst?.controller ?? ap;
      const action = entry.action as EffectActionV2;
      if (typeof action === 'object' && action !== null && typeof action.kind === 'string' && actionHandlers.has(action.kind)) {
        next = actionHandlers.get(action.kind)(next, {
          sourceInstanceId: entry.sourceInstanceId,
          controller,
        }, action, []);
      }
    }

    // (2) Tick OneShot expiresInTurns; clear when reaches zero (V1 parity
    // — tickPower in endTurn lines 164-178).
    for (const inst of Object.values(next.instances)) {
      if ((inst.powerModifierExpiresInTurns ?? 0) > 0) {
        inst.powerModifierExpiresInTurns = (inst.powerModifierExpiresInTurns ?? 0) - 1;
      } else if (inst.powerModifierExpiresInTurns !== undefined) {
        inst.powerModifierOneShot = undefined;
        inst.powerModifierExpiresInTurns = undefined;
      }
      if ((inst.costModifierExpiresInTurns ?? 0) > 0) {
        inst.costModifierExpiresInTurns = (inst.costModifierExpiresInTurns ?? 0) - 1;
      } else if (inst.costModifierExpiresInTurns !== undefined) {
        inst.costModifierOneShot = undefined;
        inst.costModifierExpiresInTurns = undefined;
      }
      if ((inst.basePowerOverrideExpiresInTurns ?? 0) > 0) {
        inst.basePowerOverrideExpiresInTurns = (inst.basePowerOverrideExpiresInTurns ?? 0) - 1;
      } else if (inst.basePowerOverrideExpiresInTurns !== undefined) {
        inst.basePowerOverrideOneShot = undefined;
        inst.basePowerOverrideExpiresInTurns = undefined;
      }
      if ((inst.effectsNegatedExpiresInTurns ?? 0) > 0) {
        inst.effectsNegatedExpiresInTurns = (inst.effectsNegatedExpiresInTurns ?? 0) - 1;
      } else if (inst.effectsNegatedExpiresInTurns !== undefined) {
        inst.effectsNegated = undefined;
        inst.effectsNegatedExpiresInTurns = undefined;
      }
    }

    // (3) Clear THIS_BATTLE scope (powerModifierThisBattle survives only
    // within an attack; if any leaked past damage_resolution, scrub here).
    for (const inst of Object.values(next.instances)) {
      inst.powerModifierThisBattle = undefined;
    }

    // (4) V1 parity: nextPlayCostModifier expires at end of turn if not
    // consumed; lifeFaceUp orphan prune (V1 endTurn lines 180-191).
    for (const pid of ['A', 'B'] as PlayerId[]) {
      next.players[pid].nextPlayCostModifier = undefined;
      const pl = next.players[pid];
      const liveSet = new Set(pl.life);
      for (const id of Object.keys(pl.lifeFaceUp)) {
        if (!liveSet.has(id)) {
          // Mutate in place — `lifeFaceUp` is Record<string, boolean>.
          delete (pl.lifeFaceUp as Record<string, boolean>)[id];
        }
      }
    }

    // (5) Broadcast at_end_of_turn_self (active player's field) and
    // at_end_of_turn (both fields) — V1 endTurn lines 196-221.
    if (triggerEmitters.has('at_end_of_turn_self')) {
      next = triggerEmitters.get('at_end_of_turn_self')(next, { kind: 'at_end_of_turn_self' }, ap);
    }
    if (triggerEmitters.has('at_end_of_turn')) {
      next = triggerEmitters.get('at_end_of_turn')(next, { kind: 'at_end_of_turn' }, ap);
    }
    void EffectDispatcher; // reserved for future on_take_damage-style dispatches inside end phase

    // (6) Hand-size limit: CR §6-5-7. If active player's hand > 10, they
    // must discard down. Suspends via PendingDiscard.
    state = next;
    const HAND_LIMIT = 10;
    if (apZ.hand.length > HAND_LIMIT) {
      const excess = apZ.hand.length - HAND_LIMIT;
      state.pending = {
        kind: 'discard',
        pendingDiscard: {
          controller: ap,
          sourceInstanceId: 'system',
          revealedFrom: 'self_hand',
          count: excess,
          resumePhase: 'end',
        },
      };
      state.phase = 'discard_choice';
      return state;
    }

    return finalizeEndTurn(state, ap, opp);
  },
} as const;

/**
 * Finalize end-of-turn: pass turn to opp, bump turn counter, reset
 * koSourceStack + pendingDonReturned, transition phase → refresh.
 *
 * Exported so the hand-size-limit RESOLVE_DISCARD resumer can call it
 * after the discard completes (closes CR-3 audit finding — without this
 * the turn would hang at phase='end' permanently).
 */
export function finalizeEndTurn(
  state: GameState,
  ap: PlayerId,
  opp: PlayerId,
): GameState {
  state.activePlayer = opp;
  state.turn += 1;
  state.koSourceStack = [];
  state.pendingDonReturned = {};
  // TODO: TriggerEngine.broadcast(state, 'at_end_phase', ap);
  void ap;
  return setPhase(state, expectStaticNext('end')); // → 'refresh' (next turn)
}

// ────────────────────────────────────────────────────────────────────
// Re-exports for callers
// ────────────────────────────────────────────────────────────────────

export { PHASE_TRANSITIONS } from './transitions.js';
export { STARTING_HAND_SIZE };

// Internal helpers — exported only for testing.
export const __internal = {
  allCharsOnField,
  expectStaticNext,
  resetInstanceTransientState,
  detachAllAttachedDon,
};
