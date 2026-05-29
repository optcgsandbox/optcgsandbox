// Curved hand layout math — visual-spec.md §5.4.
// For n cards at index i:
//   theta = (i - (n-1)/2) * step,  step = min(7°, 56°/n)
//   arcY  = |i - (n-1)/2|^1.5 * 3px  (gentle parabola, max ~14px lift)
//   x     = (i - (n-1)/2) * spacing  (negative overlap so 8-card hand fits in 430px)
//
// Returns transform values intended for a `<motion.div style={{ originY: 1 }}>`.
// originY: 1 means the card pivots from its bottom edge so the fan looks anchored.

export interface FanPosition {
  x: number;
  y: number;
  rotate: number;
}

const MAX_STEP_DEG = 7;
const TOTAL_ARC_DEG = 56;
const ARC_HEIGHT_PX = 3;
const CARD_WIDTH_PX = 92; // matches CARD_DIMS.hand.w
// Overlap so an 8-card hand stays inside the 430px portrait frame.
// Spacing of card_width * 0.6 leaves a 40% reveal per card (spec §5.4).
const SPACING_RATIO = 0.6;

export function fanPosition(i: number, n: number): FanPosition {
  if (n <= 0) return { x: 0, y: 0, rotate: 0 };
  if (n === 1) return { x: 0, y: 0, rotate: 0 };

  const center = (n - 1) / 2;
  const offset = i - center;
  const stepDeg = Math.min(MAX_STEP_DEG, TOTAL_ARC_DEG / n);
  const rotate = offset * stepDeg;

  // Parabolic lift — outermost cards sit ~14px below the center card.
  // ** 1.5 keeps the curve gentle in the middle and steeper at the edges.
  const arcY = Math.pow(Math.abs(offset), 1.5) * ARC_HEIGHT_PX;
  const y = arcY;

  const spacing = CARD_WIDTH_PX * SPACING_RATIO;
  const x = offset * spacing;

  return { x, y, rotate };
}

/** Maximum width the fan occupies, used by HandFan for centering / overflow checks. */
export function fanFootprint(n: number): number {
  if (n <= 1) return CARD_WIDTH_PX;
  return CARD_WIDTH_PX + (n - 1) * CARD_WIDTH_PX * SPACING_RATIO;
}
