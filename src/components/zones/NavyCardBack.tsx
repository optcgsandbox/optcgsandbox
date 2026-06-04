// NavyCardBack — playmat-redesign.md §3.7.
//
// Renders one of the three official Bandai card-back skins from
// `docs/optcg-sim/source-material/rule_manual.pdf` (pp. 3, 4, 6).
//
// The actual Bandai PNGs are extracted from the rule manual via
// `pdfimages` and bundled in `public/backs/`:
//   leader.png — red ground, white compass        (rule manual p.3)
//   main.png   — navy ground, brass compass       (rule manual p.4)
//   don.png    — cream ground, teal compass       (rule manual p.6)
//
// Component absolutely-fills its parent — drop into any card-sized
// container without sizing math.

import { memo } from 'react';

export type CardBackKind = 'leader' | 'main' | 'don';

interface NavyCardBackProps {
  /** Which Bandai back skin to render. Defaults to `main` so existing
   *  callers keep the navy back without a code change. */
  kind?: CardBackKind;
  /** Retained for API compatibility with the prior SVG-based component;
   *  PNG renders cannot hide the printed wordmark — flag is ignored. */
  hideWordmark?: boolean;
  /** Override the rounding to match the parent card's radius. */
  radius?: number;
}

const SRC_BY_KIND: Record<CardBackKind, string> = {
  leader: '/backs/leader.png',
  main: '/backs/main.png',
  don: '/backs/don.png',
};

export const NavyCardBack = memo(function NavyCardBack({
  kind = 'main',
}: NavyCardBackProps) {
  // PNGs in `public/backs/` carry their own transparent rounded corners
  // (cropped via `magick … roundrectangle … 22,22 …`) — so the wrapper
  // does NOT apply overflow-hidden / borderRadius. Any wrapper clip would
  // either fight the image's natural alpha (producing the squarish corners
  // owner caught 2026-06-03) or square off rounding at small sizes.
  return (
    <div
      data-flip-back
      className="absolute inset-0"
      style={{
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))',
      }}
      aria-hidden="true"
    >
      <img
        src={SRC_BY_KIND[kind]}
        alt=""
        className="w-full h-full object-contain"
        decoding="async"
        loading="eager"
        draggable={false}
      />
    </div>
  );
});
