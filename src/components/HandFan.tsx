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
import { createPortal } from 'react-dom';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useGameStore } from '../store/game';
import { springs } from '../lib/animationTokens';
import { CardArt, CARD_DIMS } from './CardArt';
import {
  OPP_RAIL_H_PX,
} from './cardSizing';
import { NavyCardBack } from './zones/NavyCardBack';
import type { Card } from '@shared/engine-v2/cards/Card';
import type { CardInstance, PlayerId } from '@shared/engine-v2/state/types';

/** Opp rail cards: small fixed backs (~60% of the old hand size). */
const OPP_SCALE = 0.6;
/** Side-by-side gap (owner: small gap, NO overlap). */
const GAP_PX = 6;
/** Card-to-mat margin — and, per owner 2026-06-12, the SAME margin from
 *  the card bottoms to the screen bottom. The player cards auto-size to
 *  fill everything between (bigger screens → bigger cards). */
const MARGIN_PX = 12;

const OPP_W = Math.round(CARD_DIMS.hand.w * OPP_SCALE); // 38
const OPP_H = Math.round(CARD_DIMS.hand.h * OPP_SCALE); // 53
const CARD_ASPECT = CARD_DIMS.hand.w / CARD_DIMS.hand.h;

/** Inline @dnd-kit/modifiers `restrictToHorizontalAxis` (avoids the extra
 *  dependency) — the hand is a single horizontal row, so the dragged card
 *  must never move vertically (owner 2026-06-13). */
const restrictToHorizontalAxis = ({
  transform,
}: {
  transform: { x: number; y: number; scaleX: number; scaleY: number };
}) => ({ ...transform, y: 0 });

interface HandFanProps {
  /** Which seat's hand to render. Defaults to viewAs. */
  playerId?: PlayerId;
  /** When true (human's seat), tapping a card opens the detail modal. */
  interactive?: boolean;
  /** Opponent mode: small face-down rail, zero identity in the DOM. */
  hidden?: boolean;
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
    let raf = 0;
    const measure = (): void => {
      // Inside the emergency shrink-fit shell (windows <710px tall) rects
      // come back pre-scaled; divide by the scale so sizing stays in
      // design px. s=1 everywhere else — identical numbers.
      const shell = el.closest('[data-shrink-scale]');
      const s = Number(shell?.getAttribute('data-shrink-scale') ?? '1') || 1;
      const lane = el.getBoundingClientRect().height / s - 2 * MARGIN_PX;
      setH(Math.max(CARD_DIMS.hand.h, Math.round(lane)));
    };
    // Re-measure on the NEXT frame too — a resize/orientation change (e.g.
    // resizing during mulligan) leaves the dvh-driven strip lane settling a
    // frame later; a single synchronous read captured the stale (too-tall)
    // height and the dealt cards overflowed the strip + got clipped by
    // overflow-y-hidden (owner 2026-06-12: "where the fuck are my cards").
    const update = (): void => {
      measure();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // ResizeObserver alone proved unreliable across dvh recalcs — back it
    // with an explicit window-resize listener so the lane always re-measures.
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      cancelAnimationFrame(raf);
    };
  }, [ref, active]);
  return h;
}

/** Session-local hand order (owner 2026-06-12: drag-to-reorder). The engine
 *  hand array stays the source of truth (draw order); this is a PURELY VISUAL
 *  overlay. Reconciles every time the store hand changes: keeps the player's
 *  manual order for cards still in hand, appends freshly-drawn cards at the
 *  end (in store order), and drops cards that left the hand (played/discarded).
 *  No engine/rules effect. */
function useHandOrder(handIds: ReadonlyArray<string>): [string[], (next: string[]) => void] {
  const [order, setOrder] = useState<string[]>(() => [...handIds]);
  // Reconcile DURING RENDER (the React-blessed "adjust state while rendering"
  // pattern) — not in an effect, which triggers cascading-render setState.
  // Keyed on the store hand so this only runs when the hand actually changes.
  const key = handIds.join(',');
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    const handSet = new Set(handIds);
    const prevSet = new Set(order);
    const kept = order.filter((id) => handSet.has(id)); // manual order, minus removed
    const added = handIds.filter((id) => !prevSet.has(id)); // new draws appended
    const reconciled = [...kept, ...added];
    setOrder(reconciled);
    return [reconciled, setOrder]; // return the fresh order this render — no stale frame
  }
  return [order, setOrder];
}

/** The visual card body (scaled CardArt). Shared by the sortable item and the
 *  DragOverlay so the lifted card looks identical to its slot. */
function HandCardBody({
  inst,
  card,
  cardW,
  onTap,
}: {
  inst: CardInstance;
  card: Card | undefined;
  cardW: number;
  onTap?: () => void;
}) {
  return (
    <div
      style={{
        transform: `scale(${cardW / CARD_DIMS.hand.w})`,
        transformOrigin: 'top left',
        width: CARD_DIMS.hand.w,
        height: CARD_DIMS.hand.h,
      }}
    >
      {/* disableLayout: hand cards must NOT use framer's shared-layout
          (layoutId) — it fights dnd-kit's reorder transform → spazz
          (owner 2026-06-13). */}
      <CardArt inst={inst} card={card} size="hand" onTap={onTap} disableLayout />
    </div>
  );
}

interface SortableHandCardProps {
  id: string;
  inst: CardInstance;
  card: Card | undefined;
  cardW: number;
  cardH: number;
  someoneElseInspected: boolean;
  reduced: boolean;
  interactive: boolean;
  /** True while ANY card in the hand is being dragged — suspends this card's
   *  scroll-snap so it can't fight the reorder (owner 2026-06-13). */
  dragging: boolean;
  onOpen: (id: string) => void;
}

/** One sortable hand card (owner 2026-06-12, dnd-kit). The drag only ARMS
 *  after the pointer moves 8px (DndContext sensor) — so a tap (<8px) stays a
 *  plain click → CardArt's button opens the detail; a drag never fires a
 *  click, so the modal can't open mid/after drag. While this card is the one
 *  being dragged it's hidden (opacity 0); the DragOverlay shows the moving
 *  copy that follows the pointer (smooth, scroll-safe). */
const SortableHandCard = memo(function SortableHandCard({
  id,
  inst,
  card,
  cardW,
  cardH,
  someoneElseInspected,
  reduced,
  interactive,
  dragging,
  onOpen,
}: SortableHandCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="relative flex-none cursor-grab select-none active:cursor-grabbing"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        width: cardW,
        height: cardH,
        // Snap suspended during any drag (owner 2026-06-13) so it can't fight
        // the reorder; restores when the drag ends.
        scrollSnapAlign: dragging ? undefined : 'center',
        // pan-x (owner 2026-06-13): a quick touch swipe scrolls the strip;
        // the TouchSensor's long-press (200ms) is what starts a reorder, so
        // the two don't fight. Desktop is unaffected (mouse ignores this).
        touchAction: 'pan-x',
        opacity: isDragging ? 0 : someoneElseInspected ? 0.55 : 1,
        filter: someoneElseInspected && !reduced ? 'saturate(0.7)' : undefined,
      }}
    >
      <HandCardBody
        inst={inst}
        card={card}
        cardW={cardW}
        onTap={interactive ? () => onOpen(id) : undefined}
      />
    </div>
  );
});

export const HandFan = memo(function HandFan({ playerId, interactive = true, hidden = false }: HandFanProps) {
  const seat = useGameStore((s) => playerId ?? s.viewAs);
  const handIds = useGameStore((s) => s.state.players[seat].hand);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const inspectedCardId = useGameStore((s) => s.inspectedCardId);
  const openCardDetail = useGameStore((s) => s.openCardDetail);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  // Drag-to-reorder (owner 2026-06-12) — YOUR hand only. Visual order overlay
  // on top of the engine hand; see useHandOrder. The carousel group + render
  // use this order so the detail browse order matches what's on screen.
  const [orderedIds, setOrderedIds] = useHandOrder(handIds);

  const onTap = useCallback(
    (instanceId: string) => {
      if (!interactive || hidden) return;
      // Single tap opens the detail modal (owner 2026-05-29) in ONE atomic
      // store write so the playmat-clear click (PlayfieldStage onPlaymatTap →
      // setInspectedCardId(null) → cardDetailOpen:false) can't race it shut.
      // dnd-kit's 8px activation guarantees a drag never produces this click,
      // so the modal can't open mid-drag. Group = visual order.
      openCardDetail(instanceId, orderedIds);
    },
    [interactive, hidden, openCardDetail, orderedIds],
  );

  // dnd-kit drag-to-reorder (owner 2026-06-12). PointerSensor with an 8px
  // activation distance = the clean tap-vs-drag separation; a tap stays a
  // click, a drag never clicks. arrayMove on drop.
  // Split sensors (owner 2026-06-13): DESKTOP = instant drag after 8px move;
  // MOBILE = long-press (~200ms hold) to pick a card up, so a quick touch
  // swipe scrolls the strip instead of reordering (cards are touch-action:
  // pan-x below). Both keep tap-to-open (a tap never reaches activation).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const onDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);
  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const from = orderedIds.indexOf(String(active.id));
      const to = orderedIds.indexOf(String(over.id));
      if (from === -1 || to === -1) return;
      setOrderedIds(arrayMove(orderedIds, from, to));
    },
    [orderedIds, setOrderedIds],
  );

  const n = handIds.length;
  // Opp rail: fixed small backs — its slot under the header is reserved by
  // the frame constants, so mat overlap is impossible by construction.
  // Unified across browser / PWA / desktop (owner 2026-06-12): cap opp
  // hand at 5 visible backs + a "+N" pill — the pill is the sole count
  // signal. Player strip: lane-fill sizing measured from the container's
  // real box.
  const visibleIds = hidden ? handIds.slice(0, 5) : handIds;
  const overflow = n - visibleIds.length;
  const stripRef = useRef<HTMLDivElement | null>(null);
  const playerH = usePlayerCardH(stripRef, !hidden);
  const cardH = hidden ? OPP_H : playerH;

  // Hand-strip overflow arrows (owner 2026-06-12): when the strip scrolls,
  // ‹ › overlays page card-by-card; each arrow shows only while more
  // cards exist in that direction (mirrors the inspect-carousel arrows).
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  useEffect(() => {
    if (hidden) return undefined;
    const el = scrollerRef.current;
    if (!el) return undefined;
    const update = (): void => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      // Only re-render when an arrow actually flips — a per-frame setState
      // here re-rendered the strip DURING native scrolling and made the
      // framer layout animations fight it (cards jumped mid-scroll).
      setCanScroll((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [hidden, n]);
  const pageBy = useCallback(
    (dir: 1 | -1) => {
      const step = Math.round(playerH * CARD_ASPECT) + GAP_PX;
      scrollerRef.current?.scrollBy({ left: dir * step, behavior: 'smooth' });
    },
    [playerH],
  );
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
              // block's bottom to the home-bar inset — cards center inside
              // with MARGIN_PX above and below, so clipping is impossible.
              // Anchored to the SAME --mat-block-h the rows derive from
              // (UX-architect 2026-06-12) so the strip can never drift
              // from the mat when the row clamps engage. Algebraically
              // identical to the previous formula when no clamp engages:
              // frame + (62dvh + 24px gaps + 6px contact) + 6px.
              top: 'calc(var(--frame-mat-top) + var(--mat-block-h) + 6px)',
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
        ref={hidden ? undefined : scrollerRef}
        className="pointer-events-auto flex max-w-full items-center overflow-x-auto overflow-y-hidden"
        // Scroll-snap is SUSPENDED during a drag (owner 2026-06-13): snap was
        // fighting the reorder → jitter. It restores on drop. (layoutScroll
        // removed — no framer layout in the hand anymore.)
        style={{ scrollSnapType: activeId ? 'none' : 'x proximity', scrollbarWidth: 'none' }}
        data-hand-strip-scroller
      >
        {hidden ? (
          // OPPONENT rail — fixed navy backs (+ "+N" pill on compact). No
          // reordering: identity-free, not interactive.
          <LayoutGroup>
            <div className="mx-auto flex items-center" style={{ gap: GAP_PX, padding: '0 8px' }}>
              {visibleIds.map((instanceId) => (
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
                      (ids / names / aria) reaches the DOM. Upright — the
                      ONE PIECE logo reads right-side up (owner 2026-06-12). */}
                  <div className="relative h-full w-full">
                    <NavyCardBack radius={3} />
                  </div>
                </motion.div>
              ))}
              {overflow > 0 && (
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
        ) : (
          // YOUR hand — drag-to-reorder via dnd-kit (owner 2026-06-12). The
          // dragged card lifts into a DragOverlay (follows the pointer,
          // doesn't fight the scroll → no glitch); the 8px activation distance
          // separates tap (click → open) from drag (reorder, never clicks).
          <DndContext
            sensors={sensors}
            // pointerWithin: resolve the drop target by the POINTER position,
            // not a computed dragged-rect — closestCenter mis-measured on the
            // overflowing/scaled strip and sent every card to the end (owner
            // 2026-06-13).
            collisionDetection={pointerWithin}
            // Auto-scroll the strip when a card is dragged to its left/right
            // edge (owner 2026-06-13). Horizontal-only (y:0). Safe now that
            // CSS scroll-snap is SUSPENDED during a drag (the snap↔autoscroll
            // fight was the earlier violent loop).
            autoScroll={{ threshold: { x: 0.2, y: 0 } }}
            modifiers={[restrictToHorizontalAxis]}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <SortableContext items={orderedIds} strategy={horizontalListSortingStrategy}>
              <div className="mx-auto flex items-center" style={{ gap: GAP_PX, padding: '0 8px' }}>
                {orderedIds.map((instanceId) => {
                  const inst = instances[instanceId];
                  if (!inst) return null;
                  const card = library[inst.cardId];
                  const someoneElseInspected =
                    inspectedCardId !== null && inspectedCardId !== instanceId;
                  return (
                    <SortableHandCard
                      key={instanceId}
                      id={instanceId}
                      inst={inst}
                      card={card}
                      cardW={cardW}
                      cardH={cardH}
                      someoneElseInspected={someoneElseInspected}
                      reduced={reduced}
                      interactive={interactive}
                      dragging={activeId !== null}
                      onOpen={onTap}
                    />
                  );
                })}
              </div>
            </SortableContext>
            {/* The lifted card — follows the pointer. PORTALED to <body> so
                it escapes the board's perspective container + the strip's
                overflow:hidden, which were clipping it out of view during the
                drag (owner 2026-06-13: "card disappears during drag"). */}
            {createPortal(
              <DragOverlay>
                {activeId && instances[activeId] ? (
                  <div
                    className="relative"
                    style={{ width: cardW, height: cardH, cursor: 'grabbing' }}
                  >
                    <HandCardBody
                      inst={instances[activeId]}
                      card={library[instances[activeId].cardId]}
                      cardW={cardW}
                    />
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )}
          </DndContext>
        )}
      </div>

      {/* Hand-strip overflow arrows (owner 2026-06-12): page the strip
          card-by-card; each side renders only while more cards exist in
          that direction. Same visual language as the inspect carousel. */}
      {!hidden && canScroll.left && (
        <button
          type="button"
          aria-label="Scroll hand left"
          data-hand-strip-prev
          onClick={() => pageBy(-1)}
          className="pointer-events-auto absolute left-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2
                     items-center justify-center rounded-full bg-ink-black/70 text-[1.1rem]
                     leading-none text-paper-cream
                     focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
        >
          ‹
        </button>
      )}
      {!hidden && canScroll.right && (
        <button
          type="button"
          aria-label="Scroll hand right"
          data-hand-strip-next
          onClick={() => pageBy(1)}
          className="pointer-events-auto absolute right-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2
                     items-center justify-center rounded-full bg-ink-black/70 text-[1.1rem]
                     leading-none text-paper-cream
                     focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
        >
          ›
        </button>
      )}

    </div>
  );
});
