// Supabase JWT auth binding — Phase F-5c.2.
//
// Concrete `AuthBinding` that validates a Supabase-issued JWT against
// the project's JWKS endpoint and yields a stable, namespaced clientId.
// Drops into the transport layer wherever `StaticTokenAuthBinding` was
// previously used — same interface, same failure-result shape.
//
// Trust posture:
//   - Issuer + JWKS URL come from CONSTRUCTOR CONFIG only. No
//     `process.env` reads, no hardcoded URLs. Callers (the Worker)
//     read their env and inject the values.
//   - Audience defaults to Supabase's `authenticated` claim; can be
//     overridden via config.
//   - `clientId = "sb:<sub>"` so it's namespaced and impossible to
//     collide with other future providers' subjects.
//
// What this class is responsible for:
//   - JWKS fetch + in-memory cache with TTL.
//   - Coalescing concurrent JWKS fetches (single inflight promise).
//   - Surfacing fetch failures as `jwks_fetch_failed` rather than
//     throwing into the dispatch loop.
//   - Translating raw `verifyJwt` reasons into the public taxonomy.
//
// What it is NOT responsible for:
//   - Token revocation (Supabase's posture is short-lived tokens; F-6+
//     may revisit).
//   - Service-role / PAT tokens. Don't pass them here.
//   - JWE / encrypted bodies.

import type {
  AuthBinding,
  AuthenticateResult,
  AuthenticatedClient,
} from './auth.js';
import { verifyJwt } from './jwt.js';

export interface SupabaseJwtAuthBindingConfig {
  /**
   * Full URL of the Supabase project's JWKS endpoint. Typical shape:
   *   `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`
   * The caller is expected to construct this from `SUPABASE_URL`.
   */
  readonly jwksUrl: string;
  /**
   * Expected JWT `iss` claim. For Supabase this is generally
   *   `https://<project-ref>.supabase.co/auth/v1`
   * (i.e. the auth issuer, not the project root). Must match exactly
   * the value the JWT carries.
   */
  readonly issuer: string;
  /**
   * Expected JWT `aud` claim. Defaults to `'authenticated'` which is
   * Supabase's audience for user sessions. Override for service /
   * admin contexts (but service-role tokens should never reach here).
   */
  readonly audience?: string | ReadonlyArray<string>;
  /** JWKS cache TTL in ms. Default: 10 minutes. */
  readonly cacheTtlMs?: number;
  /** Optional clock-skew tolerance, seconds. Default 60. */
  readonly clockSkewSec?: number;
  /** Optional fetch override for tests. Defaults to global fetch. */
  readonly fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Optional `Date.now`-like callback for tests. Returns ms. */
  readonly nowMs?: () => number;
}

interface JwksKey extends JsonWebKey {
  readonly kid?: string;
  readonly alg?: string;
}

interface JwksDoc {
  readonly keys: ReadonlyArray<JwksKey>;
}

const DEFAULT_AUDIENCE = 'authenticated';
const DEFAULT_TTL_MS = 600_000; // 10 minutes

export class SupabaseJwtAuthBinding implements AuthBinding {
  private readonly jwksUrl: string;
  private readonly issuer: string;
  private readonly audience: string | ReadonlyArray<string>;
  private readonly ttlMs: number;
  private readonly clockSkewSec: number | undefined;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly nowMs: () => number;

  private cached: { readonly doc: JwksDoc; readonly fetchedAtMs: number } | null = null;
  private inflight: Promise<JwksDoc> | null = null;

  constructor(config: SupabaseJwtAuthBindingConfig) {
    if (typeof config.jwksUrl !== 'string' || config.jwksUrl.length === 0) {
      throw new Error('SupabaseJwtAuthBinding: jwksUrl is required');
    }
    if (typeof config.issuer !== 'string' || config.issuer.length === 0) {
      throw new Error('SupabaseJwtAuthBinding: issuer is required');
    }
    this.jwksUrl = config.jwksUrl;
    this.issuer = config.issuer;
    this.audience = config.audience ?? DEFAULT_AUDIENCE;
    this.ttlMs = config.cacheTtlMs ?? DEFAULT_TTL_MS;
    this.clockSkewSec = config.clockSkewSec;
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
    this.nowMs = config.nowMs ?? Date.now.bind(Date);
  }

  async authenticate(token: string): Promise<AuthenticateResult> {
    if (typeof token !== 'string' || token.length === 0) {
      return { ok: false, reason: 'invalid_token' };
    }

    let result;
    try {
      result = await verifyJwt(token, {
        issuer: this.issuer,
        audience: this.audience,
        getKey: (kid, alg) => this.lookupJwk(kid, alg),
        ...(this.clockSkewSec !== undefined ? { clockSkewSec: this.clockSkewSec } : {}),
        now: () => Math.floor(this.nowMs() / 1000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'jwks_fetch_failed') {
        return { ok: false, reason: 'jwks_fetch_failed' };
      }
      // Any other thrown error from the JWKS lookup → opaque
      return { ok: false, reason: 'invalid_token' };
    }

    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }
    const sub = result.payload.sub;
    if (typeof sub !== 'string' || sub.length === 0) {
      return { ok: false, reason: 'invalid_token' };
    }

    const client: AuthenticatedClient = {
      clientId: `sb:${sub}`,
      userId: sub,
    };
    return { ok: true, client };
  }

  // ─────────────────────────────────────────────────────────────────
  // JWKS cache
  // ─────────────────────────────────────────────────────────────────

  private async lookupJwk(
    kid: string | undefined,
    _alg: string,
  ): Promise<JsonWebKey | null> {
    // Supabase JWTs always carry a `kid`; fail closed if absent so a
    // forged header that omits kid can't fall back to "first key".
    if (kid === undefined) return null;
    const doc = await this.getJwks();
    const hit = doc.keys.find((k) => k.kid === kid);
    return hit ?? null;
  }

  private async getJwks(): Promise<JwksDoc> {
    const nowMs = this.nowMs();
    if (this.cached !== null && nowMs - this.cached.fetchedAtMs < this.ttlMs) {
      return this.cached.doc;
    }
    // Coalesce concurrent refresh attempts so a flurry of inbound
    // tokens during cache invalidation produces ONE network call.
    if (this.inflight !== null) return this.inflight;
    this.inflight = this.refreshJwks(nowMs);
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  private async refreshJwks(nowMs: number): Promise<JwksDoc> {
    let resp: Response;
    try {
      resp = await this.fetchImpl(this.jwksUrl);
    } catch {
      throw new Error('jwks_fetch_failed');
    }
    if (!resp.ok) throw new Error('jwks_fetch_failed');
    let doc: JwksDoc;
    try {
      doc = (await resp.json()) as JwksDoc;
    } catch {
      throw new Error('jwks_fetch_failed');
    }
    if (doc === null || typeof doc !== 'object' || !Array.isArray(doc.keys)) {
      throw new Error('jwks_fetch_failed');
    }
    this.cached = { doc, fetchedAtMs: nowMs };
    return doc;
  }
}
