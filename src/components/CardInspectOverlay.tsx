// CardInspectOverlay — F-8C size C ("inspect") read-view, shared by every
// View affordance in the app (SearcherPeekPrompt / CounterPrompt /
// BlockerPrompt). Renders the card at EXACTLY the CardDetailModal
// presentation (modal art × INSPECT_SCALE = 330×462), responsive-clamped
// on small viewports. Pure read view — no action buttons; tap/Escape closes.
//
// One standard "read card" modal: if you change inspect sizing, change
// INSPECT_SCALE in CardArt.tsx — both this overlay and CardDetailModal
// derive from it.

import { memo, useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Card } from '@shared/engine-v2/cards/Card';
import type { CardInstance } from '@shared/engine-v2/state/types';
import { CardArt, CARD_DIMS } from './CardArt';
import { inspectScaleFor } from './cardSizing';

interface CardInspectOverlayProps {
  inst: CardInstance | undefined;
  card: Card | undefined;
  onClose: () => void;
}

export const CardInspectOverlay = memo(function CardInspectOverlay({
  inst,
  card,
  onClose,
}: CardInspectOverlayProps) {
  const reduced = useReducedMotion() ?? false;
  // Responsive-clamped to the live viewport (original geometry restored
  // per owner 2026-06-12 — no fixed design canvas).
  const scale = inspectScaleFor(window.innerWidth, window.innerHeight);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const open = card !== undefined;
  const w = CARD_DIMS.modal.w * scale;
  const h = CARD_DIMS.modal.h * scale;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
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
        >
          <motion.div
            data-testid="card-inspect-card"
            initial={reduced ? false : { scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: reduced ? 0.01 : 0.16 }}
            style={{
              width: w,
              height: h,
              position: 'relative',
              filter: 'drop-shadow(0 10px 28px rgba(0,0,0,0.5))',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                transformOrigin: 'top left',
                transform: `scale(${scale})`,
                width: CARD_DIMS.modal.w,
                height: CARD_DIMS.modal.h,
              }}
            >
              <CardArt inst={inst} card={card} size="modal" />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default CardInspectOverlay;
