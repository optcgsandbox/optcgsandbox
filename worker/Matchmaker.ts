// Matchmaker — single global Durable Object that pairs players into
// GameRoom DOs.
//
// v0.3 (Phase F-7a): accepts a submitted deck per player and validates
// it against the cards.json corpus before queueing. On pair, the
// initialState is built from the two submitted decks via
// `shared/engine-v2/setup/initialState.ts`. Dev identity is still
// `dev:<sessionId>` (Supabase JWT swap is F-5d.1).
//
// What's NEW vs v0.2 (F-6):
//   - `POST /api/join` body: `{ sessionId, deck: { leaderId, mainDeckIds, name? } }`.
//   - `validateDeck` runs before any queue write; invalid deck → 400.
//   - Queue entry stores the validated submission.
//   - Pair flow builds `initialState({ seed, decks: {A,B} })` from real
//     submissions instead of the dev stub.
//
// Bundle cost notice: pulling `@shared/data/cards.json` into the worker
// jumps the bundle from 292 KiB → ~3025 KiB raw (296 KiB gzip).
// Measured with `wrangler deploy --dry-run` in F-7a. Operator should
// verify against the current Cloudflare Workers compressed-size limit
// before any live deploy; the dry-run accepted the bundle without
// warning under wrangler 4.95.0.

import type { Env } from './index';
import { buildPlayableInitialState } from './devSetup';
import type {
  Card,
  LeaderCard,
} from '@shared/engine-v2/cards/Card';
import type { GameState } from '@shared/engine-v2/state/types';
import {
  validateDeck,
  type DeckSubmission,
  type NormalizedDeck,
} from '@shared/server/deck/validateDeck';
import {
  resolveJoinAuth,
  selectAuthMode,
  type JoinAuthEnv,
} from '@shared/server/transport/joinAuth';
import { SupabaseJwtAuthBinding } from '@shared/server/transport/SupabaseJwtAuthBinding';
import type { AuthBinding } from '@shared/server/transport/auth';

import cardsRaw from '@shared/data/cards.json';

// Corpus loaded once per isolate cold start. Wrangler bundles cards.json
// into the worker upload; runtime cost is one structuredClone of the
// `Record<id, Card>` per worker boot, not per request.
const CORPUS_ARRAY = cardsRaw as unknown as Card[];
const CARD_LIBRARY: Record<string, Card> = Object.create(null);
for (const c of CORPUS_ARRAY) CARD_LIBRARY[c.id] = c;

// ────────────────────────────────────────────────────────────────────
// Storage types
// ────────────────────────────────────────────────────────────────────

interface QueueEntry {
  readonly sessionId: string;
  readonly joinedAt: number;
  readonly submission: NormalizedDeck;
  /**
   * F-5d.2: per-seat clientId resolved at queue time. Either
   * `dev:<sessionId>` (DEV_AUTH mode) or `sb:<sub>` (Supabase mode).
   * Used as the bootstrap seat clientId so GameRoom seat lookup
   * matches whatever the auth binding will produce at /ws upgrade.
   */
  readonly clientId: string;
  /**
   * F-5d.2: per-seat token captured at queue time. In DEV_AUTH mode it
   * is a Matchmaker-minted UUID consumed by `StaticTokenAuthBinding`
   * in GameRoom. In Supabase mode it is the caller's original JWT,
   * echoed back via `/api/poll` so the F-7b client can use it on
   * `/ws?token=…`. NOT cryptographically stored — DO storage is
   * encrypted at rest by Cloudflare; short-lived JWTs limit replay.
   */
  readonly token: string;
}

interface InitFailureBody {
  readonly status: 'init_failed';
  readonly upstreamStatus: number;
  readonly upstreamBody: string;
}

interface PairedResult {
  readonly status: 'PAIRED';
  readonly roomId: string;
  readonly you: 'A' | 'B';
  readonly clientId: string;
  readonly token: string;
  readonly leaderA: { readonly id: string; readonly name: string };
  readonly leaderB: { readonly id: string; readonly name: string };
  /** ms epoch — used by F-7b+ for TTL eviction. Not enforced today. */
  readonly pairedAt: number;
}

const STORAGE_KEY = 'queue';
const PAIRED_STORAGE_KEY = 'paired_results';

// ────────────────────────────────────────────────────────────────────
// Matchmaker DO
// ────────────────────────────────────────────────────────────────────

export class Matchmaker {
  private queue: QueueEntry[] = [];
  private pairedResults: Record<string, PairedResult> = {};
  /**
   * F-5d.2: lazy-cached Supabase JWT binding per DO instance. Created
   * on first /api/join in Supabase mode; shares its in-memory JWKS
   * cache across all subsequent requests so a flurry of joins doesn't
   * hammer the JWKS endpoint.
   */
  private supabaseBinding: SupabaseJwtAuthBinding | null = null;

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {
    // F-5d.2 production safety guard — mirrors `GameRoom.rebuildEngine`.
    // If a Worker is somehow deployed with ENV=production + DEV_AUTH=1,
    // the DO refuses to boot at all rather than silently accepting
    // opaque dev tokens at the Matchmaker.
    const envCheck = selectAuthMode(this.env as unknown as JoinAuthEnv);
    if (!envCheck.ok) {
      throw new Error(
        `Matchmaker: ${envCheck.reason}. ` +
          `Remove DEV_AUTH from production env or set ENV != "production".`,
      );
    }

    this.state.blockConcurrencyWhile(async () => {
      const raw = (await this.state.storage.get<unknown[]>(STORAGE_KEY)) ?? [];
      // Migration: drop pre-F-7a queue entries that lack `submission`.
      // F-6 stored `{sessionId, joinedAt}` only; the v0.3 type now
      // requires `submission: NormalizedDeck`. Old entries can't be
      // paired against because the Matchmaker no longer mints stub
      // decks. Filter at load time to avoid runtime nulls downstream.
      this.queue = raw.filter((e): e is QueueEntry => {
        return (
          e !== null &&
          typeof e === 'object' &&
          (e as { submission?: unknown }).submission !== undefined &&
          typeof (e as { submission?: unknown }).submission === 'object'
        );
      });
      if (this.queue.length !== raw.length) {
        await this.state.storage.put(STORAGE_KEY, this.queue);
      }
      this.pairedResults =
        (await this.state.storage.get<Record<string, PairedResult>>(
          PAIRED_STORAGE_KEY,
        )) ?? {};
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/api/poll' && req.method === 'GET') {
      const sessionId = url.searchParams.get('sessionId');
      if (sessionId === null || sessionId.length === 0) {
        return Response.json(
          { status: 'unknown_session' },
          { status: 404 },
        );
      }
      const paired = this.pairedResults[sessionId];
      if (paired !== undefined) {
        return Response.json(paired);
      }
      const inQueue = this.queue.find((e) => e.sessionId === sessionId);
      if (inQueue !== undefined) {
        return Response.json({
          status: 'QUEUED',
          sessionId,
          queueLen: this.queue.length,
        });
      }
      return Response.json(
        { status: 'unknown_session' },
        { status: 404 },
      );
    }

    if (url.pathname !== '/api/join') {
      return new Response('not found', { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      sessionId?: unknown;
      deck?: unknown;
      token?: unknown;
    };

    // F-5d.2: resolve auth FIRST so we know who's joining before we
    // validate the deck. Dev mode keeps `dev:<sessionId>` semantics;
    // Supabase mode authenticates the caller's JWT and yields
    // `sb:<sub>` so /ws's SupabaseJwtAuthBinding-derived clientId
    // matches the bootstrap seat clientId we'll store.
    const authResult = await resolveJoinAuth({
      env: this.env as unknown as JoinAuthEnv,
      authHeader: req.headers.get('Authorization'),
      bodyToken: typeof body.token === 'string' ? body.token : null,
      bodySessionId:
        typeof body.sessionId === 'string' && body.sessionId.length > 0
          ? body.sessionId
          : null,
      supabaseBinding: this.getOrCreateSupabaseBinding(),
    });
    if (!authResult.ok) {
      return Response.json(
        { status: authResult.status, reason: authResult.reason },
        { status: authResult.httpStatus },
      );
    }
    const sessionId = authResult.sessionId;
    const callerClientId = authResult.clientId;
    const callerToken = authResult.token;

    // Validate the deck FIRST. No deck → 400. Bad deck → 400.
    if (body.deck === undefined) {
      return Response.json(
        { status: 'deck_invalid', reason: 'missing_deck' },
        { status: 400 },
      );
    }
    const validation = validateDeck(body.deck as DeckSubmission, CARD_LIBRARY);
    if (!validation.ok) {
      return Response.json(
        { status: 'deck_invalid', reason: validation.reason },
        { status: 400 },
      );
    }
    const incomingSubmission: NormalizedDeck = validation.normalized;
    const incomingLeader: LeaderCard = validation.leader;
    const incomingCards: ReadonlyArray<Card> = validation.cards;

    // Pair with head of queue, else enqueue.
    const peer = this.queue.shift();
    if (peer === undefined) {
      this.queue.push({
        sessionId,
        joinedAt: Date.now(),
        submission: incomingSubmission,
        clientId: callerClientId,
        token: callerToken,
      });
      await this.state.storage.put(STORAGE_KEY, this.queue);
      return Response.json({
        status: 'QUEUED',
        sessionId,
        queueLen: this.queue.length,
      });
    }

    // Persist the popped queue immediately so a failure below doesn't
    // double-pair the peer.
    await this.state.storage.put(STORAGE_KEY, this.queue);

    // Resolve the PEER's submission into the same `{leader, cards}`
    // shape `buildInitialState` expects. The peer's submission has
    // already been validated; we re-resolve here so the corpus version
    // observed at PAIR time is the one used to build the state.
    const peerLeaderEntry = CARD_LIBRARY[peer.submission.leaderId];
    if (peerLeaderEntry === undefined || peerLeaderEntry.kind !== 'leader') {
      // Should be impossible because we validated at queue-time, but
      // guard against corpus drift between v0 deploys.
      return Response.json(
        {
          status: 'init_failed',
          upstreamStatus: 0,
          upstreamBody: 'corpus_drift: peer_leader_no_longer_exists',
        } satisfies InitFailureBody,
        { status: 502 },
      );
    }
    const peerLeader = peerLeaderEntry as LeaderCard;
    const peerCards: Card[] = [];
    for (const id of peer.submission.mainDeckIds) {
      const c = CARD_LIBRARY[id];
      if (c === undefined) {
        return Response.json(
          {
            status: 'init_failed',
            upstreamStatus: 0,
            upstreamBody: `corpus_drift: peer_card_missing: ${id}`,
          } satisfies InitFailureBody,
          { status: 502 },
        );
      }
      peerCards.push(c);
    }

    // Allocate the room + build identities.
    const newId = this.env.GAME_ROOM.newUniqueId();
    const roomId = newId.toString();
    const seed = randomU32();
    // F-5d.2: identities come from `resolveJoinAuth`. In DEV_AUTH mode
    // these are `dev:<sessionId>` + minted UUID; in Supabase mode they
    // are `sb:<sub>` + the caller's JWT echoed back. Both seats stamp
    // the same shape into the bootstrap so GameRoom's seat lookup
    // matches whatever the auth binding produces at /ws.
    const clientA = peer.clientId;
    const clientB = callerClientId;
    const tokenA = peer.token;
    const tokenB = callerToken;

    // F-7g: build a PLAYABLE V2 initialState. Drives the engine setup
    // chain (dice → choose first → mulligans → deal_life → refresh →
    // draw → don → main) so server-supplied legalActions include real
    // gameplay actions, not just CONCEDE + setup placeholders.
    const initialStateBlob: GameState = buildPlayableInitialState({
      seed,
      decks: {
        A: { leader: peerLeader, cards: peerCards },
        B: { leader: incomingLeader, cards: incomingCards.slice() },
      },
    });

    // Per-seat `token` is preserved in the bootstrap only when the
    // GameRoom's auth binding will USE it (DEV_AUTH mode →
    // StaticTokenAuthBinding maps token → clientId). In Supabase mode
    // SupabaseJwtAuthBinding ignores the seat token entirely (it
    // verifies the JWT on /ws upgrade), so we omit it from the
    // bootstrap — the JWT lives only in the PairedResult below.
    const envAuthMode = selectAuthMode(this.env as unknown as JoinAuthEnv);
    const includeSeatTokens = envAuthMode.ok && envAuthMode.mode === 'dev';

    const initPayload = {
      initialState: initialStateBlob,
      seats: {
        A: includeSeatTokens
          ? { clientId: clientA, token: tokenA }
          : { clientId: clientA },
        B: includeSeatTokens
          ? { clientId: clientB, token: tokenB }
          : { clientId: clientB },
      },
    };

    // POST /init to the GameRoom DO and CHECK the response.
    const roomStub = this.env.GAME_ROOM.get(newId);
    let initResp: Response;
    try {
      initResp = await roomStub.fetch('https://internal/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(initPayload),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.queue.unshift(peer);
      await this.state.storage.put(STORAGE_KEY, this.queue);
      return Response.json(
        {
          status: 'init_failed',
          upstreamStatus: 0,
          upstreamBody: `fetch_error: ${reason}`,
        } satisfies InitFailureBody,
        { status: 502 },
      );
    }

    if (!initResp.ok) {
      const text = await initResp.text().catch(() => '');
      this.queue.unshift(peer);
      await this.state.storage.put(STORAGE_KEY, this.queue);
      return Response.json(
        {
          status: 'init_failed',
          upstreamStatus: initResp.status,
          upstreamBody: text,
        } satisfies InitFailureBody,
        { status: 502 },
      );
    }

    // PAIRED — persist results for BOTH players so the first one can
    // retrieve their pair via /api/poll, then respond to the second
    // (incoming) player synchronously.
    const leaderA = { id: peerLeader.id, name: peerLeader.name };
    const leaderB = { id: incomingLeader.id, name: incomingLeader.name };
    const pairedAt = Date.now();
    const resultA: PairedResult = {
      status: 'PAIRED',
      roomId,
      you: 'A',
      clientId: clientA,
      token: tokenA,
      leaderA,
      leaderB,
      pairedAt,
    };
    const resultB: PairedResult = {
      status: 'PAIRED',
      roomId,
      you: 'B',
      clientId: clientB,
      token: tokenB,
      leaderA,
      leaderB,
      pairedAt,
    };
    this.pairedResults[peer.sessionId] = resultA;
    this.pairedResults[sessionId] = resultB;
    await this.state.storage.put(PAIRED_STORAGE_KEY, this.pairedResults);

    return Response.json(resultB);
  }

  /**
   * F-5d.2: lazy-cache one `SupabaseJwtAuthBinding` per DO instance.
   * Returns null if Supabase config is missing (the resolver then
   * surfaces `auth_config_missing` to the caller).
   */
  private getOrCreateSupabaseBinding(): AuthBinding | null {
    if (this.supabaseBinding !== null) return this.supabaseBinding;
    const env = this.env as unknown as {
      SUPABASE_JWKS_URL?: string;
      SUPABASE_ISSUER?: string;
      SUPABASE_AUDIENCE?: string;
      SUPABASE_JWKS_CACHE_TTL_MS?: string;
    };
    if (
      typeof env.SUPABASE_JWKS_URL !== 'string' ||
      env.SUPABASE_JWKS_URL.length === 0 ||
      typeof env.SUPABASE_ISSUER !== 'string' ||
      env.SUPABASE_ISSUER.length === 0
    ) {
      return null;
    }
    const ttlMs =
      typeof env.SUPABASE_JWKS_CACHE_TTL_MS === 'string'
        ? Number.parseInt(env.SUPABASE_JWKS_CACHE_TTL_MS, 10)
        : undefined;
    this.supabaseBinding = new SupabaseJwtAuthBinding({
      jwksUrl: env.SUPABASE_JWKS_URL,
      issuer: env.SUPABASE_ISSUER,
      ...(env.SUPABASE_AUDIENCE !== undefined ? { audience: env.SUPABASE_AUDIENCE } : {}),
      ...(ttlMs !== undefined && Number.isFinite(ttlMs) ? { cacheTtlMs: ttlMs } : {}),
    });
    return this.supabaseBinding;
  }
}

function randomU32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! >>> 0;
}
