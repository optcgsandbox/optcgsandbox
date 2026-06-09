// Replay artifact serialization (Phase F-1).
//
// A MatchReplayV1 is the persisted form of a finished or in-progress match.
// It contains everything required to reconstruct the authoritative state
// byte-for-byte:
//
//   - schemaVersion           — discriminator for forward-compatibility
//   - initialState            — the state the match started from
//   - actionLog               — every accepted action, in order
//   - finalHash               — hash of the replayed state; desync canary
//   - createdAt               — optional ISO-8601 timestamp (metadata only)
//
// The format is the SOURCE OF TRUTH for a match. We deliberately do NOT
// persist a snapshot of the final state — every byte of that final state
// must derive from re-running the log against initialState. Doing it any
// other way invites two divergent representations of the same match, and
// the cheapest cure is to never have two in the first place.
//
// Phase F-1 is pure data + helpers. No I/O, no persistence backend, no
// transport. Phase F-2 wires this into a storage layer (filesystem, KV,
// blob store — TBD).

import { applyAction } from '../engine-v2/reducers/applyAction.js';
import type { Action, ActionType } from '../engine-v2/protocol/actions.js';
import type { GameState, PlayerId } from '../engine-v2/state/types.js';
import { MatchSession, type LoggedAction } from './MatchSession.js';
import { computeStateHash } from './stateHash.js';
import { advanceTurnPipelineIfNeeded } from './turnPipeline.js';
import { relinkInstances } from './relinkInstances.js';

// ────────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────────

export const REPLAY_SCHEMA_VERSION = 1 as const;
export type ReplaySchemaVersion = typeof REPLAY_SCHEMA_VERSION;

export interface MatchReplayV1 {
  readonly schemaVersion: ReplaySchemaVersion;
  readonly initialState: GameState;
  readonly actionLog: ReadonlyArray<LoggedAction>;
  readonly finalHash: string;
  readonly createdAt?: string;
}

export type ValidationOk = { readonly ok: true };
export type ValidationFail = { readonly ok: false; readonly reason: string };
export type ValidationOutcome = ValidationOk | ValidationFail;

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Snapshot a MatchSession into a persistable replay artifact. Returns a
 * deep clone — mutating the result is safe and does NOT affect the source
 * session.
 */
export function serializeReplay(session: MatchSession): MatchReplayV1 {
  const initialState = structuredClone(session.getInitialState());
  const actionLog = structuredClone(
    session.getActionLog() as LoggedAction[],
  ) as ReadonlyArray<LoggedAction>;
  const finalHash = session.getStateHash();

  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    initialState,
    actionLog,
    finalHash,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Reconstruct a MatchSession from a persisted replay. Validates structure
 * + hash parity before accepting. Throws with a precise reason on any
 * failure so callers never end up holding a session built on lies.
 *
 * Does NOT mutate `replay`. Performs a defensive deep-clone of every
 * referenced field as it passes through.
 */
export function deserializeReplay(replay: MatchReplayV1): MatchSession {
  const validation = validateReplay(replay);
  if (!validation.ok) {
    throw new Error(`deserializeReplay: ${validation.reason}`);
  }
  // Defensive copies — the rebuilt session must not share refs with the
  // caller's replay object.
  const initialState = structuredClone(replay.initialState);
  const log = structuredClone(replay.actionLog as LoggedAction[]);
  return MatchSession.fromActionLog(initialState, log);
}

/**
 * Run the replay's actionLog against its initialState and return ONLY the
 * final state. Does not construct a MatchSession. Used by validation and
 * by replay viewers that don't need the wrapper.
 */
export function replayToFinalState(replay: MatchReplayV1): GameState {
  // F-7k BUG-002 — restore aliasing after JSON deserialization.
  const init = relinkInstances(structuredClone(replay.initialState));
  let state = init;
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
 * Structural + semantic validation. Returns `{ ok: true }` only when:
 *
 *   - schemaVersion is the supported value (1)
 *   - initialState is a non-null object
 *   - finalHash is a non-empty string
 *   - actionLog is an array
 *   - every entry has player ∈ {'A','B'} and action with a string `type`
 *   - replaying the log produces a state whose hash matches finalHash
 *
 * Replay failure (engine throws — e.g. illegal action after cards.json
 * change) is also caught and surfaced as a failure reason.
 */
export function validateReplay(replay: MatchReplayV1): ValidationOutcome {
  // Structural checks first — cheap and stops obvious tampering early.
  if (replay === null || typeof replay !== 'object') {
    return { ok: false, reason: 'replay_is_not_an_object' };
  }
  if (replay.schemaVersion !== REPLAY_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `unsupported_schema_version: ${String(replay.schemaVersion)}`,
    };
  }
  if (replay.initialState === null || typeof replay.initialState !== 'object') {
    return { ok: false, reason: 'missing_or_invalid_initialState' };
  }
  if (typeof replay.finalHash !== 'string' || replay.finalHash.length === 0) {
    return { ok: false, reason: 'missing_or_invalid_finalHash' };
  }
  if (!Array.isArray(replay.actionLog)) {
    return { ok: false, reason: 'actionLog_is_not_an_array' };
  }
  for (let i = 0; i < replay.actionLog.length; i++) {
    const entry = replay.actionLog[i];
    const entryCheck = validateLogEntry(entry, i);
    if (!entryCheck.ok) return entryCheck;
  }

  // Optional metadata: if present, createdAt must be a string.
  if (replay.createdAt !== undefined && typeof replay.createdAt !== 'string') {
    return { ok: false, reason: 'createdAt_must_be_string_if_present' };
  }

  // Semantic check: replay the log and confirm hash parity. Engine throws
  // (e.g. RegistryValidationError, invariant violations) become validation
  // failures rather than uncaught exceptions.
  let finalState: GameState;
  try {
    finalState = replayToFinalState(replay);
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
// Helpers
// ────────────────────────────────────────────────────────────────────

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

// `Action` type assertion site — keeps eslint happy if a strict lint rule
// flags unused imports.
export type { Action };
