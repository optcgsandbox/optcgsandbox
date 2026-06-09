/**
 * F-7k BUG-002 — Restore object-identity aliasing between
 * `state.players.{A,B}.{leader,field,stage}` and `state.instances[id]`.
 *
 * Why this exists:
 *
 *   The engine's invariants and several reducers assume that
 *   `state.players.A.leader` and `state.instances[leader.instanceId]`
 *   refer to the SAME object — so a push to one is observed via the
 *   other. The local-play fixtures honor this (see
 *   `shared/engine-v2/__tests__/fixtures.ts:116-141`) and Node's
 *   structuredClone preserves that aliasing across clones.
 *
 *   BUT — when the Matchmaker passes `initialState` to GameRoom over
 *   a Cloudflare Durable-Object RPC, the payload is JSON-serialized.
 *   `JSON.parse(JSON.stringify(...))` does NOT preserve reference
 *   identity. After deserialization, `players.A.leader` and
 *   `instances[leaderId]` contain identical data but are DIFFERENT
 *   objects. The next reducer that mutates one of them via the
 *   instances table (e.g. ATTACH_DON pushing to
 *   `state.instances[target].attachedDon`) leaves the player-side
 *   ref untouched. The DON_CONSERVATION invariant counts the
 *   player-side ref and sees a missing DON — `9 DON instances total;
 *   expected 10`.
 *
 * Fix: pick ONE canonical source — the `instances` table — and
 * re-point `players.X.leader/field/stage` references at it. Idempotent
 * + cheap (5 references per player, runs once per state ingress).
 *
 * This restores the invariant that LOCAL play and engine tests rely on,
 * so the same reducers work uniformly through the online path.
 */

import type { CardInstance, GameState, PlayerId } from '../engine-v2/state/types.js';

export function relinkInstances(state: GameState): GameState {
  for (const side of ['A', 'B'] as PlayerId[]) {
    const pl = state.players[side];

    // Leader.
    const linkedLeader = state.instances[pl.leader.instanceId];
    if (linkedLeader !== undefined && linkedLeader !== pl.leader) {
      pl.leader = linkedLeader as CardInstance;
    }

    // Field (array of refs).
    for (let i = 0; i < pl.field.length; i++) {
      const cur = pl.field[i]!;
      const linked = state.instances[cur.instanceId];
      if (linked !== undefined && linked !== cur) {
        pl.field[i] = linked as CardInstance;
      }
    }

    // Stage (single ref or null).
    if (pl.stage !== null) {
      const linked = state.instances[pl.stage.instanceId];
      if (linked !== undefined && linked !== pl.stage) {
        pl.stage = linked as CardInstance;
      }
    }
  }
  return state;
}
