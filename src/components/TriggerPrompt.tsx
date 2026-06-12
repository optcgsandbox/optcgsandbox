// TriggerPrompt — visual-spec.md §5 component pattern.
// Modal that appears when `state.pendingTrigger != null` AND the viewer is the
// trigger's controller (the player who just took life damage and now chooses
// whether to activate the [Trigger] effect — rules-reference.md §1.7).
//
// Behavior:
//   - Renders the flipped life card face-up at center-screen with effect text.
//   - Two CTAs: Activate / Decline → dispatch RESOLVE_TRIGGER{activate, targetInstanceId:null}.
//   - Focus-traps to the Activate button on open (WCAG dialog pattern).
//   - role="dialog", aria-modal="true", aria-labelledby on the heading.
//   - Reduced-motion swaps spring transitions to instant snap.
//
// We DO NOT touch the engine. The engine handles the trigger window state
// machine; the UI's only job is to surface the choice + dispatch the action.

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';
import { CardInspectOverlay } from './CardInspectOverlay';
import { springs } from '../lib/animationTokens';

export const TriggerPrompt = memo(function TriggerPrompt() {
  const pendingTrigger = useGameStore((s) =>
    s.state.pending?.kind === 'trigger' ? s.state.pending.pendingTrigger : null,
  );
  const viewAs = useGameStore((s) => s.viewAs);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const activateRef = useRef<HTMLButtonElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);
  // WCAG 2.4.3 — save the element that was focused when the dialog opened so
  // we can restore focus to it on close. Without this, keyboard users land at
  // <body> after Decline/Activate, breaking their navigation context.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Only show to the controller (the player whose life was taken). The
  // opponent sees nothing — keeps the choice private to the rights-holder.
  const isMine = pendingTrigger != null && pendingTrigger.controller === viewAs;
  const open = isMine;

  // F-7n Phase C — the v0-stub comment that previously hard-disabled
  // Activate is STALE. The engine resolves RESOLVE_TRIGGER{activate:true}
  // fully (per BUG-004 + the 5 scenarios in
  // `shared/server/__tests__/triggerWindow.online.test.ts`, including
  // Carrot's `play_self_from_life`). Disable Activate only when there's
  // genuinely no life card to activate (defensive).
  const activateDisabled =
    pendingTrigger == null || pendingTrigger.lifeCardInstanceId === undefined;

  const lifeInst = pendingTrigger ? instances[pendingTrigger.lifeCardInstanceId] : undefined;
  const lifeCard = lifeInst ? library[lifeInst.cardId] : undefined;

  // F-8D inspect-everywhere — the flipped life card reads at full size too.
  const [inspecting, setInspecting] = useState(false);
  useEffect(() => {
    if (!open) setInspecting(false);
  }, [open]);

  // Auto-focus the primary action when the modal opens — WCAG 2.1 §2.4.3.
  // Also save the previously focused element so we can restore it on close.
  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
      // Defer a tick so the motion enter doesn't fight the focus. Focus the
      // first ENABLED CTA — when Activate is disabled, Decline is primary.
      const t = window.setTimeout(() => {
        const target = activateDisabled ? declineRef.current : activateRef.current;
        target?.focus();
      }, reduced ? 0 : 40);
      return () => {
        window.clearTimeout(t);
        // Restore focus when the dialog closes (WCAG 2.4.3). Guard against
        // the previously focused element having been removed from the DOM.
        const prev = previouslyFocusedRef.current;
        if (prev && document.contains(prev)) {
          prev.focus();
        }
        previouslyFocusedRef.current = null;
      };
    }
    return undefined;
  }, [open, reduced, activateDisabled]);

  // Minimal focus trap — Tab/Shift+Tab cycles between the focusable CTAs.
  // When Activate is disabled, focus stays on Decline (single focusable target).
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Tab') return;
      const a = activateRef.current;
      const d = declineRef.current;
      if (!d) return;
      // Single focusable target — trap Tab on Decline.
      if (activateDisabled || !a) {
        e.preventDefault();
        d.focus();
        return;
      }
      const focused = document.activeElement;
      if (e.shiftKey) {
        if (focused === a) {
          e.preventDefault();
          d.focus();
        }
      } else {
        if (focused === d) {
          e.preventDefault();
          a.focus();
        }
      }
    },
    [activateDisabled],
  );

  const handleActivate = useCallback(() => {
    dispatch({ type: 'RESOLVE_TRIGGER', activate: true, targetInstanceId: null });
  }, [dispatch]);

  const handleDecline = useCallback(() => {
    dispatch({ type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null });
  }, [dispatch]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="trigger-prompt-heading"
          data-pending-kind="trigger"
          onKeyDown={handleKeyDown}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center
                     bg-paper-cream/95 backdrop-blur-sm px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.18 }}
        >
          <motion.h2
            id="trigger-prompt-heading"
            initial={reduced ? false : { y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={spring.ribbonSwap}
            className="font-display text-[1.5rem] leading-tight text-ink-black text-center mb-3"
          >
            Trigger!
          </motion.h2>

          <motion.div
            initial={reduced ? false : { scale: 0.6, opacity: 0, rotateY: 180 }}
            animate={{ scale: 1, opacity: 1, rotateY: 0 }}
            transition={{ ...spring.cardTravel, delay: reduced ? 0 : 0.05 }}
            className="mb-3"
            style={{ transform: 'scale(1.4)', transformOrigin: 'center' }}
          >
            {lifeCard && lifeInst && (
              <div
                role="button"
                tabIndex={0}
                aria-label={`View ${lifeCard.name} enlarged`}
                data-trigger-card
                onClick={() => setInspecting(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setInspecting(true);
                  }
                }}
                className="cursor-pointer rounded-[4px] focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
              >
                <CardArt
                  inst={lifeInst}
                  card={lifeCard}
                  size="leader"
                />
              </div>
            )}
          </motion.div>

          {lifeCard && (
            <button
              type="button"
              onClick={() => setInspecting(true)}
              aria-label={`View ${lifeCard.name} enlarged`}
              data-trigger-view
              className="mb-2 rounded px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide
                         bg-ink-black/10 text-ink-iron hover:bg-ink-black/20"
            >
              View
            </button>
          )}

          {lifeCard?.effectText && (
            <motion.p
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: reduced ? 0 : 0.15, duration: 0.2 }}
              className="max-w-[360px] rounded-xl bg-paper-fog/60 px-3 py-2
                         text-[0.8125rem] leading-snug text-ink-black text-center
                         ring-1 ring-marine-fog/40 mb-4"
            >
              {lifeCard.effectText}
            </motion.p>
          )}

          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-3">
              <button
                ref={activateRef}
                type="button"
                onClick={handleActivate}
                disabled={activateDisabled}
                aria-disabled={activateDisabled}
                aria-describedby={activateDisabled ? 'trigger-activate-hint' : undefined}
                title={activateDisabled ? 'Trigger effects coming in v0.2' : undefined}
                className={[
                  'min-h-[44px] min-w-[110px] rounded-2xl px-5 py-2',
                  'font-body font-extrabold uppercase tracking-wider',
                  'focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none',
                  activateDisabled
                    ? // Disabled treatment — desaturated fog with iron text for AA contrast.
                      'bg-paper-fog text-ink-iron ring-1 ring-marine-fog/60 opacity-60 cursor-not-allowed'
                    : 'bg-seal-red text-paper-cream shadow-[0_4px_12px_rgba(168,38,31,0.30)]',
                ].join(' ')}
              >
                Activate
              </button>
              <button
                ref={declineRef}
                type="button"
                onClick={handleDecline}
                className="min-h-[44px] min-w-[110px] rounded-2xl
                           bg-paper-fog px-5 py-2 font-body font-extrabold uppercase
                           tracking-wider text-ink-black ring-1 ring-marine-fog/60
                           focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
              >
                Decline
              </button>
            </div>
            {activateDisabled && (
              <p
                id="trigger-activate-hint"
                className="text-[0.6875rem] font-body text-ink-iron text-center"
              >
                Trigger effects coming in v0.2 — Decline to put the life card into your hand.
              </p>
            )}
          </div>

          {/* Standard read view (size C) — same shared inspect as every surface */}
          {inspecting && lifeCard && (
            <CardInspectOverlay
              inst={lifeInst}
              card={lifeCard}
              onClose={() => setInspecting(false)}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default TriggerPrompt;
