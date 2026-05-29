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
      className="absolute inset-0 rounded-md overflow-hidden flex flex-col items-center justify-center"
      style={{
        // 2026-05-29 polish: a touch of gradient lift so the back reads as a
        // physical card edge rather than a flat blue rectangle at 24×34.
        background:
          'radial-gradient(ellipse at 50% 25%, #143C40 0%, var(--color-hull-deep) 70%, #051A1C 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(212,160,23,0.25)',
      }}
      aria-hidden="true"
    >
      <div className="absolute inset-1 rounded-sm ring-1 ring-brass-canary/65" />
      <svg
        viewBox="0 0 24 24"
        className="w-[55%] h-[55%] text-brass-canary"
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
      {/* Wordmark — reads as a real card-back, not just a compass icon.
          Uses "CREW SIM" to match DonDeckSlot pattern + IP isolation. */}
      <span
        className="mt-1 font-display tabular text-brass-canary"
        style={{ fontSize: '0.5rem', letterSpacing: '0.08em', lineHeight: 1 }}
      >
        CREW SIM
      </span>
    </div>
  );
});
