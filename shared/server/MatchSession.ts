// Server-authoritative session wrapper around the verified engine.
//
// Responsibilities:
//   - Hold the single authoritative GameState for a match.
//   - Validate every player action against `getLegalActions` BEFORE applying.
//   - Append every accepted action to an immutable action log.
//   - Compute + cache a deterministic state hash for desync detection.
//   - Project the state for each viewer with hidden zones anonymized.
//   - Reconstruct from `{ initialState, actionLog }` for replay / reconnect.
//
// Non-goals (Phase E — do NOT add here):
//   - No I/O. No networking. No persistence. No timers. No randomness.
//   - No engine modifications. MatchSession only WRAPS engine entry points.

import { applyAction } from '../engine-v2/reducers/applyAction.js';
import { getLegalActions } from '../engine-v2/rules/legality.js';
import type { Action } from '../engine-v2/protocol/actions.js';
import type { GameState, PlayerId } from '../engine-v2/state/types.js';
import { computeStateHash } from './stateHash.js';
import { projectForViewer, type PublicGameState, type ViewerId } from './publicProjection.js';
import { advanceTurnPipelineIfNeeded } from './turnPipeline.js';
import { relinkInstances } from './relinkInstances.js';

export interface LoggedAction {
  readonly player: PlayerId;
  readonly action: Action;
}

export interface ApplyResultAccepted {
  readonly accepted: true;
  readonly hash: string;
  readonly events: ReadonlyArray<unknown>;
}

export interface ApplyResultRejected {
  readonly accepted: false;
  readonly reason: string;
}

export type ApplyResult = ApplyResultAccepted | ApplyResultRejected;

export interface ValidationResult {
  readonly legal: boolean;
  readonly reason?: string;
}

/**
 * Authoritative wrapper around a single match. Pure — no I/O, no time, no
 * sockets. All mutation funnels through `applyPlayerAction`.
 */
export class MatchSession {
  private _state: GameState;
  private readonly _initialState: GameState;
  private readonly _actionLog: LoggedAction[] = [];
  private _hash: string;

  /**
   * @param initialState  The state to start from. Must already be set up
   *                      (decks loaded, dice roll done, mulligans complete)
   *                      OR a fresh initialState awaiting setup actions.
   *                      The caller decides; MatchSession itself does not
   *                      perform setup.
   */
  constructor(initialState: GameState) {
    // Defensive deep-clone of the initial state so that subsequent mutations
    // to the caller's object can't leak into our authoritative copy.
    //
    // F-7k BUG-002 — after clone we relink player.{leader,field,stage}
    // references back to `state.instances[id]`. JSON round-trips across
    // DO RPC boundaries (Matchmaker → GameRoom) break the aliasing the
    // local-play fixtures + reducers assume. Restore it on ingress so
    // ATTACH_DON, etc., observe their writes via the player-side ref.
    this._initialState = relinkInstances(structuredClone(initialState));
    this._state = relinkInstances(structuredClone(initialState));
    this._hash = computeStateHash(this._state);
  }

  // ────────────────────────────────────────────────────────────────────
  // Action ingestion
  // ────────────────────────────────────────────────────────────────────

  /**
   * Validate + apply an action attributed to `player`. Rejects with a reason
   * if illegal; never mutates state on rejection. On accept, appends to the
   * action log and updates the cached hash.
   */
  applyPlayerAction(player: PlayerId, action: Action): ApplyResult {
    if (this._state.result !== null) {
      return { accepted: false, reason: 'match_already_concluded' };
    }

    const validation = this.validateLegalAction(player, action);
    if (!validation.legal) {
      return { accepted: false, reason: validation.reason ?? 'illegal_action' };
    }

    let result;
    try {
      result = applyAction(this._state, player, action);
    } catch (err) {
      // Engine threw (e.g. invariant violation, unregistered handler).
      // Treat as a rejection — do NOT mutate state, do NOT log.
      const msg = err instanceof Error ? err.message : String(err);
      return { accepted: false, reason: `engine_error: ${msg}` };
    }

    // Server-authoritative turn-pipeline sweep — see turnPipeline.ts for
    // the full rationale + invariant. Without this, every END_TURN leaves
    // the new active player with only CONCEDE legal and the match stalls.
    this._state = advanceTurnPipelineIfNeeded(result.state);

    this._actionLog.push({ player, action });
    this._hash = computeStateHash(this._state);

    return { accepted: true, hash: this._hash, events: result.events };
  }

  /**
   * Pure legality check via `getLegalActions(state, player)`. Returns whether
   * the action is currently legal for the given player and, if not, a brief
   * reason useful for client diagnostics. Does NOT mutate state.
   */
  validateLegalAction(player: PlayerId, action: Action): ValidationResult {
    // Special-case CONCEDE: always legal for either player as long as match
    // is in progress. `getLegalActions` may or may not include CONCEDE in
    // its enumeration (some engines treat it as out-of-band).
    if (action.type === 'CONCEDE') {
      return { legal: true };
    }

    const legal = getLegalActions(this._state, player);
    const match = legal.some((a) => actionsEqual(a, action));
    if (match) return { legal: true };

    // Heuristic reasons for the most common rejections.
    if (this._state.activePlayer !== player && !isPassiveActionType(action.type)) {
      return { legal: false, reason: 'not_your_turn' };
    }
    if (this._state.pending !== null) {
      const pendingKind = this._state.pending.kind;
      if (!matchesPendingKind(action.type, pendingKind)) {
        return {
          legal: false,
          reason: `pending_${pendingKind}_requires_response`,
        };
      }
    }
    return { legal: false, reason: 'not_in_legal_actions' };
  }

  // ────────────────────────────────────────────────────────────────────
  // Read-only views
  // ────────────────────────────────────────────────────────────────────

  getStateHash(): string {
    return this._hash;
  }

  /**
   * Projected, viewer-safe state with opponent hidden zones anonymized.
   * See publicProjection.ts for the exact projection contract.
   */
  getPublicStateFor(viewer: ViewerId): PublicGameState {
    return projectForViewer(this._state, viewer);
  }

  /**
   * Returns the full authoritative state. ONLY for server-internal /
   * test use — never expose this to a client over the wire.
   */
  getAuthoritativeState(): GameState {
    return this._state;
  }

  getActionLog(): ReadonlyArray<LoggedAction> {
    return this._actionLog;
  }

  getInitialState(): GameState {
    return this._initialState;
  }

  // ────────────────────────────────────────────────────────────────────
  // Replay / reconnect
  // ────────────────────────────────────────────────────────────────────

  /**
   * Reapply this session's action log from the stored initial state. Returns
   * the rebuilt state + its hash. Used by `assertReplayParity()` and by the
   * reconnect / desync-recovery path.
   */
  replay(): { state: GameState; hash: string } {
    return MatchSession.replayLog(this._initialState, this._actionLog);
  }

  /**
   * Throws if `replay()` does not produce a state whose hash matches the
   * live cached hash. Used in tests + as an optional runtime sanity check.
   */
  assertReplayParity(): void {
    const { hash } = this.replay();
    if (hash !== this._hash) {
      throw new Error(
        `MatchSession replay-parity failed: live=${this._hash} replay=${hash}`,
      );
    }
  }

  /**
   * Build a new MatchSession from a prior `{ initialState, actionLog }`. This
   * is the reconnect / load-replay path. The resulting session's state, log,
   * and hash all match what the original session would have at that point.
   *
   * If the engine rejects any logged action (e.g. cards.json changed in a
   * way that altered legality), this throws — the replay is no longer
   * faithful and the caller must decide what to do.
   */
  static fromActionLog(
    initialState: GameState,
    actionLog: ReadonlyArray<LoggedAction>,
  ): MatchSession {
    const session = new MatchSession(initialState);
    for (let i = 0; i < actionLog.length; i++) {
      const { player, action } = actionLog[i]!;
      const res = session.applyPlayerAction(player, action);
      if (!res.accepted) {
        throw new Error(
          `MatchSession.fromActionLog: action ${i} rejected (${res.reason})`,
        );
      }
    }
    return session;
  }

  /**
   * Pure helper — reapplies a log onto an initial state and returns the
   * resulting state + hash without constructing a MatchSession.
   */
  static replayLog(
    initialState: GameState,
    log: ReadonlyArray<LoggedAction>,
  ): { state: GameState; hash: string } {
    // Relink instances first — see constructor + relinkInstances.ts for
    // the JSON-round-trip aliasing fix (F-7k BUG-002).
    let state = relinkInstances(structuredClone(initialState));
    for (let i = 0; i < log.length; i++) {
      const { player, action } = log[i]!;
      const res = applyAction(state, player, action);
      // Mirror applyPlayerAction's turn-pipeline sweep so replay produces
      // a bit-identical state (and therefore hash) to the live session.
      state = advanceTurnPipelineIfNeeded(res.state);
    }
    return { state, hash: computeStateHash(state) };
  }
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Deep equality for two engine actions. Engine actions are plain JSON-safe
 * objects, so canonical-JSON equality is sufficient and deterministic.
 */
function actionsEqual(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  return canonicalJSON(a) === canonicalJSON(b);
}

function canonicalJSON(obj: unknown): string {
  return JSON.stringify(obj, (_k, v) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      sorted[k] = (v as Record<string, unknown>)[k];
    }
    return sorted;
  });
}

// Action types that the opponent player can dispatch out-of-turn (block /
// counter / trigger response / etc). If the action's type is NOT in this
// list AND `state.activePlayer !== player`, we surface "not_your_turn".
const PASSIVE_ACTION_TYPES = new Set<string>([
  'DECLARE_BLOCKER',
  'SKIP_BLOCKER',
  'PLAY_COUNTER',
  'SKIP_COUNTER',
  'RESOLVE_TRIGGER',
  'RESOLVE_PEEK',
  'RESOLVE_DISCARD',
  'RESOLVE_CHOOSE_ONE',
  'RESOLVE_TARGET_PICK',
  'CONCEDE',
  'CHOOSE_FIRST',
  'CHOOSE_SECOND',
  'MULLIGAN',
  'KEEP_HAND',
  'ROLL_DICE',
]);

function isPassiveActionType(type: string): boolean {
  return PASSIVE_ACTION_TYPES.has(type);
}

/**
 * Mapping from action type → which `pending.kind` it satisfies. Used to
 * surface a clearer rejection reason when a player tries to act normally
 * while a pending choice window is open.
 */
function matchesPendingKind(actionType: string, pendingKind: string): boolean {
  switch (pendingKind) {
    case 'attack':
      return (
        actionType === 'DECLARE_BLOCKER' ||
        actionType === 'SKIP_BLOCKER' ||
        actionType === 'PLAY_COUNTER' ||
        actionType === 'SKIP_COUNTER'
      );
    case 'trigger':
      return actionType === 'RESOLVE_TRIGGER';
    case 'peek':
      return actionType === 'RESOLVE_PEEK';
    case 'discard':
      return actionType === 'RESOLVE_DISCARD';
    case 'choose_one':
      return actionType === 'RESOLVE_CHOOSE_ONE';
    case 'attack_target_pick':
      return actionType === 'RESOLVE_TARGET_PICK';
    default:
      return false;
  }
}
