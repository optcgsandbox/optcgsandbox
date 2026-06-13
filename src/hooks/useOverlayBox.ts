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
//
// CRITICAL (owner 2026-06-12): the measured element is often rendered
// CONDITIONALLY inside an ALWAYS-MOUNTED overlay (e.g. MulliganPrompt at
// PlayfieldStage — it returns null until the prompt opens). A plain
// `useEffect(..., [ref])` runs once at mount while the element is still
// absent, so it never attaches and the box stays {0,0} → FitScale falls
// back to scale 1 and the content overflows. We re-attach via a
// dependency-less useLayoutEffect that runs after every render and acts
// only when the element IDENTITY changes — so the element is caught the
// instant it mounts (synchronously, before paint, no flash) and released
// when it unmounts, with no polling and no per-render layout cost.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface OverlayBox {
  w: number;
  h: number;
}

export function useOverlayBox(ref: RefObject<HTMLElement | null>): OverlayBox {
  const [box, setBox] = useState<OverlayBox>({ w: 0, h: 0 });
  const elRef = useRef<HTMLElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const read = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const shell = el.closest('[data-shrink-scale]');
    const s = Number(shell?.getAttribute('data-shrink-scale') ?? '1') || 1;
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width / s);
    const h = Math.round(r.height / s);
    setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, [ref]);

  // Re-attach whenever the measured element mounts / swaps / unmounts.
  // No dependency array → runs after every render; the identity guard makes
  // it a no-op on renders where the element didn't change, so there's no
  // per-render layout thrash (getBoundingClientRect only fires on attach).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === elRef.current) return;
    roRef.current?.disconnect();
    elRef.current = el;
    if (!el) return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    roRef.current = ro;
    read();
  });

  // data-shrink-scale changes on window resize without resizing the observed
  // element's layout box — listen for it explicitly. Disconnect on unmount.
  useEffect(() => {
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('resize', read);
      roRef.current?.disconnect();
      roRef.current = null;
      elRef.current = null;
    };
  }, [read]);

  return box;
}
