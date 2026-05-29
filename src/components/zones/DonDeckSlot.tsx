// DonDeckSlot — design-reference.md §3.4 L4.
// Bottom-left corner of player's half (mirror top-left for opp). Single
// teal/green DON OP-compass card-back showing remaining donDeck count.
// Visually distinct from the main DECK (teal-green vs navy) per
// design-reference §3.3.

import { memo } from 'react';
import { useGameStore } from '../../store/game';
import { ZoneSlot } from '../ZoneSlot';
import { CARD_DIMS } from '../CardArt';
import type { PlayerId } from '@shared/engine/GameState';

interface DonDeckSlotProps {
  playerId: PlayerId;
  isYou: boolean;
}

/** Teal/green OP-compass DON back. */
function DonBack() {
  return (
    <div
      className="absolute inset-0 rounded-md overflow-hidden bg-hull-teal flex items-center justify-center"
      aria-hidden="true"
    >
      <div className="absolute inset-1 rounded-sm ring-1 ring-brass-canary/70" />
      <svg
        viewBox="0 0 24 24"
        className="w-1/2 h-1/2 text-brass-canary"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Crossed blades — generic DON glyph. */}
        <line x1="5" y1="5" x2="19" y2="19" />
        <line x1="5" y1="19" x2="19" y2="5" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </div>
  );
}

export const DonDeckSlot = memo(function DonDeckSlot({ playerId, isYou }: DonDeckSlotProps) {
  const count = useGameStore((s) => s.state.players[playerId].donDeck.length);
  const dims = CARD_DIMS.field;
  const label = `${isYou ? 'Your' : 'Opponent'} DON deck — ${count} cards remaining`;
  return (
    <ZoneSlot kind="donDeck" playerId={playerId} ariaLabel={label}>
      <div
        className="relative"
        style={{ width: dims.w, height: dims.h }}
      >
        <DonBack />
        <span
          className="absolute bottom-0.5 right-0.5 rounded-sm bg-paper-cream/95 px-1 py-px
                     font-display tabular text-[0.7rem] leading-none text-ink-black
                     shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
          aria-hidden="true"
        >
          {count}
        </span>
        {/* "DON" micro-label so empty/full state is unambiguous next to the main deck. */}
        <span
          className="absolute top-0.5 left-0.5 rounded-sm bg-brass-canary/90 px-1 py-px
                     font-body text-[0.5rem] font-extrabold uppercase leading-none tracking-wider text-ink-black"
          aria-hidden="true"
        >
          DON
        </span>
      </div>
    </ZoneSlot>
  );
});
