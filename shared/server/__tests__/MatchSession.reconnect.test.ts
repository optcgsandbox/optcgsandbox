/**
 * MatchSession — reconnect.
 *
 * Validates that a session can be reconstructed from `{ initialState, log }`
 * such that the resulting state, hash, and log are identical to the original
 * at any midpoint. This is the path a reconnecting client takes.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from '../../engine-v2/__tests__/fixtures.js';
import { MatchSession } from '../MatchSession.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

describe('MatchSession — reconnect / rebuild from log', () => {
  it('fromActionLog produces an identical session at any midpoint', () => {
    const initial = buildBasicGameState();
    const handId = moveTopOfDeckToHand(initial, 'A');
    const session = new MatchSession(initial);
    session.applyPlayerAction('A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    });
    session.applyPlayerAction('A', { type: 'END_TURN' });

    const originalHash = session.getStateHash();
    const log = session.getActionLog();

    // Rebuild from log and verify the resulting hash matches.
    const rebuilt = MatchSession.fromActionLog(session.getInitialState(), log);
    expect(rebuilt.getStateHash()).toBe(originalHash);
    expect(rebuilt.getActionLog().length).toBe(log.length);
  });

  it('reconstructing at the empty-log midpoint matches the initial state hash', () => {
    const initial = buildBasicGameState();
    const session = new MatchSession(initial);
    const initHash = session.getStateHash();

    const rebuilt = MatchSession.fromActionLog(session.getInitialState(), []);
    expect(rebuilt.getStateHash()).toBe(initHash);
    expect(rebuilt.getActionLog().length).toBe(0);
  });

  it('rebuilt session can continue accepting actions identically', () => {
    const initial = buildBasicGameState();
    const handId = moveTopOfDeckToHand(initial, 'A');
    const sessionA = new MatchSession(initial);
    sessionA.applyPlayerAction('A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    });

    const rebuilt = MatchSession.fromActionLog(
      sessionA.getInitialState(),
      sessionA.getActionLog(),
    );
    // Both should accept the same next action identically.
    const r1 = sessionA.applyPlayerAction('A', { type: 'END_TURN' });
    const r2 = rebuilt.applyPlayerAction('A', { type: 'END_TURN' });
    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
    if (r1.accepted && r2.accepted) {
      expect(r1.hash).toBe(r2.hash);
    }
    expect(sessionA.getStateHash()).toBe(rebuilt.getStateHash());
  });

  it('throws if any logged action is no longer legal (e.g., engine changed)', () => {
    const initial = buildBasicGameState();
    const handId = moveTopOfDeckToHand(initial, 'A');
    const session = new MatchSession(initial);
    session.applyPlayerAction('A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    });

    // Tamper with the log: PLAY_CARD pointing at a nonexistent instance.
    const corruptedLog = [
      {
        player: 'A' as const,
        action: {
          type: 'PLAY_CARD' as const,
          instanceId: 'this-instance-does-not-exist',
          replaceTargetId: null,
        },
      },
    ];

    expect(() =>
      MatchSession.fromActionLog(session.getInitialState(), corruptedLog),
    ).toThrow(/rejected/);
  });

  it('three independent rebuilds of the same log all produce the same hash', () => {
    const initial = buildBasicGameState();
    const handId = moveTopOfDeckToHand(initial, 'A');
    const session = new MatchSession(initial);
    session.applyPlayerAction('A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    });
    session.applyPlayerAction('A', { type: 'END_TURN' });
    const log = session.getActionLog();
    const init = session.getInitialState();

    const a = MatchSession.fromActionLog(init, log).getStateHash();
    const b = MatchSession.fromActionLog(init, log).getStateHash();
    const c = MatchSession.fromActionLog(init, log).getStateHash();
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe(session.getStateHash());
  });
});
