/**
 * Legal-move enumeration for the simulation layer.
 *
 * THIN WRAPPER around shared/engine-v2/rules/legality.ts:getLegalActions —
 * the same authoritative legal-move enumerator the UI store uses
 * (src/store/game.ts:13, 180, 192, 205, 214, 288, 303, 322, 357).
 *
 * Convergence invariant (hard convergence fix):
 *   SIMULATION LEGAL MOVES = engine-v2 getLegalActions(state, actor)
 *
 * NO simulation-side legality rules. NO cost / keyword / phase / counter /
 * blocker checks. The engine decides; the simulator queries.
 *
 * Actor selection mirrors src/store/game.ts:343-348 (dispatch routing):
 *   - pending → pending.<kind>.controller
 *   - block_window / counter_window → inactive (opp of state.activePlayer)
 *   - else → state.activePlayer
 *
 * For dice_roll, getLegalActions returns ROLL_DICE only for the queried
 * player. We query both A and B and union — each per-player getLegalActions
 * call is engine truth from that player's perspective.
 */

import type { Action } from '../engine-v2/protocol/actions.js';
import { getLegalActions } from '../engine-v2/rules/legality.js';
import type { GameState, PlayerId } from '../engine-v2/state/types.js';
import { OTHER_PLAYER } from '../engine-v2/state/types.js';

import type { Rng } from './rng.js';

export interface LegalMoves {
  readonly actor: PlayerId;
  readonly moves: ReadonlyArray<Action>;
  /**
   * Per-move actor tag — needed because some moves (e.g., ROLL_DICE) carry
   * their own player while still requiring the engine to be told who is
   * dispatching. The runner uses this to call applyAction with the right
   * player.
   */
  readonly moveActors: ReadonlyArray<PlayerId>;
}

/**
 * Compute the actor for non-dice phases. Mirrors src/store/game.ts:343-348.
 */
function computeActor(state: GameState): PlayerId {
  if (state.pending !== null) {
    const p = state.pending;
    switch (p.kind) {
      case 'attack': {
        // block/counter windows: inactive player (defender) reacts.
        const attacker = state.instances[p.pendingAttack.attackerInstanceId];
        if (attacker !== undefined) {
          return attacker.controller === 'A' ? 'B' : 'A';
        }
        return OTHER_PLAYER[state.activePlayer];
      }
      case 'trigger': return p.pendingTrigger.controller;
      case 'peek': return p.pendingPeek.controller;
      case 'discard': return p.pendingDiscard.controller;
      case 'choose_one': return p.pendingChoose.controller;
      case 'attack_target_pick': return p.pendingTargetPick.controller;
    }
  }
  if (state.phase === 'block_window' || state.phase === 'counter_window') {
    return OTHER_PLAYER[state.activePlayer];
  }
  return state.activePlayer;
}

export function legalMoves(state: GameState, _rng: Rng): LegalMoves {
  if (state.result !== null) {
    return { actor: state.activePlayer, moves: [], moveActors: [] };
  }

  // dice_roll: query BOTH players, union, tag each move with its producer.
  // Per-player getLegalActions returns CONCEDE-only for already-rolled slots
  // and [ROLL_DICE, CONCEDE] for not-yet-rolled. We honor both perspectives.
  if (state.phase === 'dice_roll') {
    const collected: Action[] = [];
    const actors: PlayerId[] = [];
    for (const p of ['A', 'B'] as PlayerId[]) {
      for (const a of getLegalActions(state, p)) {
        collected.push(a);
        actors.push(p);
      }
    }
    return {
      actor: state.activePlayer,
      moves: collected,
      moveActors: actors,
    };
  }

  const actor = computeActor(state);
  const moves = getLegalActions(state, actor);
  const moveActors = moves.map(() => actor);
  return { actor, moves, moveActors };
}
