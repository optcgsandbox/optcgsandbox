/**
 * MatchSession — server-authoritative turn pipeline (F-7k BUG-001 regression).
 *
 * `turnFlow.endTurnReducer` (shared/engine-v2/reducers/turnFlow.ts:25) leaves
 * the engine at `phase='refresh'` for the new active player and documents:
 * "The host (store) runs the paced R/D/D pipeline so each phase animates
 * visibly." In server-authoritative play the host is `MatchSession` itself.
 *
 * Without the post-action sweep, the new active player's `getLegalActions`
 * returns CONCEDE-only and every multi-turn online match deadlocks at the
 * first END_TURN. This file pins that the sweep runs.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import { buildBasicGameState } from '../../engine-v2/__tests__/fixtures.js';
import { getLegalActions } from '../../engine-v2/rules/legality.js';
import { MatchSession } from '../MatchSession.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

describe('MatchSession — server-authoritative turn pipeline', () => {
  it('drives refresh → draw → don → main after A END_TURN; B can act on its turn', () => {
    const session = new MatchSession(buildBasicGameState());

    // Sanity: starting state is A's main phase.
    const pre = session.getAuthoritativeState();
    expect(pre.phase).toBe('main');
    expect(pre.activePlayer).toBe('A');

    const res = session.applyPlayerAction('A', { type: 'END_TURN' });
    expect(res.accepted).toBe(true);

    const post = session.getAuthoritativeState();
    // Invariant the BUG-001 fix establishes.
    expect(post.phase).toBe('main');
    expect(post.activePlayer).toBe('B');
    // Turn counter incremented by the engine.
    expect(post.turn).toBeGreaterThan(pre.turn);
    // The match is still live.
    expect(post.result).toBeNull();

    // B has at least one non-CONCEDE legal action — the prior bug surfaced
    // as B's legalActions collapsing to [CONCEDE].
    const bLegal = getLegalActions(post, 'B');
    const nonConcede = bLegal.filter((a) => a.type !== 'CONCEDE');
    expect(nonConcede.length).toBeGreaterThan(0);
  });

  it('drives the pipeline on EVERY END_TURN (turn 1 → turn 2 → turn 3)', () => {
    const session = new MatchSession(buildBasicGameState());

    expect(session.applyPlayerAction('A', { type: 'END_TURN' }).accepted).toBe(true);
    expect(session.getAuthoritativeState().phase).toBe('main');
    expect(session.getAuthoritativeState().activePlayer).toBe('B');

    expect(session.applyPlayerAction('B', { type: 'END_TURN' }).accepted).toBe(true);
    expect(session.getAuthoritativeState().phase).toBe('main');
    expect(session.getAuthoritativeState().activePlayer).toBe('A');

    expect(session.applyPlayerAction('A', { type: 'END_TURN' }).accepted).toBe(true);
    expect(session.getAuthoritativeState().phase).toBe('main');
    expect(session.getAuthoritativeState().activePlayer).toBe('B');
  });

  it('does NOT drive the pipeline when an action leaves phase=main (no false trigger)', () => {
    const session = new MatchSession(buildBasicGameState());
    const before = session.getStateHash();

    // ATTACH_DON is a main-phase action; engine returns with phase='main'
    // so the post-action invariant should be a no-op.
    const leaderInst =
      session.getAuthoritativeState().players['A'].leader.instanceId;
    const res = session.applyPlayerAction('A', {
      type: 'ATTACH_DON',
      targetInstanceId: leaderInst,
    });
    expect(res.accepted).toBe(true);
    expect(session.getAuthoritativeState().phase).toBe('main');
    expect(session.getAuthoritativeState().activePlayer).toBe('A');
    expect(session.getStateHash()).not.toBe(before);
  });

  it('replay parity holds across END_TURN (live state == replayed state)', () => {
    const session = new MatchSession(buildBasicGameState());
    expect(session.applyPlayerAction('A', { type: 'END_TURN' }).accepted).toBe(true);
    expect(session.applyPlayerAction('B', { type: 'END_TURN' }).accepted).toBe(true);

    // The replay path must apply the same authoritative pipeline sweep —
    // otherwise replayed hash diverges from live hash.
    expect(() => session.assertReplayParity()).not.toThrow();
  });

  it('does NOT drive the pipeline when the match has concluded', () => {
    const session = new MatchSession(buildBasicGameState());
    expect(session.applyPlayerAction('A', { type: 'CONCEDE' }).accepted).toBe(true);
    expect(session.getAuthoritativeState().result).not.toBeNull();
    // CONCEDE leaves phase=main and result!==null. Pipeline must not fire
    // even if a future reducer ever leaves the state at refresh+result.
    expect(session.getAuthoritativeState().phase).not.toBe('refresh');
  });
});
