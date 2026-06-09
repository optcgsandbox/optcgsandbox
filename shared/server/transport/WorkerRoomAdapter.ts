// WorkerRoomAdapter — runtime-agnostic socket bridge for `MatchRoom`.
//
// Sits between a real socket transport (Cloudflare Durable Object,
// future Node ws server, etc.) and the verified F-4b protocol layer.
// The runtime owns sockets; the adapter only knows clientIds and a
// `SocketSink` callback for "send this message to this clientId".
//
// Why this file lives in `shared/server/transport/` instead of `worker/`:
// the dispatch logic is identical for any frame-based transport. Keeping
// it portable means the same code is testable without instantiating a
// Cloudflare DO, and the DO itself shrinks to runtime plumbing.
//
// Trust boundary: every inbound frame's `clientId` field is OVERWRITTEN
// with the trusted clientId the caller passed to `handleFrame()`. A
// poorly-behaved client that fakes someone else's clientId on the wire
// is corrected at this seam, before MatchRoom sees the message.

import type { PlayerId } from '../../engine-v2/state/types.js';
import type { MatchRoom } from './MatchRoom.js';
import { parseClientMessage } from './parseClientMessage.js';
import type { ClientMessage, ServerMessage } from './protocol.js';

/**
 * Implementation-provided callback to deliver a `ServerMessage` to a
 * specific clientId. The runtime knows how to map clientId → socket.
 * If the recipient has disconnected, implementations MAY silently drop.
 */
export interface SocketSink {
  sendTo(clientId: string, message: ServerMessage): void;
}

/**
 * Result of `handleFrame`. `accepted` flips true when an action mutated
 * authoritative state — callers can use it as the signal to persist a
 * replay snapshot.
 */
export interface FrameResult {
  readonly accepted: boolean;
  readonly serverSeq: number;
  readonly hash: string;
}

export class WorkerRoomAdapter {
  private readonly room: MatchRoom;
  private readonly sink: SocketSink;

  constructor(room: MatchRoom, sink: SocketSink) {
    this.room = room;
    this.sink = sink;
  }

  /**
   * Drive a `join` after the runtime has accepted a socket for this
   * client. Used by the DO's `/ws` upgrade handler.
   */
  connectClient(clientId: string, requestedPlayer: PlayerId): void {
    const dispatch = this.room.handleMessage({
      type: 'join',
      clientId,
      player: requestedPlayer,
    });
    this.route(clientId, dispatch);
  }

  /**
   * Process an inbound frame attributed to `trustedClientId`. The frame's
   * own `clientId` field (if any) is overwritten with the trusted value
   * before reaching MatchRoom — see file-header trust-boundary note.
   *
   * Returns whether the frame produced an `action_accepted`. `serverSeq`
   * and `hash` are the post-frame values for caller logging / replay
   * checkpoints.
   */
  handleFrame(trustedClientId: string, rawFrame: string | unknown): FrameResult {
    const parsed = parseClientMessage(rawFrame);
    if (!parsed.ok) {
      this.sink.sendTo(trustedClientId, {
        type: 'error',
        reason: `bad_frame: ${parsed.reason}`,
      });
      return {
        accepted: false,
        serverSeq: this.room.getServerSeq(),
        hash: '',
      };
    }
    const trusted = injectTrustedClientId(parsed.message, trustedClientId);
    const dispatch = this.room.handleMessage(trusted);
    this.route(trustedClientId, dispatch);

    const accepted = dispatch.toClient.some((m) => m.type === 'action_accepted');
    // Hash is on action_accepted / snapshot / joined / action_rejected
    // (they all carry it). For frames that produced none — e.g. error —
    // we leave hash empty; callers use `accepted` as the meaningful signal.
    let hash = '';
    for (const m of dispatch.toClient) {
      if ('hash' in m && typeof (m as { hash?: unknown }).hash === 'string') {
        hash = (m as { hash: string }).hash;
      }
    }
    return { accepted, serverSeq: this.room.getServerSeq(), hash };
  }

  /**
   * The runtime detected a socket close. Forward as `leave` so the
   * opponent receives `opponent_left` and the seat is released.
   */
  disconnectClient(clientId: string): void {
    const dispatch = this.room.handleMessage({ type: 'leave', clientId });
    this.route(clientId, dispatch);
  }

  // ─────────────────────────────────────────────────────────────────

  private route(
    senderId: string,
    dispatch: ReturnType<MatchRoom['handleMessage']>,
  ): void {
    for (const m of dispatch.toClient) this.sink.sendTo(senderId, m);
    for (const { clientId, message: m } of dispatch.broadcasts) {
      this.sink.sendTo(clientId, m);
    }
  }
}

function injectTrustedClientId(
  message: ClientMessage,
  clientId: string,
): ClientMessage {
  switch (message.type) {
    case 'join':
      return { type: 'join', player: message.player, clientId };
    case 'submit_action':
      return {
        type: 'submit_action',
        action: message.action,
        clientSeq: message.clientSeq,
        clientId,
      };
    case 'request_snapshot':
      return { type: 'request_snapshot', clientId };
    case 'leave':
      return { type: 'leave', clientId };
  }
}
