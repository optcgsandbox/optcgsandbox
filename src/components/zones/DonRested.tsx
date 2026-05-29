// DonRested — visual-spec-layout-correction.md Phase B addendum.
// Renders the player's rested DON instances as rotated-90° brass coin sprites
// (matching OPTCG's physical "tap to rest" gesture). Visually subdued
// (lower opacity, marine-fog tint behind the coin) so the player can read at
// a glance "this DON is spent this turn".
//
// Rested DON returns to the active pool in the next Refresh phase (engine
// runRefreshPhase) — UI does not need to drive that transition.

import { memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../../store/game';
import { STAGGER_DON } from '../../lib/animationTokens';
import type { PlayerId } from '@shared/engine/GameState';

interface DonRestedProps {
  playerId: PlayerId;
  isYou: boolean;
}

function RestedCoin({
  instanceId,
  index,
  reduced,
}: {
  instanceId: string;
  index: number;
  reduced: boolean;
}) {
  return (
    <motion.div
      data-don-rested={instanceId}
      initial={reduced ? false : { opacity: 0, rotate: 0 }}
      animate={{ opacity: 0.55, rotate: 90 }}
      transition={{
        type: 'spring',
        stiffness: 280,
        damping: 26,
        delay: reduced ? 0 : index * STAGGER_DON,
      }}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full
                 bg-brass-canary/80 text-ink-black/70
                 shadow-[0_1px_2px_rgba(15,20,15,0.18)] ring-1 ring-marine-fog/40"
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="3" y1="3" x2="13" y2="13" />
        <line x1="3" y1="13" x2="13" y2="3" />
      </svg>
    </motion.div>
  );
}

export const DonRested = memo(function DonRested({ playerId, isYou }: DonRestedProps) {
  const donRested = useGameStore((s) => s.state.players[playerId].donRested);
  const reduced = useReducedMotion() ?? false;

  if (donRested.length === 0) return null;

  return (
    <div
      role="region"
      aria-label={`${isYou ? 'Your' : 'Opponent'} rested DON, ${donRested.length} used this turn`}
      className="flex w-full items-center gap-1 px-3"
      style={{ height: 'var(--zone-cost-strip-h, 28px)' }}
    >
      <span className="font-body text-[0.55rem] font-extrabold uppercase tracking-wider text-ink-iron/60">
        Rested
      </span>
      <div className="flex h-full grow items-center gap-1 overflow-x-auto">
        {donRested.map((instanceId, i) => (
          <RestedCoin key={instanceId} instanceId={instanceId} index={i} reduced={reduced} />
        ))}
      </div>
    </div>
  );
});
