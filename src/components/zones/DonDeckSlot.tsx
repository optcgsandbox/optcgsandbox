// DonDeckSlot — design-reference.md §3.4 L4 + visual-design-spec.md §1.5–1.6.
// Bottom-left corner of player's half (mirror top-left for opp). Cream body
// with a TEAL compass-rose back: 3 concentric rings + tick marks + NE-pointing
// needle + crosshair lines + "CREW SIM" wordmark in teal. Optional brass count
// chip bottom-right.

import { memo } from 'react';
import { useGameStore } from '../../store/game';
import { ZoneSlot } from '../ZoneSlot';
import { CARD_DIMS } from '../CardArt';
import type { PlayerId } from '@shared/engine/GameState';

interface DonDeckSlotProps {
  playerId: PlayerId;
  isYou: boolean;
}

/** Teal compass-rose DON back — visual-design-spec.md §1.5. */
function DonBack() {
  // Drawn on a 36×50 viewBox to match --zone-don-deck-w. Compass centered
  // around (18, 19); wordmark at (18, 37); count chip not drawn here (the
  // count badge sits outside this SVG so it can be themed independently).
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-[3px] bg-paper-cream paper-grain"
      style={{ border: '0.5px solid var(--color-ink-black)' }}
      aria-hidden="true"
    >
      {/* Brass inset hairline. */}
      <div
        className="absolute inset-0.5 rounded-[2px]"
        style={{
          boxShadow: 'inset 0 0 0 1px rgba(212,160,23,0.35)',
        }}
      />
      <svg
        viewBox="0 0 36 50"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {/* Crosshair lines through compass center. */}
        <g stroke="var(--color-hull-teal)" strokeOpacity={0.4} strokeWidth={0.5}>
          <line x1={2} y1={19} x2={34} y2={19} />
          <line x1={18} y1={2} x2={18} y2={36} />
        </g>
        {/* Concentric compass rings. */}
        <g fill="none" stroke="var(--color-hull-teal)" strokeWidth={0.75}>
          <circle cx={18} cy={19} r={6} />
          <circle cx={18} cy={19} r={9} />
          <circle cx={18} cy={19} r={12} />
        </g>
        {/* 24 tick marks on outer ring. */}
        <g stroke="var(--color-hull-teal)" strokeWidth={0.5}>
          {Array.from({ length: 24 }).map((_, i) => {
            const angle = (i * 360) / 24;
            const rad = (angle * Math.PI) / 180;
            const x1 = 18 + Math.cos(rad) * 12;
            const y1 = 19 + Math.sin(rad) * 12;
            const x2 = 18 + Math.cos(rad) * 13;
            const y2 = 19 + Math.sin(rad) * 13;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
        </g>
        {/* Compass needle pointing NE (45°), diamond shape ~12px long. */}
        <g fill="var(--color-hull-teal)">
          <polygon points="18,19 22.5,14.5 27.5,9.5 23,14 18,19" />
          <polygon
            points="18,19 13.5,23.5 8.5,28.5 13,24 18,19"
            opacity={0.55}
          />
          <circle cx={18} cy={19} r={0.75} fill="var(--color-paper-cream)" stroke="var(--color-hull-teal)" strokeWidth={0.5} />
        </g>
        {/* X-circle + wordmark — CREW SIM (no Bandai trademark). */}
        <g
          fill="var(--color-hull-teal)"
          fontFamily="Lilita One, system-ui, sans-serif"
        >
          <text
            x={18}
            y={42}
            textAnchor="middle"
            fontSize={4.2}
            letterSpacing={0.35}
            style={{ fontWeight: 600 }}
          >
            CREW SIM
          </text>
        </g>
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
        {/* Brass count chip bottom-right per §1.6 element table. */}
        {count > 0 && (
          <span
            className="absolute bottom-0.5 right-0.5 rounded-[2px] bg-brass-canary px-1 py-px
                       font-display tabular text-[0.55rem] leading-none text-ink-black"
            style={{ border: '0.5px solid var(--color-ink-black)' }}
            aria-hidden="true"
          >
            {count}
          </span>
        )}
      </div>
    </ZoneSlot>
  );
});
