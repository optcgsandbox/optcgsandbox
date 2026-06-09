// GameRoom — one Durable Object per match. Authoritative engine state lives here.
//
// v0.2: refactored to use the verified V2 server layer (Phase E/F).
//   - `MatchSession` owns authoritative state + replay + hashing
//   - `MatchRoom` enforces F-4b protocol semantics
//   - `WorkerRoomAdapter` bridges socket frames → MatchRoom dispatch
//   - `StaticTokenAuthBinding` derives trusted clientId from per-seat token
//
// Wire protocol: F-4b `ClientMessage` / `ServerMessage` as defined in
// `shared/server/transport/protocol.ts`. The pre-F-4b envelope (ACTION /
// SNAPSHOT / DELTA) is retired.
//
// Cloudflare specifics preserved from v0.1:
//   - WebSocket Hibernation API (`state.acceptWebSocket`) — only bills
//     CPU while JS is executing; idle game rooms cost only storage.
//   - Per-socket `[clientId]` tag for hibernation-safe seat recovery.
//   - SQLite-backed Durable Object (declared in `wrangler.toml`).
//
// What's intentionally NOT here in v0.2:
//   - Real Supabase JWT verification (F-5c.2; we still use static tokens).
//   - Matchmaking rewrite (Matchmaker.ts still mints sessionIds+tokens).
//   - Game-setup orchestration (caller of `/init` must supply a fully
//     constructed `GameState`; v0.1 had the same constraint).
//   - Production deploy (this is `wrangler dev` smoke level).

import type { Env } from './index';
import type { GameState, PlayerId } from '@shared/engine-v2/state/types';

import { registerAllReducers } from '@shared/engine-v2/reducers';
import { registerAllHandlers } from '@shared/engine-v2/registry/handlers';

import { MatchSession } from '@shared/server/MatchSession';
import {
  serializeCompactReplay,
  type MatchReplayV2,
} from '@shared/server/serializeCompact';
import { MatchRoom } from '@shared/server/transport/MatchRoom';
import { WorkerRoomAdapter, type SocketSink } from '@shared/server/transport/WorkerRoomAdapter';
import {
  StaticTokenAuthBinding,
  StrictSeatAssignmentPolicy,
  type AuthBinding,
} from '@shared/server/transport/auth';
import { SupabaseJwtAuthBinding } from '@shared/server/transport/SupabaseJwtAuthBinding';
import type { ServerMessage } from '@shared/server/transport/protocol';

// Eagerly boot the V2 engine registries on isolate cold-start. Idempotent
// — re-registration replaces map entries. Cloudflare reuses isolates
// across requests, so this runs once per warm worker.
registerAllReducers();
registerAllHandlers();

// ─────────────────────────────────────────────────────────────────────
// Persistence schema
// ─────────────────────────────────────────────────────────────────────

interface SeatBootstrap {
  readonly clientId: string;
  // F-6: per-seat `token` is legacy. v0.2 used per-seat opaque tokens to
  // address `StaticTokenAuthBinding`; with `SupabaseJwtAuthBinding` the
  // trusted credential is the JWT and `clientId = "sb:<sub>"` is the
  // only seat key. Field kept optional so prior persisted bootstraps
  // continue to deserialize.
  readonly token?: string;
}

interface RoomBootstrap {
  readonly initialState: GameState;
  readonly seats: Readonly<Record<PlayerId, SeatBootstrap>>;
}

interface InitPayload {
  readonly initialState: GameState;
  readonly seats: {
    readonly A: SeatBootstrap;
    readonly B: SeatBootstrap;
  };
}

const STORAGE = {
  bootstrap: 'bootstrap',
  replay: 'replay',
  replaySkippedBytes: 'replay_skipped_bytes',
} as const;

// Cloudflare DO storage cap: 128 KiB per value. We keep a 28 KiB
// headroom for envelope + future fields. If a serialized replay
// exceeds this, we skip persistence and record the observed size
// so operators can see drift before persistence becomes critical.
const REPLAY_MAX_BYTES = 100_000;

// ─────────────────────────────────────────────────────────────────────
// GameRoom Durable Object
// ─────────────────────────────────────────────────────────────────────

export class GameRoom {
  private bootstrap: RoomBootstrap | null = null;
  private session: MatchSession | null = null;
  private room: MatchRoom | null = null;
  private adapter: WorkerRoomAdapter | null = null;
  private auth: AuthBinding | null = null;
  private readonly seatPolicy = new StrictSeatAssignmentPolicy();
  private readonly socketsByClient = new Map<string, WebSocket>();

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {
    void this.env;
    this.state.blockConcurrencyWhile(async () => {
      const boot = await this.state.storage.get<RoomBootstrap>(STORAGE.bootstrap);
      if (boot !== undefined) {
        this.bootstrap = boot;
        this.rebuildEngine();
        // Re-attach hibernated sockets by tag.
        for (const ws of this.state.getWebSockets()) {
          const tags = (this.state.getTags(ws) ?? []) as string[];
          const clientId = tags[0];
          if (clientId !== undefined) {
            this.socketsByClient.set(clientId, ws);
          }
        }
      }
    });
  }

  // ───────────────────────────────────────────────────────────────────
  // HTTP routes (non-WebSocket)
  // ───────────────────────────────────────────────────────────────────

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/init' && req.method === 'POST') {
      const body = (await req.json()) as InitPayload;
      if (
        !body.initialState ||
        !body.seats?.A?.clientId ||
        !body.seats?.B?.clientId
      ) {
        return new Response('bad_init_payload', { status: 400 });
      }
      // Refuse re-init: a DO is one match for life.
      if (this.bootstrap !== null) {
        return new Response('already_initialized', { status: 409 });
      }
      this.bootstrap = {
        initialState: body.initialState,
        seats: {
          A: {
            clientId: body.seats.A.clientId,
            ...(body.seats.A.token !== undefined ? { token: body.seats.A.token } : {}),
          },
          B: {
            clientId: body.seats.B.clientId,
            ...(body.seats.B.token !== undefined ? { token: body.seats.B.token } : {}),
          },
        },
      };
      await this.state.storage.put(STORAGE.bootstrap, this.bootstrap);
      this.rebuildEngine();
      return new Response('ok');
    }

    if (url.pathname === '/ws') {
      return this.handleWsUpgrade(req);
    }

    return new Response('not found', { status: 404 });
  }

  // ───────────────────────────────────────────────────────────────────
  // WebSocket lifecycle (Hibernation API)
  // ───────────────────────────────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (this.adapter === null || this.session === null) {
      this.errorTo(ws, 'no_state');
      return;
    }
    const tags = (this.state.getTags(ws) ?? []) as string[];
    const clientId = tags[0];
    if (clientId === undefined) {
      this.errorTo(ws, 'untagged_socket');
      return;
    }
    if (typeof message !== 'string') {
      this.errorTo(ws, 'binary_frame_unsupported');
      return;
    }
    const result = this.adapter.handleFrame(clientId, message);
    if (result.accepted) {
      await this.persistReplay();
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    if (this.adapter === null) return;
    const tags = (this.state.getTags(ws) ?? []) as string[];
    const clientId = tags[0];
    if (clientId === undefined) return;
    this.socketsByClient.delete(clientId);
    this.adapter.disconnectClient(clientId);
  }

  // ───────────────────────────────────────────────────────────────────
  // /ws handler
  // ───────────────────────────────────────────────────────────────────

  private async handleWsUpgrade(req: Request): Promise<Response> {
    if (this.bootstrap === null || this.room === null || this.auth === null || this.adapter === null) {
      return new Response('room_not_initialized', { status: 409 });
    }
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    if (token === null || token.length === 0) {
      return new Response('missing_token', { status: 400 });
    }

    const authResult = await this.auth.authenticate(token);
    if (!authResult.ok) {
      return new Response(`auth_failed: ${authResult.reason}`, { status: 401 });
    }
    const client = authResult.client;

    // ClientId → seat. With Supabase JWTs, the orchestrator binds each
    // seat to the player's `sb:<sub>` at /init time; the per-seat
    // `token` field on the bootstrap is now legacy and unused. The
    // verifier-derived clientId is the only trusted identifier.
    let requestedPlayer: PlayerId;
    if (client.clientId === this.bootstrap.seats.A.clientId) {
      requestedPlayer = 'A';
    } else if (client.clientId === this.bootstrap.seats.B.clientId) {
      requestedPlayer = 'B';
    } else {
      return new Response('clientId_not_seated', { status: 409 });
    }

    const seatResult = this.seatPolicy.assignSeat(client, requestedPlayer, {
      occupiedSeats: this.occupiedSeats(),
    });
    if (!seatResult.ok) {
      return new Response(`seat_${seatResult.reason}`, { status: 409 });
    }

    const pair = new WebSocketPair();
    const [clientSocket, server] = Object.values(pair) as [WebSocket, WebSocket];
    // Hibernation API: do NOT call server.accept().
    this.state.acceptWebSocket(server, [client.clientId]);
    this.socketsByClient.set(client.clientId, server);
    this.adapter.connectClient(client.clientId, seatResult.player);

    return new Response(null, { status: 101, webSocket: clientSocket });
  }

  // ───────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────

  private rebuildEngine(): void {
    if (this.bootstrap === null) return;

    this.session = new MatchSession(this.bootstrap.initialState);
    this.room = new MatchRoom(this.session);

    // Auth config comes from the Worker env exclusively. The DO does
    // NOT read process.env directly.
    //
    // Two binding paths:
    //   1. `DEV_AUTH === '1'` → `StaticTokenAuthBinding` over the
    //      per-seat tokens the Matchmaker minted. Local-smoke only.
    //   2. Otherwise → `SupabaseJwtAuthBinding`. Production path.
    //
    // **Fail-loud cross-check:** if `ENV === 'production'` AND
    // `DEV_AUTH === '1'` we throw at startup. A misconfigured deploy
    // dies fast rather than silently accepting opaque dev tokens.
    const env = this.env as unknown as {
      ENV?: string;
      DEV_AUTH?: string;
      SUPABASE_JWKS_URL?: string;
      SUPABASE_ISSUER?: string;
      SUPABASE_AUDIENCE?: string;
      SUPABASE_JWKS_CACHE_TTL_MS?: string;
    };

    const isDevAuth = env.DEV_AUTH === '1';
    const isProdEnv = env.ENV === 'production';

    if (isDevAuth && isProdEnv) {
      throw new Error(
        'GameRoom: DEV_AUTH=1 is rejected when ENV=production. ' +
          'StaticTokenAuthBinding is for local development only. ' +
          'Remove DEV_AUTH from the production env or switch ENV away from "production".',
      );
    }

    if (isDevAuth) {
      // F-7c: dev-only auth bypass. Each seat's opaque token is the
      // credential; `clientId` is read directly out of the bootstrap.
      const { A, B } = this.bootstrap.seats;
      if (
        typeof A.token !== 'string' ||
        A.token.length === 0 ||
        typeof B.token !== 'string' ||
        B.token.length === 0
      ) {
        throw new Error(
          'GameRoom: DEV_AUTH=1 requires per-seat tokens in /init payload. ' +
            'The Matchmaker mints them; if you POSTed /init directly, include both.',
        );
      }
      this.auth = new StaticTokenAuthBinding({
        [A.token]: { clientId: A.clientId, userId: A.clientId },
        [B.token]: { clientId: B.clientId, userId: B.clientId },
      });
    } else {
      if (
        typeof env.SUPABASE_JWKS_URL !== 'string' ||
        env.SUPABASE_JWKS_URL.length === 0 ||
        typeof env.SUPABASE_ISSUER !== 'string' ||
        env.SUPABASE_ISSUER.length === 0
      ) {
        throw new Error(
          'GameRoom: SUPABASE_JWKS_URL and SUPABASE_ISSUER must be configured in wrangler.toml [vars]',
        );
      }
      const ttlMs =
        typeof env.SUPABASE_JWKS_CACHE_TTL_MS === 'string'
          ? Number.parseInt(env.SUPABASE_JWKS_CACHE_TTL_MS, 10)
          : undefined;
      this.auth = new SupabaseJwtAuthBinding({
        jwksUrl: env.SUPABASE_JWKS_URL,
        issuer: env.SUPABASE_ISSUER,
        ...(env.SUPABASE_AUDIENCE !== undefined ? { audience: env.SUPABASE_AUDIENCE } : {}),
        ...(ttlMs !== undefined && Number.isFinite(ttlMs) ? { cacheTtlMs: ttlMs } : {}),
      });
    }

    const sink: SocketSink = {
      sendTo: (clientId, message) => this.sendToClient(clientId, message),
    };
    this.adapter = new WorkerRoomAdapter(this.room, sink);
  }

  private occupiedSeats(): Partial<Record<PlayerId, string>> {
    const out: Partial<Record<PlayerId, string>> = {};
    if (this.room === null) return out;
    const a = this.room.getSeatedClient('A');
    const b = this.room.getSeatedClient('B');
    if (a !== null) out.A = a;
    if (b !== null) out.B = b;
    return out;
  }

  private sendToClient(clientId: string, message: ServerMessage): void {
    const ws = this.socketsByClient.get(clientId);
    if (ws === undefined) return; // recipient disconnected; drop
    try {
      ws.send(JSON.stringify(message));
    } catch {
      this.socketsByClient.delete(clientId);
    }
  }

  private errorTo(ws: WebSocket, reason: string): void {
    try {
      ws.send(JSON.stringify({ type: 'error', reason } satisfies ServerMessage));
    } catch {
      /* socket gone */
    }
  }

  private async persistReplay(): Promise<void> {
    if (this.session === null) return;
    // F-5b.2: switched from V1 (full GameState + cardLibrary) to V2
    // (initialState minus cardLibrary + a content-hash reference). The
    // DO's `bootstrap` key still holds the full initial state so the
    // library is recoverable; here we only need the dynamic deltas.
    // V2 measurements vs V1 are recorded in
    // `shared/server/__tests__/serializeCompact.test.ts` and
    // `docs/ONLINE_INTEGRATION_PLAN.md` §19.
    const replay: MatchReplayV2 = serializeCompactReplay(this.session, {
      cardLibraryVersion: 'worker-dev-v1',
    });
    const bytes = JSON.stringify(replay).length;
    if (bytes > REPLAY_MAX_BYTES) {
      // Still possible above some future scale (history events + giant
      // action logs). Record the skipped size so operators see drift
      // before persistence becomes critical. The follow-on for THIS
      // failure mode is an action-log truncation strategy, NOT another
      // library strip — F-5b.3 territory.
      await this.state.storage.put(STORAGE.replaySkippedBytes, bytes);
      return;
    }
    await this.state.storage.put(STORAGE.replay, replay);
  }
}
