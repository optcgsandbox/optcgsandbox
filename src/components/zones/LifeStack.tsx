// LifeStack — design-reference.md §3.4 L1.
// Vertical face-down column on the FAR LEFT of the playmat, full height of
// the player's half. 5 (or fewer) card-shaped slots stacked top-to-bottom
// with a 4px overlap, matching the official Bandai OPTCG playsheet. The
// card count IS the readout — no numeric badge on the stack itself. Top
// card animates a flip-to-hand when life is taken; until then, all cards
// render face-down.
//
// Source of truth = `instances` (each life card has its own CardInstance.id),
// so we layoutId the top card and Framer Motion can animate it to the hand row.

import { memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CardArt, CARD_DIMS } from '../CardArt';
import { springs } from '../../lib/animationTokens';
import { useGameStore } from '../../store/game';
import type { PlayerId } from '@shared/engine/GameState';

interface LifeStackProps {
  /** Whose life pile to render. */
  playerId: PlayerId;
  /** Vertical stack offset between cards (px). Falls back to CSS token at 4px. */
  offsetPx?: number;
  /** When true, render WITHOUT the "Life" micro-label (used inside the dedicated
   *  far-left column where the column itself is labeled). Default false. */
  hideLabel?: boolean;
}

/**
 * 5-card vertical stack (or fewer if life has been taken).
 * Spec: stack offset 4px per card downward; top card has highest z; max 5.
 * Empty state: dashed marine-fog/30 outline of the same container size.
 */
export const LifeStack = memo(function LifeStack({ playerId, offsetPx = 4, hideLabel = false }: LifeStackProps) {
  const lifeInstanceIds = useGameStore((s) => s.state.players[playerId].life);
  const instances = useGameStore((s) => s.state.instances);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const cardW = CARD_DIMS.lifeStack.w;
  const cardH = CARD_DIMS.lifeStack.h;
  const count = lifeInstanceIds.length;

  // Container holds up to 5 stacked cards. Total stack height = cardH + 4*offset.
  const containerH = cardH + 4 * offsetPx;

  if (count === 0) {
    return (
      <div
        role="region"
        aria-label={`${playerId === 'A' ? 'Your' : 'Opponent'} life: 0`}
        className="flex flex-col items-center justify-center"
        style={{ width: cardW, minWidth: cardW }}
      >
        <div
          className="rounded-md border border-dashed border-marine-fog/40"
          style={{ width: cardW, height: cardH }}
          aria-hidden="true"
        />
        {!hideLabel && (
          /* WCAG 1.4.3 — was text-ink-iron/70 on paper-cream (~3.1:1). Solid ink-iron is ~10.5:1. */
          <span className="mt-1 text-[0.55rem] font-body font-extrabold uppercase tracking-wider text-ink-iron">
            Life
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label={`${playerId === 'A' ? 'Your' : 'Opponent'} life: ${count}`}
      className="flex flex-col items-center"
      style={{ width: cardW, minWidth: cardW }}
    >
      <div className="relative" style={{ width: cardW, height: containerH }}>
        {lifeInstanceIds.map((instanceId, i) => {
          const inst = instances[instanceId];
          if (!inst) return null;
          // Top card = index 0 in the life array, gets the highest z. Each
          // subsequent card slides 4px down.
          const top = i * offsetPx;
          const z = count - i;
          return (
            <motion.div
              key={instanceId}
              layoutId={instanceId}
              transition={spring.lifeFlip}
              style={{
                position: 'absolute',
                top,
                left: 0,
                zIndex: z,
              }}
            >
              <CardArt inst={inst} size="lifeStack" faceDown />
            </motion.div>
          );
        })}
      </div>
      {!hideLabel && (
        /* WCAG 1.4.3 — was text-ink-iron/80 on paper-cream (~4.0:1). Solid ink-iron is ~10.5:1. */
        <span className="mt-1 text-[0.55rem] font-body font-extrabold uppercase tracking-wider text-ink-iron">
          Life
        </span>
      )}
    </div>
  );
});
