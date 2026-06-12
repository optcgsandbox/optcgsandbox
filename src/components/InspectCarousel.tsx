// InspectCarousel — arrows + position pill for the shared inspect
// surfaces. Hooks/types live in ../lib/inspectCarousel (react-refresh).

import type { InspectGroup } from '../lib/inspectCarousel';

/** Arrows + "i / n" position pill. Renders nothing for single-card groups.
 *  `counterAt` — 'bottom' (default, the read overlay) or 'top' (the detail
 *  modal, whose action buttons own the bottom edge). */
export function CarouselNav({
  group,
  counterAt = 'bottom',
}: {
  group: InspectGroup;
  counterAt?: 'top' | 'bottom';
}) {
  const i = group.ids.indexOf(group.currentId);
  if (group.ids.length < 2 || i === -1) return null;
  const arrowCls =
    'pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full ' +
    'bg-ink-black/70 text-paper-cream text-[1.25rem] leading-none ' +
    'disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none';
  return (
    <>
      <button
        type="button"
        aria-label="Previous card"
        data-carousel-prev
        disabled={i === 0}
        onClick={(e) => {
          e.stopPropagation();
          if (i > 0) group.onNavigate(group.ids[i - 1]!);
        }}
        className={`${arrowCls} absolute left-2 top-1/2 z-10 -translate-y-1/2`}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Next card"
        data-carousel-next
        disabled={i === group.ids.length - 1}
        onClick={(e) => {
          e.stopPropagation();
          if (i < group.ids.length - 1) group.onNavigate(group.ids[i + 1]!);
        }}
        className={`${arrowCls} absolute right-2 top-1/2 z-10 -translate-y-1/2`}
      >
        ›
      </button>
      <span
        data-carousel-counter
        className={`pointer-events-none absolute ${counterAt === 'top' ? 'top-3' : 'bottom-3'}
                   left-1/2 z-10 -translate-x-1/2
                   rounded-full bg-ink-black/70 px-2.5 py-1 font-body text-[0.6875rem]
                   font-bold tracking-wider text-paper-cream tabular`}
      >
        {group.label ? `${group.label} · ` : ''}{i + 1} / {group.ids.length}
      </span>
    </>
  );
}
