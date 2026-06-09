/**
 * MatchSession — hash parity.
 *
 * Validates the relationship between live hash and replayed hash at EVERY
 * point in the action log, not just at the end. This is the desync-detection
 * core: a client and server holding the same log must compute the same hash
 * at the same point.
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
  canonicalize,
  computeStateHash,
  fnv1a64,
} from '../stateHash.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

describe('MatchSession — hash parity', () => {
  it('live hash equals replayed hash after each action', () => {
    const initial = buildBasicGameState();
    const handIdA = moveTopOfDeckToHand(initial, 'A');
    const session = new MatchSession(initial);

    // Snapshot live hashes after each action.
    const liveHashes: string[] = [];
    liveHashes.push(session.getStateHash());

    session.applyPlayerAction('A', {
      type: 'PLAY_CARD',
      instanceId: handIdA,
      replaceTargetId: null,
    });
    liveHashes.push(session.getStateHash());

    session.applyPlayerAction('A', { type: 'END_TURN' });
    liveHashes.push(session.getStateHash());

    // Replay walks the log; reconstruct each prefix and verify the hash.
    const initialClone = session.getInitialState();
    const log = session.getActionLog();

    expect(computeStateHash(initialClone)).toBe(liveHashes[0]);

    for (let i = 1; i <= log.length; i++) {
      const prefix = log.slice(0, i);
      const { hash } = MatchSession.replayLog(initialClone, prefix);
      expect(hash).toBe(liveHashes[i]);
    }
  });

  it('fnv1a64 is portable: same input → same output', () => {
    const a = fnv1a64('hello world');
    const b = fnv1a64('hello world');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('canonicalize produces the same string regardless of input key order', () => {
    const a = { z: 1, a: 2, m: { y: 3, b: 4 } };
    const b = { a: 2, m: { b: 4, y: 3 }, z: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('different states produce different hashes', () => {
    const s1 = buildBasicGameState();
    const s2 = buildBasicGameState();
    // s2 ends turn — different state.
    const session = new MatchSession(s2);
    session.applyPlayerAction('A', { type: 'END_TURN' });
    expect(computeStateHash(s1)).not.toBe(session.getStateHash());
  });

  it('engine-internal property ordering does not affect hash', () => {
    // Build the same state twice; both hashes must match even though the
    // fixture may insert keys in different orders (it does not, but the
    // canonicalize step is what enforces this invariant).
    const s1 = buildBasicGameState();
    const s2 = buildBasicGameState();
    expect(computeStateHash(s1)).toBe(computeStateHash(s2));
  });
});
