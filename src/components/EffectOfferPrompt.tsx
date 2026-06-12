// EffectOfferPrompt — F-8D addendum: "You may pay <cost>: <effect>" pre-prompt.
//
// Mounts when `state.phase === 'effect_offer'` and `viewAs` controls the
// pending offer. Generic — the PRINTED card text (segment for the firing
// trigger) is the primary copy; the engine-generated cost/effect summary is
// the fallback for cards with no printed text. The card is inspectable
// (tap or View → shared CardInspectOverlay). Skip pays NOTHING; Use Effect
// pays the cost (opening the cost picker when payment needs a choice) and
// continues into the target picker / resolution.

import { memo, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';
import { CardInspectOverlay } from './CardInspectOverlay';
import { printedSegmentFor } from './printedEffect';

export const EffectOfferPrompt = memo(function EffectOfferPrompt() {
  const phase = useGameStore((s) => s.state.phase);
  const pending = useGameStore((s) =>
    s.state.pending?.kind === 'effect_offer' ? s.state.pending.pendingEffectOffer : null,
  );
  const viewAs = useGameStore((s) => s.viewAs);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;

  const [inspecting, setInspecting] = useState(false);

  const open = phase === 'effect_offer' && pending !== null && pending.controller === viewAs;
  const srcInst = pending ? instances[pending.sourceInstanceId] : undefined;
  const srcCard = srcInst ? library[srcInst.cardId] : undefined;

  useEffect(() => {
    if (!open) setInspecting(false);
  }, [open]);

  // Printed card text wins; engine-generated wording only when the card has
  // no printed text (synthetic/test cards). Never internal action keys.
  const printed = printedSegmentFor(
    (srcCard as { effectText?: string } | undefined)?.effectText,
    pending?.trigger,
  );

  return (
    <AnimatePresence>
      {open && pending && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="effect-offer-heading"
          data-pending-kind="effect_offer"
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center
                     gap-3 px-4 bg-paper-cream/95 backdrop-blur-sm overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.18 }}
        >
          <h2
            id="effect-offer-heading"
            className="font-display text-[1.5rem] leading-tight text-ink-black text-center"
          >
            Use effect?
          </h2>
          {srcCard && (
            <div className="flex flex-col items-center gap-1">
              <div
                role="button"
                tabIndex={0}
                aria-label={`View ${srcCard.name} enlarged`}
                data-effect-offer-card
                onClick={() => setInspecting(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setInspecting(true);
                  }
                }}
                className="cursor-pointer rounded-[4px] focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
              >
                <CardArt inst={srcInst} card={srcCard} size="prompt" />
              </div>
              <span className="text-[0.75rem] font-body font-extrabold uppercase tracking-wider text-ink-iron">
                {srcCard.name}
              </span>
              <button
                type="button"
                onClick={() => setInspecting(true)}
                aria-label={`View ${srcCard.name} enlarged`}
                data-effect-offer-view
                className="rounded px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide
                           bg-ink-black/10 text-ink-iron hover:bg-ink-black/20"
              >
                View
              </button>
            </div>
          )}
          {printed !== null ? (
            <p
              data-effect-offer-text="printed"
              className="max-w-[340px] text-[0.8125rem] leading-snug text-ink-black text-center font-medium"
            >
              {printed}
            </p>
          ) : (
            <p
              data-effect-offer-text="generated"
              className="max-w-[340px] text-[0.8125rem] leading-snug text-ink-iron text-center"
            >
              You may {pending.costSummary}:
              <br />
              <span className="font-bold">{pending.effectSummary}</span>
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => dispatch({ type: 'RESOLVE_EFFECT_OFFER', accept: false })}
              data-effect-offer-skip
              className="min-h-[44px] min-w-[120px] rounded-2xl px-5 py-2
                         font-body font-extrabold uppercase tracking-wider
                         bg-ink-black/15 text-ink-black text-[0.875rem]
                         focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: 'RESOLVE_EFFECT_OFFER', accept: true })}
              data-effect-offer-accept
              className="min-h-[44px] min-w-[150px] rounded-2xl px-5 py-2
                         font-body font-extrabold uppercase tracking-wider
                         bg-hull-teal text-paper-cream text-[0.875rem]
                         shadow-[0_4px_12px_rgba(15,69,73,0.30)]
                         focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
            >
              Use effect
            </button>
          </div>

          {/* Standard read view (size C) — same shared inspect as every surface */}
          {inspecting && srcCard && (
            <CardInspectOverlay
              inst={srcInst}
              card={srcCard}
              onClose={() => setInspecting(false)}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default EffectOfferPrompt;
