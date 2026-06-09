/**
 * verifyJwt — Phase F-5c.2.
 *
 * Tests the standalone JWT verifier with locally-generated RSA + EC
 * key pairs. No network. Uses Node's globalThis.crypto.subtle (Node
 * 19+) which matches the Cloudflare Workers WebCrypto surface.
 */

import { describe, expect, it } from 'vitest';

import { verifyJwt } from '../transport/jwt.js';

// ─────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────

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

interface SignedToken {
  readonly token: string;
  readonly jwk: JsonWebKey & { kid: string; alg: string };
  readonly kid: string;
}

async function generateRsa(
  kid: string,
  bits: 2048 | 3072 = 2048,
): Promise<{ keyPair: CryptoKeyPair; publicJwk: JsonWebKey & { kid: string; alg: string } }> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
      publicExponent: new Uint8Array([1, 0, 1]),
      modulusLength: bits,
    },
    true,
    ['sign', 'verify'],
  );
  const publicJwkBase = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return {
    keyPair,
    publicJwk: { ...publicJwkBase, kid, alg: 'RS256' },
  };
}

async function generateEs256(
  kid: string,
): Promise<{ keyPair: CryptoKeyPair; publicJwk: JsonWebKey & { kid: string; alg: string } }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const publicJwkBase = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return {
    keyPair,
    publicJwk: { ...publicJwkBase, kid, alg: 'ES256' },
  };
}

async function signJwt(args: {
  privateKey: CryptoKey;
  kid: string;
  alg: 'RS256' | 'ES256';
  payload: Record<string, unknown>;
}): Promise<string> {
  const header = { alg: args.alg, typ: 'JWT', kid: args.kid };
  const headerB64 = b64urlStr(JSON.stringify(header));
  const payloadB64 = b64urlStr(JSON.stringify(args.payload));
  const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signParams =
    args.alg === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5' as const }
      : { name: 'ECDSA' as const, hash: 'SHA-256' as const };
  const sig = new Uint8Array(await crypto.subtle.sign(signParams, args.privateKey, signed));
  return `${headerB64}.${payloadB64}.${b64urlBytes(sig)}`;
}

function makeStaticKey(jwk: JsonWebKey & { kid: string }) {
  return async (kid: string | undefined): Promise<JsonWebKey | null> => {
    if (kid === undefined) return null;
    if (kid === jwk.kid) return jwk;
    return null;
  };
}

function freshPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'user-uuid-1',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Happy paths
// ─────────────────────────────────────────────────────────────────────

describe('verifyJwt — happy paths', () => {
  it('accepts a valid RS256 token', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      alg: 'RS256',
      payload: freshPayload(),
    });
    const r = await verifyJwt(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: makeStaticKey(publicJwk),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.sub).toBe('user-uuid-1');
      expect(r.header.alg).toBe('RS256');
    }
  });

  it('accepts a valid ES256 token', async () => {
    const { keyPair, publicJwk } = await generateEs256('ec1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'ec1',
      alg: 'ES256',
      payload: freshPayload(),
    });
    const r = await verifyJwt(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: makeStaticKey(publicJwk),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.header.alg).toBe('ES256');
  });

  it('accepts when audience is an array on the token', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      alg: 'RS256',
      payload: freshPayload({ aud: ['authenticated', 'other'] }),
    });
    const r = await verifyJwt(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: makeStaticKey(publicJwk),
    });
    expect(r.ok).toBe(true);
  });

  it('accepts when audience config is omitted (audience check skipped)', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      alg: 'RS256',
      payload: freshPayload({ aud: 'something-else' }),
    });
    const r = await verifyJwt(token, {
      issuer: ISSUER,
      // no audience
      getKey: makeStaticKey(publicJwk),
    });
    expect(r.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Failure paths
// ─────────────────────────────────────────────────────────────────────

describe('verifyJwt — failure paths', () => {
  it('rejects malformed token (wrong segment count)', async () => {
    const r = await verifyJwt('aaa.bbb', {
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: async () => null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed_token');
  });

  it('rejects malformed token (bad base64 segments)', async () => {
    const r = await verifyJwt('!!!!.????.&&&&', {
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: async () => null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed_token');
  });

  it('rejects unsupported alg (HS256)', async () => {
    const header = b64urlStr(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'x' }));
    const payload = b64urlStr(JSON.stringify(freshPayload()));
    const sig = b64urlBytes(new Uint8Array([1, 2, 3]));
    const token = `${header}.${payload}.${sig}`;
    const r = await verifyJwt(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: async () => null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_alg');
  });

  it('rejects unknown kid (lookup returns null)', async () => {
    const { keyPair } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      alg: 'RS256',
      payload: freshPayload(),
    });
    const r = await verifyJwt(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: async () => null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown_kid');
  });

  it('rejects token signed by a DIFFERENT key (invalid_signature)', async () => {
    const { keyPair: kpReal, publicJwk: jwkReal } = await generateRsa('k1');
    const { keyPair: kpAttacker } = await generateRsa('k1');
    // Attacker signs with their own private key but pretends kid=k1.
    void kpReal;
    const token = await signJwt({
      privateKey: kpAttacker.privateKey,
      kid: 'k1',
      alg: 'RS256',
      payload: freshPayload(),
    });
    const r = await verifyJwt(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: makeStaticKey(jwkReal), // verifier only knows the real public key
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_signature');
  });

  it('rejects expired token', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      alg: 'RS256',
      payload: freshPayload({ exp: Math.floor(Date.now() / 1000) - 3600 }),
    });
    const r = await verifyJwt(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: makeStaticKey(publicJwk),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('expired');
  });

  it('rejects not-yet-valid token (nbf in the future)', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      alg: 'RS256',
      payload: freshPayload({ nbf: Math.floor(Date.now() / 1000) + 3600 }),
    });
    const r = await verifyJwt(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: makeStaticKey(publicJwk),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_yet_valid');
  });

  it('rejects wrong issuer', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      alg: 'RS256',
      payload: freshPayload({ iss: 'https://malicious.example/auth' }),
    });
    const r = await verifyJwt(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: makeStaticKey(publicJwk),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_issuer');
  });

  it('rejects wrong audience', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    const token = await signJwt({
      privateKey: keyPair.privateKey,
      kid: 'k1',
      alg: 'RS256',
      payload: freshPayload({ aud: 'service_role' }),
    });
    const r = await verifyJwt(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: makeStaticKey(publicJwk),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_audience');
  });

  it('rejects when token omits kid (fail-closed)', async () => {
    const { keyPair, publicJwk } = await generateRsa('k1');
    // Sign with no kid in header.
    const header = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = b64urlStr(JSON.stringify(freshPayload()));
    const signed = new TextEncoder().encode(`${header}.${payload}`);
    const sig = b64urlBytes(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: 'RSASSA-PKCS1-v1_5' },
          keyPair.privateKey,
          signed,
        ),
      ),
    );
    const token = `${header}.${payload}.${sig}`;
    // Verifier's getKey passes through kid=undefined, our test impl
    // returns null in that case → unknown_kid.
    const r = await verifyJwt(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: makeStaticKey(publicJwk),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown_kid');
  });
});
