// AttackResolutionOverlay — visual-spec.md §5.7.
// Fullscreen modal during Damage Step. Attacker left, defender right,
// brass-canary "VS" glyph center. Counter window shows a countdown ring
// (visual only — actual timer logic lives in the engine).

import { memo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';
import { springs } from '../lib/animationTokens';
import type { CardInstance } from '@shared/engine-v2/state/types';

interface AttackResolutionOverlayProps {
  /** Show even when no pendingAttack exists (storybook / preview). Default false. */
  forceShow?: boolean;
  /** Optional callback for the "PASS" button — defaults to dispatching SKIP_COUNTER. */
  onPass?: () => void;
}

function findInstance(
  instances: Record<string, CardInstance>,
  id: string | undefined,
): CardInstance | undefined {
  if (!id) return undefined;
  return instances[id];
}

export const AttackResolutionOverlay = memo(function AttackResolutionOverlay({
  forceShow,
  onPass,
}: AttackResolutionOverlayProps) {
  const pending = useGameStore((s) =>
    s.state.pending?.kind === 'attack' ? s.state.pending.pendingAttack : null,
  );
  const phase = useGameStore((s) => s.state.phase);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const players = useGameStore((s) => s.state.players);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const isCounterWindow = phase === 'counter_window' || phase === 'block_window';
  const open = !!forceShow || (!!pending && isCounterWindow);

  const attackerInst = findInstance(instances, pending?.attackerInstanceId);
  const defenderInst = findInstance(instances, pending?.targetInstanceId);
  const attackerCard = attackerInst ? library[attackerInst.cardId] : undefined;
  const defenderCard = defenderInst ? library[defenderInst.cardId] : undefined;
  // Live life counts for the leader pills shown at 1.4× — visual-spec-layout-correction.md §E.2.
  // Pull from each side's PlayerZones rather than the printed card.life.
  const attackerLife = attackerInst ? players[attackerInst.controller].life.length : undefined;
  const defenderLife = defenderInst ? players[defenderInst.controller].life.length : undefined;

  const counterBoost = pending?.counterBoost ?? 0;

  const handlePass = () => {
    if (onPass) return onPass();
    dispatch(phase === 'block_window' ? { type: 'SKIP_BLOCKER' } : { type: 'SKIP_COUNTER' });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Attack resolution"
          className="fixed inset-0 z-40 flex flex-col items-center justify-center
                     bg-paper-cream/95 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.18 }}
        >
          <div className="flex w-full max-w-[430px] items-center justify-between gap-3 px-4">
            <motion.div
              initial={{ x: -40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={spring.cardTravel}
              className="flex flex-col items-center gap-2"
              style={{ transform: 'scale(1.4)', transformOrigin: 'center' }}
            >
              {attackerCard && (
                <CardArt
                  inst={attackerInst}
                  card={attackerCard}
                  size="leader"
                  liveLifeCount={attackerLife}
                />
              )}
              <span className="text-[0.6875rem] font-body font-extrabold uppercase tracking-wider text-ink-iron">
                Attacker
              </span>
            </motion.div>

            <motion.div
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...spring.cardTravel, delay: reduced ? 0 : 0.08 }}
              className="flex flex-col items-center"
            >
              <span
                className="font-display text-[2.5rem] leading-none text-sun-brass
                           drop-shadow-[0_2px_8px_rgba(232,180,61,0.45)]"
                aria-hidden="true"
              >
                VS
              </span>
              {counterBoost > 0 && (
                <span className="mt-1 rounded-full bg-hull-teal px-2 py-0.5 text-[0.6875rem] font-body font-extrabold uppercase tracking-wider text-paper-cream">
                  +{counterBoost} counter
                </span>
              )}
            </motion.div>

            <motion.div
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={spring.cardTravel}
              className="flex flex-col items-center gap-2"
              style={{ transform: 'scale(1.4)', transformOrigin: 'center' }}
            >
              {defenderCard && (
                <CardArt
                  inst={defenderInst}
                  card={defenderCard}
                  size="leader"
                  liveLifeCount={defenderLife}
                />
              )}
              <span className="text-[0.6875rem] font-body font-extrabold uppercase tracking-wider text-ink-iron">
                Defender
              </span>
            </motion.div>
          </div>

          {/* Countdown ring — purely decorative; engine owns timing. */}
          {!reduced && (
            <motion.div
              className="mt-10 h-10 w-10"
              aria-hidden="true"
              initial={{ rotate: 0 }}
              animate={{ rotate: 360 }}
              transition={{ duration: 8, ease: 'linear' }}
            >
              <svg viewBox="0 0 40 40" className="h-full w-full">
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  fill="none"
                  stroke="var(--color-marine-fog)"
                  strokeWidth="3"
                  opacity="0.4"
                />
                <motion.circle
                  cx="20"
                  cy="20"
                  r="16"
                  fill="none"
                  stroke="var(--color-seal-red)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 16}
                  initial={{ strokeDashoffset: 0 }}
                  animate={{ strokeDashoffset: 2 * Math.PI * 16 }}
                  transition={{ duration: 8, ease: 'linear' }}
                  transform="rotate(-90 20 20)"
                />
              </svg>
            </motion.div>
          )}

          <button
            type="button"
            onClick={handlePass}
            aria-label={phase === 'block_window' ? 'Decline Blocker' : 'Decline Counter'}
            className="fixed bottom-6 right-6 min-h-[44px] min-w-[64px] rounded-2xl
                       bg-hull-teal px-5 py-2 font-body font-extrabold uppercase
                       tracking-wider text-paper-cream shadow-[0_4px_12px_rgba(15,69,73,0.30)]
                       focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
          >
            {phase === 'block_window' ? 'Decline Blocker' : 'Decline Counter'}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
