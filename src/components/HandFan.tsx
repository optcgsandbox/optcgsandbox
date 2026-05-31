// HandFan — visual-design-spec.md §3.
// Mobile-tuned fan that distributes 1–10 cards along a shallow arc inside the
// 398px inner playmat width. Cards pivot from their bottom-center.
//
// Interaction (replaces the old immediate-PLAY behavior):
//   • Tap a resting card        → setInspectedCardId(thatId) (card lifts)
//   • Tap the lifted card again → setCardDetailOpen(true) (opens CardDetailModal)
//   • Tap a different card      → switch lift to the new card
//   • Tap outside any card      → clearing handled by App-level listener
//
// PLAY_CARD is now dispatched ONLY from CardDetailModal's primary action.

import { memo, useCallback } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { fanPosition, HAND_CARD_W, HAND_CARD_H } from '../lib/fanLayout';
import { springs } from '../lib/animationTokens';
import { CardArt } from './CardArt';
import type { PlayerId } from '@shared/engine/GameState';

interface HandFanProps {
  /** Which seat's hand to render. Defaults to viewAs. */
  playerId?: PlayerId;
  /** When true (human's seat), tapping a card lifts it / opens the modal. */
  interactive?: boolean;
}

export const HandFan = memo(function HandFan({ playerId, interactive = true }: HandFanProps) {
  const seat = useGameStore((s) => playerId ?? s.viewAs);
  const handIds = useGameStore((s) => s.state.players[seat].hand);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const inspectedCardId = useGameStore((s) => s.inspectedCardId);
  const setInspectedCardId = useGameStore((s) => s.setInspectedCardId);
  const setCardDetailOpen = useGameStore((s) => s.setCardDetailOpen);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const onTap = useCallback(
    (instanceId: string) => {
      if (!interactive) return;
      // Owner direction 2026-05-29: single tap opens detail modal directly.
      // The two-step lift-then-tap-again was too small to read on a phone.
      setInspectedCardId(instanceId);
      setCardDetailOpen(true);
    },
    [interactive, setCardDetailOpen, setInspectedCardId],
  );

  const n = handIds.length;

  return (
    <div
      // pointer-events-none lets the container pass clicks through to the
      // playmat (which clears inspectedCardId at App level). Individual cards
      // re-enable pointer events.
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-end justify-center"
      style={{
        // Reserve card height + apex lift + buffer for the lifted state.
        height: `calc(${HAND_CARD_H + 80}px + env(safe-area-inset-bottom, 0px))`,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      aria-label={`${interactive ? 'Your' : 'Opponent'} hand, ${n} cards`}
      data-hand-fan
    >
      <LayoutGroup>
        <div className="relative" style={{ width: 1, height: HAND_CARD_H }}>
          {handIds.map((instanceId, i) => {
            const inst = instances[instanceId];
            if (!inst) return null;
            const card = library[inst.cardId];
            const fan = fanPosition(i, n);
            const isInspected = inspectedCardId === instanceId;
            const someoneElseInspected =
              inspectedCardId !== null && !isInspected;

            // visual-design-spec.md §3.5 lift override.
            const animate = isInspected
              ? { x: fan.x, y: -60, rotate: 0, scale: 1.15, opacity: 1 }
              : {
                  x: fan.x,
                  y: fan.y,
                  rotate: fan.rotate,
                  scale: 1,
                  opacity: someoneElseInspected ? 0.5 : 1,
                };

            return (
              <motion.div
                key={instanceId}
                layout
                // Owner direction 2026-05-30: card draw comes from the DECK
                // (upper-right of LEADER row), not from below the fan.
                // x: +190 places the mount near the deck slot's screen x;
                // y: -330 lifts it to the deck row; scale: 0.7 + rotate -8
                // give a "card pulled from pile" feel before it settles
                // into its fan slot.
                initial={{ opacity: 0, x: 190, y: -330, scale: 0.7, rotate: -8 }}
                animate={animate}
                exit={{ opacity: 0, y: 80, transition: { duration: 0.2 } }}
                transition={spring.handFan}
                style={{
                  position: 'absolute',
                  left: -HAND_CARD_W / 2,
                  bottom: 0,
                  transformOrigin: '50% 100%',
                  zIndex: isInspected ? 40 : 20 + i,
                  filter:
                    someoneElseInspected && !reduced ? 'saturate(0.7)' : undefined,
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
