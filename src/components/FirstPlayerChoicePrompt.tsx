// FirstPlayerChoicePrompt — D24 (CR §5-2-1-4) first-player declaration.
//
// Renders after DiceRollPrompt produces a non-tie outcome and the engine
// transitions to `first_player_choice`. The dice-winner declares whether to
// go first or second; the other player sees a "Waiting…" placeholder.
//
// Visibility rules:
//   - state.phase === 'first_player_choice'.
//   - Active player (the dice-winner) sees Go First / Go Second buttons.
//   - The other player sees "Waiting for opponent…" in their seat.
//
// AI cadence: if the AI is player B and won the roll, this prompt auto-fires
// CHOOSE_FIRST after 600ms so the game keeps moving. Human-as-winner makes
// the choice manually.
//
// Engine note: the engine handles the activePlayer swap on CHOOSE_SECOND.
// This component is purely the affordance + AI cadence.

import { memo, useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { springs } from '../lib/animationTokens';

const AI_DELAY_MS = 600;

export const FirstPlayerChoicePrompt = memo(function FirstPlayerChoicePrompt() {
  const phase = useGameStore((s) => s.state.phase);
  const activePlayer = useGameStore((s) => s.state.activePlayer);
  const diceRoll = useGameStore((s) => s.state.diceRoll);
  const viewAs = useGameStore((s) => s.viewAs);
  const mode = useGameStore((s) => s.mode);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const firstButtonRef = useRef<HTMLButtonElement>(null);

  const open = phase === 'first_player_choice';
  const isChooser = open && viewAs === activePlayer;

  const handleChooseFirst = useCallback(() => {
    dispatch({ type: 'CHOOSE_FIRST' });
  }, [dispatch]);

  const handleChooseSecond = useCallback(() => {
    dispatch({ type: 'CHOOSE_SECOND' });
  }, [dispatch]);

  // AI auto-choose. If the AI (player B) is the dice-winner, fire CHOOSE_FIRST
  // after a short beat. The AI always picks "go first" — it's the simple
  // baseline; a future heuristic could weigh deck strength, but Easy/Medium
  // here just commit.
  const isAiGame = mode === 'vs-easy' || mode === 'vs-medium';
  useEffect(() => {
    if (!open) return undefined;
    if (!isAiGame) return undefined;
    if (activePlayer !== 'B') return undefined; // AI is B; humans always choose for themselves
    const t = window.setTimeout(() => {
      dispatch({ type: 'CHOOSE_FIRST' });
    }, AI_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [open, isAiGame, activePlayer, dispatch]);

  // Auto-focus the "Go First" button when the chooser opens the modal.
  useEffect(() => {
    if (!isChooser) return;
    const t = window.setTimeout(() => firstButtonRef.current?.focus(), reduced ? 0 : 40);
    return () => window.clearTimeout(t);
  }, [isChooser, reduced]);

  // Per CR §5-2-1-4, the dice-roll outcome remains visible in the engine state
  // until the choice closes. Snapshot the values for the prompt body.
  const youValue = open ? (viewAs === 'A' ? diceRoll?.A : diceRoll?.B) : null;
  const oppValue = open ? (viewAs === 'A' ? diceRoll?.B : diceRoll?.A) : null;
  const youWon = open && viewAs === activePlayer;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="first-player-choice-heading"
          aria-describedby="first-player-choice-body"
          aria-live="polite"
          className="prompt-safe fixed inset-0 z-50 flex flex-col items-center justify-center
                     bg-paper-cream/95 backdrop-blur-sm px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.18 }}
        >
          <motion.h2
            id="first-player-choice-heading"
            initial={reduced ? false : { y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={spring.ribbonSwap}
            className="font-display text-[1.75rem] leading-tight text-ink-black text-center mb-2"
          >
            {youWon ? 'You won the roll!' : 'Opponent won the roll'}
          </motion.h2>

          <motion.p
            id="first-player-choice-body"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduced ? 0 : 0.1, duration: 0.2 }}
            className="max-w-[360px] text-[0.875rem] leading-snug text-ink-iron
                       text-center mb-6"
          >
            You: <span className="font-extrabold text-ink-black">{youValue ?? '?'}</span>
            {'  ·  '}
            Opp: <span className="font-extrabold text-ink-black">{oppValue ?? '?'}</span>
          </motion.p>

          {isChooser ? (
            <div className="flex items-center gap-3">
              <button
                ref={firstButtonRef}
                type="button"
                onClick={handleChooseFirst}
                className="min-h-[44px] min-w-[140px] rounded-2xl px-5 py-2
                           font-body font-extrabold uppercase tracking-wider
                           bg-seal-red text-paper-cream
                           shadow-[0_4px_12px_rgba(168,38,31,0.30)]
                           focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
              >
                Go First
              </button>
              <button
                type="button"
                onClick={handleChooseSecond}
                className="min-h-[44px] min-w-[140px] rounded-2xl px-5 py-2
                           font-body font-extrabold uppercase tracking-wider
                           bg-hull-teal text-paper-cream
                           shadow-[0_4px_12px_rgba(15,69,73,0.30)]
                           focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
              >
                Go Second
              </button>
            </div>
          ) : (
            <motion.p
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: reduced ? 0 : 0.05 }}
              className="font-display text-[1rem] uppercase tracking-[0.16em] text-ink-iron"
              role="status"
            >
              Waiting for opponent…
            </motion.p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default FirstPlayerChoicePrompt;
