// DonDeckSlot — playmat-redesign.md §2.6.
//
// Bottom-LEFT corner of each player's FAR row. Single card-shaped slot
// holding the face-down DON deck. Per visual-design-spec §1.5–1.6 the DON
// back is CREAM with a TEAL compass-rose — visually distinct from the navy
// main-deck back, which is what lets the player tell the two decks apart at
// a glance.
//
// A brass count chip sits bottom-right of the card so the remaining DON
// count is always visible. When the deck is empty the slot collapses to the
// dashed empty outline + "DON DECK" wordmark.

import { memo } from 'react';
import { useGameStore } from '../../store/game';
import { ZoneSlot } from '../ZoneSlot';
import { NavyCardBack } from './NavyCardBack';
import type { PlayerId } from '@shared/engine-v2/state/types';

interface DonDeckSlotProps {
  playerId: PlayerId;
  isYou: boolean;
}

export const DonDeckSlot = memo(function DonDeckSlot({ playerId, isYou }: DonDeckSlotProps) {
  const count = useGameStore((s) => s.state.players[playerId].donDeck.length);
  const label = `${isYou ? 'Your' : 'Opponent'} DON deck — ${count} cards remaining`;

  return (
    <ZoneSlot
      kind="donDeck"
      playerId={playerId}
      ariaLabel={label}
      width="var(--zone-don-deck-w, 44px)"
      height="var(--zone-don-deck-h, 60px)"
      emptyLabel="DON DECK"
    >
      {count > 0 && (
        <div
          className="relative"
          style={{
            width: 'var(--zone-don-deck-w, 44px)',
            height: 'var(--zone-don-deck-h, 60px)',
          }}
        >
          <NavyCardBack kind="don" radius={5} />
          <span
            data-flip-back
            className="absolute bottom-0.5 right-0.5 z-10 rounded-[3px] bg-brass-canary
                       font-display tabular text-ink-black ring-[0.5px] ring-ink-black/50"
            style={{
              padding: '0.5px 4px',
              fontSize: '0.62rem',
              lineHeight: 1.1,
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
