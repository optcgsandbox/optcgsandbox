/**
 * MatchSession — deterministic replay.
 *
 * Validates that reapplying the recorded action log from the stored initial
 * state produces a state byte-identical to the live session at every point
 * in the log. This is the foundational guarantee that everything downstream
 * (reconnect, replay viewer, ranked audit) builds on.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from '../../engine-v2/__tests__/fixtures.js';
import { MatchSession } from '../MatchSession.js';
import { computeStateHash } from '../stateHash.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

describe('MatchSession — replay parity', () => {
  it('reapplying the action log reproduces the live state exactly', () => {
    const initial = buildBasicGameState();
    // Stash a hand card so we have a real PLAY_CARD to dispatch.
    const handId = moveTopOfDeckToHand(initial, 'A');

    const session = new MatchSession(initial);
    const r1 = session.applyPlayerAction('A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    });
    expect(r1.accepted).toBe(true);
    const r2 = session.applyPlayerAction('A', { type: 'END_TURN' });
    expect(r2.accepted).toBe(true);

    const liveHash = session.getStateHash();
    const { hash: replayHash, state: replayState } = session.replay();

    expect(replayHash).toBe(liveHash);
    expect(computeStateHash(replayState)).toBe(liveHash);
  });

  it('hashes are deterministic across multiple replays', () => {
    const initial = buildBasicGameState();
    const handId = moveTopOfDeckToHand(initial, 'A');

    const session = new MatchSession(initial);
    session.applyPlayerAction('A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    });
    session.applyPlayerAction('A', { type: 'END_TURN' });

    const h1 = session.replay().hash;
    const h2 = session.replay().hash;
    const h3 = session.replay().hash;
    expect(h2).toBe(h1);
    expect(h3).toBe(h1);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('assertReplayParity does not throw on a clean session', () => {
    const initial = buildBasicGameState();
    const handId = moveTopOfDeckToHand(initial, 'A');
    const session = new MatchSession(initial);
    session.applyPlayerAction('A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    });
    expect(() => session.assertReplayParity()).not.toThrow();
  });

  it('action log records every accepted action in order, never any rejected one', () => {
    const initial = buildBasicGameState();
    const handId = moveTopOfDeckToHand(initial, 'A');
    const session = new MatchSession(initial);

    // Accepted
    session.applyPlayerAction('A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    });
    // Rejected — opponent can't END_TURN during A's turn
    const reject = session.applyPlayerAction('B', { type: 'END_TURN' });
    expect(reject.accepted).toBe(false);
    // Accepted
    session.applyPlayerAction('A', { type: 'END_TURN' });

    const log = session.getActionLog();
    expect(log.length).toBe(2);
    expect(log[0]!.action.type).toBe('PLAY_CARD');
    expect(log[0]!.player).toBe('A');
    expect(log[1]!.action.type).toBe('END_TURN');
    expect(log[1]!.player).toBe('A');
  });

  it('caller mutations to the input state do not leak into the session', () => {
    const initial = buildBasicGameState();
    const session = new MatchSession(initial);
    const beforeHash = session.getStateHash();

    // Caller scribbles on the input state.
    initial.players['A'].hand.push('attacker-injection');
    initial.turn = 999;

    // Session is unaffected.
    expect(session.getStateHash()).toBe(beforeHash);
    expect(session.getAuthoritativeState().turn).toBe(1);
    expect(session.getAuthoritativeState().players['A'].hand).not.toContain(
      'attacker-injection',
    );
  });
});
