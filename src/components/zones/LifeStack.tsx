// LifeStack — playmat-redesign.md §2.1.
//
// Vertical face-down card column. On the Bandai playsheet the LIFE zone is
// a tall slim gray BAND on the far-left of each player's half, full height
// of the CHARACTER + LEADER rows, with the player's life cards stacked
// inside it top-to-bottom. The cards peek by a few px so the player can
// read the count at a glance; the column itself carries the "LIFE" wordmark
// on the bottom of the band so the zone is identified even when empty.
//
// Engine truth: life cards are SECRET per CR §3-10-2 — no tap handler.
// `LifeRevealOverlay` owns the flip-to-hand animation via layoutId on the
// top card.

import { memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { NavyCardBack } from './NavyCardBack';
import { springs } from '../../lib/animationTokens';
import { useGameStore } from '../../store/game';
import type { PlayerId } from '@shared/engine/GameState';

interface LifeStackProps {
  /** Whose life pile to render. */
  playerId: PlayerId;
  /** Owner direction text — "Your" / "Opp" — for aria + the floating count
   *  chip. Defaults to "Your" if isYou, else "Opp". */
  isYou?: boolean;
}

const CARD_W = 28;
const CARD_H = 38;

export const LifeStack = memo(function LifeStack({
  playerId,
  isYou = false,
}: LifeStackProps) {
  const lifeInstanceIds = useGameStore((s) => s.state.players[playerId].life);
  const instances = useGameStore((s) => s.state.instances);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const count = lifeInstanceIds.length;
  const ownerLabel = isYou ? 'Your' : 'Opponent';

  return (
    <div
      role="region"
      aria-label={`${ownerLabel} life: ${count}`}
      className="playmat-zone playmat-zone--strong relative flex h-full w-full flex-col items-center justify-start"
      style={{
        padding: '6px 0 22px 0',
      }}
    >
      {/* Card stack — N face-down cards stacked top-to-bottom with a fixed
          10px stride so adjacent cards overlap by 28px (cardH - stride).
          Stack reads as a tight "deck" of life cards. Owner direction
          2026-05-29: variant B fan (stride 10). CR §3-10-2: secret, face-down. */}
      <div
        className="relative w-full grow"
        style={{ minWidth: CARD_W }}
      >
        {lifeInstanceIds.map((instanceId, slotIdx) => {
          const isTop = slotIdx === 0;
          // Fixed 10px stride. Up to 10 life fits within the column
          // (bottom of last card = 9 * 10 + 38 = 128px).
          const topCalc = `${slotIdx * 10}px`;
          const Wrapper = isTop ? motion.div : 'div';
          return (
            <Wrapper
              key={instanceId}
              {...(isTop ? { layoutId: instanceId, transition: spring.lifeFlip } : {})}
              style={{
                position: 'absolute',
                top: topCalc,
                left: '50%',
                transform: 'translateX(-50%)',
                width: CARD_W,
                height: CARD_H,
                // Top of pile renders on top so the layoutId card animates
                // correctly when it flies to the hand.
                zIndex: 10 + (count - slotIdx),
              }}
              aria-hidden="true"
            >
              {instances[instanceId] && (
                <NavyCardBack hideWordmark radius={3} />
              )}
            </Wrapper>
          );
        })}
        {/* Count chip — small brass pill at the top-right of the topmost
            card so the player can read remaining life without revealing
            cards. Positioned relative to the band; sits above the topmost
            card's right edge. */}
        {count > 0 && (
          <span
            data-flip-back
            className="absolute z-50 rounded-full bg-brass-canary font-display tabular text-ink-black
                       shadow-[0_1px_2px_rgba(0,0,0,0.55)] ring-[1px] ring-ink-black/55"
            style={{
              top: -6,
              left: `calc(50% + ${CARD_W / 2 - 8}px)`,
              padding: '1px 5px',
              fontSize: '0.7rem',
              lineHeight: 1.1,
            }}
            aria-hidden="true"
          >
            {count}
          </span>
        )}
      </div>
      {/* "LIFE" wordmark printed at the bottom of the band — matches the
          large block label on the Bandai cardboard playsheet. */}
      <span
        className="playmat-zone__label absolute font-display font-bold"
        style={{
          left: 0,
          right: 0,
          bottom: 5,
          textAlign: 'center',
          fontSize: 11,
          letterSpacing: '0.18em',
          color: 'var(--color-ink-iron)',
          opacity: 0.7,
        }}
        aria-hidden="true"
      >
        LIFE
      </span>
    </div>
  );
});
