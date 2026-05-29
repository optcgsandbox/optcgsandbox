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
      {/* Card stack — N face-down cards (N = current life count, NOT hardcoded
          to 5) distributed evenly across the band's full available height.
          Each card's top is computed as a % of (band height - cardH) so as
          life is taken / leaders with non-5 life are rendered, the cards
          spread to fill the available space. Owner direction 2026-05-29:
          "fit the life cards in this area height" + cards = number of life
          remaining. CR §3-10-2: secret, face-down (no reveal). */}
      <div
        className="relative w-full grow"
        style={{ minWidth: CARD_W }}
      >
        {lifeInstanceIds.map((instanceId, slotIdx) => {
          const isTop = slotIdx === 0;
          const denom = Math.max(count - 1, 1);
          // Distributed top: 0% for first, (100% - cardH) for last.
          const topCalc = `calc((100% - ${CARD_H}px) * ${slotIdx} / ${denom})`;
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
