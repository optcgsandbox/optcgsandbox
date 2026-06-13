// ArrowPagedRow — overlay-fit audit (owner 2026-06-12).
//
// The app's ONE sanctioned overflow pattern (owner law: side-scroll with
// ‹ › arrow buttons is fine, vertical scroll NEVER). Extracted from the
// hand strip (HandFan.tsx): native overflow-x scroller with snap +
// hidden scrollbar, arrows that page by one item width and render only
// while more content exists in that direction. Touch swipe comes free
// from the native scroller. Rows that fit show no arrows and center —
// visually identical to a plain flex row.

import { Children, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface ArrowPagedRowProps {
  /** Page step in px — one item width + gap. */
  step: number;
  gap?: number;
  children: ReactNode;
  className?: string;
  /** data-testid prefix → `${idPrefix}-scroller` / `-prev` / `-next`. */
  idPrefix?: string;
  ariaLabel?: string;
}

export function ArrowPagedRow({
  step,
  gap = 8,
  children,
  className,
  idPrefix = 'paged-row',
  ariaLabel,
}: ArrowPagedRowProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  const count = Children.count(children);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    const update = (): void => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      // Compare-before-set: per-frame setState during native scrolling
      // makes framer layout animations fight the scroll (HandFan lesson).
      setCanScroll((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [count]);

  const pageBy = useCallback(
    (dir: 1 | -1) => {
      scrollerRef.current?.scrollBy({ left: dir * step, behavior: 'smooth' });
    },
    [step],
  );

  return (
    <div className={`relative max-w-full ${className ?? ''}`}>
      <div
        ref={scrollerRef}
        className="flex max-w-full items-center overflow-x-auto overflow-y-hidden"
        style={{ scrollSnapType: 'x proximity', scrollbarWidth: 'none' }}
        data-testid={`${idPrefix}-scroller`}
        aria-label={ariaLabel}
      >
        <div className="mx-auto flex items-start" style={{ gap }}>
          {Children.map(children, (child) => (
            <div className="flex-none" style={{ scrollSnapAlign: 'center' }}>
              {child}
            </div>
          ))}
        </div>
      </div>
      {canScroll.left && (
        <button
          type="button"
          aria-label="Scroll left"
          data-testid={`${idPrefix}-prev`}
          onClick={() => pageBy(-1)}
          className="absolute left-0 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2
                     items-center justify-center rounded-full bg-ink-black/70 text-[1.1rem]
                     leading-none text-paper-cream
                     focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
        >
          ‹
        </button>
      )}
      {canScroll.right && (
        <button
          type="button"
          aria-label="Scroll right"
          data-testid={`${idPrefix}-next`}
          onClick={() => pageBy(1)}
          className="absolute right-0 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2
                     items-center justify-center rounded-full bg-ink-black/70 text-[1.1rem]
                     leading-none text-paper-cream
                     focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
        >
          ›
        </button>
      )}
    </div>
  );
}

export default ArrowPagedRow;
