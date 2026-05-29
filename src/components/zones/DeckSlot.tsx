// DeckSlot — design-reference.md §3.4.
// Single face-down deck card-back showing the remaining deck count. Uses the
// navy OP-compass back per design-reference.md §3.3 (Character/Event/Stage
// back color). Count = `state.players[X].deck.length` (NEVER render the
// string[] array directly).

import { memo } from 'react';
import { useGameStore } from '../../store/game';
import { ZoneSlot } from '../ZoneSlot';
import { CARD_DIMS } from '../CardArt';
import type { PlayerId } from '@shared/engine/GameState';

interface DeckSlotProps {
  playerId: PlayerId;
  isYou: boolean;
}

/** Navy OP-compass back, code-drawn. v0.1 placeholder for the commissioned asset. */
function NavyBack() {
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
        {/* Compass rose — generic sea-adventure motif, no Bandai IP. */}
        <circle cx="12" cy="12" r="6.5" />
        <path d="M12 5.5 L13.5 12 L12 18.5 L10.5 12 Z" />
        <path d="M5.5 12 L12 10.5 L18.5 12 L12 13.5 Z" />
      </svg>
    </div>
  );
}

export const DeckSlot = memo(function DeckSlot({ playerId, isYou }: DeckSlotProps) {
  const count = useGameStore((s) => s.state.players[playerId].deck.length);
  const dims = CARD_DIMS.field;
  const label = `${isYou ? 'Your' : 'Opponent'} deck — ${count} cards remaining`;
  return (
    <ZoneSlot kind="deck" playerId={playerId} ariaLabel={label}>
      <div
        className="relative"
        style={{ width: dims.w, height: dims.h }}
      >
        <NavyBack />
        {/* Count overlay — bottom-right corner of the back. */}
        <span
          className="absolute bottom-0.5 right-0.5 rounded-sm bg-paper-cream/95 px-1 py-px
                     font-display tabular text-[0.7rem] leading-none text-ink-black
                     shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
          aria-hidden="true"
        >
          {count}
        </span>
      </div>
    </ZoneSlot>
  );
});
