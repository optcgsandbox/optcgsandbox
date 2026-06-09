// MatchReplayV2 — compact replay artifact (Phase F-5b.2).
//
// V1 (`MatchReplayV1`) is correct but stores the full `GameState`
// including `cardLibrary`. With production decks the library accounts
// for ~half of the artifact and pushes the JSON past Cloudflare's
// 128 KiB per-key Durable Object storage cap; the worker's
// `persistReplay()` currently skips above 100 KiB and records the
// observed size at `replay_skipped_bytes`.
//
// V2 closes that gap by treating `cardLibrary` as STATIC data:
//
//   - `serializeCompactReplay(session)` strips `cardLibrary` from
//     `initialState` and records its content hash in `staticDataRef`.
//   - `deserializeCompactReplay(replay, staticData)` requires the
//     caller to inject a `StaticData` blob containing the right
//     `cardLibrary`. The hash MUST match the stored
//     `staticDataRef.cardLibraryHash`. Mismatch = validation fail.
//
// V2 is portable: the same artifact replays correctly against any
// future cardLibrary that hashes identically, and the hash is the
// canary against silent drift.
//
// V1 is intentionally NOT deprecated. Callers that don't have a stable
// staticData lookup still use V1 (e.g., the existing replay viewer
// tests). The two formats co-exist; the worker chooses V2 because the
// DO already holds the cardLibrary in `bootstrap`.

import { applyAction } from '../engine-v2/reducers/applyAction.js';
import type { Action, ActionType } from '../engine-v2/protocol/actions.js';
import type { GameState, PlayerId } from '../engine-v2/state/types.js';
import { MatchSession, type LoggedAction } from './MatchSession.js';
import type { ValidationOutcome } from './serialize.js';
import { canonicalize, computeStateHash, fnv1a64 } from './stateHash.js';
import { advanceTurnPipelineIfNeeded } from './turnPipeline.js';
import { relinkInstances } from './relinkInstances.js';

// ────────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────────

export const REPLAY_SCHEMA_VERSION_V2 = 2 as const;
export type ReplaySchemaVersionV2 = typeof REPLAY_SCHEMA_VERSION_V2;

/**
 * GameState minus `cardLibrary`. The library is re-attached at
 * deserialize time from caller-supplied `StaticData`.
 */
export type InitialStatePatch = Omit<GameState, 'cardLibrary'>;

export interface StaticDataRef {
  /**
   * FNV-1a 64-bit hash (16 lowercase hex chars) of the canonicalized
   * cardLibrary at serialize time. The same hash MUST be reproducible
   * from the caller's `StaticData.cardLibrary` at deserialize time.
   */
  readonly cardLibraryHash: string;
  /**
   * Optional human-readable version tag. Recommended:
   *   - cards.json release tag, e.g. `'2026-06-08'`
   *   - dev marker, e.g. `'dev-stub-v1'`
   */
  readonly cardLibraryVersion?: string;
}

export interface MatchReplayV2 {
  readonly schemaVersion: ReplaySchemaVersionV2;
  readonly initialStatePatch: InitialStatePatch;
  readonly actionLog: ReadonlyArray<LoggedAction>;
  readonly finalHash: string;
  readonly createdAt?: string;
  readonly staticDataRef: StaticDataRef;
}

export interface StaticData {
  readonly cardLibrary: GameState['cardLibrary'];
  /** Mirrors `staticDataRef.cardLibraryVersion`. Caller hint only. */
  readonly cardLibraryVersion?: string;
}

export interface SerializeCompactOptions {
  /** Optional human-readable version tag — surfaces as `staticDataRef.cardLibraryVersion`. */
  readonly cardLibraryVersion?: string;
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Hash a cardLibrary so callers can compare without touching internal
 * canonicalization rules. Exported for the worker, which precomputes
 * the hash to skip re-canonicalizing in the hot path.
 */
export function hashCardLibrary(lib: GameState['cardLibrary']): string {
  return fnv1a64(canonicalize(lib));
}

/**
 * Snapshot a MatchSession into V2 compact form. Returns a deep clone;
 * mutating the result is safe and does NOT affect the source session.
 */
export function serializeCompactReplay(
  session: MatchSession,
  options?: SerializeCompactOptions,
): MatchReplayV2 {
  const fullInitial = session.getInitialState();
  const { cardLibrary, ...rest } = fullInitial;
  const cardLibraryHash = hashCardLibrary(cardLibrary);

  return {
    schemaVersion: REPLAY_SCHEMA_VERSION_V2,
    initialStatePatch: structuredClone(rest) as InitialStatePatch,
    actionLog: structuredClone(
      session.getActionLog() as LoggedAction[],
    ) as ReadonlyArray<LoggedAction>,
    finalHash: session.getStateHash(),
    createdAt: new Date().toISOString(),
    staticDataRef: {
      cardLibraryHash,
      ...(options?.cardLibraryVersion !== undefined
        ? { cardLibraryVersion: options.cardLibraryVersion }
        : {}),
    },
  };
}

/**
 * Reconstruct a MatchSession from a V2 replay + caller-supplied static
 * data. Validates structure, the cardLibrary hash, and replay-hash
 * parity before constructing the session. Throws on any validation
 * failure so callers never end up holding a session built on lies.
 */
export function deserializeCompactReplay(
  replay: MatchReplayV2,
  staticData: StaticData,
): MatchSession {
  const validation = validateCompactReplay(replay, staticData);
  if (!validation.ok) {
    throw new Error(`deserializeCompactReplay: ${validation.reason}`);
  }
  const initialState = rehydrateInitialState(replay, staticData);
  const log = structuredClone(replay.actionLog as LoggedAction[]);
  return MatchSession.fromActionLog(initialState, log);
}

/**
 * Re-run the action log against the rehydrated initial state and
 * return only the final state. Mirrors V1's `replayToFinalState`.
 *
 * Throws if the underlying engine rejects an action (caller is
 * expected to have validated first; this is the inner loop used by
 * `validateCompactReplay`).
 */
export function compactReplayToFinalState(
  replay: MatchReplayV2,
  staticData: StaticData,
): GameState {
  // F-7k BUG-002 — `rehydrateInitialState` produces JSON-deserialized
  // state with no instance aliasing. Restore it before any reducer runs.
  const initial = relinkInstances(rehydrateInitialState(replay, staticData));
  let state = initial;
  for (let i = 0; i < replay.actionLog.length; i++) {
    const entry = replay.actionLog[i]!;
    const res = applyAction(state, entry.player, entry.action);
    // Mirror the live session's server-authoritative turn-pipeline sweep
    // (turnPipeline.ts). Without it, replay's final hash diverges from
    // the live session whenever the log contains an END_TURN.
    state = advanceTurnPipelineIfNeeded(res.state);
  }
  return state;
}

/**
 * Pure structural + semantic validation. Reasons match V1's taxonomy
 * where possible, with two additions specific to V2:
 *   - `missing_or_invalid_staticData`
 *   - `card_library_hash_mismatch: expected=... got=...`
 *
 * On replay failure, the engine's error message is surfaced as
 * `replay_failed: <engine message>` — same shape as V1.
 */
export function validateCompactReplay(
  replay: MatchReplayV2,
  staticData: StaticData,
): ValidationOutcome {
  if (replay === null || typeof replay !== 'object') {
    return { ok: false, reason: 'replay_is_not_an_object' };
  }
  if (replay.schemaVersion !== REPLAY_SCHEMA_VERSION_V2) {
    return {
      ok: false,
      reason: `unsupported_schema_version: ${String(replay.schemaVersion)}`,
    };
  }
  if (
    replay.initialStatePatch === null ||
    typeof replay.initialStatePatch !== 'object'
  ) {
    return { ok: false, reason: 'missing_or_invalid_initialStatePatch' };
  }
  if (typeof replay.finalHash !== 'string' || replay.finalHash.length === 0) {
    return { ok: false, reason: 'missing_or_invalid_finalHash' };
  }
  if (!Array.isArray(replay.actionLog)) {
    return { ok: false, reason: 'actionLog_is_not_an_array' };
  }
  if (
    replay.staticDataRef === null ||
    typeof replay.staticDataRef !== 'object'
  ) {
    return { ok: false, reason: 'missing_or_invalid_staticDataRef' };
  }
  if (
    typeof replay.staticDataRef.cardLibraryHash !== 'string' ||
    replay.staticDataRef.cardLibraryHash.length === 0
  ) {
    return { ok: false, reason: 'missing_or_invalid_cardLibraryHash' };
  }
  if (
    replay.createdAt !== undefined &&
    typeof replay.createdAt !== 'string'
  ) {
    return { ok: false, reason: 'createdAt_must_be_string_if_present' };
  }

  for (let i = 0; i < replay.actionLog.length; i++) {
    const entry = replay.actionLog[i];
    const check = validateLogEntry(entry, i);
    if (!check.ok) return check;
  }

  if (
    staticData === null ||
    typeof staticData !== 'object' ||
    staticData.cardLibrary === null ||
    typeof staticData.cardLibrary !== 'object'
  ) {
    return { ok: false, reason: 'missing_or_invalid_staticData' };
  }
  const expectedHash = replay.staticDataRef.cardLibraryHash;
  const actualHash = hashCardLibrary(staticData.cardLibrary);
  if (actualHash !== expectedHash) {
    return {
      ok: false,
      reason: `card_library_hash_mismatch: expected=${expectedHash} got=${actualHash}`,
    };
  }

  let finalState: GameState;
  try {
    finalState = compactReplayToFinalState(replay, staticData);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `replay_failed: ${msg}` };
  }
  const computed = computeStateHash(finalState);
  if (computed !== replay.finalHash) {
    return {
      ok: false,
      reason: `final_hash_mismatch: expected=${replay.finalHash} computed=${computed}`,
    };
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

function rehydrateInitialState(
  replay: MatchReplayV2,
  staticData: StaticData,
): GameState {
  return {
    ...structuredClone(replay.initialStatePatch),
    cardLibrary: structuredClone(staticData.cardLibrary),
  } as GameState;
}

const VALID_PLAYERS: ReadonlyArray<PlayerId> = ['A', 'B'];
const VALID_ACTION_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  'ROLL_DICE',
  'CHOOSE_FIRST',
  'CHOOSE_SECOND',
  'MULLIGAN',
  'KEEP_HAND',
  'PLAY_CARD',
  'PLAY_STAGE',
  'ATTACH_DON',
  'ACTIVATE_MAIN',
  'DECLARE_ATTACK',
  'DECLARE_BLOCKER',
  'PLAY_COUNTER',
  'SKIP_COUNTER',
  'SKIP_BLOCKER',
  'RESOLVE_TRIGGER',
  'RESOLVE_PEEK',
  'RESOLVE_DISCARD',
  'RESOLVE_CHOOSE_ONE',
  'RESOLVE_TARGET_PICK',
  'END_TURN',
  'CONCEDE',
]);

function validateLogEntry(entry: unknown, index: number): ValidationOutcome {
  if (entry === null || typeof entry !== 'object') {
    return { ok: false, reason: `actionLog[${index}]_is_not_an_object` };
  }
  const e = entry as { player?: unknown; action?: unknown };
  if (typeof e.player !== 'string' || !VALID_PLAYERS.includes(e.player as PlayerId)) {
    return { ok: false, reason: `actionLog[${index}]_invalid_player` };
  }
  if (e.action === null || typeof e.action !== 'object') {
    return { ok: false, reason: `actionLog[${index}]_invalid_action` };
  }
  const a = e.action as { type?: unknown };
  if (typeof a.type !== 'string') {
    return { ok: false, reason: `actionLog[${index}]_action_missing_type` };
  }
  if (!VALID_ACTION_TYPES.has(a.type as ActionType)) {
    return {
      ok: false,
      reason: `actionLog[${index}]_unknown_action_type: ${a.type}`,
    };
  }
  return { ok: true };
}

// Keep the `Action` import "used" for callers that re-export from here.
export type { Action };
