// HandFan — visual-spec.md §5.4.
// Distributes cards along a shallow arc anchored at the bottom of the screen.
// originY:1 so each card pivots from its bottom edge (anchored fan).
// LayoutGroup so adding/removing cards re-fans smoothly instead of popping.

import { memo, useCallback } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { fanPosition } from '../lib/fanLayout';
import { springs } from '../lib/animationTokens';
import { CardArt, CARD_DIMS } from './CardArt';
import type { PlayerId } from '@shared/engine/GameState';

interface HandFanProps {
  /** Which seat's hand to render. Defaults to viewAs. */
  playerId?: PlayerId;
  /** When true (humans's seat), tapping a card dispatches PLAY_CARD. */
  interactive?: boolean;
}

export const HandFan = memo(function HandFan({ playerId, interactive = true }: HandFanProps) {
  const seat = useGameStore((s) => playerId ?? s.viewAs);
  const handIds = useGameStore((s) => s.state.players[seat].hand);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const onTap = useCallback(
    (instanceId: string) => {
      if (!interactive) return;
      dispatch({ type: 'PLAY_CARD', instanceId, replaceTargetId: null });
    },
    [dispatch, interactive],
  );

  const n = handIds.length;
  // Card height drives the fan's footprint; tallest reveal sits at the center.
  const cardH = CARD_DIMS.hand.h;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-end justify-center"
      style={{
        // Reserve at least the card height + arc lift; safe-area inset added below.
        height: `calc(${cardH + 24}px + env(safe-area-inset-bottom, 0px))`,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      aria-label={`${interactive ? 'Your' : 'Opponent'} hand, ${n} cards`}
    >
      <LayoutGroup>
        <div className="relative" style={{ width: 1, height: cardH }}>
          {handIds.map((instanceId, i) => {
            const inst = instances[instanceId];
            if (!inst) return null;
            const card = library[inst.cardId];
            const { x, y, rotate } = fanPosition(i, n);
            return (
              <motion.div
                key={instanceId}
                layout
                initial={{ opacity: 0, y: 60 }}
                animate={{ opacity: 1, x, y: -y, rotate }}
                exit={{ opacity: 0, y: 80, transition: { duration: 0.2 } }}
                transition={spring.handFan}
                style={{
                  position: 'absolute',
                  left: -CARD_DIMS.hand.w / 2,
                  bottom: 0,
                  transformOrigin: '50% 100%',
                }}
                className="pointer-events-auto"
              >
                <CardArt
                  inst={inst}
                  card={card}
                  size="hand"
                  onTap={interactive ? () => onTap(instanceId) : undefined}
                />
              </motion.div>
            );
          })}
        </div>
      </LayoutGroup>
    </div>
  );
});
