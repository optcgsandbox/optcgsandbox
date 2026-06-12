// inspectCarousel (lib) — hooks + types for the generic inspect carousel.
// Split from the component file (react-refresh/only-export-components).
// Original header:
// InspectCarousel — generic next/previous navigation for the shared card
// inspect surfaces (owner 2026-06-12). ONE implementation used by both
// CardInspectOverlay (prompt View buttons) and CardDetailModal (board /
// hand / trash): callers pass the group's instance ids + the current id +
// a navigate callback. Single-card contexts simply pass no group — no
// arrows render. Keyboard (ArrowLeft/Right) + touch swipe included.

import { useEffect, useRef } from 'react';

export interface InspectGroup {
  /** Ordered instance ids of the group being browsed. */
  ids: ReadonlyArray<string>;
  currentId: string;
  onNavigate: (id: string) => void;
  /** Optional context label shown beside the position counter. */
  label?: string;
}

/** ArrowLeft / ArrowRight navigation while an inspect surface is open. */
export function useCarouselKeys(group: InspectGroup | null | undefined): void {
  useEffect(() => {
    if (!group || group.ids.length < 2) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      const i = group.ids.indexOf(group.currentId);
      if (i === -1) return;
      if (e.key === 'ArrowLeft' && i > 0) {
        e.preventDefault();
        group.onNavigate(group.ids[i - 1]!);
      }
      if (e.key === 'ArrowRight' && i < group.ids.length - 1) {
        e.preventDefault();
        group.onNavigate(group.ids[i + 1]!);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [group]);
}

/** Touch-swipe navigation handlers — spread onto the inspect container. */
export function useCarouselSwipe(group: InspectGroup | null | undefined): {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
} {
  const startX = useRef<number | null>(null);
  return {
    onTouchStart: (e) => {
      startX.current = e.touches[0]?.clientX ?? null;
    },
    onTouchEnd: (e) => {
      const sx = startX.current;
      startX.current = null;
      if (!group || sx === null || group.ids.length < 2) return;
      const dx = (e.changedTouches[0]?.clientX ?? sx) - sx;
      if (Math.abs(dx) < 40) return;
      const i = group.ids.indexOf(group.currentId);
      if (i === -1) return;
      if (dx > 0 && i > 0) group.onNavigate(group.ids[i - 1]!);
      if (dx < 0 && i < group.ids.length - 1) group.onNavigate(group.ids[i + 1]!);
    },
  };
}

