// DiscardChoicePrompt — V3-4.
//
// Mounts when `state.phase === 'discard_choice'` and `viewAs` is the
// controller of the pending discard. Shows the revealed opponent hand;
// tap a card to discard it (RESOLVE_DISCARD).

import { memo, useCallback } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';

export const DiscardChoicePrompt = memo(function DiscardChoicePrompt() {
  const phase = useGameStore((s) => s.state.phase);
  const pendingDiscard = useGameStore((s) => s.state.pendingDiscard);
  const viewAs = useGameStore((s) => s.viewAs);
  const players = useGameStore((s) => s.state.players);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;

  const open =
    phase === 'discard_choice' &&
    pendingDiscard !== null &&
    pendingDiscard.controller === viewAs;

  const onPick = useCallback(
    (instanceId: string) => {
      dispatch({ type: 'RESOLVE_DISCARD', instanceId });
    },
    [dispatch],
  );

  if (!open || !pendingDiscard) return null;
  const oppHand = players[pendingDiscard.revealedFrom].hand;

  return (
    <AnimatePresence>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="discard-prompt-heading"
        className="fixed inset-0 z-50 flex flex-col items-center justify-center
                   bg-paper-cream/95 backdrop-blur-sm px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0.01 : 0.18 }}
      >
        <h2
          id="discard-prompt-heading"
          className="font-display text-[1.75rem] leading-tight text-ink-black text-center mb-2"
        >
          Discard 1 from opponent
        </h2>
        <p className="max-w-[360px] text-[0.8125rem] leading-snug text-ink-iron text-center mb-6">
          Their hand is revealed. Pick one card to send to their trash.
        </p>

        <div className="flex flex-wrap gap-3 justify-center mb-6 max-w-[400px]">
          {oppHand.map((id) => {
            const inst = instances[id];
            if (!inst) return null;
            const card = library[inst.cardId];
            return (
              <button
                key={id}
                type="button"
                onClick={() => onPick(id)}
                aria-label={`Discard ${card?.name ?? 'card'}`}
                className="focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none rounded-[3px]"
              >
                <CardArt inst={inst} card={card} size="hand" />
              </button>
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
});

export default DiscardChoicePrompt;
