// ChoosePrompt — surfaces the choose_one engine pause to the UI.
// Renders when state.phase === 'choose_one' AND state.pending.kind === 'choose_one'.
// One button per option in state.pending.pendingChoose.options.
// Click → dispatch RESOLVE_CHOOSE_ONE { optionIndex }.
// The engine handles resumption; the UI's only job is to surface + dispatch.

import { memo, useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { springs } from '../lib/animationTokens';

interface OptionLike {
  readonly action?: { readonly kind?: string };
}

function labelForOption(option: unknown, index: number): string {
  const o = option as OptionLike;
  const kind = o?.action?.kind;
  if (typeof kind === 'string' && kind.length > 0) {
    return `${index + 1}. ${kind.replace(/_/g, ' ')}`;
  }
  return `Option ${index + 1}`;
}

export const ChoosePrompt = memo(function ChoosePrompt() {
  const pendingChoose = useGameStore((s) =>
    s.state.pending?.kind === 'choose_one' ? s.state.pending.pendingChoose : null,
  );
  const pendingKind = useGameStore((s) => s.state.pending?.kind ?? null);
  const phase = useGameStore((s) => s.state.phase);
  const viewAs = useGameStore((s) => s.viewAs);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);

  const isMine = pendingChoose != null && pendingChoose.controller === viewAs;
  const open = phase === 'choose_one' && isMine;

  // Temporary defensive logs — owner-requested runtime trace 2026-06-04.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[ChoosePrompt]', {
      phase,
      pendingKind,
      hasPendingChoose: pendingChoose != null,
      isMine,
      open,
      viewAs,
      controller: pendingChoose?.controller,
      optionCount: pendingChoose?.options?.length ?? 0,
    });
  }, [phase, pendingKind, pendingChoose, isMine, open, viewAs]);

  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
      const t = window.setTimeout(() => firstButtonRef.current?.focus(), reduced ? 0 : 40);
      return () => {
        window.clearTimeout(t);
        const prev = previouslyFocusedRef.current;
        if (prev && document.contains(prev)) prev.focus();
        previouslyFocusedRef.current = null;
      };
    }
    return undefined;
  }, [open, reduced]);

  const handlePick = useCallback(
    (optionIndex: number) => {
      // eslint-disable-next-line no-console
      console.log('[ChoosePrompt] dispatching RESOLVE_CHOOSE_ONE', { optionIndex });
      dispatch({ type: 'RESOLVE_CHOOSE_ONE', optionIndex });
    },
    [dispatch],
  );

  const options = pendingChoose?.options ?? [];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="choose-prompt-heading"
          data-pending-kind="choose_one"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center
                     bg-paper-cream/95 backdrop-blur-sm px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.18 }}
        >
          <motion.h2
            id="choose-prompt-heading"
            initial={reduced ? false : { y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={spring.ribbonSwap}
            className="font-display text-[1.5rem] leading-tight text-ink-black text-center mb-3"
          >
            Choose One
          </motion.h2>

          <motion.p
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduced ? 0 : 0.1, duration: 0.2 }}
            className="max-w-[360px] text-[0.8125rem] leading-snug text-ink-iron
                       text-center mb-6"
          >
            Pick one of the following effects.
          </motion.p>

          <div className="flex flex-col items-stretch gap-3 w-full max-w-[320px]">
            {options.map((option, index) => (
              <button
                key={index}
                ref={index === 0 ? firstButtonRef : undefined}
                type="button"
                onClick={() => handlePick(index)}
                aria-label={`Choose option ${index + 1}: ${labelForOption(option, index)}`}
                className="min-h-[48px] w-full rounded-2xl px-5 py-2
                           font-body font-extrabold uppercase tracking-wider
                           bg-seal-red text-paper-cream text-[0.875rem]
                           shadow-[0_4px_12px_rgba(168,38,31,0.30)]
                           focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none
                           hover:brightness-110 transition-[filter] duration-150"
              >
                {labelForOption(option, index)}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default ChoosePrompt;
