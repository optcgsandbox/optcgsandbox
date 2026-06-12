// cardSizing — F-8C unified card-size standard, shared constants.
//
// Owner rule: EXACTLY 3 card sizes app-wide —
//   A. BOARD   — CARD_DIMS.hand/field/leader/mini/lifeStack (zone smalls)
//   B. PROMPT  — CARD_DIMS.prompt (110×154), fixed, all selection tiles
//   C. INSPECT — CARD_DIMS.modal (220×308) × INSPECT_SCALE → 330×462,
//                every read/View affordance incl. CardDetailModal
// "Presentation" (played-card reveal beats) = INSPECT, responsive-clamped.
//
// Lives outside CardArt.tsx so component files only export components
// (react-refresh/only-export-components).

import { CARD_DIMS } from './CardArt';

export const INSPECT_SCALE = 1.5;

/** Effective on-screen inspect dimensions (the CardDetailModal standard). */
export const INSPECT_DIMS = {
  w: CARD_DIMS.modal.w * INSPECT_SCALE,
  h: CARD_DIMS.modal.h * INSPECT_SCALE,
};

/** Responsive inspect/presentation scale: full 1.5× unless the viewport
 *  can't fit it (small phones) — then shrink to fit with margins. */
export function inspectScaleFor(vw: number, vh: number): number {
  return Math.min(
    INSPECT_SCALE,
    (vw - 48) / CARD_DIMS.modal.w,
    (vh - 200) / CARD_DIMS.modal.h,
  );
}
