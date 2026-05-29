// CostAreaStrip — visual-spec-layout-correction.md §D.2 + §F step 10.
// Horizontal staging band rendering the player's active (un-attached) DON tokens
// as small brass coin SVGs. Sits between character row and leader row in each
// field band. Reads `zones.donActive` and renders one coin per DON.
//
// Capped at 10 visible (OPTCG max DON in cost area). overflow-x-auto on the
// rare edge case where engine state exceeds the cap (defensive — shouldn't
// happen given DON_DECK_SIZE = 10).

import { memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../../store/game';
import { springs, STAGGER_DON } from '../../lib/animationTokens';
import type { PlayerId } from '@shared/engine/GameState';

interface CostAreaStripProps {
  playerId: PlayerId;
  isYou: boolean;
}

/** Single brass DON coin — generic crossed-blade glyph, no Bandai IP. */
function DonCoin({ index, reduced }: { index: number; reduced: boolean }) {
  return (
    <motion.div
      // Stagger the coins on initial paint so a fresh DON phase reads as a
      // deal sequence rather than 10 coins popping at once.
      initial={reduced ? false : { scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{
        type: 'spring',
        stiffness: 280,
        damping: 26,
        delay: reduced ? 0 : index * STAGGER_DON,
      }}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brass-canary
                 text-ink-black shadow-[0_1px_2px_rgba(15,20,15,0.25)]"
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        {/* Crossed-blade DON glyph (generic). */}
        <line x1="3" y1="3" x2="13" y2="13" />
        <line x1="3" y1="13" x2="13" y2="3" />
      </svg>
    </motion.div>
  );
}

export const CostAreaStrip = memo(function CostAreaStrip({ playerId, isYou }: CostAreaStripProps) {
  const donActive = useGameStore((s) => s.state.players[playerId].donActive);
  const donRested = useGameStore((s) => s.state.players[playerId].donRested);
  const reduced = useReducedMotion() ?? false;
  // springs imported for parity with sibling components; no spring directly used here.
  void springs(reduced);

  // Visible coins = active DON. Rested DON shown as a small count chip at the
  // trailing edge so the player can still see what's already been spent this turn.
  return (
    <div
      role="region"
      aria-label={`${isYou ? 'Your' : 'Opponent'} cost area, ${donActive} active DON, ${donRested} rested`}
      className="flex w-full items-center gap-1 px-3"
      style={{ height: 'var(--zone-cost-strip-h, 28px)' }}
    >
      <span className="font-body text-[0.55rem] font-extrabold uppercase tracking-wider text-ink-iron/70">
        Cost
      </span>
      <div className="flex h-full grow items-center gap-1 overflow-x-auto">
        {Array.from({ length: donActive }).map((_, i) => (
          <DonCoin key={`don-${playerId}-${i}`} index={i} reduced={reduced} />
        ))}
      </div>
      {donRested > 0 && (
        <span className="shrink-0 rounded-full bg-paper-fog/60 px-1.5 py-0.5
                         font-display tabular text-[0.65rem] leading-none text-ink-iron">
          {donRested}r
        </span>
      )}
    </div>
  );
});
