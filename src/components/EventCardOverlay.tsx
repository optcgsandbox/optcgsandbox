// EventCardOverlay — visual-spec.md §5 component pattern.
// When a CARD_PLAYED event fires in state.history and the played card is an
// event (Card.kind === 'event'), we briefly reveal it center-screen at large
// scale with its effect text, then collapse via a Framer Motion shared-element
// transition into the trash zone (engine rules-reference.md §1.5 — event cards
// resolve their effect, then go to the trash).
//
// Same pattern as LifeRevealOverlay: subscribe to state.history (append-only),
// track lastProcessed index to avoid re-firing on every render, and use
// `layoutId={instanceId}` so the dismiss is a shared-element flight to the
// trash slot rather than a fade.
//
// Engine state is NEVER mutated — this overlay is purely presentational.

import { memo, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';
import { springs } from '../lib/animationTokens';

const REVEAL_DURATION_MS = 1500;

interface RevealItem {
  /** Index into state.history we already processed. Avoids re-firing on every render. */
  eventIndex: number;
  /** instanceId of the event card to render. */
  instanceId: string;
}

export const EventCardOverlay = memo(function EventCardOverlay() {
  const history = useGameStore((s) => s.state.history);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const [active, setActive] = useState<RevealItem | null>(null);
  const [lastProcessed, setLastProcessed] = useState(0);

  // Scan history for unprocessed CARD_PLAYED events where the played card is
  // an event. Both players see it — events resolve publicly per the rules.
  useEffect(() => {
    if (history.length <= lastProcessed) return;
    for (let i = lastProcessed; i < history.length; i++) {
      const ev = history[i];
      if (ev.type !== 'CARD_PLAYED') continue;
      const inst = instances[ev.instanceId];
      if (!inst) continue;
      const card = library[inst.cardId];
      if (!card || card.kind !== 'event') continue;
      setActive({ eventIndex: i, instanceId: ev.instanceId });
      setLastProcessed(i + 1);
      return;
    }
    setLastProcessed(history.length);
  }, [history, lastProcessed, instances, library]);

  // Dismiss after the reveal window. Reduced motion shortens to 200ms so the
  // shared-element transition to trash still has a frame to land.
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
          aria-live="polite"
          aria-label={`Event played: ${card.name}`}
          className="pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.18 }}
        >
          {/* layoutId = instanceId — Framer Motion shares animation with the
              eventual trash card so the dismiss is a slide-to-trash, not a fade. */}
          <motion.div
            layoutId={inst.instanceId}
            initial={reduced ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1.4, opacity: 1 }}
            transition={spring.cardTravel}
            style={{ transformOrigin: 'center' }}
          >
            <CardArt inst={inst} card={card} size="leader" />
          </motion.div>

          {card.effectText && (
            <motion.p
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduced ? 0 : 0.18, duration: 0.2 }}
              className="mt-4 max-w-[360px] rounded-xl bg-paper-fog/80 px-3 py-2
                         text-[0.8125rem] leading-snug text-ink-black text-center
                         ring-1 ring-marine-fog/40"
            >
              {card.effectText}
            </motion.p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default EventCardOverlay;
