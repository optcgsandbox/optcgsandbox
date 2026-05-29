// NavyCardBack — shared card-back design for Deck + Life stacks.
// Per design-reference §3.3, Character/Event/Stage cards (which is what life
// cards ARE — drawn from the top of the deck per CR §5-2-1-7) share the
// NAVY OP-compass back. The same back must render for both the Deck slot
// and the Life stack so the player immediately reads "these are face-down
// deck cards in waiting" rather than two unrelated back designs.

import { memo } from 'react';

export const NavyCardBack = memo(function NavyCardBack() {
  return (
    <div
      className="absolute inset-0 rounded-md overflow-hidden bg-hull-deep flex items-center justify-center"
      aria-hidden="true"
    >
      <div className="absolute inset-1 rounded-sm ring-1 ring-brass-canary/60" />
      <svg
        viewBox="0 0 24 24"
        className="w-1/2 h-1/2 text-brass-canary"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Generic sea-adventure compass rose — no Bandai IP. */}
        <circle cx="12" cy="12" r="6.5" />
        <path d="M12 5.5 L13.5 12 L12 18.5 L10.5 12 Z" />
        <path d="M5.5 12 L12 10.5 L18.5 12 L12 13.5 Z" />
      </svg>
    </div>
  );
});
