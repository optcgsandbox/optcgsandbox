/**
 * resolveJoinAuth / selectAuthMode — Phase F-5d.2.
 *
 * Pure-function tests for the Matchmaker's auth resolver. Supabase
 * happy paths use `StaticTokenAuthBinding` as a stand-in for the real
 * binding so we exercise the resolver's interaction with the
 * `AuthBinding` interface without depending on WebCrypto or JWKS
 * fetches (those are covered by `supabaseJwtAuthBinding.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import {
  resolveJoinAuth,
  selectAuthMode,
  type JoinAuthDeps,
  type JoinAuthEnv,
} from '../transport/joinAuth.js';
import { StaticTokenAuthBinding } from '../transport/auth.js';

// ─────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────

const SUPABASE_ENV: JoinAuthEnv = {
  ENV: 'dev',
  SUPABASE_JWKS_URL: 'https://example.supabase.co/auth/v1/.well-known/jwks.json',
  SUPABASE_ISSUER: 'https://example.supabase.co/auth/v1',
};

function deterministicUuids(values: string[]): () => string {
  let i = 0;
  return () => {
    const out = values[i] ?? `uuid-${i}`;
    i += 1;
    return out;
  };
}

function staticBinding(map: Record<string, { clientId: string; userId: string }>) {
  return new StaticTokenAuthBinding(map);
}

function depsForDev(over: Partial<JoinAuthDeps> = {}): JoinAuthDeps {
  return {
    env: { ENV: 'dev', DEV_AUTH: '1' },
    authHeader: null,
    bodyToken: null,
    bodySessionId: null,
    supabaseBinding: null,
    randomUuid: deterministicUuids(['s1', 't1', 's2', 't2']),
    ...over,
  };
}

function depsForSupabase(over: Partial<JoinAuthDeps> = {}): JoinAuthDeps {
  return {
    env: SUPABASE_ENV,
    authHeader: null,
    bodyToken: null,
    bodySessionId: null,
    supabaseBinding: staticBinding({
      'jwt-alice': { clientId: 'sb:alice-uuid', userId: 'alice-uuid' },
      'jwt-bob': { clientId: 'sb:bob-uuid', userId: 'bob-uuid' },
    }),
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────
// selectAuthMode
// ─────────────────────────────────────────────────────────────────────

describe('selectAuthMode', () => {
  it('returns dev when DEV_AUTH=1 and ENV != production', () => {
    expect(selectAuthMode({ DEV_AUTH: '1', ENV: 'dev' })).toEqual({
      ok: true,
      mode: 'dev',
    });
    expect(selectAuthMode({ DEV_AUTH: '1', ENV: 'staging' })).toEqual({
      ok: true,
      mode: 'dev',
    });
  });

  it('returns supabase when DEV_AUTH is absent or != 1', () => {
    expect(selectAuthMode({ ENV: 'production' })).toEqual({
      ok: true,
      mode: 'supabase',
    });
    expect(selectAuthMode({ DEV_AUTH: '0', ENV: 'dev' })).toEqual({
      ok: true,
      mode: 'supabase',
    });
  });

  it('rejects DEV_AUTH=1 + ENV=production with auth_config_invalid', () => {
    const res = selectAuthMode({ DEV_AUTH: '1', ENV: 'production' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe('auth_config_invalid');
      expect(res.httpStatus).toBe(500);
      expect(res.reason).toMatch(/DEV_AUTH=1 is rejected when ENV=production/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// resolveJoinAuth — dev mode
// ─────────────────────────────────────────────────────────────────────

describe('resolveJoinAuth — dev mode', () => {
  it('uses body.sessionId when provided and emits dev:<sessionId>', async () => {
    const res = await resolveJoinAuth(
      depsForDev({ bodySessionId: 'alice' }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.mode).toBe('dev');
      expect(res.clientId).toBe('dev:alice');
      expect(res.sessionId).toBe('alice');
      expect(res.tokenIsCredentialEcho).toBe(false);
      // token is a freshly-minted UUID (deterministic in the test)
      expect(res.token).toBe('s1');
    }
  });

  it('mints a sessionId when none is supplied', async () => {
    const res = await resolveJoinAuth(
      depsForDev({
        bodySessionId: null,
        randomUuid: deterministicUuids(['minted-sid', 'minted-token']),
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.clientId).toBe('dev:minted-sid');
      expect(res.sessionId).toBe('minted-sid');
      expect(res.token).toBe('minted-token');
    }
  });

  it('ignores Authorization header in dev mode', async () => {
    const res = await resolveJoinAuth(
      depsForDev({
        bodySessionId: 'alice',
        authHeader: 'Bearer jwt-alice',
      }),
    );
    if (res.ok) expect(res.clientId).toBe('dev:alice');
  });
});

// ─────────────────────────────────────────────────────────────────────
// resolveJoinAuth — Supabase mode rejection paths
// ─────────────────────────────────────────────────────────────────────

describe('resolveJoinAuth — Supabase mode rejections', () => {
  it('rejects when SUPABASE_JWKS_URL is missing', async () => {
    const res = await resolveJoinAuth(
      depsForSupabase({
        env: { ENV: 'dev', SUPABASE_ISSUER: 'https://x.example/auth/v1' },
        authHeader: 'Bearer jwt-alice',
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe('auth_config_missing');
      expect(res.httpStatus).toBe(500);
    }
  });

  it('rejects when SUPABASE_ISSUER is missing', async () => {
    const res = await resolveJoinAuth(
      depsForSupabase({
        env: { ENV: 'dev', SUPABASE_JWKS_URL: 'https://x.example/jwks.json' },
        authHeader: 'Bearer jwt-alice',
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe('auth_config_missing');
  });

  it('rejects missing JWT (no Authorization, no body.token)', async () => {
    const res = await resolveJoinAuth(depsForSupabase());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe('auth_failed');
      expect(res.reason).toBe('missing_jwt');
      expect(res.httpStatus).toBe(401);
    }
  });

  it('rejects empty Bearer token', async () => {
    const res = await resolveJoinAuth(
      depsForSupabase({ authHeader: 'Bearer   ' }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('missing_jwt');
  });

  it('rejects invalid token (binding returns unknown_token)', async () => {
    const res = await resolveJoinAuth(
      depsForSupabase({ authHeader: 'Bearer not-in-the-map' }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe('auth_failed');
      expect(res.reason).toBe('unknown_token');
      expect(res.httpStatus).toBe(401);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// resolveJoinAuth — Supabase mode happy path
// ─────────────────────────────────────────────────────────────────────

describe('resolveJoinAuth — Supabase mode happy path', () => {
  it('Authorization header → sb:<sub> clientId + JWT echoed in token', async () => {
    const res = await resolveJoinAuth(
      depsForSupabase({ authHeader: 'Bearer jwt-alice' }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.mode).toBe('supabase');
      expect(res.clientId).toBe('sb:alice-uuid');
      expect(res.sessionId).toBe('sb:alice-uuid');
      expect(res.token).toBe('jwt-alice');
      expect(res.tokenIsCredentialEcho).toBe(true);
    }
  });

  it('body.token fallback works when no Authorization header', async () => {
    const res = await resolveJoinAuth(
      depsForSupabase({ bodyToken: 'jwt-bob' }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.clientId).toBe('sb:bob-uuid');
  });

  it('Authorization header takes precedence over body.token', async () => {
    const res = await resolveJoinAuth(
      depsForSupabase({
        authHeader: 'Bearer jwt-alice',
        bodyToken: 'jwt-bob',
      }),
    );
    if (res.ok) expect(res.clientId).toBe('sb:alice-uuid');
  });

  it('different JWTs produce different sb:<sub> clientIds (seat distinctness)', async () => {
    const alice = await resolveJoinAuth(
      depsForSupabase({ authHeader: 'Bearer jwt-alice' }),
    );
    const bob = await resolveJoinAuth(
      depsForSupabase({ authHeader: 'Bearer jwt-bob' }),
    );
    if (alice.ok && bob.ok) {
      expect(alice.clientId).not.toBe(bob.clientId);
      expect(alice.clientId.startsWith('sb:')).toBe(true);
      expect(bob.clientId.startsWith('sb:')).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Production safety guard via resolveJoinAuth
// ─────────────────────────────────────────────────────────────────────

describe('resolveJoinAuth — production safety guard', () => {
  it('rejects DEV_AUTH=1 + ENV=production at the resolver level', async () => {
    const res = await resolveJoinAuth({
      env: { ENV: 'production', DEV_AUTH: '1' },
      authHeader: null,
      bodyToken: null,
      bodySessionId: 'alice',
      supabaseBinding: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe('auth_config_invalid');
  });
});
