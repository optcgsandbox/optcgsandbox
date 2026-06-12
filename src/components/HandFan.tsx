// HandFan — F-8E HAND STRIPS (owner 2026-06-12): the fan system is REMOVED.
// Board-first layout — both hands are flat horizontal strips anchored to
// their MAT edge, never overlapping any zone, never causing page scroll.
//
//   • YOUR hand  — readable cards (HAND × PLAYER_SCALE), side-by-side with a
//     small gap (owner: NO overlap), centered; internal horizontal snap-
//     scroll when wider than the shell. Tap → CardDetailModal (+ carousel
//     group). Anchored just below the mat's bottom edge.
//   • OPP hand   — small navy card backs (~60% of yours), straight centered
//     row just above the opp mat's top zone line, identity-free, with a
//     count pill (owner spec F-8E §1 "Keep pill/badge count").
//
// File keeps its name + data hooks (data-hand-fan / data-hidden /
// data-hand-count) so the e2e suite and mounts carry over.
//
// PLAY_CARD is dispatched ONLY from CardDetailModal's primary action.

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { springs } from '../lib/animationTokens';
import { CardArt, CARD_DIMS } from './CardArt';
import {
  MAT_BLOCK_DVH,
  MAT_BLOCK_EXTRA_PX,
  OPP_RAIL_H_PX,
} from './cardSizing';
import { NavyCardBack } from './zones/NavyCardBack';
import type { PlayerId } from '@shared/engine-v2/state/types';

/** Opp rail cards: small fixed backs (~60% of the old hand size). */
const OPP_SCALE = 0.6;
/** Side-by-side gap (owner: small gap, NO overlap). */
const GAP_PX = 6;
/** Card-to-mat margin — and, per owner 2026-06-12, the SAME margin from
 *  the card bottoms to the screen bottom. The player cards auto-size to
 *  fill everything between (bigger screens → bigger cards). */
const MARGIN_PX = 12;
/** The mats' lowest zone edges reach 24–29px past the block boundary
 *  (measured at 768/844/932/1080 heights) — 30 covers the envelope. */
const ZONE_EDGE_PX = 30;

const OPP_W = Math.round(CARD_DIMS.hand.w * OPP_SCALE); // 38
const OPP_H = Math.round(CARD_DIMS.hand.h * OPP_SCALE); // 53
const CARD_ASPECT = CARD_DIMS.hand.w / CARD_DIMS.hand.h;

interface HandFanProps {
  /** Which seat's hand to render. Defaults to viewAs. */
  playerId?: PlayerId;
  /** When true (human's seat), tapping a card opens the detail modal. */
  interactive?: boolean;
  /** Opponent mode: small face-down rail, zero identity in the DOM. */
  hidden?: boolean;
}

/** COMPACT detection (owner 2026-06-12): narrow screens — phone browsers
 *  AND installed apps — get the PWA treatment (5-back cap + "+N" pill, no
 *  count badge, label-aligned rail). Matches the index.css 520px query. */
function useIsCompact(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 520px)');
    const update = (): void => setCompact(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return compact;
}

/** PLAYER card height = the strip container's REAL rendered height minus
 *  MARGIN_PX on both sides (mat-to-hand and hand-to-safe-bottom gaps).
 *  Measured from the container box itself so PWA env() insets are
 *  automatically correct; in browsers the box equals the old window math
 *  (env()=0) — desktop numbers unchanged. */
function usePlayerCardH(ref: React.RefObject<HTMLDivElement | null>, active: boolean): number {
  const [h, setH] = useState(CARD_DIMS.hand.h);
  useEffect(() => {
    if (!active) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const update = (): void => {
      const lane = el.getBoundingClientRect().height - 2 * MARGIN_PX;
      setH(Math.max(CARD_DIMS.hand.h, Math.round(lane)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active]);
  return h;
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
      // Single tap opens the detail modal (owner 2026-05-29); the whole
      // hand is the carousel browse group (owner 2026-06-12).
      setInspectGroup(handIds);
      setInspectedCardId(instanceId);
      setCardDetailOpen(true);
    },
    [interactive, hidden, setCardDetailOpen, setInspectedCardId, setInspectGroup, handIds],
  );

  const n = handIds.length;
  // Opp rail: fixed small backs — its slot under the header is reserved by
  // the frame constants, so mat overlap is impossible by construction.
  // COMPACT (narrow screens, browser or PWA): cap at 5 visible backs +
  // a "+N" pill. Wide windows show every back. Player strip: lane-fill
  // sizing measured from the container's real box.
  const compact = useIsCompact();
  const visibleIds = hidden && compact ? handIds.slice(0, 5) : handIds;
  const overflow = n - visibleIds.length;
  const stripRef = useRef<HTMLDivElement | null>(null);
  const playerH = usePlayerCardH(stripRef, !hidden);
  const cardH = hidden ? OPP_H : playerH;
  const cardW = hidden ? OPP_W : Math.round(playerH * CARD_ASPECT);

  return (
    <div
      ref={hidden ? undefined : stripRef}
      // The strip CONTAINER spans the shell width; pointer-events-none lets
      // taps on empty strip area fall through to the playmat. Cards
      // re-enable pointer events.
      //
      // ANCHORING (board-first, owner 2026-06-12): the mats' outer zone
      // lines sit at 19dvh−15px (opp, top) and 81dvh+15px (yours, bottom);
      // each strip parks MAT_CLEAR_PX outside its line — connected to the
      // board, never overlapping a zone, never moving the board.
      // z-[48]: ON TOP of everything on the board (owner) — End Turn,
      // badges, zone chrome — under only dialogs/prompts (z-50+).
      className="pointer-events-none absolute inset-x-0 z-[48] flex justify-center"
      style={
        hidden
          ? {
              // Rail top = --frame-rail-top (index.css): wide windows keep
              // the accepted 38px; narrow screens (browser or PWA) ride
              // the OPTCGS label line (env+6). The mat follows the same
              // variable, so cost-area overlap stays impossible.
              top: 'var(--frame-rail-top)',
              height: OPP_RAIL_H_PX,
            }
          : {
              // The strip container owns the ENTIRE lane from the mat
              // block's lowest zone line to the home-bar inset — cards
              // center inside with MARGIN_PX above and below, so clipping
              // is impossible. Top mirrors the mat's frame variable.
              top: `calc(var(--frame-mat-top) + ${MAT_BLOCK_EXTRA_PX + ZONE_EDGE_PX}px + ${MAT_BLOCK_DVH}dvh)`,
              bottom: 'env(safe-area-inset-bottom, 0px)',
            }
      }
      aria-label={`${hidden ? 'Opponent' : 'Your'} hand, ${n} cards`}
      data-hand-fan
      data-hidden={hidden || undefined}
      data-hand-count={n}
    >
      {/* Horizontal strip: centered when it fits (mx-auto on the row),
          internal snap-scroll when wider than the shell — the PAGE never
          scrolls. No wrapping, no second row. */}
      <div
        className="pointer-events-auto flex max-w-full items-center overflow-x-auto overflow-y-hidden"
        style={{ scrollSnapType: 'x proximity', scrollbarWidth: 'none' }}
        data-hand-strip-scroller
      >
        <LayoutGroup>
          <div className="mx-auto flex items-center" style={{ gap: GAP_PX, padding: '0 8px' }}>
            {visibleIds.map((instanceId) => {
              const inst = instances[instanceId];
              if (!inst) return null;
              const card = library[inst.cardId];
              const isInspected = inspectedCardId === instanceId;
              const someoneElseInspected = inspectedCardId !== null && !isInspected;

              if (hidden) {
                return (
                  <motion.div
                    key={instanceId}
                    initial={{ opacity: 0, y: -24, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -24, transition: { duration: 0.2 } }}
                    transition={spring.handFan}
                    className="flex-none"
                    style={{ width: cardW, height: cardH, scrollSnapAlign: 'center' }}
                  >
                    {/* Navy deck back, NO inst/card props → zero identity
                        (ids / names / aria) reaches the DOM. */}
                    <div className="relative h-full w-full rotate-180">
                      <NavyCardBack radius={3} />
                    </div>
                  </motion.div>
                );
              }

              return (
                <motion.div
                  key={instanceId}
                  layout
                  // Draw animation: card arrives from the deck's direction
                  // (upper-right) — same feel as the fan era, strip-tuned.
                  initial={{ opacity: 0, x: 120, y: -260, scale: 0.7 }}
                  animate={{
                    opacity: someoneElseInspected ? 0.55 : 1,
                    x: 0,
                    y: isInspected ? -10 : 0,
                    scale: 1,
                  }}
                  exit={{ opacity: 0, y: 60, transition: { duration: 0.2 } }}
                  transition={spring.handFan}
                  className="flex-none"
                  style={{
                    width: cardW,
                    height: cardH,
                    scrollSnapAlign: 'center',
                    filter: someoneElseInspected && !reduced ? 'saturate(0.7)' : undefined,
                  }}
                >
                  {/* CardArt renders at the F-8C 'hand' standard; the strip
                      scales the footprint uniformly (PLAYER_SCALE × lane). */}
                  <div
                    style={{
                      transform: `scale(${cardW / CARD_DIMS.hand.w})`,
                      transformOrigin: 'top left',
                      width: CARD_DIMS.hand.w,
                      height: CARD_DIMS.hand.h,
                    }}
                  >
                    <CardArt
                      inst={inst}
                      card={card}
                      size="hand"
                      onTap={interactive ? () => onTap(instanceId) : undefined}
                    />
                  </div>
                </motion.div>
              );
            })}

            {/* PWA overflow pill: backs beyond the 5-cap collapse into
                "+N" (owner 2026-06-12). Browsers never cap → never shows. */}
            {hidden && overflow > 0 && (
              <span
                data-opp-overflow-pill
                className="flex-none self-center rounded-full bg-ink-black/75 px-2 py-1
                           font-display text-[0.6875rem] leading-none text-paper-cream tabular"
                aria-hidden="true"
              >
                +{overflow}
              </span>
            )}
          </div>
        </LayoutGroup>
      </div>

      {/* Opp hand COUNT badge — WIDE windows only. On narrow screens
          (browser or PWA) the "+N" overflow pill is the count signal AND
          the badge sat behind the hamburger (owner 2026-06-12). */}
      {hidden && n > 0 && !compact && (
        <span
          data-opp-hand-badge
          className="pointer-events-none absolute rounded-full bg-ink-black/75 px-1.5 py-0.5
                     font-display text-[0.625rem] leading-none text-paper-cream tabular"
          style={{ right: 10, top: 2 }}
          aria-hidden="true"
        >
          {n}
        </span>
      )}
    </div>
  );
});
