// useOverlayBox — overlay-fit audit (owner 2026-06-12).
//
// Returns the LOGICAL (design-px) size of an overlay's containing box.
// Every overlay mounts inside the app shell (no portals); on wide windows
// shorter than FIT_H the shell carries a transform scale advertised via
// the `data-shrink-scale` attribute (src/App.tsx), so raw
// getBoundingClientRect comes back pre-scaled — divide it out, exactly
// like the hand strip's lane measurer (HandFan.tsx usePlayerCardH).
//
// This is the ONE source of truth for "how much room does this popup
// actually have" across all three layout regimes + PWA safe-areas.
// Never read window.innerWidth/innerHeight for overlay sizing.

import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

export interface OverlayBox {
  w: number;
  h: number;
}

export function useOverlayBox(ref: RefObject<HTMLElement | null>): OverlayBox {
  const [box, setBox] = useState<OverlayBox>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = (): void => {
      const shell = el.closest('[data-shrink-scale]');
      const s = Number(shell?.getAttribute('data-shrink-scale') ?? '1') || 1;
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width / s);
      const h = Math.round(r.height / s);
      // Compare-before-set: scroll/animation frames must not re-render.
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // data-shrink-scale changes on window resize without resizing the
    // observed element's layout box — listen for it explicitly.
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [ref]);
  return box;
}
