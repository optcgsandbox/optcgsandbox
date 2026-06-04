// DiceRollPrompt — D24 (CR §5-2-1-4) dice-roll first-player decision.
//
// Rolls are INDEPENDENT per seat:
//   - AI auto-rolls on its own timer the moment the modal opens — not gated
//     on the human's roll. (Owner direction 2026-06-03.)
//   - PvP: both players have roll buttons that can fire concurrently.
//   - Spins run in parallel — no cross-seat serialization.
//
// Visibility rules:
//   - state.phase === 'dice_roll'.
//   - YOU renders a roll button until the YOU slot is filled.
//   - OPP renders a roll button in PvP mode; in vs-AI mode it shows
//     "AI is rolling…" / "Rolled" status.
//
// Tie behavior:
//   - On tie, the engine increments `diceRoll.rolls` and nulls both slots.
//   - We watch that increment and hold a 1500ms "TIE — rolling again"
//     overlay before re-enabling roll buttons + AI's next auto-roll.
//   - Without the overlay the tie message would only flash for one frame
//     because the engine reset clears the slots instantly. (Owner direction
//     2026-06-03.)
//
// Animation: the rolling die spins for 1.2s then settles on its face value.
// Once both slots are filled, the winning die gets a brass-canary ring
// (briefly visible before the modal unmounts on the phase advance).
// Reduced-motion users see snap-in values with no spin.
//
// Engine note: the engine handles per-player slot assignment + tie reset +
// phase transition; this prompt is purely the affordance + theatre. After a
// winner is produced, this prompt UNMOUNTS (phase advances to
// 'first_player_choice') and the FirstPlayerChoicePrompt takes over.

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { springs } from '../lib/animationTokens';
import type { PlayerId } from '@shared/engine-v2/state/types';

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
  const isAiGame = mode === 'vs-easy' || mode === 'vs-medium' || mode === 'vs-hard';
  void mode;

  // Spinning is tracked per-seat so YOU and OPP can spin concurrently.
  // (Owner direction 2026-06-03: rolls must be independent per seat.)
  const [spinningSides, setSpinningSides] = useState<ReadonlySet<PlayerId>>(
    () => new Set(),
  );
  const youButtonRef = useRef<HTMLButtonElement>(null);

  // Seat mapping: from the viewer's perspective YOU is `viewAs` and OPP is
  // the other player. In vs-AI viewAs is always 'A', so YOU = A, OPP = B.
  const youPlayer: PlayerId = viewAs;
  const oppPlayer: PlayerId = viewAs === 'A' ? 'B' : 'A';

  const youValue = diceRoll?.[youPlayer] ?? null;
  const oppValue = diceRoll?.[oppPlayer] ?? null;
  const youSpinning = spinningSides.has(youPlayer);
  const oppSpinning = spinningSides.has(oppPlayer);

  // Tie-hold overlay: the engine instantly nulls both slots on tie + bumps
  // `diceRoll.rolls`. Without holding the UI, the "Tie!" message would only
  // appear for a single frame. We watch the increment and freeze a 1500ms
  // overlay before re-enabling roll buttons + AI's next auto-roll.
  const rollsCount = diceRoll?.rolls ?? 0;
  const prevRollsCountRef = useRef(rollsCount);
  const [tieDisplaying, setTieDisplaying] = useState(false);
  useEffect(() => {
    if (rollsCount > prevRollsCountRef.current) {
      prevRollsCountRef.current = rollsCount;
      setTieDisplaying(true);
      const t = window.setTimeout(
        () => setTieDisplaying(false),
        reduced ? 0 : 1500,
      );
      return () => window.clearTimeout(t);
    }
    prevRollsCountRef.current = rollsCount;
    return undefined;
  }, [rollsCount, reduced]);

  // Buttons enable on null slot, not already spinning, and not while a tie
  // is being displayed. OPP renders as a button in PvP mode (non-AI); in
  // vs-AI mode OPP is the AI and shows status text instead.
  const youEnabled = open && youValue === null && !youSpinning && !tieDisplaying;
  const oppEnabled =
    open && !isAiGame && oppValue === null && !oppSpinning && !tieDisplaying;

  const bothFilled = youValue !== null && oppValue !== null;
  const isTie =
    (bothFilled && youValue === oppValue) || tieDisplaying;

  const rollFor = useCallback(
    (player: PlayerId) => {
      // Button-disable gates (`youEnabled` / `oppEnabled`) already block
      // double-clicks while spinning. Engine's `setup.ts:56` is also
      // idempotent — ROLL_DICE on a filled slot returns state unchanged.
      // So we don't need a sync dedup check (a prior one mis-used React
      // state updater side effects, which run async — `didStart` was
      // always false at the sync check and the dispatch never fired,
      // leaving both dice stuck on "Rolling…").
      setSpinningSides((prev) => {
        if (prev.has(player)) return prev;
        const next = new Set(prev);
        next.add(player);
        return next;
      });
      window.setTimeout(
        () => {
          dispatch({ type: 'ROLL_DICE', player });
          setSpinningSides((prev) => {
            if (!prev.has(player)) return prev;
            const next = new Set(prev);
            next.delete(player);
            return next;
          });
        },
        reduced ? 0 : SPIN_MS,
      );
    },
    [dispatch, reduced],
  );

  const handleRollYou = useCallback(() => rollFor(youPlayer), [rollFor, youPlayer]);
  const handleRollOpp = useCallback(() => rollFor(oppPlayer), [rollFor, oppPlayer]);

  // vs-AI: the AI rolls on its OWN timer, independent of the human. As soon
  // as the modal opens (or after a tie reset), schedule the AI's roll with a
  // short 600ms beat so both dice land within ~2s of each other but neither
  // waits for the other. (Owner direction 2026-06-03.)
  useEffect(() => {
    if (!open) return undefined;
    if (!isAiGame) return undefined;
    if (tieDisplaying) return undefined; // hold during tie overlay
    if (spinningSides.has('B')) return undefined; // already spinning
    if ((diceRoll?.B ?? null) !== null) return undefined; // already rolled
    const t = window.setTimeout(() => rollFor('B'), AI_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [open, isAiGame, tieDisplaying, spinningSides, diceRoll, rollFor]);

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
  const youWon =
    bothFilled && !tieDisplaying && youValue !== oppValue && youValue! > oppValue!;
  const oppWon =
    bothFilled && !tieDisplaying && youValue !== oppValue && oppValue! > youValue!;

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

            {/* OPP side — button in PvP mode, status text in vs-AI mode. */}
            <div className="flex flex-col items-center gap-3">
              <DieFace
                value={oppValue}
                spinning={oppSpinning}
                highlighted={!oppSpinning && oppWon}
                label="Opp"
              />
              {isAiGame ? (
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
              ) : (
                <button
                  type="button"
                  onClick={handleRollOpp}
                  disabled={!oppEnabled}
                  aria-busy={oppSpinning}
                  aria-label={oppSpinning ? "Rolling opponent's die" : "Roll opponent's die"}
                  className="min-h-[44px] min-w-[120px] rounded-2xl px-5 py-2
                             font-body font-extrabold uppercase tracking-wider
                             bg-hull-teal text-paper-cream text-[0.875rem]
                             shadow-[0_4px_12px_rgba(15,69,73,0.30)]
                             focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none
                             disabled:opacity-40 disabled:cursor-not-allowed
                             disabled:shadow-none"
                >
                  {oppSpinning ? 'Rolling…' : oppValue !== null ? 'Rolled' : 'Roll'}
                </button>
              )}
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
              Tie! Rolling again…
            </motion.p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default DiceRollPrompt;
