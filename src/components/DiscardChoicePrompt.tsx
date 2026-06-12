// DiscardChoicePrompt — V3-4.
//
// Mounts when `state.phase === 'discard_choice'` and `viewAs` is the
// controller of the pending discard. Shows the revealed opponent hand;
// tap a card to discard it (RESOLVE_DISCARD).

import { memo, useCallback, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';
import { CardInspectOverlay } from './CardInspectOverlay';

export const DiscardChoicePrompt = memo(function DiscardChoicePrompt() {
  const phase = useGameStore((s) => s.state.phase);
  const pendingDiscard = useGameStore((s) =>
    s.state.pending?.kind === 'discard' ? s.state.pending.pendingDiscard : null,
  );
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
      dispatch({ type: 'RESOLVE_DISCARD', pickedId: instanceId });
    },
    [dispatch],
  );

  // F-8D inspect-everywhere — read any revealed card before discarding it.
  const [inspectId, setInspectId] = useState<string | null>(null);

  if (!open || !pendingDiscard) return null;
  const inspectInst = inspectId !== null ? instances[inspectId] : undefined;
  const inspectCard = inspectInst ? library[inspectInst.cardId] : undefined;
  // V2 revealedFrom: 'self_hand' (active player picks own hand) or 'opp_hand'.
  const handSide = pendingDiscard.revealedFrom === 'self_hand'
    ? pendingDiscard.controller
    : (pendingDiscard.controller === 'A' ? 'B' : 'A');
  const oppHand = players[handSide].hand;

  return (
    <AnimatePresence>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="discard-prompt-heading"
        data-pending-kind="discard"
        className="fixed inset-0 z-[70] flex flex-col items-center justify-center
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
              <div
                key={id}
                role="button"
                tabIndex={0}
                onClick={() => onPick(id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPick(id);
                  }
                }}
                aria-label={`Discard ${card?.name ?? 'card'}`}
                className="cursor-pointer focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none rounded-[3px]"
              >
                <CardArt inst={inst} card={card} size="hand" />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setInspectId(id);
                  }}
                  aria-label={`View ${card?.name ?? 'card'} enlarged`}
                  data-discard-view={id}
                  className="mt-1 block mx-auto rounded px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide
                             bg-ink-black/10 text-ink-iron hover:bg-ink-black/20"
                >
                  View
                </button>
              </div>
            );
          })}
        </div>

        {/* Standard read view (size C) — same shared inspect as every surface */}
        {inspectId !== null && (
          <CardInspectOverlay
            inst={inspectInst}
            card={inspectCard}
            onClose={() => setInspectId(null)}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
});

export default DiscardChoicePrompt;
