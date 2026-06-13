// CardInspectOverlay — F-8C size C ("inspect") read-view, shared by every
// View affordance in the app (SearcherPeekPrompt / CounterPrompt /
// BlockerPrompt). Renders the card at EXACTLY the CardDetailModal
// presentation (modal art × INSPECT_SCALE = 330×462), responsive-clamped
// on small viewports. Pure read view — no action buttons; tap/Escape closes.
//
// One standard "read card" modal: if you change inspect sizing, change
// INSPECT_SCALE in CardArt.tsx — both this overlay and CardDetailModal
// derive from it.

import { memo, useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useOverlayBox } from '../hooks/useOverlayBox';
import type { Card } from '@shared/engine-v2/cards/Card';
import type { CardInstance } from '@shared/engine-v2/state/types';
import { CardArt, CARD_DIMS } from './CardArt';
import { inspectScaleFor } from './cardSizing';
import { CarouselNav } from './InspectCarousel';
import {
  type InspectGroup,
  useCarouselKeys,
  useCarouselSwipe,
} from '../lib/inspectCarousel';

interface CardInspectOverlayProps {
  inst: CardInstance | undefined;
  card: Card | undefined;
  onClose: () => void;
  /** Optional carousel context (owner 2026-06-12): when present and >1 id,
   *  arrows/counter/keys/swipe browse the group without closing. */
  group?: InspectGroup;
}

export const CardInspectOverlay = memo(function CardInspectOverlay({
  inst,
  card,
  onClose,
  group,
}: CardInspectOverlayProps) {
  const reduced = useReducedMotion() ?? false;
  // Overlay-fit (owner 2026-06-12): clamp to the overlay's REAL logical
  // box (shell-aware, resize-reactive) instead of the window — inside the
  // shrink-fit shell the window overstates the available space. Window
  // values remain the first-frame fallback before the ref mounts.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const box = useOverlayBox(rootRef);
  const scale =
    box.w > 0 && box.h > 0
      ? inspectScaleFor(box.w, box.h)
      : inspectScaleFor(window.innerWidth, window.innerHeight);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useCarouselKeys(group);
  const swipe = useCarouselSwipe(group);
  // Slide direction: compare the incoming index to the last one shown.
  const lastIndexRef = useRef(group ? group.ids.indexOf(group.currentId) : 0);
  const curIndex = group ? group.ids.indexOf(group.currentId) : 0;
  const dir = curIndex >= lastIndexRef.current ? 1 : -1;
  useEffect(() => {
    lastIndexRef.current = curIndex;
  }, [curIndex]);

  const open = card !== undefined;
  const w = CARD_DIMS.modal.w * scale;
  const h = CARD_DIMS.modal.h * scale;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={rootRef}
          role="button"
          tabIndex={0}
          aria-label={`Close ${card?.name ?? 'card'} view`}
          data-testid="card-inspect-overlay"
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClose();
            }
          }}
          className="fixed inset-0 z-[80] flex items-center justify-center
                     bg-ink-black/75 backdrop-blur-sm cursor-zoom-out"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduced ? undefined : { opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.15 }}
          {...swipe}
        >
          {/* Fixed-size frame — the slide animation happens INSIDE it so
              the modal footprint never resizes during navigation. */}
          <div
            data-testid="card-inspect-card"
            style={{
              width: w,
              height: h,
              position: 'relative',
              filter: 'drop-shadow(0 10px 28px rgba(0,0,0,0.5))',
            }}
          >
            <AnimatePresence mode="popLayout" custom={dir} initial={false}>
              <motion.div
                key={inst?.instanceId ?? card?.id ?? 'card'}
                initial={reduced ? false : { x: 60 * dir, opacity: 0, scale: 0.96 }}
                animate={{ x: 0, opacity: 1, scale: 1 }}
                exit={reduced ? undefined : { x: -60 * dir, opacity: 0, scale: 0.96 }}
                transition={{ duration: reduced ? 0.01 : 0.16 }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  transformOrigin: 'top left',
                }}
              >
                <div
                  style={{
                    transformOrigin: 'top left',
                    transform: `scale(${scale})`,
                    width: CARD_DIMS.modal.w,
                    height: CARD_DIMS.modal.h,
                  }}
                >
                  <CardArt inst={inst} card={card} size="modal" />
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
          {group && <CarouselNav group={group} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default CardInspectOverlay;
