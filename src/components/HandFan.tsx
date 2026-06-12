// HandFan — visual-design-spec.md §3.
// Mobile-tuned fan that distributes 1–10 cards along a shallow arc inside the
// 398px inner playmat width. Cards pivot from their bottom-center.
//
// Interaction (replaces the old immediate-PLAY behavior):
//   • Tap a resting card        → setInspectedCardId(thatId) (card lifts)
//   • Tap the lifted card again → setCardDetailOpen(true) (opens CardDetailModal)
//   • Tap a different card      → switch lift to the new card
//   • Tap outside any card      → clearing handled by App-level listener
//
// PLAY_CARD is now dispatched ONLY from CardDetailModal's primary action.

import { memo, useCallback, useEffect, useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { fanPosition, HAND_CARD_W, HAND_CARD_H } from '../lib/fanLayout';
import { springs } from '../lib/animationTokens';
import { CardArt, CARD_DIMS } from './CardArt';
import { NavyCardBack } from './zones/NavyCardBack';
import type { PlayerId } from '@shared/engine-v2/state/types';

interface HandFanProps {
  /** Which seat's hand to render. Defaults to viewAs. */
  playerId?: PlayerId;
  /** When true (human's seat), tapping a card lifts it / opens the modal. */
  interactive?: boolean;
  /** F-8D — opponent mode: SAME fan geometry but face-down card backs,
   *  mirrored to the top of the board, zero identity in the DOM, never
   *  interactive. */
  hidden?: boolean;
}

/** Opp-hand SAFE LANE scale: the lane above the opp mat is
 *  19dvh − 19px (zone edge clearance) − 36px (header). When shorter than a
 *  card, scale the whole fan down so it NEVER overlaps a board zone. */
function useOppLaneScale(active: boolean): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!active) return undefined;
    const update = (): void => {
      const lane = 0.19 * window.innerHeight - 19 - 36;
      setScale(Math.max(0.45, Math.min(1, lane / HAND_CARD_H)));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [active]);
  return scale;
}

export const HandFan = memo(function HandFan({ playerId, interactive = true, hidden = false }: HandFanProps) {
  const seat = useGameStore((s) => playerId ?? s.viewAs);
  const handIds = useGameStore((s) => s.state.players[seat].hand);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const inspectedCardId = useGameStore((s) => s.inspectedCardId);
  const setInspectedCardId = useGameStore((s) => s.setInspectedCardId);
  const setCardDetailOpen = useGameStore((s) => s.setCardDetailOpen);
  const setInspectGroup = useGameStore((s) => s.setInspectGroup);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const onTap = useCallback(
    (instanceId: string) => {
      if (!interactive || hidden) return;
      // Owner direction 2026-05-29: single tap opens detail modal directly.
      // The two-step lift-then-tap-again was too small to read on a phone.
      // Carousel (owner 2026-06-12): the whole hand is the browse group.
      setInspectGroup(handIds);
      setInspectedCardId(instanceId);
      setCardDetailOpen(true);
    },
    [interactive, hidden, setCardDetailOpen, setInspectedCardId, setInspectGroup, handIds],
  );

  const n = handIds.length;
  const oppScale = useOppLaneScale(hidden);

  return (
    <div
      // pointer-events-none lets the container pass clicks through to the
      // playmat (which clears inspectedCardId at App level). Individual cards
      // re-enable pointer events.
      //
      // HAND ANCHORING (owner 2026-06-12, safe-lane revision):
      // - OPP fan lives in the SAFE LANE above the opp mat: card bottoms
      //   land 4px ABOVE the topmost opp zone edge (measured at 19dvh−15px
      //   across viewports) — it must NEVER cover a board zone. When the
      //   lane is shorter than a card (landscape), the whole fan scales
      //   down (useOppLaneScale) instead of intruding.
      // - YOUR fan hugs the mat's bottom edge (card tops 2px clear of the
      //   cost area) and is clamped above the home-indicator inset.
      className={
        hidden
          ? 'pointer-events-none absolute inset-x-0 top-0 z-10 flex items-end justify-center'
          : 'pointer-events-none absolute inset-x-0 z-40 flex items-end justify-center'
      }
      style={
        hidden
          ? {
              // Card block spans [marginTop .. marginTop+cardH·s]; topmost
              // opp zone edge = 19dvh − 15px → bottom of cards at
              // 19dvh − 19px: marginTop = 19dvh − 19 − cardH.
              height: HAND_CARD_H + 8,
              marginTop: `max(34px, calc(19dvh - ${HAND_CARD_H + 19}px))`,
              // Center-origin: rotate flips in place; lane-scale shrinks
              // symmetrically (upward into the lane, never onto the mat).
              transform: `rotate(180deg) scale(${oppScale})`,
            }
          : {
              // Cards sit at the container bottom; your mat BOTTOM edge is
              // 19dvh+inset above the shell's physical bottom → card tops
              // 18px past it; clamped above the home-indicator inset.
              height: HAND_CARD_H + 80,
              bottom: `max(env(safe-area-inset-bottom, 0px), calc(19dvh - ${HAND_CARD_H + 18}px + env(safe-area-inset-bottom, 0px)))`,
            }
      }
      aria-label={`${hidden ? 'Opponent' : 'Your'} hand, ${n} cards`}
      data-hand-fan
      data-hidden={hidden || undefined}
      data-hand-count={n}
    >
      <LayoutGroup>
        <div className="relative" style={{ width: 1, height: HAND_CARD_H }}>
          {handIds.map((instanceId, i) => {
            const inst = instances[instanceId];
            if (!inst) return null;
            const card = library[inst.cardId];
            const fan = fanPosition(i, n);
            const isInspected = inspectedCardId === instanceId;
            const someoneElseInspected =
              inspectedCardId !== null && !isInspected;

            // visual-design-spec.md §3.5 lift override.
            const animate = isInspected
              ? { x: fan.x, y: -60, rotate: 0, scale: 1.15, opacity: 1 }
              : {
                  x: fan.x,
                  y: fan.y,
                  rotate: fan.rotate,
                  scale: 1,
                  opacity: someoneElseInspected ? 0.5 : 1,
                };

            if (hidden) {
              return (
                <motion.div
                  key={instanceId}
                  initial={{ opacity: 0, y: -40, scale: 0.7 }}
                  animate={{ x: fan.x, y: fan.y, rotate: fan.rotate, scale: 1, opacity: 1 }}
                  exit={{ opacity: 0, y: -60, transition: { duration: 0.2 } }}
                  transition={spring.handFan}
                  style={{
                    position: 'absolute',
                    left: -HAND_CARD_W / 2,
                    bottom: 0,
                    transformOrigin: '50% 100%',
                    zIndex: 20 + i,
                  }}
                >
                  {/* The SAME Bandai navy back as the deck pile (owner
                      2026-06-12). Rendered SLIMMER than the player-card
                      footprint (×0.88): the solid-navy full-bleed back reads
                      optically wider than the white-bordered scans at equal
                      box size — owner direction. NO inst/card props → zero
                      identity (ids / names / aria) reaches the DOM. */}
                  <div
                    className="relative"
                    style={{
                      width: Math.round(CARD_DIMS.hand.w * 0.88),
                      height: Math.round(CARD_DIMS.hand.h * 0.88),
                    }}
                  >
                    <NavyCardBack radius={4} />
                  </div>
                </motion.div>
              );
            }

            return (
              <motion.div
                key={instanceId}
                layout
                // Owner direction 2026-05-30: card draw comes from the DECK
                // (upper-right of LEADER row), not from below the fan.
                // x: +190 places the mount near the deck slot's screen x;
                // y: -330 lifts it to the deck row; scale: 0.7 + rotate -8
                // give a "card pulled from pile" feel before it settles
                // into its fan slot.
                initial={{ opacity: 0, x: 190, y: -330, scale: 0.7, rotate: -8 }}
                animate={animate}
                exit={{ opacity: 0, y: 80, transition: { duration: 0.2 } }}
                transition={spring.handFan}
                style={{
                  position: 'absolute',
                  left: -HAND_CARD_W / 2,
                  bottom: 0,
                  transformOrigin: '50% 100%',
                  zIndex: isInspected ? 40 : 20 + i,
                  filter:
                    someoneElseInspected && !reduced ? 'saturate(0.7)' : undefined,
                }}
                className="pointer-events-auto"
              >
                <CardArt
                  inst={inst}
                  card={card}
                  size="hand"
                  onTap={interactive ? () => onTap(instanceId) : undefined}
                />
              </motion.div>
            );
          })}
        </div>
      </LayoutGroup>
      {/* NO count badge on the opp fan — owner rule (reaffirmed 2026-06-12
          over the addendum spec): the fan itself is the only count signal. */}
    </div>
  );
});
