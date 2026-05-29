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
import { CARD_DIMS } from '../CardArt';
import { NavyCardBack } from './NavyCardBack';
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

  // Per owner reference 2026-05-29: real cards stacked physically with a
  // small downward offset per card so each card's top edge peeks above the
  // one in front. Same dimensions as before — no layout-bumping.
  const containerH = cardH + Math.max(0, count - 1) * offsetPx;

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
        {/* Real cards stacked physically — each life card is a full navy
            card-back; subsequent cards sit ${offsetPx}px lower than the one
            above so the back edges peek out below. The TOP card (index 0)
            sits on top with the highest z. Per CR §3-10-2 the life area is
            SECRET — no tap handler, no reveal until LIFE_TAKEN.
            (Top card uses layoutId so LifeRevealOverlay can do its
            shared-element fly-to-hand transition.) */}
        {lifeInstanceIds.map((instanceId, i) => {
          const isTop = i === 0;
          const Wrapper = isTop ? motion.div : 'div';
          return (
            <Wrapper
              key={instanceId}
              {...(isTop ? { layoutId: instanceId, transition: spring.lifeFlip } : {})}
              style={{
                position: 'absolute',
                top: i * offsetPx,
                left: 0,
                width: cardW,
                height: cardH,
                zIndex: count - i,
              }}
              aria-hidden="true"
            >
              {instances[instanceId] && <NavyCardBack />}
            </Wrapper>
          );
        })}
        {/* Count badge — brass numeral overlay on the top card so the player
            can read remaining life at a glance. */}
        <span
          className="absolute -top-1 -right-1 z-50 rounded-full bg-brass-canary px-1.5 py-px
                     font-display tabular text-[0.7rem] leading-none text-ink-black
                     shadow-[0_1px_3px_rgba(15,20,15,0.45)]
                     ring-1 ring-ink-black/30"
          aria-hidden="true"
        >
          {count}
        </span>
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
