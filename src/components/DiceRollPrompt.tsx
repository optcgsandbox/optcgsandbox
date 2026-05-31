// DiceRollPrompt — D24 (CR §5-2-1-4) dice-roll first-player decision.
//
// V0 is single-player vs AI. Human (player A) presses YOU; the AI auto-rolls
// AFTER the human has rolled, with a 600ms beat to keep the dramatic pacing.
// Future remote MP: each socket dispatches `{ player: <theirId> }` from their
// own client; this prompt only ever surfaces a button for the seat whose
// slot is currently null.
//
// Visibility rules:
//   - state.phase === 'dice_roll'.
//   - Only YOU renders; OPP shows "AI is rolling…" once it's the AI's turn
//     to fire, or stays blank waiting on YOU first.
//
// Animation: the die being rolled spins for 1.2s then settles on its face
// value. The other die holds its current state. Once both slots are filled,
// the winning die gets a brass-canary ring (briefly visible before the modal
// unmounts on the phase advance). Reduced-motion users see snap-in values
// with no spin.
//
// Engine note: the engine handles per-player slot assignment + tie reset +
// phase transition; this prompt is purely the affordance + theatre. After a
// winner is produced, this prompt UNMOUNTS (phase advances to
// 'first_player_choice') and the FirstPlayerChoicePrompt takes over.

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { springs } from '../lib/animationTokens';
import type { PlayerId } from '@shared/engine/GameState';

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
  const viewAs = useGameStore((s) => s.viewAs);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const open = phase === 'dice_roll';
  // V0 is always a vs-AI game (vs-easy / vs-medium / vs-hard); kept as a
  // boolean for symmetry + future MP gating.
  const isAiGame = mode === 'vs-easy' || mode === 'vs-medium' || mode === 'vs-hard';
  void mode;

  // Theatre flow per side: clicking the YOU button kicks off a 1.2s spin;
  // at the end of the spin the dispatch fires and the engine populates that
  // slot. The AI's spin is driven independently by the effect below.
  const [spinningSide, setSpinningSide] = useState<PlayerId | null>(null);
  const youButtonRef = useRef<HTMLButtonElement>(null);

  // Seat mapping: from the viewer's perspective YOU is `viewAs` and OPP is
  // the other player. In vs-AI viewAs is always 'A', so YOU = A, OPP = B.
  const youPlayer: PlayerId = viewAs;
  const oppPlayer: PlayerId = viewAs === 'A' ? 'B' : 'A';

  const youValue = diceRoll?.[youPlayer] ?? null;
  const oppValue = diceRoll?.[oppPlayer] ?? null;
  const youSpinning = spinningSide === youPlayer;
  const oppSpinning = spinningSide === oppPlayer;

  // Buttons enable on null slot + not already spinning that side. The OPP
  // button is hidden entirely — the AI rolls itself.
  const youEnabled = open && youValue === null && !youSpinning;

  // Round-close detection: when both slots are non-null briefly (before the
  // engine transitions to first_player_choice or resets on tie), the modal
  // shows a "Tie!" status. Otherwise the winner die gets highlighted on
  // round close — but that happens in the same tick as the phase advance
  // so the user mainly sees it via FirstPlayerChoicePrompt's recap.
  const bothFilled = youValue !== null && oppValue !== null;
  const isTie = bothFilled && youValue === oppValue;

  const rollFor = useCallback(
    (player: PlayerId) => {
      if (spinningSide) return; // serialize spins to keep theatre coherent
      setSpinningSide(player);
      window.setTimeout(
        () => {
          dispatch({ type: 'ROLL_DICE', player });
          setSpinningSide(null);
        },
        reduced ? 0 : SPIN_MS,
      );
    },
    [dispatch, reduced, spinningSide],
  );

  const handleRollYou = useCallback(() => rollFor(youPlayer), [rollFor, youPlayer]);

  // vs-AI: the AI only rolls AFTER the human has rolled. Trigger condition is
  // strictly local to the engine state — `diceRoll.A !== null && diceRoll.B
  // === null` (or the symmetric case if a future build flips seats). The
  // 600ms beat gives the human a moment to register their own roll settling.
  //
  // On a tie the engine resets both slots back to null; this effect then
  // pauses (human re-presses YOU first) until the human rolls again, after
  // which the same condition re-fires for the AI.
  useEffect(() => {
    if (!open) return undefined;
    if (!isAiGame) return undefined;
    if (spinningSide) return undefined; // wait for any spin to finish
    // Human (A) has rolled, AI (B) has not → schedule AI roll.
    const humanSlot = diceRoll?.A ?? null;
    const aiSlot = diceRoll?.B ?? null;
    if (humanSlot === null) return undefined;
    if (aiSlot !== null) return undefined;
    const t = window.setTimeout(() => rollFor('B'), AI_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [open, isAiGame, spinningSide, diceRoll, rollFor]);

  // Auto-focus the YOU roll button when the modal opens (and re-focus after
  // a tie clears the slots).
  useEffect(() => {
    if (!open) return;
    if (!youEnabled) return;
    const t = window.setTimeout(() => youButtonRef.current?.focus(), reduced ? 0 : 40);
    return () => window.clearTimeout(t);
  }, [open, youEnabled, reduced]);

  // Highlight winner ring briefly on round close (before phase advance
  // unmounts the modal).
  const youWon = bothFilled && !isTie && youValue! > oppValue!;
  const oppWon = bothFilled && !isTie && oppValue! > youValue!;

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

          <div className="flex items-start justify-center gap-10 mb-6">
            {/* YOU side */}
            <div className="flex flex-col items-center gap-3">
              <DieFace
                value={youValue}
                spinning={youSpinning}
                highlighted={!youSpinning && youWon}
                label="You"
              />
              <button
                ref={youButtonRef}
                type="button"
                onClick={handleRollYou}
                disabled={!youEnabled}
                aria-busy={youSpinning}
                aria-label={youSpinning ? 'Rolling your die' : 'Roll your die'}
                className="min-h-[44px] min-w-[120px] rounded-2xl px-5 py-2
                           font-body font-extrabold uppercase tracking-wider
                           bg-seal-red text-paper-cream text-[0.875rem]
                           shadow-[0_4px_12px_rgba(168,38,31,0.30)]
                           focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none
                           disabled:opacity-40 disabled:cursor-not-allowed
                           disabled:shadow-none"
              >
                {youSpinning ? 'Rolling…' : youValue !== null ? 'Rolled' : 'Roll'}
              </button>
            </div>

            {/* OPP side */}
            <div className="flex flex-col items-center gap-3">
              <DieFace
                value={oppValue}
                spinning={oppSpinning}
                highlighted={!oppSpinning && oppWon}
                label="Opp"
              />
              <span
                className="min-h-[44px] min-w-[120px] flex items-center justify-center
                           font-display text-[0.75rem] uppercase tracking-[0.16em]
                           text-ink-iron px-2 text-center"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {oppSpinning
                  ? 'AI is rolling…'
                  : oppValue !== null
                    ? 'Rolled'
                    : 'Waiting…'}
              </span>
            </div>
          </div>

          {isTie && (
            <motion.p
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="font-display text-[1rem] uppercase tracking-[0.16em] text-seal-red"
              role="status"
            >
              Tie! Roll again.
            </motion.p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default DiceRollPrompt;
