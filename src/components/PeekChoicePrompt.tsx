// PeekChoicePrompt — V3-3 (CR §10-1-3-1).
//
// Mounts when `state.phase === 'peek_choice'` and `viewAs` is the controller
// of the pending peek. Shows the peeked cards as a grid; tap a card to
// add it to hand (RESOLVE_PEEK). SKIP button returns everything to deck.
// AI-controlled peeks are auto-resolved by HardAi.simulateAction before
// the engine ever lands in peek_choice for an AI seat, so this UI only
// renders when YOU are the controller.

import { memo, useCallback } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';

export const PeekChoicePrompt = memo(function PeekChoicePrompt() {
  const phase = useGameStore((s) => s.state.phase);
  const pendingPeek = useGameStore((s) => s.state.pendingPeek);
  const viewAs = useGameStore((s) => s.viewAs);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;

  const open =
    phase === 'peek_choice' && pendingPeek !== null && pendingPeek.controller === viewAs;

  const onPick = useCallback(
    (instanceId: string) => {
      dispatch({ type: 'RESOLVE_PEEK', instanceIds: [instanceId] });
    },
    [dispatch],
  );

  const onSkip = useCallback(() => {
    dispatch({ type: 'SKIP_PEEK' });
  }, [dispatch]);

  return (
    <AnimatePresence>
      {open && pendingPeek && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="peek-prompt-heading"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center
                     bg-paper-cream/95 backdrop-blur-sm px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.18 }}
        >
          <h2
            id="peek-prompt-heading"
            className="font-display text-[1.75rem] leading-tight text-ink-black text-center mb-2"
          >
            Look at top {pendingPeek.peekedIds.length}
          </h2>
          <p className="max-w-[360px] text-[0.8125rem] leading-snug text-ink-iron text-center mb-6">
            Pick up to {pendingPeek.addCount} card{pendingPeek.addCount > 1 ? 's' : ''} to add to your hand.
            The rest go back to your deck, shuffled.
          </p>

          <div className="flex flex-wrap gap-3 justify-center mb-6 max-w-[400px]">
            {pendingPeek.peekedIds.map((id) => {
              const inst = instances[id];
              if (!inst) return null;
              const card = library[inst.cardId];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onPick(id)}
                  aria-label={`Add ${card?.name ?? 'card'} to hand`}
                  className="focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none rounded-[3px]"
                >
                  <CardArt inst={inst} card={card} size="hand" />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onSkip}
            className="min-h-[44px] min-w-[140px] rounded-2xl px-5 py-2
                       font-body font-extrabold uppercase tracking-wider
                       bg-hull-teal text-paper-cream text-[0.875rem]
                       shadow-[0_4px_12px_rgba(15,69,73,0.30)]
                       focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
          >
            Skip — none
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default PeekChoicePrompt;
