// PhaseRibbon — visual-spec.md §5.6.
// Top-center pill showing current phase + whose turn. Lilita display label,
// hull-teal fill, crossfade between phase swaps. Turn chip on the trailing
// edge — brass-canary for YOU, marine-fog for OPP.

import { memo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { springs } from '../lib/animationTokens';
import type { Phase } from '@shared/engine/GameState';

const PHASE_LABEL: Record<Phase, string> = {
  refresh: 'Refresh',
  draw: 'Draw',
  don: 'DON!!',
  main: 'Main',
  attack_declaration: 'Attack',
  block_window: 'Block?',
  counter_window: 'Counter?',
  damage_resolution: 'Damage',
  end: 'End',
};

interface PhaseRibbonProps {
  /** Override the seat we consider "you". Defaults to viewAs from the store. */
  viewAs?: 'A' | 'B';
}

export const PhaseRibbon = memo(function PhaseRibbon({ viewAs }: PhaseRibbonProps) {
  const phase = useGameStore((s) => s.state.phase);
  const turnPlayer = useGameStore((s) => s.state.activePlayer);
  const seat = useGameStore((s) => viewAs ?? s.viewAs);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const isYourTurn = turnPlayer === seat;
  const label = PHASE_LABEL[phase] ?? phase;

  return (
    <div
      className="pointer-events-none flex h-full items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label={`Phase ${label}, ${isYourTurn ? 'your turn' : 'opponent turn'}`}
    >
      <div
        className="pointer-events-auto flex items-center gap-2 rounded-full
                   bg-hull-teal px-5 py-2 shadow-[0_4px_16px_rgba(15,69,73,0.30)]
                   ring-1 ring-hull-deep/30"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={phase}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={spring.ribbonSwap}
            className="font-display text-[1.25rem] leading-none text-paper-cream"
          >
            {label}
          </motion.span>
        </AnimatePresence>
        <span
          className={[
            'rounded-full px-2 py-0.5 text-[0.6875rem] font-body font-extrabold uppercase tracking-wider',
            isYourTurn
              ? 'bg-sun-brass text-ink-black'
              : 'bg-marine-fog/30 text-paper-cream',
          ].join(' ')}
        >
          {isYourTurn ? 'You' : 'Opp'}
        </span>
      </div>
    </div>
  );
});
