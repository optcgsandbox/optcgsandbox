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

// DON card front — visual-design-spec.md §1.2–1.4.
// Cream body with ink ど!! mark sitting on a faint radial speed-line burst,
// brass underline accent, and a brass "+1000" stamp inside an ink bottom band.
// 30×42px base; scales for hand/field renders if ever needed.
const DON_CARD_W = 30;
const DON_CARD_H = 42;

/** Radial speed-lines burst behind the ど!! mark. Pure decoration. */
function SpeedLines() {
  // 12 evenly-spaced radial dashes (every 30°) emanating from (50%, 38%).
  const dashes = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg
      viewBox="0 0 30 42"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <g
        stroke="var(--color-ink-black)"
        strokeOpacity={0.18}
        strokeWidth={0.5}
        strokeLinecap="round"
      >
        {dashes.map((deg) => (
          <line
            key={deg}
            x1={15}
            y1={16}
            x2={15}
            y2={10}
            transform={`rotate(${deg} 15 16)`}
          />
        ))}
      </g>
    </svg>
  );
}

function DonCardArt({ active }: { active: boolean }) {
  return (
    <div
      className={[
        'absolute inset-0 overflow-hidden rounded-[3px]',
        'bg-paper-cream paper-grain',
        active
          ? 'shadow-[0_2px_4px_rgba(15,20,15,0.35)]'
          : 'shadow-[0_1px_2px_rgba(15,20,15,0.18)]',
      ].join(' ')}
      style={{
        border: '0.75px solid var(--color-ink-black)',
      }}
      aria-hidden="true"
    >
      <SpeedLines />
      {/* ど!! mark — Lilita One ink with subtle drop shadow + 4° forward lean. */}
      <div
        className="absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2"
        style={{ transform: 'translate(-50%, -50%) rotate(-4deg)' }}
      >
        <span
          className="font-display leading-none text-ink-black"
          style={{
            fontSize: 11,
            letterSpacing: '-0.02em',
            textShadow: '0 1px 0 var(--color-paper-cream)',
            fontWeight: 600,
          }}
        >
          ど!!
        </span>
      </div>
      {/* Brass underline accent — small "stamp" cue under the mark. */}
      <div
        className="absolute left-1/2 -translate-x-1/2 bg-brass-canary"
        style={{ top: '54%', width: 8, height: 0.75 }}
        aria-hidden="true"
      />
      {/* Bottom band with +1000 brass stamp. */}
      <div
        className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-ink-black"
        style={{ height: 12, borderRadius: '0 0 3px 3px' }}
      >
        <span
          className="font-display tabular text-brass-canary"
          style={{
            fontSize: 8,
            letterSpacing: '0.04em',
            lineHeight: 1,
            fontWeight: 600,
          }}
        >
          +1000
        </span>
      </div>
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
  // Per CR §4-4 active vs rested = upright vs 90° rotated.
  // visual-design-spec.md §1.3 rested treatment: `transform-origin: 0 100%`
  // so the card pivots around its bottom-left, anchoring the slot position
  // (per MOOgiwara card.ts:117-128).
  const targetRotate = rested ? 90 : 0;
  return (
    <motion.button
      type="button"
      initial={reduced ? false : { scale: 0, opacity: 0 }}
      animate={
        armed && !reduced
          ? {
              scale: [1, 1.08, 1],
              opacity: 1,
              rotate: targetRotate,
              y: -2,
              boxShadow: [
                '0 0 0 0px var(--color-sun-brass)',
                '0 0 0 2px var(--color-sun-brass), 0 0 8px rgba(232,180,61,0.5)',
                '0 0 0 0px var(--color-sun-brass)',
              ],
            }
          : {
              scale: 1,
              opacity: rested ? 0.72 : 1,
              rotate: targetRotate,
              y: 0,
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
        'relative shrink-0 rounded-[3px]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sun-brass',
        interactive && !rested ? 'cursor-pointer' : 'cursor-default',
      ].join(' ')}
      style={{
        width: DON_CARD_W,
        height: DON_CARD_H,
        minWidth: 28,
        minHeight: 28,
        // §1.3 — rested pivot anchors bottom-left so the slot footprint stays put.
        transformOrigin: rested ? '0 100%' : '50% 50%',
        pointerEvents: rested ? 'none' : undefined,
      }}
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
                 rounded-md bg-paper-fog/40 px-1.5
                 ring-1 ring-ink-iron/15"
    >
      <span
        className="shrink-0 font-body text-[0.5rem] font-extrabold uppercase tracking-wider text-ink-iron/75"
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
        <span className="absolute inset-0 flex items-center justify-center font-body text-[0.55rem] font-extrabold uppercase tracking-wider text-ink-iron/55">
          No DON
        </span>
      )}
    </div>
  );
});
