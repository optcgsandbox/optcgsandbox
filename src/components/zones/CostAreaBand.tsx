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
import type { PlayerId } from '@shared/engine-v2/state/types';

interface CostAreaBandProps {
  playerId: PlayerId;
  isYou: boolean;
}

// DON card front — official Bandai art from `public/backs/don-front.png`
// (extracted from rule_manual.pdf p.4, image #18). 38×52 base inside the
// 60px-tall COST band so the cards read clearly.
const DON_CARD_W = 38;
const DON_CARD_H = 52;
const DON_STRIDE = 12; // tight overlap, life-card style
const REST_GAP = 16;   // gap between active group and rested group

function DonCardArt({ active }: { active: boolean }) {
  return (
    <div
      className="absolute inset-0"
      style={{
        // `drop-shadow` follows the PNG's transparent rounded corners (no
        // rectangular halo). Stronger when active, dim when rested.
        filter: active
          ? 'drop-shadow(0 2px 5px rgba(15,20,15,0.40))'
          : 'drop-shadow(0 1px 2px rgba(15,20,15,0.18))',
      }}
      aria-hidden="true"
    >
      <img
        src="/backs/don-front.png"
        alt=""
        className="w-full h-full object-contain"
        decoding="async"
        loading="eager"
        draggable={false}
      />
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
  /** Side flag — drives mount-animation mirroring. Opp side's `data-flip-back`
   *  counter-rotates the parent half's 180°, so the outer mount animation sits
   *  in an upright local frame for both halves. To make opp's card appear to
   *  fly from THEIR deck (visually screen-right) instead of mirroring owner's
   *  screen-left start, flip x, rotateY, and transformOrigin on opp. Owner
   *  values stay untouched. */
  isYou: boolean;
  onTap?: () => void;
}

function DonCard({ instanceId, index, rested, reduced, interactive, armed, isYou, onTap }: DonCardProps) {
  const targetRotate = rested ? 90 : 0;
  // Side-aware mount choreography (owner: flight from left; opp: mirrored).
  const mountX = isYou ? -64 : 64;
  const mountRotateY = isYou ? -90 : 90;
  const mountOrigin = isYou ? '0% 50%' : '100% 50%';
  return (
    // Static wrapper carries data-flip-back so Framer transforms inside the
    // motion.button (animate/whileHover/whileTap) don't override the CSS
    // counter-rotation on the opp side.
    <div data-flip-back style={{ display: 'block', width: DON_CARD_W, height: DON_CARD_H }}>
    {/* OUTER motion layer — mount-only flight + face-up flip. Pivots from the
        card's LEFT edge (transformOrigin: 0% 50%) so the card opens like a
        book from its left-most edge. Opp half's parent rotate(180deg) maps
        local-left → screen-right (= opp's DON-deck side), so a single
        animation works for both sides. Verified via mockup v3 2026-05-30. */}
    <motion.div
      initial={reduced ? false : { scale: 0.85, opacity: 0, x: mountX, rotateY: mountRotateY }}
      animate={reduced ? false : { scale: 1, opacity: 1, x: 0, rotateY: 0 }}
      transition={{
        type: 'spring',
        stiffness: 220,
        damping: 24,
        delay: reduced ? 0 : index * STAGGER_DON,
      }}
      style={{
        width: DON_CARD_W,
        height: DON_CARD_H,
        transformOrigin: mountOrigin,
      }}
    >
    {/* INNER motion.button — rest rotateZ + armed pulse + hover + tap.
        Pivots from card center so the rest swing stays in place. */}
    <motion.button
      type="button"
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
          : { type: 'spring', stiffness: 280, damping: 26 }
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
    </motion.div>
    </div>
  );
}

export const CostAreaBand = memo(function CostAreaBand({ playerId, isYou }: CostAreaBandProps) {
  const donCostArea = useGameStore((s) => s.state.players[playerId].donCostArea);
  const donRested = useGameStore((s) => s.state.players[playerId].donRested);
  const activePlayer = useGameStore((s) => s.state.activePlayer);
  const phase = useGameStore((s) => s.state.phase);
  const reduced = useReducedMotion() ?? false;

  const armedDonIds = useDonArm((s) => s.armedDonIds);
  const toggleDon = useDonArm((s) => s.toggle);
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
    if (isYou && !interactive && armedDonIds.length) disarmDon();
  }, [isYou, interactive, armedDonIds, disarmDon]);

  const handleCoinTap = useCallback(
    (instanceId: string) => {
      // Toggle this coin in/out of the armed set — multi-select.
      toggleDon(instanceId);
    },
    [toggleDon],
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
      {/* Wordmark — printed CENTER on Bandai's cardboard mat when zone is empty.
          F-8C — the flex-centering CONTAINER must NOT carry
          `playmat-zone__label`: the opp-half counter-rotation CSS
          (index.css `.is-opp-content-flip .playmat-zone__label`) forces
          `display: inline-block`, which destroyed the flex centering and
          left the opponent's COST AREA wordmark mis-positioned vs the
          player's. Centering lives on a plain outer div; the label class
          (and its 180° counter-rotation) applies to the INNER span only,
          which rotates about its own center — same position both sides. */}
      {totalDon === 0 && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
          data-cost-area-label={playerId}
        >
          <span
            className="playmat-zone__label font-display"
            style={{ fontSize: 12, letterSpacing: '0.16em' }}
          >
            COST AREA
          </span>
        </div>
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
          {/*
            Single unified iteration over [active DONs, rested DONs]. Previously
            this was TWO separate .map() calls. When runRefreshPhase moved an
            instance from donRested → donCostArea, React's reconciler saw it as
            UNMOUNT from one map + MOUNT in the other (different parent list),
            which RE-FIRED the DonCard flight+flip mount animation on every
            rested DON during refresh. That added a chaotic "DONs replay their
            entry" beat on top of the per-card un-rest rotation, making REFRESH
            phase feel slower than DRAW / DON. The unified list lets the same
            key=instanceId stay mounted across the move; only the `rested` prop
            changes, and the DonCard's animate-rotate handles the visual.
            Owner direction 2026-05-30.
          */}
          {[
            ...donCostArea.map((id, i) => ({ id, i, rested: false })),
            ...donRested.map((id, i) => ({ id, i, rested: true })),
          ].map(({ id: instanceId, i, rested: itemRested }, flatIdx) => {
            const left = itemRested
              ? (donCostArea.length > 0 ? donCostArea.length * DON_STRIDE + REST_GAP : 0) +
                i * DON_STRIDE
              : i * DON_STRIDE;
            return (
              <div
                key={instanceId}
                className="absolute"
                style={{
                  left,
                  zIndex: flatIdx + 1,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
              >
                <DonCard
                  instanceId={instanceId}
                  index={i}
                  rested={itemRested}
                  reduced={reduced}
                  interactive={itemRested ? false : interactive}
                  armed={!itemRested && armedDonIds.includes(instanceId)}
                  isYou={isYou}
                  onTap={itemRested ? undefined : () => handleCoinTap(instanceId)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
