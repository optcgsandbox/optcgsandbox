// CostAreaBand — playmat-redesign.md §2.7.
//
// Wide horizontal band in the FAR row, sitting between DON DECK (left) and
// TRASH (right). On the Bandai playsheet this is the gray "COST AREA"
// rectangle — the largest single zone in the FAR row. It hosts ALL DON
// cards: active DON upright on the left, rested DON rotated 90° in place
// to its right. Max 10 DON; with up to 10 DON the cards overlap in a
// compressed stack so the band footprint stays fixed.
//
// Interaction: tap an active DON to ARM it (pulsing brass ring) — then tap
// a friendly character / leader to ATTACH_DON via the CardDetailModal.
// Rested DON are non-interactive.

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

// DON card front — Bandai's "+1000" stamp on a cream body with a ど!! mark.
// 38×52 base inside the 60px-tall COST band so the cards read clearly.
const DON_CARD_W = 38;
const DON_CARD_H = 52;
const DON_STRIDE = 12; // tight overlap, life-card style
const REST_GAP = 16;   // gap between active group and rested group

/** 12 radial dashes behind the ど!! mark — speed-line burst. */
function SpeedLines() {
  const dashes = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg
      viewBox="0 0 38 52"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <g
        stroke="var(--color-ink-black)"
        strokeOpacity={0.20}
        strokeWidth={0.7}
        strokeLinecap="round"
      >
        {dashes.map((deg) => (
          <line
            key={deg}
            x1={19}
            y1={20}
            x2={19}
            y2={12}
            transform={`rotate(${deg} 19 20)`}
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
        'absolute inset-0 overflow-hidden rounded-[4px]',
        'bg-paper-cream paper-grain',
        active
          ? 'shadow-[0_2px_5px_rgba(15,20,15,0.40)]'
          : 'shadow-[0_1px_2px_rgba(15,20,15,0.18)]',
      ].join(' ')}
      style={{
        border: '0.75px solid var(--color-ink-black)',
        // Thin brass inset hairline — matches the back design language.
        backgroundImage:
          'radial-gradient(ellipse at 50% 30%, rgba(255,248,225,0.7) 0%, transparent 60%)',
      }}
      aria-hidden="true"
    >
      <SpeedLines />
      {/* ど!! mark — Lilita One ink-black with a 4° forward lean. */}
      <div
        className="absolute left-1/2 top-[36%] -translate-x-1/2 -translate-y-1/2"
        style={{ transform: 'translate(-50%, -50%) rotate(-4deg)' }}
      >
        <span
          className="font-display leading-none text-ink-black"
          style={{
            fontSize: 14,
            letterSpacing: '-0.02em',
            textShadow: '0 1px 0 var(--color-paper-cream)',
            fontWeight: 700,
          }}
        >
          ど!!
        </span>
      </div>
      {/* Brass underline beneath the mark. */}
      <div
        className="absolute left-1/2 -translate-x-1/2 bg-brass-canary"
        style={{ top: '52%', width: 14, height: 1 }}
        aria-hidden="true"
      />
      {/* Brass +1000 stamp inside an ink bottom band — Bandai's signature. */}
      <div
        className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-ink-black"
        style={{ height: 14, borderRadius: '0 0 4px 4px' }}
      >
        <span
          className="font-display tabular text-brass-canary"
          style={{
            fontSize: 10,
            letterSpacing: '0.06em',
            lineHeight: 1,
            fontWeight: 700,
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
  const targetRotate = rested ? 90 : 0;
  return (
    // Static wrapper carries data-flip-back so Framer transforms inside the
    // motion.button (animate/whileHover/whileTap) don't override the CSS
    // counter-rotation on the opp side.
    <div data-flip-back style={{ display: 'block', width: DON_CARD_W, height: DON_CARD_H }}>
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
                '0 0 0 2px var(--color-sun-brass), 0 0 10px rgba(232,180,61,0.6)',
                '0 0 0 0px var(--color-sun-brass)',
              ],
            }
          : {
              scale: 1,
              opacity: rested ? 0.74 : 1,
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
      onClick={
        interactive && !rested
          ? (e) => {
              // Stop bubble to PlayfieldStage root onPlaymatTap — that handler
              // disarms armedDonId if set, which would immediately undo this arm.
              e.stopPropagation();
              onTap?.();
            }
          : undefined
      }
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
        'relative shrink-0 rounded-[4px]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sun-brass',
        interactive && !rested ? 'cursor-pointer' : 'cursor-default',
      ].join(' ')}
      style={{
        width: DON_CARD_W,
        height: DON_CARD_H,
        minWidth: 28,
        minHeight: 28,
        transformOrigin: '50% 50%',
        pointerEvents: rested ? 'none' : undefined,
      }}
    >
      <DonCardArt active={!rested} />
    </motion.button>
    </div>
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

  useEffect(() => {
    // Only the owner's CostAreaBand can drive the shared armedDonId state.
    // Without the isYou guard, the OPP-side instance of this component (where
    // interactive is always false) would see armedDonId become non-null and
    // immediately disarm — racing with the owner's arm action and making the
    // DON appear to never arm. Found 2026-05-29 via Playwright (aria-pressed
    // stuck at "false" after click).
    if (isYou && !interactive && armedDonId) disarmDon();
  }, [isYou, interactive, armedDonId, disarmDon]);

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
  const stackWidth =
    totalDon > 0 ? (totalDon - 1) * DON_STRIDE + DON_CARD_W : 0;

  return (
    <div
      role="region"
      data-zone={`costArea:${playerId}`}
      aria-label={`${isYou ? 'Your' : 'Opponent'} cost area — ${donCostArea.length} active DON, ${donRested.length} rested DON`}
      className="playmat-zone playmat-zone--strong relative flex h-full w-full items-center justify-start px-2"
      style={{ minHeight: 'var(--zone-cost-strip-h, 60px)' }}
    >
      {/* Wordmark — printed CENTER on Bandai's cardboard mat when zone is empty. */}
      {totalDon === 0 && (
        <span
          className="playmat-zone__label absolute inset-0 flex items-center justify-center font-display"
          style={{ fontSize: 12, letterSpacing: '0.16em' }}
          aria-hidden="true"
        >
          COST AREA
        </span>
      )}
      {totalDon > 0 && (
        // absolute inset-y-0 anchors the wrapper to the band's true top + bottom
        // so the abs children's `top: 50% + translateY(-50%)` centers against
        // the band's actual height. Previously `h-full flex items-center`
        // shrunk to the children's intrinsic 52px (parent `items-center` +
        // min-height-only band makes h-full unreliable for percentage children),
        // so cards visually hugged the top of the band.
        <div
          className="absolute inset-y-0"
          style={{ left: 8, width: stackWidth, minWidth: 0, overflow: 'visible' }}
        >
          {donCostArea.map((instanceId, i) => (
            <div
              key={instanceId}
              className="absolute"
              style={{
                left: i * DON_STRIDE,
                zIndex: i + 1,
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            >
              <DonCard
                instanceId={instanceId}
                index={i}
                rested={false}
                reduced={reduced}
                interactive={interactive}
                armed={armedDonId === instanceId}
                onTap={() => handleCoinTap(instanceId)}
              />
            </div>
          ))}
          {donRested.map((instanceId, i) => {
            // Rested group starts AFTER all active DONs + a small gap.
            const restedLeft =
              (donCostArea.length > 0 ? donCostArea.length * DON_STRIDE + REST_GAP : 0) +
              i * DON_STRIDE;
            return (
              <div
                key={instanceId}
                className="absolute"
                style={{
                  left: restedLeft,
                  zIndex: donCostArea.length + i + 1,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
              >
                <DonCard
                  instanceId={instanceId}
                  index={i}
                  rested
                  reduced={reduced}
                  interactive={false}
                  armed={false}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
