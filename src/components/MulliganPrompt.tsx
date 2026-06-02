// MulliganPrompt — D10 (CR §5-2-1-6) mulligan window prompt.
//
// Modal that surfaces the once-per-player mulligan decision during the setup
// window. Per CR §5-2-1-6, after both players draw their opening 5 cards,
// each player MAY (in turn order, first player first) return their hand to
// the deck, reshuffle, and redraw 5. The option is consumed by either
// choice — they don't get a second look.
//
// Visibility rules (mirroring TriggerPrompt's controller-only pattern):
//   - state.phase === 'mulligan_first'  AND viewAs === activePlayer
//   - state.phase === 'mulligan_second' AND viewAs === the OTHER player
//
// AI mode (vs-easy / vs-medium): the AI is player B and auto-fires KEEP_HAND
// from the store dispatch path; the prompt only renders for the human (A).
//
// Engine note: the prompt dispatches MULLIGAN or KEEP_HAND. The engine handles
// the phase transition (mulligan_first → mulligan_second → refresh) and the
// life-card deal that closes the window per CR §5-2-1-7.

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';
import { springs } from '../lib/animationTokens';
import type { PlayerId } from '@shared/engine-v2/state/types';

export const MulliganPrompt = memo(function MulliganPrompt() {
  const phase = useGameStore((s) => s.state.phase);
  const activePlayer = useGameStore((s) => s.state.activePlayer);
  const viewAs = useGameStore((s) => s.viewAs);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const players = useGameStore((s) => s.state.players);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const mulliganRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  // WCAG 2.4.3 — restore focus when the dialog closes.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Engine-v2: activePlayer flips at mulligan_first → mulligan_second so the
  // decider IS activePlayer in BOTH windows.
  const decider: PlayerId | null = useMemo(() => {
    if (phase === 'mulligan_first' || phase === 'mulligan_second') return activePlayer;
    return null;
  }, [phase, activePlayer]);

  const open = decider !== null && decider === viewAs;
  const handIds = open ? players[viewAs].hand : [];

  // Auto-focus the KEEP button (safer default — owner can re-shuffle by tabbing).
  useEffect(() => {
    if (!open) return undefined;
    previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
    const t = window.setTimeout(() => {
      keepRef.current?.focus();
    }, reduced ? 0 : 40);
    return () => {
      window.clearTimeout(t);
      const prev = previouslyFocusedRef.current;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
      previouslyFocusedRef.current = null;
    };
  }, [open, reduced]);

  // Minimal focus trap between Mulligan and Keep buttons.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const m = mulliganRef.current;
    const k = keepRef.current;
    if (!m || !k) return;
    const focused = document.activeElement;
    if (e.shiftKey) {
      if (focused === m) {
        e.preventDefault();
        k.focus();
      }
    } else {
      if (focused === k) {
        e.preventDefault();
        m.focus();
      }
    }
  }, []);

  const handleMulligan = useCallback(() => {
    dispatch({ type: 'MULLIGAN' });
  }, [dispatch]);

  const handleKeep = useCallback(() => {
    dispatch({ type: 'KEEP_HAND' });
  }, [dispatch]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mulligan-prompt-heading"
          aria-describedby="mulligan-prompt-body"
          onKeyDown={handleKeyDown}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center
                     bg-paper-cream/95 backdrop-blur-sm px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.18 }}
        >
          <motion.h2
            id="mulligan-prompt-heading"
            initial={reduced ? false : { y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={spring.ribbonSwap}
            className="font-display text-[1.75rem] leading-tight text-ink-black text-center mb-2"
          >
            Mulligan?
          </motion.h2>

          <motion.p
            id="mulligan-prompt-body"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduced ? 0 : 0.1, duration: 0.2 }}
            className="max-w-[360px] text-[0.8125rem] leading-snug text-ink-iron
                       text-center mb-3"
          >
            Return all 5 to deck, shuffle, and redraw? You can only do this once.
          </motion.p>

          {/* Hand row — owner sees their opening 5 face-up. */}
          <motion.div
            initial={reduced ? false : { y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ ...spring.cardTravel, delay: reduced ? 0 : 0.05 }}
            className="flex items-center justify-center gap-2 mb-4"
            aria-label="Your opening hand"
          >
            {handIds.map((id) => {
              const inst = instances[id];
              if (!inst) return null;
              const card = library[inst.cardId];
              if (!card) return null;
              return (
                <div key={id}>
                  <CardArt inst={inst} card={card} size="hand" />
                </div>
              );
            })}
          </motion.div>

          <div className="flex items-center gap-3">
            <button
              ref={mulliganRef}
              type="button"
              onClick={handleMulligan}
              className="min-h-[44px] min-w-[120px] rounded-2xl px-5 py-2
                         font-body font-extrabold uppercase tracking-wider
                         bg-seal-red text-paper-cream
                         shadow-[0_4px_12px_rgba(168,38,31,0.30)]
                         focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
            >
              Mulligan
            </button>
            <button
              ref={keepRef}
              type="button"
              onClick={handleKeep}
              className="min-h-[44px] min-w-[120px] rounded-2xl px-5 py-2
                         font-body font-extrabold uppercase tracking-wider
                         bg-hull-teal text-paper-cream
                         shadow-[0_4px_12px_rgba(15,69,73,0.30)]
                         focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
            >
              Keep
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default MulliganPrompt;
