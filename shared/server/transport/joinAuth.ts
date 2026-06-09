// Auth-mode resolution for the Matchmaker's /api/join endpoint.
//
// Pure module. No Cloudflare specifics, no DO state, no I/O. The
// Matchmaker injects the right `AuthBinding` for the current mode;
// tests inject a `StaticTokenAuthBinding` with a known token map.
//
// Phase F-5d.2 — adds an auth-aware Matchmaker path that produces
// `sb:<sub>` clientIds in Supabase mode (matching what
// `SupabaseJwtAuthBinding` returns on WS upgrade), so GameRoom's seat
// lookup compares apples-to-apples and `clientId_not_seated` 409
// becomes unreachable.

import type { AuthBinding } from './auth.js';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type JoinAuthMode = 'dev' | 'supabase';

export interface JoinAuthEnv {
  readonly ENV?: string;
  readonly DEV_AUTH?: string;
  readonly SUPABASE_JWKS_URL?: string;
  readonly SUPABASE_ISSUER?: string;
}

export interface JoinAuthDeps {
  /** Worker env vars — used to select mode and validate config. */
  readonly env: JoinAuthEnv;
  /**
   * Raw `Authorization` header value. e.g. `"Bearer eyJ..."`. May be
   * `null` if the request had no Authorization header. Ignored in dev
   * mode.
   */
  readonly authHeader: string | null;
  /**
   * Caller-supplied `body.token` (smoke fallback). Ignored if
   * authHeader is present.
   */
  readonly bodyToken: string | null;
  /** Caller-supplied `body.sessionId`. Used only in dev mode. */
  readonly bodySessionId: string | null;
  /**
   * `AuthBinding` to call when mode === 'supabase'. The Matchmaker
   * passes a lazy-cached `SupabaseJwtAuthBinding`; tests pass a
   * `StaticTokenAuthBinding` with a known token table.
   * Pass `null` in dev mode (the resolver doesn't need it).
   */
  readonly supabaseBinding: AuthBinding | null;
  /**
   * RNG/UUID factory. Defaults to `crypto.randomUUID`. Tests override
   * for determinism.
   */
  readonly randomUuid?: () => string;
}

export type JoinAuthOutcome =
  | {
      readonly ok: true;
      readonly mode: JoinAuthMode;
      /** Trusted clientId — `dev:<sessionId>` or `sb:<sub>`. */
      readonly clientId: string;
      /** Credential to echo back to the caller. In dev: minted UUID. In Supabase: the JWT the caller sent (echo). */
      readonly token: string;
      /** Queue-dedup key. Equals `clientId` in Supabase mode (durable across re-joins); `bodySessionId ?? new UUID` in dev mode. */
      readonly sessionId: string;
      /** Whether `token` was an echo of the caller's credential (Supabase) vs minted server-side (dev). */
      readonly tokenIsCredentialEcho: boolean;
    }
  | {
      readonly ok: false;
      readonly status: 'auth_failed' | 'auth_config_missing' | 'auth_config_invalid';
      readonly reason: string;
      readonly httpStatus: number;
    };

// ─────────────────────────────────────────────────────────────────────
// Mode selection
// ─────────────────────────────────────────────────────────────────────

/**
 * Decide which mode the Matchmaker should use for this request. Pure
 * function; no I/O. Exported separately so it can be unit-tested in
 * isolation.
 *
 * Modes:
 *   - dev      — `DEV_AUTH === '1'` AND `ENV !== 'production'`
 *   - supabase — otherwise
 *
 * Fail-loud guard:
 *   - `ENV === 'production'` AND `DEV_AUTH === '1'` → returns the
 *     `auth_config_invalid` error so callers can short-circuit. Mirrors
 *     `worker/GameRoom.ts:rebuildEngine`'s production guard.
 */
export function selectAuthMode(
  env: JoinAuthEnv,
):
  | { readonly ok: true; readonly mode: JoinAuthMode }
  | {
      readonly ok: false;
      readonly status: 'auth_config_invalid';
      readonly reason: string;
      readonly httpStatus: number;
    } {
  const isDevAuth = env.DEV_AUTH === '1';
  const isProdEnv = env.ENV === 'production';
  if (isDevAuth && isProdEnv) {
    return {
      ok: false,
      status: 'auth_config_invalid',
      reason: 'DEV_AUTH=1 is rejected when ENV=production',
      httpStatus: 500,
    };
  }
  return { ok: true, mode: isDevAuth ? 'dev' : 'supabase' };
}

// ─────────────────────────────────────────────────────────────────────
// Resolver
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve the caller's identity for /api/join. Returns either:
 *   - `{ ok:true, mode, clientId, token, sessionId, tokenIsCredentialEcho }`
 *   - `{ ok:false, status, reason, httpStatus }` — caller should respond
 *     with `Response.json({ status, reason }, { status: httpStatus })`.
 *
 * In dev mode, no authentication is performed. The Matchmaker mints
 * a fresh token (UUID) for the session, returned as `token` for the
 * StaticTokenAuthBinding handshake on the GameRoom side.
 *
 * In Supabase mode, the JWT is extracted from `Authorization: Bearer …`
 * (preferred) or `bodyToken` (smoke fallback), verified via the
 * supplied `supabaseBinding`, and the resulting `sb:<sub>` clientId is
 * returned. The JWT itself is echoed in `token` so the F-7b lobby
 * client can use it for the subsequent `/ws?token=…` upgrade. The JWT
 * is NOT persisted in DO storage on the Matchmaker side — the caller
 * already has it.
 */
export async function resolveJoinAuth(
  deps: JoinAuthDeps,
): Promise<JoinAuthOutcome> {
  const modeResult = selectAuthMode(deps.env);
  if (!modeResult.ok) return modeResult;

  if (modeResult.mode === 'dev') {
    const rand = deps.randomUuid ?? defaultRandomUuid;
    const sessionId =
      typeof deps.bodySessionId === 'string' && deps.bodySessionId.length > 0
        ? deps.bodySessionId
        : rand();
    return {
      ok: true,
      mode: 'dev',
      clientId: `dev:${sessionId}`,
      token: rand(),
      sessionId,
      tokenIsCredentialEcho: false,
    };
  }

  // Supabase mode
  if (
    typeof deps.env.SUPABASE_JWKS_URL !== 'string' ||
    deps.env.SUPABASE_JWKS_URL.length === 0 ||
    typeof deps.env.SUPABASE_ISSUER !== 'string' ||
    deps.env.SUPABASE_ISSUER.length === 0
  ) {
    return {
      ok: false,
      status: 'auth_config_missing',
      reason:
        'SUPABASE_JWKS_URL and SUPABASE_ISSUER must be configured in wrangler.toml [vars]',
      httpStatus: 500,
    };
  }
  if (deps.supabaseBinding === null) {
    return {
      ok: false,
      status: 'auth_config_missing',
      reason: 'supabase auth binding not provided',
      httpStatus: 500,
    };
  }

  const jwt = extractJwt(deps.authHeader, deps.bodyToken);
  if (jwt === null) {
    return {
      ok: false,
      status: 'auth_failed',
      reason: 'missing_jwt',
      httpStatus: 401,
    };
  }

  const authResult = await deps.supabaseBinding.authenticate(jwt);
  if (!authResult.ok) {
    return {
      ok: false,
      status: 'auth_failed',
      reason: authResult.reason,
      httpStatus: 401,
    };
  }

  const clientId = authResult.client.clientId;
  return {
    ok: true,
    mode: 'supabase',
    clientId,
    token: jwt, // echo the caller's credential
    sessionId: clientId, // queue-dedup by sb:<sub>; durable across re-joins
    tokenIsCredentialEcho: true,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract a bearer JWT. Prefers the `Authorization` header (the
 * standard surface). Falls back to a caller-supplied `body.token` only
 * if the header is absent — documented as the smoke/dev fallback for
 * environments where header forwarding is awkward.
 */
function extractJwt(
  authHeader: string | null,
  bodyToken: string | null,
): string | null {
  if (typeof authHeader === 'string') {
    const trimmed = authHeader.trim();
    if (trimmed.toLowerCase().startsWith('bearer ')) {
      const token = trimmed.slice(7).trim();
      if (token.length > 0) return token;
    }
  }
  if (typeof bodyToken === 'string' && bodyToken.length > 0) return bodyToken;
  return null;
}

function defaultRandomUuid(): string {
  return crypto.randomUUID();
}
