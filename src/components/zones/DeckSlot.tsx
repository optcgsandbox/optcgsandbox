// DeckSlot — design-reference.md §3.4.
// Single face-down deck card-back showing the remaining deck count. Uses the
// navy OP-compass back per design-reference.md §3.3 (Character/Event/Stage
// back color). Count = `state.players[X].deck.length` (NEVER render the
// string[] array directly).

import { memo } from 'react';
import { useGameStore } from '../../store/game';
import { ZoneSlot } from '../ZoneSlot';
import { CARD_DIMS } from '../CardArt';
import { NavyCardBack } from './NavyCardBack';
import type { PlayerId } from '@shared/engine/GameState';

interface DeckSlotProps {
  playerId: PlayerId;
  isYou: boolean;
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
        <NavyCardBack />
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
