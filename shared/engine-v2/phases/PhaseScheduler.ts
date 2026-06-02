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
    const ap = state.activePlayer;
    const pl = state.players[ap];

    // (1) Un-rest active player's chars
    for (const inst of allCharsOnField(state, ap)) {
      inst.rested = false;
      // Clear summoning sickness — a char that was summoned last turn is now
      // active for the new active player's turn.
      inst.summoningSick = false;
    }

    // (2) DON: rested → cost area (unrested). Attached-rested DON also
    // returns to cost area. Per CR §6-1-3.
    while (pl.donRested.length > 0) {
      const id = pl.donRested.shift();
      if (id !== undefined) pl.donCostArea.push(id);
    }
    for (const inst of allCharsOnField(state, ap)) {
      while (inst.attachedDonRested.length > 0) {
        const id = inst.attachedDonRested.shift();
        if (id !== undefined) inst.attachedDon.push(id);
      }
    }

    // (3) Clear active player's THIS_TURN OneShot fields. (perTurn always
    // resets here so OPT keys can fire again.)
    for (const inst of Object.values(state.instances)) {
      if (inst.controller !== ap) continue;
      inst.perTurn = { hasAttacked: false, effectsUsed: [] };
      // THIS_TURN OneShot fields expire NOW.
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
      // grantedKeywordsOneShot / immunityOneShot / attackLockedOneShot are
      // pure THIS_TURN — always clear at refresh of their controller.
      inst.grantedKeywordsOneShot = undefined;
      inst.immunityOneShot = undefined;
      inst.attackLockedOneShot = undefined;
      // armedReplacementsThisTurn drain (active player only)
    }
    pl.armedReplacementsThisTurn = [];

    // TODO: TriggerEngine.broadcast(state, 'at_refresh_phase', ap);
    // TODO: ContinuousManager.refold(state);

    return setPhase(state, expectStaticNext('refresh')); // → 'draw'
  },

  /**
   * DRAW phase (CR §6-2). Active player draws 1, UNLESS this is the very
   * first turn of the first player AND `state.firstPlayer === ap` AND the
   * game rule "first-player-no-draw" applies (default rule). Per CR §6-2-1.
   */
  enterDraw(state: GameState): GameState {
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
    const ap = state.activePlayer;
    const opp = OTHER_PLAYER[ap];
    const apZ = state.players[ap];

    // (1) Resolve pending end-of-turn entries (e.g., trash-at-end-of-turn).
    for (const entry of apZ.pendingEndOfTurn ?? []) {
      // TODO: dispatch entry to ActionHandler (delegated; not implemented yet).
      void entry;
    }
    apZ.pendingEndOfTurn = [];

    // (2) Tick down OneShot expiresInTurns counters for ALL instances.
    for (const inst of Object.values(state.instances)) {
      if (inst.powerModifierExpiresInTurns !== undefined) {
        inst.powerModifierExpiresInTurns -= 1;
      }
      if (inst.costModifierExpiresInTurns !== undefined) {
        inst.costModifierExpiresInTurns -= 1;
      }
      if (inst.basePowerOverrideExpiresInTurns !== undefined) {
        inst.basePowerOverrideExpiresInTurns -= 1;
      }
    }

    // (3) Clear THIS_BATTLE scope (powerModifierThisBattle survives only
    // within an attack; if any leaked past damage_resolution, scrub here).
    for (const inst of Object.values(state.instances)) {
      inst.powerModifierThisBattle = undefined;
    }

    // (4) Hand-size limit: CR §6-5-7. If active player's hand > 10, they
    // must discard down. Suspends via PendingDiscard.
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
