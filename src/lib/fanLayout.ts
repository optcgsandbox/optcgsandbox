// Hand-fan math — visual-design-spec.md §3.2 (replaces the prior
// visual-spec.md §5.4 implementation, which used a ±20° aggressive arc that
// owner rejected on mobile).
//
// Mobile-tuned, anchor-at-bottom-center arc that fits 1–10 cards inside the
// 398px inner playmat width (430 − 32 padding) without clipping.
//
// Per-card geometry:
//   spread       = lerp(140, 240, clamp((n-4)/6, 0, 1))   px
//   spacing      = spread / max(n-1, 1)                   px
//   x            = (i - center) * spacing                 px
//   y            = -14 * (1 - normalized^2)               px  (apex lift -14)
//   maxRotateDeg = lerp(4, 8, clamp((n-4)/6, 0, 1))       °
//   rotate       = maxRotateDeg * normalized              °
//
//   center      = (n - 1) / 2
//   normalized  = (i - center) / max(center, 1)           ∈ [-1, +1]
//
// Returns a `{ x, y, rotate }` triple consumed by HandFan.tsx. Card pivot must
// be bottom-center (`transform-origin: 50% 100%`).

export interface FanPosition {
  x: number;
  y: number;
  rotate: number;
}

// Hand card dimensions — visual-design-spec.md §3.1.
export const HAND_CARD_W = 64;
export const HAND_CARD_H = 90;

const CENTER_LIFT_PX = 14;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Linear interpolation factor for n ∈ [4, 10] used for both spread + rotation. */
function sizeFactor(n: number): number {
  return clamp((n - 4) / 6, 0, 1);
}

export function fanPosition(i: number, n: number): FanPosition {
  if (n <= 0) return { x: 0, y: 0, rotate: 0 };
  // Single-card case sits at the apex (lifted -14, no spread).
  if (n === 1) return { x: 0, y: -CENTER_LIFT_PX, rotate: 0 };

  const center = (n - 1) / 2;
  const offset = i - center;
  const normalized = offset / Math.max(center, 1);

  const t = sizeFactor(n);
  const spread = lerp(140, 240, t);
  const spacing = spread / Math.max(n - 1, 1);
  const maxRotateDeg = lerp(4, 8, t);

  const x = offset * spacing;
  // Parabolic lift: edges at 0, apex at -14 (negative = up-screen).
  const y = -CENTER_LIFT_PX * (1 - normalized * normalized);
  const rotate = maxRotateDeg * normalized;

  return { x, y, rotate };
}

/** Total footprint width (outermost-left card edge → outermost-right edge). */
export function fanFootprint(n: number): number {
  if (n <= 1) return HAND_CARD_W;
  const t = sizeFactor(n);
  const spread = lerp(140, 240, t);
  // Outermost card centers sit at ±spread/2, so adding card width gives the
  // edge-to-edge envelope.
  return spread + HAND_CARD_W;
}
