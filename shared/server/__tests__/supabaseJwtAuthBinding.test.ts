/**
 * SupabaseJwtAuthBinding — Phase F-5c.2.
 *
 * Exercises the auth binding end-to-end against locally-generated keys
 * and a mocked `fetch`. Covers each failure-reason path in the public
 * taxonomy plus JWKS cache hit/refresh + concurrent-fetch coalescing.
 */

import { describe, expect, it } from 'vitest';

import { SupabaseJwtAuthBinding } from '../transport/SupabaseJwtAuthBinding.js';

// ─────────────────────────────────────────────────────────────────────
// Helpers (mirrors jwt.test.ts but factored for binding-level tests)
// ─────────────────────────────────────────────────────────────────────

const JWKS_URL = 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
const ISSUER = 'https://example.supabase.co/auth/v1';
const AUDIENCE = 'authenticated';

function b64urlBytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(s: string): string {
  return b64urlBytes(new TextEncoder().encode(s));
}

async function generateRsa(kid: string) {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
      publicExponent: new Uint8Array([1, 0, 1]),
      modulusLength: 2048,
    },
    true,
    ['sign', 'verify'],
  );
  const publicJwkBase = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    keyPair: pair,
    publicJwk: { ...publicJwkBase, kid, alg: 'RS256' } as JsonWebKey & {
      kid: string;
      alg: string;
    },
  };
}

async function signJwt(args: {
  privateKey: CryptoKey;
  kid: string;
  payload: Record<string, unknown>;
}): Promise<string> {
  const header = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: args.kid }));
  const payload = b64urlStr(JSON.stringify(args.payload));
  const signed = new TextEncoder().encode(`${header}.${payload}`);
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, args.privateKey, signed),
  );
  return `${header}.${payload}.${b64urlBytes(sig)}`;
}

function basePayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'user-uuid-1',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...over,
  };
}

/**
 * Build a mock `fetch` that returns a JWKS doc. Supports:
 *   - initialFailures: respond 500 for the first N calls, then succeed.
 *   - jwksByCall: hand back a different JWKS doc per call number, so we
 *     can exercise key rotation across cache refresh.
 */
function makeMockFetch(
  jwks: { keys: JsonWebKey[] },
  opts: { initialFailures?: number; jwksByCall?: { keys: JsonWebKey[] }[] } = {},
): ((input: string) => Promise<Response>) & {
  callCount(): number;
  callLog(): string[];
} {
  let calls = 0;
  const recordCalls: string[] = [];
  let remainingFailures = opts.initialFailures ?? 0;
  const handler = async (input: string): Promise<Response> => {
    recordCalls.push(input);
    calls += 1;
    if (remainingFailures > 0) {
      remainingFailures -= 1;
      return new Response('boom', { status: 500 });
    }
    const body = opts.jwksByCall?.[calls - 1] ?? jwks;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  // Methods, not getters — Object.assign cannot preserve accessor descriptors;
  // it invokes the getter on the source and copies the value at that instant.
  return Object.assign(handler, {
    callCount: () => calls,
    callLog: () => recordCalls.slice(),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('SupabaseJwtAuthBinding — happy path', () => {
  it('accepts a valid JWT and yields clientId = sb:<sub>', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      payload: basePayload(),
    });
    const fetchImpl = makeMockFetch({ keys: [publicJwk] });
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl,
    });
    const r = await binding.authenticate(token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.client.clientId).toBe('sb:user-uuid-1');
      expect(r.client.userId).toBe('user-uuid-1');
    }
  });

  it('default audience is "authenticated"', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    // Token issued with the default Supabase user audience.
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      payload: basePayload({ aud: 'authenticated' }),
    });
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl: makeMockFetch({ keys: [publicJwk] }),
      // audience omitted → uses default 'authenticated'
    });
    const r = await binding.authenticate(token);
    expect(r.ok).toBe(true);
  });
});

describe('SupabaseJwtAuthBinding — failure-reason taxonomy', () => {
  it('rejects empty token with invalid_token', async () => {
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl: makeMockFetch({ keys: [] }),
    });
    const r = await binding.authenticate('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_token');
  });

  it('rejects malformed token with malformed_token', async () => {
    const { publicJwk } = await generateRsa('k1');
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl: makeMockFetch({ keys: [publicJwk] }),
    });
    const r = await binding.authenticate('not.a.jwt.even.close');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed_token');
  });

  it('rejects expired token with expired', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      payload: basePayload({ exp: Math.floor(Date.now() / 1000) - 3600 }),
    });
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl: makeMockFetch({ keys: [publicJwk] }),
    });
    const r = await binding.authenticate(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('expired');
  });

  it('rejects bad signature with invalid_signature', async () => {
    const { keyPair: real, publicJwk: realJwk } = await generateRsa('k1');
    const { keyPair: imposter } = await generateRsa('k1');
    void real;
    // Sign with imposter's key but reuse the real key's kid.
    const token = await signJwt({
      privateKey: imposter.privateKey,
      kid: 'k1',
      payload: basePayload(),
    });
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl: makeMockFetch({ keys: [realJwk] }),
    });
    const r = await binding.authenticate(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_signature');
  });

  it('rejects wrong issuer with invalid_issuer', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      payload: basePayload({ iss: 'https://attacker.example/auth' }),
    });
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl: makeMockFetch({ keys: [publicJwk] }),
    });
    const r = await binding.authenticate(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_issuer');
  });

  it('rejects wrong audience with invalid_audience', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      payload: basePayload({ aud: 'service_role' }),
    });
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl: makeMockFetch({ keys: [publicJwk] }),
    });
    const r = await binding.authenticate(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_audience');
  });

  it('rejects unknown kid with unknown_kid', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k-not-in-jwks',
      payload: basePayload(),
    });
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl: makeMockFetch({ keys: [publicJwk] }),
    });
    const r = await binding.authenticate(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown_kid');
  });

  it('rejects JWKS fetch failure with jwks_fetch_failed', async () => {
    const { keyPair } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      payload: basePayload(),
    });
    // initialFailures = Infinity keeps the mock 500ing.
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl: makeMockFetch({ keys: [] }, { initialFailures: 99 }),
    });
    const r = await binding.authenticate(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('jwks_fetch_failed');
  });

  it('rejects token without sub with invalid_token', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      payload: basePayload({ sub: undefined }),
    });
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl: makeMockFetch({ keys: [publicJwk] }),
    });
    const r = await binding.authenticate(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_token');
  });
});

// ─────────────────────────────────────────────────────────────────────
// JWKS cache behavior
// ─────────────────────────────────────────────────────────────────────

describe('SupabaseJwtAuthBinding — JWKS cache', () => {
  it('serves a second authenticate() from cache (one fetch for many tokens)', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const fetchImpl = makeMockFetch({ keys: [publicJwk] });
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl,
      cacheTtlMs: 600_000,
    });
    const tokenA = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      payload: basePayload({ sub: 'a' }),
    });
    const tokenB = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      payload: basePayload({ sub: 'b' }),
    });

    await binding.authenticate(tokenA);
    await binding.authenticate(tokenB);
    expect(fetchImpl.callCount()).toBe(1);
  });

  it('refreshes JWKS after TTL expires', async () => {
    const { keyPair: kp1, publicJwk: jwk1 } = await generateRsa('k1');
    const { publicJwk: jwk2 } = await generateRsa('k2');
    let nowMs = 0;
    const fetchImpl = makeMockFetch(
      { keys: [jwk1] },
      { jwksByCall: [{ keys: [jwk1] }, { keys: [jwk1, jwk2] }] },
    );
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl,
      cacheTtlMs: 1_000,
      nowMs: () => nowMs,
    });
    const tokenK1 = await signJwt({
      privateKey: kp1.privateKey,
      kid: 'k1',
      payload: basePayload(),
    });

    nowMs = 1_000_000;
    await binding.authenticate(tokenK1);
    expect(fetchImpl.callCount()).toBe(1);
    // Within TTL: no refresh.
    nowMs += 500;
    await binding.authenticate(tokenK1);
    expect(fetchImpl.callCount()).toBe(1);
    // Past TTL: refresh.
    nowMs += 5_000;
    await binding.authenticate(tokenK1);
    expect(fetchImpl.callCount()).toBe(2);
  });

  it('coalesces concurrent JWKS fetches into a single network call', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    // Insert an artificial async gap to make the inflight promise observable.
    let calls = 0;
    const fetchImpl: ((input: string) => Promise<Response>) & { callCount(): number } =
      Object.assign(
        async () =>
          new Promise<Response>((resolve) => {
            calls += 1;
            setTimeout(
              () =>
                resolve(
                  new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 }),
                ),
              10,
            );
          }),
        { callCount: () => calls },
      );
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl,
    });
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      payload: basePayload(),
    });
    // Fire 5 concurrent authenticates.
    const results = await Promise.all([
      binding.authenticate(token),
      binding.authenticate(token),
      binding.authenticate(token),
      binding.authenticate(token),
      binding.authenticate(token),
    ]);
    for (const r of results) expect(r.ok).toBe(true);
    expect(fetchImpl.callCount()).toBe(1);
  });

  it('handles key rotation: new kid becomes resolvable after TTL refresh', async () => {
    const { keyPair: kp1, publicJwk: jwk1 } = await generateRsa('k1');
    const { keyPair: kp2, publicJwk: jwk2 } = await generateRsa('k2');
    let nowMs = 1_000_000;
    const fetchImpl = makeMockFetch(
      { keys: [jwk1] },
      { jwksByCall: [{ keys: [jwk1] }, { keys: [jwk1, jwk2] }] },
    );
    const binding = new SupabaseJwtAuthBinding({
      jwksUrl: JWKS_URL,
      issuer: ISSUER,
      fetchImpl,
      cacheTtlMs: 1_000,
      nowMs: () => nowMs,
    });

    // Token signed by k1 — accepted from first fetch.
    const t1 = await signJwt({
      privateKey: kp1.privateKey,
      kid: 'k1',
      payload: basePayload({ sub: 'one' }),
    });
    expect((await binding.authenticate(t1)).ok).toBe(true);

    // Token signed by k2 — still unknown before refresh.
    const t2 = await signJwt({
      privateKey: kp2.privateKey,
      kid: 'k2',
      payload: basePayload({ sub: 'two' }),
    });
    const beforeRotation = await binding.authenticate(t2);
    expect(beforeRotation.ok).toBe(false);
    if (!beforeRotation.ok) expect(beforeRotation.reason).toBe('unknown_kid');

    // Tick past TTL → next call refetches; k2 now present.
    nowMs += 5_000;
    const afterRotation = await binding.authenticate(t2);
    expect(afterRotation.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Construction validation
// ─────────────────────────────────────────────────────────────────────

describe('SupabaseJwtAuthBinding — construction', () => {
  it('throws if jwksUrl is missing', () => {
    expect(
      () =>
        new SupabaseJwtAuthBinding({
          jwksUrl: '',
          issuer: ISSUER,
        }),
    ).toThrow(/jwksUrl is required/);
  });

  it('throws if issuer is missing', () => {
    expect(
      () =>
        new SupabaseJwtAuthBinding({
          jwksUrl: JWKS_URL,
          issuer: '',
        }),
    ).toThrow(/issuer is required/);
  });
});
