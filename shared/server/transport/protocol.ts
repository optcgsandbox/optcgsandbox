// Match-room wire protocol — Phase F-4b.
//
// Discriminated-union message types exchanged between a single client and
// the server-side `MatchRoom`. Transport-agnostic: a future WebSocket,
// Supabase Realtime, or Cloudflare Durable Object adapter parses bytes
// off the wire into a `ClientMessage`, hands it to `MatchRoom.handleMessage`,
// and serializes the returned `ServerMessage`s back out.
//
// Non-goals (intentionally NOT in this protocol):
//   - Auth. `clientId` and `player` are TRUSTED inputs. A real deployment
//     binds them to an authenticated session at the transport layer.
//   - Cryptographic signatures, replay protection, anti-cheat.
//   - Matchmaking, ranked, ELO, lobby state.
//   - Spectator subscription model (planned for F-5).
//   - Multi-room routing (a `MatchRoom` instance is one match).

import type { Action } from '../../engine-v2/protocol/actions.js';
import type { PlayerId } from '../../engine-v2/state/types.js';
import type { PublicGameState } from '../publicProjection.js';

// ─────────────────────────────────────────────────────────────────────
// Client → Server
// ─────────────────────────────────────────────────────────────────────

export interface ClientMessageJoin {
  readonly type: 'join';
  readonly player: PlayerId;
  readonly clientId: string;
}

export interface ClientMessageSubmitAction {
  readonly type: 'submit_action';
  readonly clientId: string;
  readonly action: Action;
  /**
   * Caller-supplied monotonic sequence number. Must strictly increase per
   * client. Re-submission with an already-seen seq is rejected as a
   * duplicate (see policy note on `MatchRoom.handleMessage`).
   */
  readonly clientSeq: number;
}

export interface ClientMessageRequestSnapshot {
  readonly type: 'request_snapshot';
  readonly clientId: string;
}

export interface ClientMessageLeave {
  readonly type: 'leave';
  readonly clientId: string;
}

export type ClientMessage =
  | ClientMessageJoin
  | ClientMessageSubmitAction
  | ClientMessageRequestSnapshot
  | ClientMessageLeave;

export type ClientMessageType = ClientMessage['type'];

// ─────────────────────────────────────────────────────────────────────
// Server → Client
// ─────────────────────────────────────────────────────────────────────

export interface ServerMessageJoined {
  readonly type: 'joined';
  readonly player: PlayerId;
  readonly state: PublicGameState;
  readonly hash: string;
  readonly lastSeq: number;
  /**
   * F-7e: viewer-specific legal actions computed server-side from the
   * TRUSTED full GameState (not the projection). Always present on
   * state-bearing messages so the client never computes legality
   * itself. See `MatchRoom.computeLegalActionsFor` for the contract.
   */
  readonly legalActions: ReadonlyArray<Action>;
}

export interface ServerMessageActionAccepted {
  readonly type: 'action_accepted';
  readonly clientSeq: number;
  readonly serverSeq: number;
  readonly hash: string;
  readonly state: PublicGameState;
  readonly legalActions: ReadonlyArray<Action>;
}

export interface ServerMessageActionRejected {
  readonly type: 'action_rejected';
  readonly clientSeq: number;
  readonly reason: string;
  readonly state: PublicGameState;
  readonly hash: string;
  readonly legalActions: ReadonlyArray<Action>;
}

export interface ServerMessageSnapshot {
  readonly type: 'snapshot';
  readonly state: PublicGameState;
  readonly hash: string;
  readonly serverSeq: number;
  readonly legalActions: ReadonlyArray<Action>;
}

export interface ServerMessageOpponentJoined {
  readonly type: 'opponent_joined';
  readonly player: PlayerId;
}

export interface ServerMessageOpponentLeft {
  readonly type: 'opponent_left';
  readonly player: PlayerId;
}

export interface ServerMessageError {
  readonly type: 'error';
  readonly reason: string;
}

export type ServerMessage =
  | ServerMessageJoined
  | ServerMessageActionAccepted
  | ServerMessageActionRejected
  | ServerMessageSnapshot
  | ServerMessageOpponentJoined
  | ServerMessageOpponentLeft
  | ServerMessageError;

export type ServerMessageType = ServerMessage['type'];

// ─────────────────────────────────────────────────────────────────────
// Dispatch envelope
// ─────────────────────────────────────────────────────────────────────

/**
 * The return shape from `MatchRoom.handleMessage`. The transport adapter
 * is responsible for delivering `toClient` to the originating socket and
 * each `broadcasts[i].message` to the socket bound to that `clientId`.
 *
 * Adapters MAY drop a broadcast addressed to a clientId that has
 * disconnected since the message was produced — `MatchRoom` does not know
 * about socket lifecycles.
 */
export interface MatchRoomDispatch {
  readonly toClient: ReadonlyArray<ServerMessage>;
  readonly broadcasts: ReadonlyArray<{
    readonly clientId: string;
    readonly message: ServerMessage;
  }>;
}
