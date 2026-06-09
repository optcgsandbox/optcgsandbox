/**
 * MatchReplayV2 — compact replay artifact tests. Phase F-5b.2.
 *
 * Mirrors V1's coverage (round-trip, validation, immutability) and
 * adds V2-specific checks (cardLibrary stripping, hash mismatch,
 * staticData injection) plus a V1-vs-V2 size comparison on a state
 * whose cardLibrary is large enough for the comparison to be
 * meaningful (NOT the buildBasicGameState fixture — that one has only
 * 4 cards in the library).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from '../../engine-v2/__tests__/fixtures.js';
import type { Card, LeaderCard } from '../../engine-v2/cards/Card.js';
import { initialState as buildInitialState } from '../../engine-v2/setup/initialState.js';
import { MatchSession } from '../MatchSession.js';
import {
  REPLAY_SCHEMA_VERSION_V2,
  compactReplayToFinalState,
  deserializeCompactReplay,
  hashCardLibrary,
  serializeCompactReplay,
  validateCompactReplay,
  type MatchReplayV2,
  type StaticData,
} from '../serializeCompact.js';
import { serializeReplay, replayToFinalState } from '../serialize.js';
import { computeStateHash } from '../stateHash.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

// ────────────────────────────────────────────────────────────────────
// Fixture helpers
// ────────────────────────────────────────────────────────────────────

function buildSampleSession() {
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

function staticDataFor(session: MatchSession): StaticData {
  const initial = session.getInitialState();
  return { cardLibrary: initial.cardLibrary };
}

/**
 * Build a synthetic GameState whose cardLibrary is intentionally large
 * (200+ unique character cards) so V1-vs-V2 size differences are
 * meaningful. Mirrors what real production decks + corpus loads look
 * like, without needing real cards.json data.
 */
function buildLargeLibrarySession(): MatchSession {
  const LEADER: LeaderCard = {
    id: 'SIZE-LEADER',
    kind: 'leader',
    name: 'Size Test Leader',
    cost: null,
    power: 5000,
    life: 5,
    counterValue: null,
    colors: ['red'],
    traits: ['SizeTest'],
    keywords: [],
    effectText: '',
  };
  const charCount = 200;
  const deckCards: Card[] = [];
  for (let i = 0; i < charCount; i++) {
    deckCards.push({
      id: `SIZE-CHAR-${i.toString().padStart(4, '0')}`,
      kind: 'character',
      name: `Size Test Character #${i}`,
      cost: 2,
      power: 3000,
      counterValue: 1000,
      colors: ['red'],
      traits: ['SizeTest'],
      keywords: [],
      effectText:
        'A reasonably long effect text so each card definition occupies non-trivial bytes — this is the realistic shape of corpus entries that drives the V1-vs-V2 byte gap. ' +
        'Placeholder filler so the cardLibrary blob is the dominant component of a serialized replay, mirroring what cards.json would look like in production.',
    });
  }
  // Deck only needs 15 instances to be a valid replay subject; the
  // library carries the rest of the bytes.
  const playableDeck = deckCards.slice(0, 15);
  const state = buildInitialState({
    seed: 1234,
    decks: {
      A: { leader: LEADER, cards: playableDeck },
      B: { leader: LEADER, cards: playableDeck },
    },
  });
  // Inject the rest of the library so V1 carries the full mass.
  for (const c of deckCards.slice(15)) state.cardLibrary[c.id] = c;
  return new MatchSession(state);
}

// ────────────────────────────────────────────────────────────────────
// Round trip
// ────────────────────────────────────────────────────────────────────

describe('serializeCompact — round trip', () => {
  it('round-trips a session and the rebuilt session matches the original hash', () => {
    const original = buildSampleSession();
    const replay = serializeCompactReplay(original, {
      cardLibraryVersion: 'test-fixture-v1',
    });

    expect(replay.schemaVersion).toBe(REPLAY_SCHEMA_VERSION_V2);
    expect(replay.finalHash).toBe(original.getStateHash());
    expect(replay.staticDataRef.cardLibraryVersion).toBe('test-fixture-v1');
    expect(replay.staticDataRef.cardLibraryHash).toMatch(/^[0-9a-f]{16}$/);

    // cardLibrary MUST NOT be present on the patch.
    expect(
      (replay.initialStatePatch as { cardLibrary?: unknown }).cardLibrary,
    ).toBeUndefined();

    const rebuilt = deserializeCompactReplay(replay, staticDataFor(original));
    expect(rebuilt.getStateHash()).toBe(original.getStateHash());
    expect(rebuilt.getActionLog().length).toBe(original.getActionLog().length);
  });

  it('V2 reconstructs the same final state as V1 for the same session', () => {
    const session = buildSampleSession();
    const v1 = serializeReplay(session);
    const v2 = serializeCompactReplay(session);

    const v1Final = replayToFinalState(v1);
    const v2Final = compactReplayToFinalState(v2, staticDataFor(session));

    expect(computeStateHash(v1Final)).toBe(computeStateHash(v2Final));
  });

  it('createdAt is set as an ISO-8601 string when not overridden', () => {
    const session = buildSampleSession();
    const replay = serializeCompactReplay(session);
    expect(replay.createdAt).toBeDefined();
    expect(replay.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('zero-action replay is supported', () => {
    const session = new MatchSession(buildBasicGameState());
    const replay = serializeCompactReplay(session);
    expect(replay.actionLog.length).toBe(0);
    const rebuilt = deserializeCompactReplay(replay, staticDataFor(session));
    expect(rebuilt.getStateHash()).toBe(session.getStateHash());
  });
});

// ────────────────────────────────────────────────────────────────────
// Validation failures
// ────────────────────────────────────────────────────────────────────

describe('serializeCompact — validation failures', () => {
  it('rejects unsupported schemaVersion', () => {
    const session = buildSampleSession();
    const replay = serializeCompactReplay(session);
    const tampered = { ...replay, schemaVersion: 99 } as unknown as MatchReplayV2;
    const r = validateCompactReplay(tampered, staticDataFor(session));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unsupported_schema_version/);
  });

  it('rejects tampered actionLog (truncated)', () => {
    const session = buildSampleSession();
    const replay = serializeCompactReplay(session);
    const tampered = { ...replay, actionLog: replay.actionLog.slice(0, -1) };
    const r = validateCompactReplay(tampered, staticDataFor(session));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/final_hash_mismatch/);
  });

  it('rejects tampered finalHash', () => {
    const session = buildSampleSession();
    const replay = serializeCompactReplay(session);
    const tampered = { ...replay, finalHash: '0000000000000000' };
    const r = validateCompactReplay(tampered, staticDataFor(session));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/final_hash_mismatch/);
  });

  it('rejects malformed actionLog (not an array)', () => {
    const session = buildSampleSession();
    const replay = serializeCompactReplay(session);
    const tampered = { ...replay, actionLog: 'not-an-array' } as unknown as MatchReplayV2;
    const r = validateCompactReplay(tampered, staticDataFor(session));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('actionLog_is_not_an_array');
  });

  it('rejects missing initialStatePatch', () => {
    const session = buildSampleSession();
    const replay = serializeCompactReplay(session);
    const tampered = {
      ...replay,
      initialStatePatch: undefined,
    } as unknown as MatchReplayV2;
    const r = validateCompactReplay(tampered, staticDataFor(session));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_or_invalid_initialStatePatch');
  });

  it('rejects missing staticDataRef', () => {
    const session = buildSampleSession();
    const replay = serializeCompactReplay(session);
    const tampered = { ...replay, staticDataRef: null } as unknown as MatchReplayV2;
    const r = validateCompactReplay(tampered, staticDataFor(session));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_or_invalid_staticDataRef');
  });

  it('rejects missing staticData (caller side)', () => {
    const session = buildSampleSession();
    const replay = serializeCompactReplay(session);
    const r = validateCompactReplay(
      replay,
      undefined as unknown as StaticData,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_or_invalid_staticData');
  });

  it('rejects cardLibrary hash mismatch (silent drift defense)', () => {
    const session = buildSampleSession();
    const replay = serializeCompactReplay(session);
    // Tamper with the staticData: drop a card from the library.
    const wrongData: StaticData = {
      cardLibrary: { ...staticDataFor(session).cardLibrary },
    };
    delete wrongData.cardLibrary['TEST-CHAR-RUSH'];
    const r = validateCompactReplay(replay, wrongData);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^card_library_hash_mismatch/);
  });

  it('deserializeCompactReplay throws on any validation failure', () => {
    const session = buildSampleSession();
    const replay = serializeCompactReplay(session);
    const tampered = { ...replay, finalHash: '0000000000000000' };
    expect(() =>
      deserializeCompactReplay(tampered, staticDataFor(session)),
    ).toThrow(/final_hash_mismatch/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Immutability
// ────────────────────────────────────────────────────────────────────

describe('serializeCompact — immutability', () => {
  it('serializeCompactReplay does not mutate the source session', () => {
    const session = buildSampleSession();
    const hashBefore = session.getStateHash();
    const logLenBefore = session.getActionLog().length;

    const replay = serializeCompactReplay(session);
    (replay.actionLog as unknown[]).push({
      player: 'A',
      action: { type: 'END_TURN' },
    });
    (replay as { finalHash: string }).finalHash = 'tampered';

    expect(session.getStateHash()).toBe(hashBefore);
    expect(session.getActionLog().length).toBe(logLenBefore);
  });

  it('deserializeCompactReplay does not mutate the input replay', () => {
    const session = buildSampleSession();
    const replay = serializeCompactReplay(session);
    const snapshotBefore = JSON.stringify(replay);

    deserializeCompactReplay(replay, staticDataFor(session));

    expect(JSON.stringify(replay)).toBe(snapshotBefore);
  });

  it('compactReplayToFinalState does not mutate the input replay', () => {
    const session = buildSampleSession();
    const replay = serializeCompactReplay(session);
    const snapshotBefore = JSON.stringify(replay);

    compactReplayToFinalState(replay, staticDataFor(session));

    expect(JSON.stringify(replay)).toBe(snapshotBefore);
  });

  it('staticData.cardLibrary not aliased into the rebuilt session', () => {
    const session = buildSampleSession();
    const replay = serializeCompactReplay(session);
    const staticData = staticDataFor(session);
    const rebuilt = deserializeCompactReplay(replay, staticData);

    // Mutate the static blob AFTER deserialize.
    delete (staticData.cardLibrary as Record<string, unknown>)['TEST-CHAR-RUSH'];

    // Rebuilt session keeps its own copy.
    expect(
      rebuilt.getInitialState().cardLibrary['TEST-CHAR-RUSH'],
    ).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// V1 vs V2 size comparison
// ────────────────────────────────────────────────────────────────────

describe('serializeCompact — V1 vs V2 size comparison', () => {
  it('V2 is meaningfully smaller than V1 for a state with a large cardLibrary', () => {
    const session = buildLargeLibrarySession();
    const v1 = serializeReplay(session);
    const v2 = serializeCompactReplay(session);

    const v1Bytes = JSON.stringify(v1).length;
    const v2Bytes = JSON.stringify(v2).length;

    // Sanity: V1 carries the bulk; V2 should be substantially less.
    // We assert a 2x+ shrink without pinning an exact ratio (which
    // would be fragile to fixture changes).
    expect(v1Bytes).toBeGreaterThan(50_000);
    expect(v2Bytes * 2).toBeLessThan(v1Bytes);
  });

  it('V2 round-trip still works at the larger size', () => {
    const session = buildLargeLibrarySession();
    const replay = serializeCompactReplay(session);
    const rebuilt = deserializeCompactReplay(replay, staticDataFor(session));
    expect(rebuilt.getStateHash()).toBe(session.getStateHash());
  });

  it('hashCardLibrary is deterministic across calls', () => {
    const session = buildSampleSession();
    const lib = session.getInitialState().cardLibrary;
    expect(hashCardLibrary(lib)).toBe(hashCardLibrary(lib));
    expect(hashCardLibrary(lib)).toMatch(/^[0-9a-f]{16}$/);
  });
});
