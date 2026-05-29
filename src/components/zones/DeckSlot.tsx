// DeckSlot — playmat-redesign.md §2.5.
//
// FAR-RIGHT of the LEADER row. Single 52×72 face-down navy card-back with a
// cream count chip bottom-right. The chip count = `state.players[X].deck.length`
// (never render the raw string[]). When the deck is empty (game-loss state per
// CR §1-2-1-1-2) we fall back to the dashed empty outline + "DECK" wordmark.

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
    <ZoneSlot
      kind="deck"
      playerId={playerId}
      ariaLabel={label}
      width={dims.w}
      height={dims.h}
      emptyLabel="DECK"
    >
      {count > 0 && (
        <div
          className="relative"
          style={{ width: dims.w, height: dims.h }}
        >
          <NavyCardBack radius={4} />
          {/* Count chip — cream pill bottom-right corner of card. */}
          <span
            className="absolute z-10 rounded-[3px] bg-paper-cream/95
                       font-display tabular text-ink-black ring-[0.5px] ring-ink-black/40
                       shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
            style={{
              right: 3,
              bottom: 3,
              padding: '0px 4px',
              fontSize: '0.62rem',
              lineHeight: 1.3,
              minWidth: 14,
              textAlign: 'center',
            }}
            aria-hidden="true"
          >
            {count}
          </span>
        </div>
      )}
    </ZoneSlot>
  );
});
