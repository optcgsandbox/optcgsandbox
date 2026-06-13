// cardImageUrl — single source of truth for mapping a card id to its public
// R2 image URL. Extracted from CardArt.tsx so the prefetch warmer and the
// <img> renderer derive identical URLs (a mismatch would warm one cache key
// and read another → defeats the prefetch).

/**
 * Public R2 base for the Crew Builder card-image bucket. Mirrors
 * `scripts/card-sync/index.mjs IMAGE_BASE_URL` on the Crew Builder side —
 * every primary print is uploaded as `{cardId}.png` (e.g. `OP09-042.png`).
 */
export const R2_IMAGE_BASE = 'https://pub-bed2e18730014af1aeb9e1e85e692e3c.r2.dev';

/**
 * Map a card id → its public R2 URL. Returns null for non-OPTCG ids
 * (internal `DON`, unit-test ids like `red-5-2`) so we never 404.
 *
 * Pattern: uppercase set prefix + dash + digits, e.g. `OP09-042`,
 * `EB01-001`, `ST01-001`, `P-001`, `PRB01-001`.
 */
export function cardIdToR2Url(cardId: string | undefined): string | null {
  if (!cardId) return null;
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(cardId)) return null;
  return `${R2_IMAGE_BASE}/${cardId}.png`;
}
