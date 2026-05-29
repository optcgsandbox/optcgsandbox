// CostAreaStrip — visual-spec-layout-correction.md §D.2 + §F step 10.
// Horizontal staging band rendering the player's active (un-attached) DON
// instances. Reads `donCostArea: string[]` from PlayerZones (Phase A engine
// refactor — DON is now CardInstance[]).
//
// ATTACH affordance: the player taps a DON coin to "arm" it (visual ring +
// pulse), then taps a friendly character or their leader to dispatch
// ATTACH_DON. Tapping the same coin again, or anywhere else, disarms. This
// is the simplest tap-tap interaction that matches the 44pt tap-target rule
// without needing a drag-and-drop layer for the v0.1 pass.
//
// Capped at 10 visible (OPTCG max DON in cost area). overflow-x-auto is
// defensive — the engine guarantees ≤ DON_DECK_SIZE = 10.

import { memo, useCallback, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../../store/game';
import { useDonArm } from '../../store/donArm';
import { STAGGER_DON } from '../../lib/animationTokens';
import type { PlayerId } from '@shared/engine/GameState';

interface CostAreaStripProps {
  playerId: PlayerId;
  /** True when this strip belongs to the seat we render as ("you"). Only the
   *  current player can arm + attach their own DON. */
  isYou: boolean;
}

/** Single brass DON coin — generic crossed-blade glyph, no Bandai IP. */
function DonCoin({
  instanceId,
  index,
  reduced,
  interactive,
  armed,
  onTap,
}: {
  instanceId: string;
  index: number;
  reduced: boolean;
  interactive: boolean;
  armed: boolean;
  onTap?: () => void;
}) {
  return (
    <motion.button
      type="button"
      // Stagger the coins on initial paint so a fresh DON phase reads as a
      // deal sequence rather than 10 coins popping at once.
      initial={reduced ? false : { scale: 0, opacity: 0 }}
      animate={
        armed && !reduced
          ? {
              scale: [1, 1.12, 1],
              opacity: 1,
              boxShadow: [
                '0 0 0 0px var(--color-sun-brass)',
                '0 0 0 4px var(--color-sun-brass)',
                '0 0 0 0px var(--color-sun-brass)',
              ],
            }
          : { scale: 1, opacity: 1, boxShadow: '0 0 0 0px transparent' }
      }
      transition={
        armed
          ? { duration: 1, repeat: Infinity, ease: 'easeInOut' }
          : {
              type: 'spring',
              stiffness: 280,
              damping: 26,
              delay: reduced ? 0 : index * STAGGER_DON,
            }
      }
      onClick={interactive ? onTap : undefined}
      disabled={!interactive}
      data-don-instance={instanceId}
      aria-label={armed ? 'Armed DON — tap a character to attach' : 'Active DON, tap to arm'}
      aria-pressed={armed}
      className={[
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
        'bg-brass-canary text-ink-black shadow-[0_1px_2px_rgba(15,20,15,0.25)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sun-brass',
        interactive ? 'cursor-pointer' : 'cursor-default',
        armed ? 'ring-2 ring-sun-brass' : '',
      ].join(' ')}
      style={{ minWidth: 28, minHeight: 28 }}
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        {/* Crossed-blade DON glyph (generic, no Bandai IP). */}
        <line x1="3" y1="3" x2="13" y2="13" />
        <line x1="3" y1="13" x2="13" y2="3" />
      </svg>
    </motion.button>
  );
}

export const CostAreaStrip = memo(function CostAreaStrip({ playerId, isYou }: CostAreaStripProps) {
  const donCostArea = useGameStore((s) => s.state.players[playerId].donCostArea);
  const donRestedCount = useGameStore((s) => s.state.players[playerId].donRested.length);
  const activePlayer = useGameStore((s) => s.state.activePlayer);
  const phase = useGameStore((s) => s.state.phase);
  const reduced = useReducedMotion() ?? false;

  const armedDonId = useDonArm((s) => s.armedDonId);
  const armDon = useDonArm((s) => s.arm);
  const disarmDon = useDonArm((s) => s.disarm);

  // Only the active player can attach during their own main phase.
  const interactive = isYou && activePlayer === playerId && phase === 'main';

  // Disarm whenever the strip stops being interactive (phase/turn changes).
  useEffect(() => {
    if (!interactive && armedDonId) disarmDon();
  }, [interactive, armedDonId, disarmDon]);

  const handleCoinTap = useCallback(
    (instanceId: string) => {
      if (armedDonId === instanceId) {
        disarmDon();
      } else {
        armDon(instanceId);
      }
    },
    [armedDonId, armDon, disarmDon],
  );

  return (
    <div
      role="region"
      aria-label={`${isYou ? 'Your' : 'Opponent'} cost area, ${donCostArea.length} active DON, ${donRestedCount} rested`}
      className="flex w-full items-center gap-1 px-3"
      style={{ height: 'var(--zone-cost-strip-h, 28px)' }}
    >
      {/* WCAG 1.4.3 — micro-label was text-ink-iron/70 on paper-cream (~3.1:1).
          Solid ink-iron on cream is ~10.5:1, well above the 4.5:1 body-text bar. */}
      <span className="font-body text-[0.55rem] font-extrabold uppercase tracking-wider text-ink-iron">
        Cost
      </span>
      <div className="flex h-full grow items-center gap-1 overflow-x-auto">
        {donCostArea.map((instanceId, i) => (
          <DonCoin
            key={instanceId}
            instanceId={instanceId}
            index={i}
            reduced={reduced}
            interactive={interactive}
            armed={armedDonId === instanceId}
            onTap={() => handleCoinTap(instanceId)}
          />
        ))}
      </div>
      {donRestedCount > 0 && (
        <span
          className="shrink-0 rounded-full bg-paper-fog/60 px-1.5 py-0.5
                     font-display tabular text-[0.65rem] leading-none text-ink-iron"
          aria-label={`${donRestedCount} rested DON`}
        >
          {donRestedCount}r
        </span>
      )}
    </div>
  );
});
