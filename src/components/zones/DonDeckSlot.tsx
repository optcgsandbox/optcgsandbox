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
import type { PlayerId } from '@shared/engine-v2/state/types';

interface DonDeckSlotProps {
  playerId: PlayerId;
  isYou: boolean;
}

/** Cream-body card with teal compass — visual-design-spec.md §1.5. */
function DonBack() {
  return (
    <div
      data-flip-back
      className="absolute inset-0 overflow-hidden rounded-[5px] bg-paper-cream paper-grain"
      style={{
        border: '0.75px solid var(--color-ink-black)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.30)',
      }}
      aria-hidden="true"
    >
      {/* Brass inset hairline at ~30% opacity. */}
      <div
        className="absolute"
        style={{
          inset: 2,
          borderRadius: 3,
          boxShadow: 'inset 0 0 0 0.75px rgba(212,160,23,0.45)',
        }}
      />
      <svg
        viewBox="0 0 44 60"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {/* Crosshair through compass center (22, 24). */}
        <g stroke="var(--color-hull-teal)" strokeOpacity={0.40} strokeWidth={0.6}>
          <line x1={3} y1={24} x2={41} y2={24} />
          <line x1={22} y1={4} x2={22} y2={44} />
        </g>
        {/* Concentric compass rings. */}
        <g fill="none" stroke="var(--color-hull-teal)" strokeWidth={0.9}>
          <circle cx={22} cy={24} r={7} />
          <circle cx={22} cy={24} r={11} />
          <circle cx={22} cy={24} r={14} />
        </g>
        {/* 24 tick marks on outer ring. */}
        <g stroke="var(--color-hull-teal)" strokeWidth={0.6}>
          {Array.from({ length: 24 }).map((_, i) => {
            const angle = (i * 360) / 24;
            const rad = (angle * Math.PI) / 180;
            const x1 = 22 + Math.cos(rad) * 14;
            const y1 = 24 + Math.sin(rad) * 14;
            const x2 = 22 + Math.cos(rad) * 15.5;
            const y2 = 24 + Math.sin(rad) * 15.5;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
        </g>
        {/* Compass needle pointing NE — strong half + dim half. */}
        <g fill="var(--color-hull-teal)">
          <polygon points="22,24 27.5,18.5 33,13 28,18.5 22,24" />
          <polygon
            points="22,24 16.5,29.5 11,35 16,29.5 22,24"
            opacity={0.55}
          />
          <circle cx={22} cy={24} r={1.1} fill="var(--color-paper-cream)" stroke="var(--color-hull-teal)" strokeWidth={0.6} />
        </g>
        {/* Wordmark — bottom of card, mirrors the navy back. */}
        <text
          x={22}
          y={54}
          textAnchor="middle"
          fontFamily="Lilita One, system-ui, sans-serif"
          fontSize={5}
          letterSpacing={0.4}
          fill="var(--color-hull-teal)"
          style={{ fontWeight: 600 }}
        >
          CREW SIM
        </text>
      </svg>
    </div>
  );
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
          <DonBack />
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
