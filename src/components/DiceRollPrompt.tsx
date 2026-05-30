// DiceRollPrompt — D24 (CR §5-2-1-4) dice-roll first-player decision.
//
// Modal that surfaces the opening-game d6 roll. Per CR §5-2-1-4, before the
// mulligan window each player rolls a die; the high roller chooses turn order.
// Ties re-roll until a winner is produced.
//
// Visibility rules:
//   - state.phase === 'dice_roll'.
//   - In hot-seat the modal shows for whoever's "seat" is currently viewAs —
//     either player may fire ROLL_DICE.
//   - In vs-AI (vs-easy / vs-medium) the human (player A) sees the modal and
//     dispatches ROLL_DICE manually; the AI auto-rolls only as the secondary
//     actor when the game starts (handled by the parent store's auto-fire
//     side-effect — see the useEffect in this component for AI cadence).
//
// Animation: dice icons spin for 1.2s then settle on their face values. The
// winner gets a brass-canary ring. Tie surfaces a "Roll again" button.
// Reduced-motion users see snap-in values with no spin.
//
// Engine note: the engine handles atomic d6 rolling and phase transition;
// this prompt is purely the affordance. After a winner is produced, this
// prompt UNMOUNTS (phase advances to 'first_player_choice') and the
// FirstPlayerChoicePrompt takes over.

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { springs } from '../lib/animationTokens';

const SPIN_MS = 1200;
const AI_DELAY_MS = 600;

/** Single die face — value 1..6 rendered as a pip pattern. Returns an array of
 *  9 booleans (3×3 grid) indicating which positions show a pip. */
function pipsForFace(face: number): boolean[] {
  // Positions: 0 1 2
  //            3 4 5
  //            6 7 8
  switch (face) {
    case 1: return [false, false, false, false, true, false, false, false, false];
    case 2: return [true, false, false, false, false, false, false, false, true];
    case 3: return [true, false, false, false, true, false, false, false, true];
    case 4: return [true, false, true, false, false, false, true, false, true];
    case 5: return [true, false, true, false, true, false, true, false, true];
    case 6: return [true, false, true, true, false, true, true, false, true];
    default: return [false, false, false, false, false, false, false, false, false];
  }
}

function DieFace({
  value,
  spinning,
  highlighted,
  label,
}: {
  value: number | null;
  spinning: boolean;
  highlighted: boolean;
  label: string;
}) {
  const pips = value !== null ? pipsForFace(value) : pipsForFace(1);
  return (
    <motion.div
      className="flex flex-col items-center"
      animate={spinning ? { rotate: [0, 360, 720, 1080] } : { rotate: 0 }}
      transition={spinning ? { duration: SPIN_MS / 1000, ease: 'easeOut' } : { duration: 0.2 }}
    >
      <div
        aria-label={`${label} die showing ${value ?? '?'}`}
        role="img"
        className={`relative grid h-20 w-20 grid-cols-3 grid-rows-3 gap-1 rounded-xl bg-paper-cream
                    p-2 shadow-[0_4px_12px_rgba(0,0,0,0.18)]
                    ${highlighted
                      ? 'ring-[3px] ring-brass-canary shadow-[0_0_18px_rgba(232,180,61,0.55)]'
                      : 'ring-1 ring-ink-iron/20'}`}
      >
        {pips.map((on, i) => (
          <span
            key={i}
            className={`m-auto h-2 w-2 rounded-full ${on ? 'bg-ink-black' : 'bg-transparent'}`}
            aria-hidden="true"
          />
        ))}
      </div>
      <span className="mt-2 font-display text-[0.75rem] uppercase tracking-[0.18em] text-ink-iron">
        {label}
      </span>
    </motion.div>
  );
}

export const DiceRollPrompt = memo(function DiceRollPrompt() {
  const phase = useGameStore((s) => s.state.phase);
  const diceRoll = useGameStore((s) => s.state.diceRoll);
  const mode = useGameStore((s) => s.mode);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  // Local UI state: theatre flow is "click Roll → spin 1.2s → dispatch
  // ROLL_DICE → engine settles dice values + advances phase → modal
  // unmounts (winner) OR re-armed (tie)". Dispatch is delayed to the END of
  // the spin so the dice icons remain spinning during the dramatic beat;
  // the engine values populate the moment the dispatch resolves.
  const [spinning, setSpinning] = useState(false);
  const rollButtonRef = useRef<HTMLButtonElement>(null);

  const open = phase === 'dice_roll';
  const rollsCount = diceRoll?.rolls ?? 0;

  const handleRoll = useCallback(() => {
    if (spinning) return;
    setSpinning(true);
    window.setTimeout(() => {
      dispatch({ type: 'ROLL_DICE' });
      setSpinning(false);
    }, reduced ? 0 : SPIN_MS);
  }, [dispatch, reduced, spinning]);

  // AI auto-roll cadence (vs-easy / vs-medium).
  // The AI is player B. On entering dice_roll the AI auto-fires the same
  // theatre sequence after a 600ms beat — so both humans and AI see the
  // spin. On a tie, `rollsCount` ticks but `open` stays true, re-triggering
  // this effect for the next roll.
  const isAiGame = mode === 'vs-easy' || mode === 'vs-medium';
  useEffect(() => {
    if (!open) return undefined;
    if (!isAiGame) return undefined;
    if (spinning) return undefined; // wait for prior spin to finish before re-rolling
    const t = window.setTimeout(() => handleRoll(), AI_DELAY_MS);
    return () => window.clearTimeout(t);
    // Depend on rollsCount so each tie schedules a fresh roll.
  }, [open, isAiGame, rollsCount, spinning, handleRoll]);

  // Auto-focus the Roll button when the modal opens.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => rollButtonRef.current?.focus(), reduced ? 0 : 40);
    return () => window.clearTimeout(t);
  }, [open, reduced]);

  // After a settled non-tie, the engine has already transitioned out of
  // dice_roll → first_player_choice. The modal unmounts via `open` going
  // false on the next render.
  const aValue = diceRoll?.A ?? null;
  const bValue = diceRoll?.B ?? null;
  const showValues = rollsCount > 0;
  const isTie = showValues && aValue !== null && bValue !== null && aValue === bValue;
  const winner: 'A' | 'B' | null = !isTie && aValue !== null && bValue !== null
    ? (aValue > bValue ? 'A' : 'B')
    : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dice-roll-prompt-heading"
          aria-describedby="dice-roll-prompt-body"
          aria-live="polite"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center
                     bg-paper-cream/95 backdrop-blur-sm px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.18 }}
        >
          <motion.h2
            id="dice-roll-prompt-heading"
            initial={reduced ? false : { y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={spring.ribbonSwap}
            className="font-display text-[1.75rem] leading-tight text-ink-black text-center mb-2"
          >
            Roll for First Player
          </motion.h2>

          <motion.p
            id="dice-roll-prompt-body"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduced ? 0 : 0.1, duration: 0.2 }}
            className="max-w-[360px] text-[0.8125rem] leading-snug text-ink-iron
                       text-center mb-6"
          >
            High roll chooses to go first or second. Ties re-roll.
          </motion.p>

          <div className="flex items-center justify-center gap-10 mb-8">
            <DieFace
              value={aValue}
              spinning={spinning}
              highlighted={!spinning && winner === 'A'}
              label="You"
            />
            <DieFace
              value={bValue}
              spinning={spinning}
              highlighted={!spinning && winner === 'B'}
              label="Opp"
            />
          </div>

          {!spinning && isTie && (
            <motion.p
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="font-display text-[1rem] uppercase tracking-[0.16em] text-seal-red mb-4"
              role="status"
            >
              Tie! Roll again.
            </motion.p>
          )}

          <button
            ref={rollButtonRef}
            type="button"
            onClick={handleRoll}
            disabled={spinning}
            aria-busy={spinning}
            aria-label={showValues && isTie ? 'Roll dice again' : 'Roll dice'}
            className="min-h-[44px] min-w-[160px] rounded-2xl px-6 py-2
                       font-body font-extrabold uppercase tracking-wider
                       bg-seal-red text-paper-cream
                       shadow-[0_4px_12px_rgba(168,38,31,0.30)]
                       focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none
                       disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {spinning ? 'Rolling…' : (showValues && isTie ? 'Roll again' : 'Roll Dice')}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default DiceRollPrompt;
