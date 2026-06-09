// MatchRoom — transport-agnostic match coordinator. Phase F-4b.
//
// Wraps a single `MatchSession`, tracks per-client identity, sequence
// numbers, and per-player seating. Pure TypeScript — no sockets, no I/O,
// no timers. A future transport layer parses bytes off the wire into a
// `ClientMessage`, hands it to `handleMessage`, and serializes the
// returned `ServerMessage`s back out.
//
// Trust posture: `clientId` and `player` are TRUSTED inputs at this
// layer. Authentication / session binding belongs in the transport
// adapter (auth deferred to a later phase).

import type { PlayerId } from '../../engine-v2/state/types.js';
import type { MatchSession } from '../MatchSession.js';
import type { ViewerId, PublicGameState } from '../publicProjection.js';
import type {
  ClientMessage,
  MatchRoomDispatch,
  ServerMessage,
} from './protocol.js';
import type { Action } from '../../engine-v2/protocol/actions.js';
import { getLegalActions } from '../../engine-v2/rules/legality.js';

interface ClientRecord {
  readonly clientId: string;
  readonly player: PlayerId;
  /** Highest clientSeq we have observed (or accepted) from this client. */
  lastClientSeq: number;
}

export class MatchRoom {
  private readonly session: MatchSession;

  // clientId → ClientRecord. At most two records, one per player.
  private readonly clients = new Map<string, ClientRecord>();
  // player → clientId currently seated. `null` once vacated.
  private readonly seats: Record<PlayerId, string | null> = { A: null, B: null };

  /** Monotonic counter of accepted actions. Never advances on reject. */
  private serverSeq = 0;

  constructor(session: MatchSession) {
    this.session = session;
  }

  // ─────────────────────────────────────────────────────────────────
  // Public entry point
  // ─────────────────────────────────────────────────────────────────

  /**
   * Dispatch one inbound message and produce the resulting outbound
   * messages. Pure with respect to inputs: side effects are confined to
   * the room's internal session + bookkeeping. Never throws on a
   * malformed-by-shape message — that's the transport's job — but does
   * NOT catch engine-internal bugs (those bubble up).
   *
   * Duplicate-seq policy: a `submit_action` whose `clientSeq` is
   * **<= lastClientSeq for that client** is REJECTED as
   * `duplicate_client_seq`. We intentionally do NOT replay the prior
   * outcome — idempotent replay requires storing per-seq responses, and
   * the simpler "monotonic increase or reject" rule is sufficient when
   * the transport guarantees in-order delivery (which TCP / WebSocket
   * does by default).
   */
  handleMessage(message: ClientMessage): MatchRoomDispatch {
    switch (message.type) {
      case 'join':
        return this.handleJoin(message.clientId, message.player);
      case 'submit_action':
        return this.handleSubmitAction(
          message.clientId,
          message.clientSeq,
          message.action,
        );
      case 'request_snapshot':
        return this.handleRequestSnapshot(message.clientId);
      case 'leave':
        return this.handleLeave(message.clientId);
      default: {
        // Exhaustive guard. If TypeScript narrows correctly this is dead.
        const exhaustive: never = message;
        return {
          toClient: [
            { type: 'error', reason: `unknown_message_type: ${String((exhaustive as { type?: unknown }).type)}` },
          ],
          broadcasts: [],
        };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Read-only helpers (mainly for tests + future transport adapters)
  // ─────────────────────────────────────────────────────────────────

  getServerSeq(): number {
    return this.serverSeq;
  }

  getSeatedClient(player: PlayerId): string | null {
    return this.seats[player];
  }

  hasClient(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  // ─────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────

  private handleJoin(clientId: string, player: PlayerId): MatchRoomDispatch {
    const existing = this.clients.get(clientId);
    if (existing !== undefined) {
      // Same client re-joining. Treat as a no-op reconnect that re-delivers
      // the current state. If they ask for the OTHER seat than they
      // already hold, that's a protocol error.
      if (existing.player !== player) {
        return errorOnly(`already_seated_as: ${existing.player}`);
      }
      return {
        toClient: [this.makeJoined(existing.clientId, existing.player, existing.lastClientSeq)],
        broadcasts: [],
      };
    }

    if (this.seats[player] !== null) {
      // Seat taken by a different clientId.
      return errorOnly('seat_occupied');
    }

    // Seat is free → accept the join.
    const record: ClientRecord = { clientId, player, lastClientSeq: 0 };
    this.clients.set(clientId, record);
    this.seats[player] = clientId;

    const opponent: PlayerId = player === 'A' ? 'B' : 'A';
    const opponentClientId = this.seats[opponent];

    const broadcasts: MatchRoomDispatch['broadcasts'] =
      opponentClientId === null
        ? []
        : [
            {
              clientId: opponentClientId,
              message: { type: 'opponent_joined', player } as ServerMessage,
            },
          ];

    return {
      toClient: [this.makeJoined(clientId, player, 0)],
      broadcasts,
    };
  }

  private handleSubmitAction(
    clientId: string,
    clientSeq: number,
    action: Parameters<MatchSession['applyPlayerAction']>[1],
  ): MatchRoomDispatch {
    const record = this.clients.get(clientId);
    if (record === undefined) {
      return errorOnly('unknown_client');
    }
    if (clientSeq <= record.lastClientSeq) {
      // Duplicate or out-of-order — REJECT (see class doc for policy).
      return {
        toClient: [this.makeActionRejected(record, clientSeq, 'duplicate_client_seq')],
        broadcasts: [],
      };
    }
    // Reserve the seq up-front so a duplicate retry cannot slip past.
    record.lastClientSeq = clientSeq;

    // Action must be dispatched as the player this client is seated as.
    // (The engine's `applyPlayerAction` already enforces "right player at
    // right turn"; we use the seat record to reject illegitimate spoofing
    // before reaching the engine, so the reason is clearer than the
    // engine's `not_your_turn`.)
    const result = this.session.applyPlayerAction(record.player, action);
    if (!result.accepted) {
      return {
        toClient: [this.makeActionRejected(record, clientSeq, result.reason)],
        broadcasts: [],
      };
    }

    // Accepted. Bump server seq + project per-recipient.
    this.serverSeq += 1;
    const serverSeq = this.serverSeq;
    const hash = this.session.getStateHash();

    const senderMessage: ServerMessage = {
      type: 'action_accepted',
      clientSeq,
      serverSeq,
      hash,
      state: this.projectFor(record.player),
      legalActions: this.legalActionsFor(record.player),
    };

    const opponent: PlayerId = record.player === 'A' ? 'B' : 'A';
    const opponentClientId = this.seats[opponent];
    const broadcasts: MatchRoomDispatch['broadcasts'] =
      opponentClientId === null
        ? []
        : [
            {
              clientId: opponentClientId,
              message: {
                type: 'snapshot',
                state: this.projectFor(opponent),
                hash,
                serverSeq,
                legalActions: this.legalActionsFor(opponent),
              } satisfies ServerMessage,
            },
          ];

    return { toClient: [senderMessage], broadcasts };
  }

  private handleRequestSnapshot(clientId: string): MatchRoomDispatch {
    const record = this.clients.get(clientId);
    if (record === undefined) {
      return errorOnly('unknown_client');
    }
    const message: ServerMessage = {
      type: 'snapshot',
      state: this.projectFor(record.player),
      hash: this.session.getStateHash(),
      serverSeq: this.serverSeq,
      legalActions: this.legalActionsFor(record.player),
    };
    return { toClient: [message], broadcasts: [] };
  }

  private handleLeave(clientId: string): MatchRoomDispatch {
    const record = this.clients.get(clientId);
    if (record === undefined) {
      return errorOnly('unknown_client');
    }
    this.clients.delete(clientId);
    this.seats[record.player] = null;

    const opponent: PlayerId = record.player === 'A' ? 'B' : 'A';
    const opponentClientId = this.seats[opponent];

    const broadcasts: MatchRoomDispatch['broadcasts'] =
      opponentClientId === null
        ? []
        : [
            {
              clientId: opponentClientId,
              message: { type: 'opponent_left', player: record.player } satisfies ServerMessage,
            },
          ];

    return { toClient: [], broadcasts };
  }

  // ─────────────────────────────────────────────────────────────────
  // Projection / message factories
  // ─────────────────────────────────────────────────────────────────

  private projectFor(viewer: ViewerId): PublicGameState {
    return this.session.getPublicStateFor(viewer);
  }

  /**
   * F-7e: viewer-specific legal actions computed from the TRUSTED full
   * `GameState`, not the projection. This is the engine's
   * `getLegalActions(state, player)` — already used internally by
   * `MatchSession.validateLegalAction` — surfaced over the wire so the
   * client never has to compute legality itself.
   *
   * Hidden-info safety: top-level `Action` types only carry instanceIds
   * for own hand/field/leader/stage and PUBLIC opp field/leader. No
   * action enumerates opp hand/deck/face-down-life instanceIds. The
   * matchRoom hidden-info tests in
   * `shared/server/__tests__/matchRoom.test.ts` enforce this at every
   * change.
   */
  private legalActionsFor(player: PlayerId): ReadonlyArray<Action> {
    return getLegalActions(this.session.getAuthoritativeState(), player);
  }

  private makeJoined(
    _clientId: string,
    player: PlayerId,
    lastSeq: number,
  ): ServerMessage {
    return {
      type: 'joined',
      player,
      state: this.projectFor(player),
      hash: this.session.getStateHash(),
      lastSeq,
      legalActions: this.legalActionsFor(player),
    };
  }

  private makeActionRejected(
    record: ClientRecord,
    clientSeq: number,
    reason: string,
  ): ServerMessage {
    return {
      type: 'action_rejected',
      clientSeq,
      reason,
      state: this.projectFor(record.player),
      hash: this.session.getStateHash(),
      legalActions: this.legalActionsFor(record.player),
    };
  }
}

function errorOnly(reason: string): MatchRoomDispatch {
  return {
    toClient: [{ type: 'error', reason }],
    broadcasts: [],
  };
}
