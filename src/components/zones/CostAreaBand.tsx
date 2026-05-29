// CostAreaBand — design-reference.md §3.4 L5 + rules-reference.md §4.8.
// Wide bottom-center band that renders ALL DON in the Cost Area together:
// active DON face-up (upright `+1000` card) AND rested DON rotated 90°
// (sideways `+1000` card). Per the Bandai playmat both states live in the
// SAME zone and should be visible at a glance.
//
// Replaces the earlier `CostAreaStrip` (active brass coins only) +
// `DonRested` (rested coins only) split — those were a UI simplification
// that diverged from the playmat (design-reference §3.1 L5). The card-front
// art ("+1000" DON card) matches rule_manual.pdf p4.
//
// ATTACH affordance preserved: tap an active DON card to "arm" it (visual
// ring + pulse), then tap a friendly character or your leader to dispatch
// ATTACH_DON. Tapping the same card again, or anywhere else, disarms.

import { memo, useCallback, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../../store/game';
import { useDonArm } from '../../store/donArm';
import { STAGGER_DON } from '../../lib/animationTokens';
import type { PlayerId } from '@shared/engine/GameState';

interface CostAreaBandProps {
  playerId: PlayerId;
  isYou: boolean;
}

// DON card aesthetic (per rule_manual.pdf p4): teal-green DON card with a
// brass "+1000" stamp at center. We render a compact representation: a
// rounded chip with the +1000 stamp visible, sized so 10 fit horizontally
// across the bottom band of a 430px-wide phone frame.
const DON_CARD_W = 30;
const DON_CARD_H = 42;

function DonCardArt({ active }: { active: boolean }) {
  return (
    <div
      className={[
        'absolute inset-0 rounded-md overflow-hidden flex flex-col items-center justify-center',
        active
          ? 'bg-hull-teal shadow-[0_2px_4px_rgba(0,0,0,0.35)]'
          : 'bg-hull-teal/70 shadow-[0_1px_2px_rgba(0,0,0,0.25)]',
      ].join(' ')}
      aria-hidden="true"
    >
      <div className="absolute inset-0.5 rounded-sm ring-1 ring-brass-canary/60" />
      {/* "+1000" brass stamp — the DON card's defining visual. */}
      <span className="font-display tabular text-[0.7rem] leading-none text-brass-canary drop-shadow-[0_1px_0_rgba(0,0,0,0.5)]">
        +1000
      </span>
    </div>
  );
}

interface DonCardProps {
  instanceId: string;
  index: number;
  rested: boolean;
  reduced: boolean;
  interactive: boolean;
  armed: boolean;
  onTap?: () => void;
}

function DonCard({ instanceId, index, rested, reduced, interactive, armed, onTap }: DonCardProps) {
  // Per CR §4-4 active vs rested = upright vs 90° rotated. Match the physical
  // game's "tap to rest" gesture.
  const targetRotate = rested ? 90 : 0;
  return (
    <motion.button
      type="button"
      initial={reduced ? false : { scale: 0, opacity: 0 }}
      animate={
        armed && !reduced
          ? {
              scale: [1, 1.10, 1],
              opacity: 1,
              rotate: targetRotate,
              boxShadow: [
                '0 0 0 0px var(--color-sun-brass)',
                '0 0 0 3px var(--color-sun-brass)',
                '0 0 0 0px var(--color-sun-brass)',
              ],
            }
          : {
              scale: 1,
              opacity: rested ? 0.7 : 1,
              rotate: targetRotate,
              boxShadow: '0 0 0 0px transparent',
            }
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
      onClick={interactive && !rested ? onTap : undefined}
      disabled={!interactive || rested}
      data-don-instance={instanceId}
      aria-label={
        rested
          ? 'Rested DON, +1000 power, spent this turn'
          : armed
            ? 'Armed DON — tap a character to attach'
            : 'Active DON, +1000 power, tap to arm'
      }
      aria-pressed={armed}
      className={[
        'relative shrink-0 rounded-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sun-brass',
        interactive && !rested ? 'cursor-pointer' : 'cursor-default',
      ].join(' ')}
      style={{ width: DON_CARD_W, height: DON_CARD_H, minWidth: 28, minHeight: 28 }}
    >
      <DonCardArt active={!rested} />
    </motion.button>
  );
}

export const CostAreaBand = memo(function CostAreaBand({ playerId, isYou }: CostAreaBandProps) {
  const donCostArea = useGameStore((s) => s.state.players[playerId].donCostArea);
  const donRested = useGameStore((s) => s.state.players[playerId].donRested);
  const activePlayer = useGameStore((s) => s.state.activePlayer);
  const phase = useGameStore((s) => s.state.phase);
  const reduced = useReducedMotion() ?? false;

  const armedDonId = useDonArm((s) => s.armedDonId);
  const armDon = useDonArm((s) => s.arm);
  const disarmDon = useDonArm((s) => s.disarm);

  // Only the active player during their main phase can attach.
  const interactive = isYou && activePlayer === playerId && phase === 'main';

  // Disarm whenever the band stops being interactive (phase/turn changes).
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

  const totalDon = donCostArea.length + donRested.length;

  return (
    <div
      role="region"
      data-zone={`costArea:${playerId}`}
      aria-label={`${isYou ? 'Your' : 'Opponent'} cost area — ${donCostArea.length} active DON, ${donRested.length} rested DON`}
      className="relative flex h-full w-full items-center justify-start gap-1
                 rounded-md bg-felt-green-dark/30 px-1.5
                 ring-1 ring-paper-cream/15"
    >
      <span
        className="shrink-0 font-body text-[0.5rem] font-extrabold uppercase tracking-wider text-paper-cream/85"
        aria-hidden="true"
      >
        Cost
      </span>
      <div className="flex h-full grow items-center gap-0.5 overflow-x-auto">
        {donCostArea.map((instanceId, i) => (
          <DonCard
            key={instanceId}
            instanceId={instanceId}
            index={i}
            rested={false}
            reduced={reduced}
            interactive={interactive}
            armed={armedDonId === instanceId}
            onTap={() => handleCoinTap(instanceId)}
          />
        ))}
        {donRested.map((instanceId, i) => (
          <DonCard
            key={instanceId}
            instanceId={instanceId}
            index={donCostArea.length + i}
            rested={true}
            reduced={reduced}
            interactive={false}
            armed={false}
          />
        ))}
      </div>
      {totalDon === 0 && (
        <span className="absolute inset-0 flex items-center justify-center font-body text-[0.55rem] font-extrabold uppercase tracking-wider text-paper-cream/55">
          No DON
        </span>
      )}
    </div>
  );
});
