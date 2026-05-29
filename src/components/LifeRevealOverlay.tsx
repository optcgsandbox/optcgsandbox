// LifeRevealOverlay — visual-spec.md §5 component pattern.
// When a LIFE_TAKEN event fires in state.history, the lost life card is
// revealed face-up at center-screen for ~1.2s before it slides into the hand
// (engine rules-reference.md §1.6 — a taken life enters the controller's hand
// face-up, optionally activating its trigger first).
//
// Framer Motion's `layoutId` matching the card's instanceId means the eventual
// hand card and this center-screen reveal share a single shared-element
// transition — when the overlay dismisses, the card flies into its hand slot
// rather than fading out.
//
// We subscribe to state.history (append-only) and grab the most recent
// LIFE_TAKEN event we haven't shown yet. setTimeout dismisses after the
// reveal window. We do NOT mutate engine state.

import { memo, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';
import { springs } from '../lib/animationTokens';

const REVEAL_DURATION_MS = 1200;

interface RevealItem {
  /** Index into state.history we already processed. Avoids re-firing on every render. */
  eventIndex: number;
  /** instanceId of the life card to render. */
  instanceId: string;
}

export const LifeRevealOverlay = memo(function LifeRevealOverlay() {
  const history = useGameStore((s) => s.state.history);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const viewAs = useGameStore((s) => s.viewAs);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const [active, setActive] = useState<RevealItem | null>(null);
  const [lastProcessed, setLastProcessed] = useState(0);

  // Scan history for unprocessed LIFE_TAKEN events belonging to the viewer's seat.
  // Only show OUR life reveals — opponent's are private to them (the engine
  // already hides the card face from us until it reaches their hand).
  useEffect(() => {
    if (history.length <= lastProcessed) return;
    for (let i = lastProcessed; i < history.length; i++) {
      const ev = history[i];
      if (ev.type === 'LIFE_TAKEN' && ev.player === viewAs) {
        setActive({ eventIndex: i, instanceId: ev.instanceId });
        setLastProcessed(i + 1);
        return;
      }
    }
    setLastProcessed(history.length);
  }, [history, lastProcessed, viewAs]);

  // Dismiss after the reveal window. Reduced motion shortens to 200ms so the
  // shared-element transition still has a frame to land.
  useEffect(() => {
    if (!active) return;
    const duration = reduced ? 200 : REVEAL_DURATION_MS;
    const t = window.setTimeout(() => setActive(null), duration);
    return () => window.clearTimeout(t);
  }, [active, reduced]);

  const inst = active ? instances[active.instanceId] : undefined;
  const card = inst ? library[inst.cardId] : undefined;

  return (
    <AnimatePresence>
      {active && card && inst && (
        <motion.div
          // aria-atomic ensures SR announces the full label on mount instead
          // of waiting for content within the region to "change" (it doesn't
          // — AnimatePresence inserts the populated region whole). Without
          // this, the polite live region can mount silently.
          aria-live="polite"
          aria-atomic="true"
          role="status"
          aria-label={`Life revealed: ${card.name}`}
          className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.18 }}
        >
          {/* layoutId = instanceId — Framer Motion shares animation with the
              eventual hand card so the dismiss is a slide-to-hand, not a fade. */}
          <motion.div
            layoutId={inst.instanceId}
            initial={reduced ? false : { scale: 0.5, rotateY: 180, opacity: 0 }}
            animate={{ scale: 1.4, rotateY: 0, opacity: 1 }}
            transition={spring.lifeFlip}
            style={{ transformOrigin: 'center' }}
          >
            <CardArt inst={inst} card={card} size="leader" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default LifeRevealOverlay;
