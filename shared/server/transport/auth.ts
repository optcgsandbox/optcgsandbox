// Auth boundary — Phase F-5c.
//
// Defines the abstract seam between an opaque caller credential
// (e.g. a Supabase JWT, a signed session cookie, a stub test token)
// and the TRUSTED `clientId`/seat that the rest of the transport layer
// is allowed to act on.
//
// What lives here:
//   - `AuthBinding`           — token → AuthenticatedClient mapping
//   - `SeatAssignmentPolicy`  — does this client get this seat?
//   - `StaticTokenAuthBinding` — dev/test in-memory token table
//   - `StrictSeatAssignmentPolicy` — the seating rules MatchRoom mirrors
//   - `AuthenticatedInProcessTransport` — wrapper that gates access to
//     `InProcessTransport` behind a token, so callers cannot spoof
//     `clientId` at the transport boundary.
//
// What does NOT live here (deliberately deferred):
//   - Real Supabase JWT verification (no `jose`, no `jwt-decode`).
//   - Service-role / PAT usage. No `.env` reads.
//   - Network calls, JWKS fetch, signature verification.
//   - Cookie / header parsing.
//   - Rate limiting, anti-abuse, token rotation.
//
// The contract here is the seam. A real `SupabaseJwtAuthBinding` lands
// in F-5c.2 (or later) under this interface; it must not require
// transport-layer changes.

import type { PlayerId } from '../../engine-v2/state/types.js';
import type { InProcessTransport, IncomingBody } from './InProcessTransport.js';
import type { ServerMessage } from './protocol.js';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface AuthenticatedClient {
  /**
   * The TRUSTED transport-layer client identity. Derived from the auth
   * provider's subject claim. Real adapters should namespace this
   * (e.g. `sb:<sub>`) so collisions across providers are impossible.
   */
  readonly clientId: string;
  /**
   * The auth provider's subject — the durable user identity. May equal
   * `clientId` minus the namespace prefix; kept separate so a future
   * provider with multi-device session ids can differentiate per-device
   * `clientId` from per-user `userId`.
   */
  readonly userId: string;
  readonly displayName?: string;
}

export type AuthenticateResult =
  | { readonly ok: true; readonly client: AuthenticatedClient }
  | { readonly ok: false; readonly reason: string };

export interface AuthBinding {
  authenticate(token: string): Promise<AuthenticateResult>;
}

export interface RoomSeatView {
  readonly occupiedSeats: Readonly<Partial<Record<PlayerId, string>>>;
}

export type SeatAssignmentResult =
  | { readonly ok: true; readonly player: PlayerId }
  | { readonly ok: false; readonly reason: string };

export interface SeatAssignmentPolicy {
  assignSeat(
    client: AuthenticatedClient,
    requestedPlayer: PlayerId,
    roomState: RoomSeatView,
  ): SeatAssignmentResult;
}

// ─────────────────────────────────────────────────────────────────────
// Dev/test implementations
// ─────────────────────────────────────────────────────────────────────

/**
 * Map-based auth binding for tests + dev. NOT for production — there is
 * no signature check, no expiry, no revocation. The constructor takes a
 * snapshot of the token → client table; subsequent edits to the input
 * record do not affect the binding.
 */
export class StaticTokenAuthBinding implements AuthBinding {
  private readonly tokens: ReadonlyMap<string, AuthenticatedClient>;

  constructor(tokenMap: Readonly<Record<string, AuthenticatedClient>>) {
    // Defensive snapshot. We freeze our internal copy so internal code
    // can't accidentally mutate the table either.
    const entries = Object.entries(tokenMap).map(
      ([k, v]) => [k, { ...v }] as const,
    );
    this.tokens = new Map(entries);
  }

  async authenticate(token: string): Promise<AuthenticateResult> {
    const client = this.tokens.get(token);
    if (client === undefined) {
      return { ok: false, reason: 'unknown_token' };
    }
    // Defensive copy on the way out so the caller can mutate freely.
    return { ok: true, client: { ...client } };
  }
}

/**
 * Strict seating policy used by `AuthenticatedInProcessTransport` and
 * (in the future) by socket adapters before forwarding `join`. Mirrors
 * `MatchRoom`'s seating rules so we get defense in depth: the policy
 * rejects bad joins at the auth boundary, and the room rejects them
 * again if anything slips past.
 *
 * Rules:
 *   1. Requested seat is free → ok.
 *   2. Requested seat already holds THIS client → ok (reconnect).
 *   3. Requested seat held by a DIFFERENT client → `seat_occupied`.
 *   4. This client is ALREADY seated in the OTHER seat → `already_seated_as_<player>`.
 *
 * No auto-seat fallback. No spectator mode. F-5c is two-player only.
 */
export class StrictSeatAssignmentPolicy implements SeatAssignmentPolicy {
  assignSeat(
    client: AuthenticatedClient,
    requestedPlayer: PlayerId,
    roomState: RoomSeatView,
  ): SeatAssignmentResult {
    const occupants = roomState.occupiedSeats;
    const otherSeat: PlayerId = requestedPlayer === 'A' ? 'B' : 'A';

    if (occupants[otherSeat] === client.clientId) {
      return { ok: false, reason: `already_seated_as_${otherSeat}` };
    }
    const currentOccupant = occupants[requestedPlayer];
    if (currentOccupant === undefined) {
      return { ok: true, player: requestedPlayer };
    }
    if (currentOccupant === client.clientId) {
      // Reconnect — same client back into the same seat.
      return { ok: true, player: requestedPlayer };
    }
    return { ok: false, reason: 'seat_occupied' };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Authenticated transport wrapper
// ─────────────────────────────────────────────────────────────────────

/**
 * Token-gated wrapper around `InProcessTransport`. Callers never supply
 * a raw `clientId` — they speak in tokens, and the wrapper derives the
 * trusted `clientId` via the `AuthBinding`.
 *
 * Token → clientId is memoized after the first successful authenticate
 * so subsequent `sendWithToken` / `drainForToken` / `inboxForToken`
 * calls don't re-hit the binding. Tokens not yet authenticated still
 * flow through `authenticate` on demand.
 */
export class AuthenticatedInProcessTransport {
  private readonly auth: AuthBinding;
  private readonly policy: SeatAssignmentPolicy;
  private readonly transport: InProcessTransport;
  private readonly clientIdByToken = new Map<string, string>();

  constructor(
    auth: AuthBinding,
    policy: SeatAssignmentPolicy,
    transport: InProcessTransport,
  ) {
    this.auth = auth;
    this.policy = policy;
    this.transport = transport;
  }

  /**
   * Authenticate + apply seat policy + connect. Returns the messages
   * the joining client receives, OR a single `error` message if either
   * authentication or seat assignment rejects.
   */
  async connectWithToken(
    token: string,
    requestedPlayer: PlayerId,
  ): Promise<ServerMessage[]> {
    const a = await this.auth.authenticate(token);
    if (!a.ok) {
      return [{ type: 'error', reason: `auth_failed: ${a.reason}` }];
    }
    const seat = this.policy.assignSeat(a.client, requestedPlayer, {
      occupiedSeats: this.transport.getOccupiedSeats(),
    });
    if (!seat.ok) {
      return [{ type: 'error', reason: seat.reason }];
    }
    this.clientIdByToken.set(token, a.client.clientId);
    return this.transport.connect(a.client.clientId, seat.player);
  }

  /**
   * Send on behalf of a token. If the token has never connected, this
   * authenticates fresh so a poorly-behaved caller still gets a clean
   * `unknown_client`/`auth_failed` rather than a silent drop.
   */
  async sendWithToken(token: string, body: IncomingBody): Promise<ServerMessage[]> {
    const cached = this.clientIdByToken.get(token);
    if (cached !== undefined) {
      return this.transport.send(cached, body);
    }
    const a = await this.auth.authenticate(token);
    if (!a.ok) {
      return [{ type: 'error', reason: `auth_failed: ${a.reason}` }];
    }
    // Do NOT memoize — the client has not connected; the transport will
    // respond with `unknown_client` and we want a future `connectWithToken`
    // to be the actual seat-bind point.
    return this.transport.send(a.client.clientId, body);
  }

  /**
   * Drain the token-bound client's inbox. Returns a defensive copy. If
   * the token never connected, returns an empty array.
   */
  drainForToken(token: string): ServerMessage[] {
    const clientId = this.clientIdByToken.get(token);
    if (clientId === undefined) return [];
    return this.transport.drain(clientId);
  }

  /**
   * Peek the token-bound client's inbox (defensive copy).
   */
  inboxForToken(token: string): ReadonlyArray<ServerMessage> {
    const clientId = this.clientIdByToken.get(token);
    if (clientId === undefined) return [];
    return this.transport.inbox(clientId);
  }
}
