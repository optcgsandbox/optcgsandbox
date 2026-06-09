// InProcessTransport — Phase F-5a.
//
// A tiny, fully synchronous transport adapter around `MatchRoom`. Owns
// the per-client inboxes that a real socket adapter would otherwise back
// onto WebSocket frames. Pure TypeScript: no sockets, no async, no
// timers, no auth.
//
// Purpose:
//   - Exercise the F-4b protocol end-to-end with two simulated clients.
//   - Catch protocol gaps before async I/O / network errors obscure them.
//   - Provide a primitive that gameplay tests + scripted-AI drills can
//     reuse without standing up any infrastructure.
//
// Out of scope (NOT in F-5a):
//   - Authentication. `clientId` is trusted exactly as it is in MatchRoom.
//   - Networking, JSON wire format, byte-level serialization.
//   - Reconnect across process restart.
//   - Spectator subscription model.

import type { PlayerId } from '../../engine-v2/state/types.js';
import type { MatchRoom } from './MatchRoom.js';
import type {
  ClientMessage,
  ClientMessageSubmitAction,
  ClientMessageRequestSnapshot,
  ClientMessageLeave,
  ServerMessage,
} from './protocol.js';

/**
 * Inbound message body that callers pass to `send`, sans `clientId` —
 * the adapter injects the `clientId` it was called with. Matches the
 * shape a real WebSocket frame would carry: the network layer knows
 * which socket spoke, so the client doesn't repeat itself.
 */
export type IncomingBody =
  | { readonly type: 'submit_action'; readonly action: ClientMessageSubmitAction['action']; readonly clientSeq: number }
  | { readonly type: 'request_snapshot' }
  | { readonly type: 'leave' };

export class InProcessTransport {
  private readonly room: MatchRoom;
  private readonly inboxes = new Map<string, ServerMessage[]>();

  constructor(room: MatchRoom) {
    this.room = room;
  }

  // ─────────────────────────────────────────────────────────────────
  // Public adapter API
  // ─────────────────────────────────────────────────────────────────

  /**
   * Connect a new "socket" for `clientId` and seat them at `player`.
   * Returns the immediate messages the connecting client receives (the
   * `joined` from MatchRoom, or an `error` if the seat is taken). The
   * messages are ALSO appended to the client's inbox so `inbox()` /
   * `drain()` stay consistent with the return value.
   */
  connect(clientId: string, player: PlayerId): ServerMessage[] {
    // Ensure the inbox exists even if the join is rejected — error
    // messages still go to that client.
    this.ensureInbox(clientId);
    return this.dispatch(clientId, {
      type: 'join',
      player,
      clientId,
    });
  }

  /**
   * Send a message on behalf of `clientId`. The adapter injects the
   * `clientId` into the message envelope before handing it to the room.
   * Returns ONLY the messages routed to the sender's inbox (the messages
   * a real socket would receive on its own connection). Broadcasts to
   * the other client are deposited in their inbox; pull them with
   * `inbox()` or `drain()`.
   */
  send(clientId: string, body: IncomingBody): ServerMessage[] {
    this.ensureInbox(clientId);
    const message = injectClientId(clientId, body);
    return this.dispatch(clientId, message);
  }

  /**
   * Return + clear the client's inbox. Returns a defensive copy.
   * Mutating the returned array is harmless.
   */
  drain(clientId: string): ServerMessage[] {
    const inbox = this.inboxes.get(clientId);
    if (inbox === undefined || inbox.length === 0) return [];
    const out = inbox.slice();
    inbox.length = 0;
    return out;
  }

  /**
   * Read-only snapshot of the inbox. Returns a defensive copy so callers
   * cannot mutate stored state by editing the returned array.
   */
  inbox(clientId: string): ReadonlyArray<ServerMessage> {
    const inbox = this.inboxes.get(clientId);
    return inbox === undefined ? [] : inbox.slice();
  }

  /**
   * Convenience for tests + sanity checks. Returns the underlying room's
   * serverSeq. Real sockets would never expose this; F-5a does for
   * regression visibility.
   */
  getServerSeq(): number {
    return this.room.getServerSeq();
  }

  /**
   * Snapshot of currently-seated clients. Used by auth/seat-assignment
   * wrappers (F-5c) to probe whether a requested seat is free without
   * reaching past the transport into the room.
   */
  getOccupiedSeats(): Partial<Record<PlayerId, string>> {
    const out: Partial<Record<PlayerId, string>> = {};
    const a = this.room.getSeatedClient('A');
    const b = this.room.getSeatedClient('B');
    if (a !== null) out['A'] = a;
    if (b !== null) out['B'] = b;
    return out;
  }

  // ─────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────

  private dispatch(senderId: string, message: ClientMessage): ServerMessage[] {
    const result = this.room.handleMessage(message);
    // `toClient` lands in the sender's inbox.
    if (result.toClient.length > 0) {
      const inbox = this.ensureInbox(senderId);
      for (const m of result.toClient) inbox.push(m);
    }
    // Each broadcast lands in its named recipient's inbox.
    for (const { clientId: recipient, message: m } of result.broadcasts) {
      const inbox = this.ensureInbox(recipient);
      inbox.push(m);
    }
    return result.toClient.slice();
  }

  private ensureInbox(clientId: string): ServerMessage[] {
    let inbox = this.inboxes.get(clientId);
    if (inbox === undefined) {
      inbox = [];
      this.inboxes.set(clientId, inbox);
    }
    return inbox;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Free helpers
// ─────────────────────────────────────────────────────────────────────

function injectClientId(clientId: string, body: IncomingBody): ClientMessage {
  switch (body.type) {
    case 'submit_action': {
      const msg: ClientMessageSubmitAction = {
        type: 'submit_action',
        clientId,
        action: body.action,
        clientSeq: body.clientSeq,
      };
      return msg;
    }
    case 'request_snapshot': {
      const msg: ClientMessageRequestSnapshot = {
        type: 'request_snapshot',
        clientId,
      };
      return msg;
    }
    case 'leave': {
      const msg: ClientMessageLeave = { type: 'leave', clientId };
      return msg;
    }
    default: {
      const exhaustive: never = body;
      throw new Error(`InProcessTransport: unknown body type: ${String((exhaustive as { type?: unknown }).type)}`);
    }
  }
}
