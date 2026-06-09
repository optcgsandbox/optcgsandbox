// JWT verifier — RS256/RS384/RS512 + ES256/ES384 via WebCrypto.
//
// Used by `SupabaseJwtAuthBinding` and any future provider binding that
// validates a JWT-shaped credential. Pure: no I/O, no caches, no fetches.
// The caller supplies a `getKey(kid, alg)` callback that does any caching.
//
// Why hand-rolled and not `jose`:
//   - Zero new runtime dependency (`package.json` runtime deps are
//     `react`, `react-dom`, `react-router-dom`, `framer-motion`, `zod`,
//     `zustand` only — verified before writing this).
//   - Runs in both Cloudflare Workers (`globalThis.crypto.subtle`) and
//     Node 19+ vitest (`globalThis.crypto.subtle`).
//   - The verifier is ~100 lines; the failure surface is small and
//     auditable.
//
// What it does NOT do:
//   - JWE / encrypted JWTs.
//   - HMAC-based JWTs (HS256/384/512) — those require a shared secret,
//     which is not the Supabase JWKS posture.
//   - Custom audience matchers, scope/role assertions, anti-replay
//     nonces — callers layer those on top.

const SUPPORTED_ALGS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384'] as const;
type SupportedAlg = (typeof SUPPORTED_ALGS)[number];

export interface JwtHeader {
  readonly alg: string;
  readonly kid?: string;
  readonly typ?: string;
}

export interface JwtPayload {
  readonly iss?: string;
  readonly aud?: string | ReadonlyArray<string>;
  readonly exp?: number;
  readonly nbf?: number;
  readonly iat?: number;
  readonly sub?: string;
  readonly [key: string]: unknown;
}

export interface JwtVerifyConfig {
  readonly issuer: string;
  /**
   * Required audience. String → exact match. Array → JWT's `aud` must
   * intersect non-emptily. Omit to skip audience validation.
   */
  readonly audience?: string | ReadonlyArray<string>;
  /**
   * Lookup callback: return the public JWK for the given `kid` + `alg`,
   * or `null` if unknown. The caller is responsible for any caching.
   */
  readonly getKey: (
    kid: string | undefined,
    alg: string,
  ) => Promise<JsonWebKey | null>;
  /** Clock-skew tolerance in seconds. Default: 60. */
  readonly clockSkewSec?: number;
  /** Test seam. Defaults to `floor(Date.now() / 1000)`. */
  readonly now?: () => number;
}

export type JwtVerifyResult =
  | { readonly ok: true; readonly header: JwtHeader; readonly payload: JwtPayload }
  | { readonly ok: false; readonly reason: string };

/**
 * Verify a JWT against the given config. Always returns a discriminated
 * result; never throws.
 *
 * Failure reasons (string, exact match preserved across binding callers):
 *   - `malformed_token`   — not a `header.payload.signature` shape, or
 *                            bad base64url, or header/payload not JSON.
 *   - `invalid_alg`       — header.alg not in {RS256/384/512, ES256/384}.
 *   - `unknown_kid`       — `getKey(kid, alg)` returned null.
 *   - `invalid_signature` — WebCrypto verify returned false, or
 *                            importKey/verify threw.
 *   - `expired`           — `exp + clockSkewSec < now`.
 *   - `not_yet_valid`     — `nbf - clockSkewSec > now`.
 *   - `invalid_issuer`    — `payload.iss !== config.issuer`.
 *   - `invalid_audience`  — config.audience supplied but payload.aud
 *                            doesn't intersect.
 */
export async function verifyJwt(
  token: string,
  config: JwtVerifyConfig,
): Promise<JwtVerifyResult> {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'malformed_token' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed_token' };
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = JSON.parse(base64UrlDecodeToString(headerB64)) as JwtHeader;
    payload = JSON.parse(base64UrlDecodeToString(payloadB64)) as JwtPayload;
  } catch {
    return { ok: false, reason: 'malformed_token' };
  }
  if (header === null || typeof header !== 'object') {
    return { ok: false, reason: 'malformed_token' };
  }
  if (payload === null || typeof payload !== 'object') {
    return { ok: false, reason: 'malformed_token' };
  }
  if (typeof header.alg !== 'string' || !(SUPPORTED_ALGS as ReadonlyArray<string>).includes(header.alg)) {
    return { ok: false, reason: 'invalid_alg' };
  }
  const alg = header.alg as SupportedAlg;

  const jwk = await config.getKey(header.kid, alg);
  if (jwk === null) return { ok: false, reason: 'unknown_kid' };

  const params = algParams(alg);
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      params.importParams,
      false,
      ['verify'],
    );
  } catch {
    return { ok: false, reason: 'invalid_signature' };
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlDecodeToBytes(signatureB64);
  } catch {
    return { ok: false, reason: 'malformed_token' };
  }
  const signedInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  let valid = false;
  try {
    // Note: ECDSA signature in JWT is raw r||s (IEEE P1363 / JWS) which
    // is exactly what `crypto.subtle.verify` expects for ECDSA. No DER
    // conversion needed.
    //
    // Cast both byte arrays to `BufferSource` via the `.buffer` ArrayBuffer
    // slice — TS 6 strict refuses to widen `Uint8Array<ArrayBufferLike>` to
    // `BufferSource = ArrayBuffer | ArrayBufferView` directly, but the
    // underlying byte ranges are exactly the data the WebCrypto API wants.
    valid = await crypto.subtle.verify(
      params.verifyParams,
      cryptoKey,
      asBuffer(signatureBytes),
      asBuffer(signedInput),
    );
  } catch {
    return { ok: false, reason: 'invalid_signature' };
  }
  if (!valid) return { ok: false, reason: 'invalid_signature' };

  // Claim checks
  const now = (config.now ?? (() => Math.floor(Date.now() / 1000)))();
  const skew = config.clockSkewSec ?? 60;
  if (typeof payload.exp === 'number' && payload.exp + skew < now) {
    return { ok: false, reason: 'expired' };
  }
  if (typeof payload.nbf === 'number' && payload.nbf - skew > now) {
    return { ok: false, reason: 'not_yet_valid' };
  }
  if (typeof payload.iss !== 'string' || payload.iss !== config.issuer) {
    return { ok: false, reason: 'invalid_issuer' };
  }
  if (config.audience !== undefined) {
    const want = typeof config.audience === 'string'
      ? [config.audience]
      : Array.from(config.audience);
    const got = payload.aud === undefined
      ? []
      : typeof payload.aud === 'string'
        ? [payload.aud]
        : Array.from(payload.aud);
    if (!got.some((a) => want.includes(a))) {
      return { ok: false, reason: 'invalid_audience' };
    }
  }

  return { ok: true, header, payload };
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

// Structural shapes for WebCrypto algorithm params. Using local interfaces
// (rather than the DOM-defined `RsaHashedImportParams` / `EcKeyImportParams`
// / `EcdsaParams` names) so this file compiles cleanly under tsconfigs
// that don't include the DOM lib — notably `worker/tsconfig.json` which
// declares only `lib: ["es2022"]` + `@cloudflare/workers-types`.
interface RsaImportParams {
  readonly name: 'RSASSA-PKCS1-v1_5';
  readonly hash: 'SHA-256' | 'SHA-384' | 'SHA-512';
}
interface EcImportParams {
  readonly name: 'ECDSA';
  readonly namedCurve: 'P-256' | 'P-384';
}
interface RsaVerifyParams {
  readonly name: 'RSASSA-PKCS1-v1_5';
}
interface EcVerifyParams {
  readonly name: 'ECDSA';
  readonly hash: 'SHA-256' | 'SHA-384';
}

interface AlgParams {
  readonly importParams: RsaImportParams | EcImportParams;
  readonly verifyParams: RsaVerifyParams | EcVerifyParams;
}

function algParams(alg: SupportedAlg): AlgParams {
  switch (alg) {
    case 'RS256':
      return {
        importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        verifyParams: { name: 'RSASSA-PKCS1-v1_5' },
      };
    case 'RS384':
      return {
        importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' },
        verifyParams: { name: 'RSASSA-PKCS1-v1_5' },
      };
    case 'RS512':
      return {
        importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
        verifyParams: { name: 'RSASSA-PKCS1-v1_5' },
      };
    case 'ES256':
      return {
        importParams: { name: 'ECDSA', namedCurve: 'P-256' },
        verifyParams: { name: 'ECDSA', hash: 'SHA-256' },
      };
    case 'ES384':
      return {
        importParams: { name: 'ECDSA', namedCurve: 'P-384' },
        verifyParams: { name: 'ECDSA', hash: 'SHA-384' },
      };
  }
}

function base64UrlDecodeToString(s: string): string {
  return new TextDecoder().decode(base64UrlDecodeToBytes(s));
}

/**
 * Coerce a `Uint8Array` (regardless of its underlying buffer-like type
 * parameter) into a plain `ArrayBuffer` whose contents are exactly the
 * array's byte range. Lets WebCrypto entry points type-check across
 * tsconfigs that differ on how `Uint8Array<ArrayBufferLike>` widens.
 */
function asBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
}

function base64UrlDecodeToBytes(s: string): Uint8Array<ArrayBuffer> {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const binary = atob(b64);
  // Allocate over a concrete ArrayBuffer (not ArrayBufferLike). Under
  // TS 6 strict, `Uint8Array<ArrayBufferLike>` is not assignable to
  // `BufferSource = ArrayBuffer | ArrayBufferView`; tying the generic
  // to `ArrayBuffer` makes downstream `crypto.subtle.verify(..., bytes)`
  // type-check across both the main project and the worker tsconfig.
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
