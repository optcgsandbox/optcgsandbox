/**
 * MatchReplayV1 serialization — Phase F-1.
 *
 * Validates the persisted-form ↔ live-session round trip, structural and
 * semantic validation, and immutability of caller-owned objects.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from '../../engine-v2/__tests__/fixtures.js';
import { MatchSession } from '../MatchSession.js';
import {
  REPLAY_SCHEMA_VERSION,
  deserializeReplay,
  replayToFinalState,
  serializeReplay,
  validateReplay,
  type MatchReplayV1,
} from '../serialize.js';
import { computeStateHash } from '../stateHash.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

/** Builds a session with two accepted actions for use in multiple tests. */
function buildSampleSession(): MatchSession {
  const initial = buildBasicGameState();
  const handId = moveTopOfDeckToHand(initial, 'A');
  const session = new MatchSession(initial);
  session.applyPlayerAction('A', {
    type: 'PLAY_CARD',
    instanceId: handId,
    replaceTargetId: null,
  });
  session.applyPlayerAction('A', { type: 'END_TURN' });
  return session;
}

describe('serialize — round trip', () => {
  it('round-trips a valid replay (session → blob → session)', () => {
    const original = buildSampleSession();
    const replay = serializeReplay(original);

    expect(replay.schemaVersion).toBe(REPLAY_SCHEMA_VERSION);
    expect(replay.finalHash).toBe(original.getStateHash());
    expect(replay.actionLog.length).toBe(original.getActionLog().length);

    const rebuilt = deserializeReplay(replay);
    expect(rebuilt.getStateHash()).toBe(original.getStateHash());
    expect(rebuilt.getActionLog().length).toBe(original.getActionLog().length);
  });

  it('replay.finalHash matches the live session hash', () => {
    const session = buildSampleSession();
    const replay = serializeReplay(session);
    expect(replay.finalHash).toBe(session.getStateHash());
  });

  it('replayToFinalState produces a state whose hash matches finalHash', () => {
    const session = buildSampleSession();
    const replay = serializeReplay(session);
    const finalState = replayToFinalState(replay);
    expect(computeStateHash(finalState)).toBe(replay.finalHash);
  });

  it('round-trips a zero-action replay (fresh session)', () => {
    const fresh = new MatchSession(buildBasicGameState());
    const replay = serializeReplay(fresh);
    expect(replay.actionLog.length).toBe(0);
    expect(replay.finalHash).toBe(fresh.getStateHash());

    const rebuilt = deserializeReplay(replay);
    expect(rebuilt.getStateHash()).toBe(fresh.getStateHash());
    expect(rebuilt.getActionLog().length).toBe(0);
  });

  it('deserialized session can continue accepting actions', () => {
    const original = buildSampleSession();
    const replay = serializeReplay(original);
    const rebuilt = deserializeReplay(replay);

    // CONCEDE is always legal (see MatchSession.validateLegalAction). After
    // sampling it on both sessions, hashes must remain identical — proving
    // the rebuilt session is a true continuation of the original.
    const r1 = rebuilt.applyPlayerAction('B', { type: 'CONCEDE' });
    const r2 = original.applyPlayerAction('B', { type: 'CONCEDE' });
    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
    expect(rebuilt.getStateHash()).toBe(original.getStateHash());
  });
});

describe('serialize — validation failures', () => {
  it('rejects unsupported schemaVersion', () => {
    const replay = serializeReplay(buildSampleSession()) as MatchReplayV1;
    const tampered = { ...replay, schemaVersion: 99 } as unknown as MatchReplayV1;
    const r = validateReplay(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unsupported_schema_version/);
  });

  it('rejects tampered finalHash', () => {
    const replay = serializeReplay(buildSampleSession());
    const tampered = { ...replay, finalHash: '0000000000000000' };
    const r = validateReplay(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/final_hash_mismatch/);
  });

  it('rejects tampered actionLog (truncated)', () => {
    // Drop the trailing END_TURN. Replay still completes cleanly but the
    // resulting state has the turn-end un-applied, so the hash diverges.
    const replay = serializeReplay(buildSampleSession());
    const tamperedLog = replay.actionLog.slice(0, -1);
    const tampered = { ...replay, actionLog: tamperedLog };
    const r = validateReplay(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/final_hash_mismatch/);
  });

  it('rejects malformed actionLog (not an array)', () => {
    const replay = serializeReplay(buildSampleSession());
    const tampered = { ...replay, actionLog: 'definitely-not-an-array' } as unknown as MatchReplayV1;
    const r = validateReplay(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('actionLog_is_not_an_array');
  });

  it('rejects malformed log entry (missing player)', () => {
    const replay = serializeReplay(buildSampleSession());
    const tamperedLog = [
      { action: { type: 'END_TURN' } } as unknown,
      ...replay.actionLog,
    ];
    const tampered = { ...replay, actionLog: tamperedLog as never };
    const r = validateReplay(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/actionLog\[0\]_invalid_player/);
  });

  it('rejects malformed log entry (unknown action type)', () => {
    const replay = serializeReplay(buildSampleSession());
    const tamperedLog = [
      { player: 'A', action: { type: 'SUMMON_RANCOR' } } as unknown,
      ...replay.actionLog,
    ];
    const tampered = { ...replay, actionLog: tamperedLog as never };
    const r = validateReplay(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unknown_action_type/);
  });

  it('rejects missing initialState', () => {
    const replay = serializeReplay(buildSampleSession());
    const tampered = { ...replay, initialState: undefined } as unknown as MatchReplayV1;
    const r = validateReplay(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_or_invalid_initialState');
  });

  it('rejects missing finalHash', () => {
    const replay = serializeReplay(buildSampleSession());
    const tampered = { ...replay, finalHash: '' };
    const r = validateReplay(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_or_invalid_finalHash');
  });

  it('deserializeReplay throws on any validation failure', () => {
    const replay = serializeReplay(buildSampleSession());
    const tampered = { ...replay, finalHash: '0000000000000000' };
    expect(() => deserializeReplay(tampered)).toThrow(/final_hash_mismatch/);
  });
});

describe('serialize — immutability', () => {
  it('serializeReplay does not mutate the source session', () => {
    const session = buildSampleSession();
    const hashBefore = session.getStateHash();
    const logLenBefore = session.getActionLog().length;

    const replay = serializeReplay(session);
    // Tamper with the returned replay — session must be unaffected.
    (replay.actionLog as LoggedAction[]).push({
      player: 'A',
      action: { type: 'END_TURN' },
    } as LoggedAction);
    (replay as { finalHash: string }).finalHash = 'tampered';

    expect(session.getStateHash()).toBe(hashBefore);
    expect(session.getActionLog().length).toBe(logLenBefore);
  });

  it('deserializeReplay does not mutate the input replay', () => {
    const session = buildSampleSession();
    const replay = serializeReplay(session);
    const snapshotBefore = JSON.stringify(replay);

    deserializeReplay(replay);

    const snapshotAfter = JSON.stringify(replay);
    expect(snapshotAfter).toBe(snapshotBefore);
  });

  it('replayToFinalState does not mutate the input replay', () => {
    const session = buildSampleSession();
    const replay = serializeReplay(session);
    const snapshotBefore = JSON.stringify(replay);

    replayToFinalState(replay);

    expect(JSON.stringify(replay)).toBe(snapshotBefore);
  });

  it('mutating session AFTER serialization does not corrupt the snapshot', () => {
    const session = buildSampleSession();
    const replay = serializeReplay(session);
    const finalHashBefore = replay.finalHash;
    const logLenBefore = replay.actionLog.length;

    // Continue the session.
    session.applyPlayerAction('B', { type: 'END_TURN' });

    // Snapshot is unaffected.
    expect(replay.finalHash).toBe(finalHashBefore);
    expect(replay.actionLog.length).toBe(logLenBefore);
    // And it still validates as the snapshot's actual final hash.
    expect(validateReplay(replay).ok).toBe(true);
  });
});

// Local type re-import for the immutability cast above.
import type { LoggedAction } from '../MatchSession.js';
