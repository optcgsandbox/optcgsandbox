// CardDetailModal — visual-design-spec.md §2 + design-reference.md §6.
//
// Tap-to-lift in HandFan moves a card to the "inspected" state. A second tap
// on the lifted card opens this modal. It shows the card art at full read
// size, its effect text (if any), and context-appropriate action buttons.
//
// Action routing (per visual-design-spec §2.6):
//   Character + your main + affordable        → PLAY · {cost} ⊙       (PLAY_CARD)
//   Character + your main + char slots == 5   → REPLACE…              (deferred: opens picker)
//   Character + opp counter window + counter  → USE COUNTER · +{val}  (PLAY_COUNTER)
//   Event + your main                         → PLAY MAIN · {cost} ⊙  (PLAY_CARD)
//   Event + opp counter window + has counter  → PLAY COUNTER          (PLAY_COUNTER)
//   Stage + your main                         → PLAY · {cost} ⊙       (PLAY_STAGE)
//   Leader / game over                        → (no PLAY, just CLOSE)
//
// We don't reimplement legality — we read getLegalActions() out of the store
// to decide what's enabled.

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';
import type { Action } from '@shared/protocol/actions';

interface ActionButton {
  label: string;
  action: Action | null; // null = close-only
  variant: 'primary-teal' | 'primary-red' | 'secondary';
  disabled?: boolean;
}

export const CardDetailModal = memo(function CardDetailModal() {
  const open = useGameStore((s) => s.cardDetailOpen);
  const inspectedCardId = useGameStore((s) => s.inspectedCardId);
  const setInspectedCardId = useGameStore((s) => s.setInspectedCardId);
  const setCardDetailOpen = useGameStore((s) => s.setCardDetailOpen);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const phase = useGameStore((s) => s.state.phase);
  const activePlayer = useGameStore((s) => s.state.activePlayer);
  const viewAs = useGameStore((s) => s.viewAs);
  const legalActions = useGameStore((s) => s.legalActions);
  const result = useGameStore((s) => s.state.result);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const inst = inspectedCardId ? instances[inspectedCardId] : undefined;
  const card = inst ? library[inst.cardId] : undefined;

  const close = useCallback(() => {
    setCardDetailOpen(false);
  }, [setCardDetailOpen]);

  // Decide action buttons per kind + phase.
  const buttons: ActionButton[] = useMemo(() => {
    if (!inst || !card) return [{ label: 'CLOSE', action: null, variant: 'secondary' }];
    if (result) {
      return [{ label: 'CLOSE', action: null, variant: 'secondary' }];
    }

    const isYourTurn = activePlayer === viewAs;
    const isMain = isYourTurn && phase === 'main';
    const isOppCounterWindow = !isYourTurn && phase === 'counter_window';

    if (card.kind === 'leader') {
      return [{ label: 'CLOSE', action: null, variant: 'secondary' }];
    }

    if (card.kind === 'character') {
      if (isMain) {
        const playable = legalActions.find(
          (a) =>
            a.type === 'PLAY_CARD' &&
            a.instanceId === inst.instanceId &&
            a.replaceTargetId === null,
        );
        const replaceable = legalActions.find(
          (a) =>
            a.type === 'PLAY_CARD' &&
            a.instanceId === inst.instanceId &&
            a.replaceTargetId !== null,
        );
        if (playable) {
          return [
            {
              label: `PLAY · ${card.cost} ⊙`,
              action: playable,
              variant: 'primary-teal',
            },
            { label: 'CANCEL', action: null, variant: 'secondary' },
          ];
        }
        if (replaceable) {
          // Field is full — owner must pick a char to replace. Defer to engine
          // legal actions: pick the first replace target. (Replace-picker UI is
          // out of scope here.)
          return [
            {
              label: 'REPLACE…',
              action: replaceable,
              variant: 'primary-teal',
            },
            { label: 'CANCEL', action: null, variant: 'secondary' },
          ];
        }
        return [
          {
            label: `PLAY · ${card.cost} ⊙`,
            action: null,
            variant: 'primary-teal',
            disabled: true,
          },
          { label: 'CLOSE', action: null, variant: 'secondary' },
        ];
      }
      if (isOppCounterWindow && (card.counterValue ?? 0) > 0) {
        const useCounter = legalActions.find(
          (a) => a.type === 'PLAY_COUNTER' && a.instanceId === inst.instanceId,
        );
        if (useCounter) {
          return [
            {
              label: `USE COUNTER · +${card.counterValue}`,
              action: useCounter,
              variant: 'primary-red',
            },
            { label: 'DECLINE', action: null, variant: 'secondary' },
          ];
        }
      }
      return [{ label: 'CLOSE', action: null, variant: 'secondary' }];
    }

    if (card.kind === 'event') {
      if (isMain) {
        const playMain = legalActions.find(
          (a) => a.type === 'PLAY_CARD' && a.instanceId === inst.instanceId,
        );
        if (playMain) {
          return [
            {
              label: `PLAY MAIN · ${card.cost} ⊙`,
              action: playMain,
              variant: 'primary-teal',
            },
            { label: 'CANCEL', action: null, variant: 'secondary' },
          ];
        }
        return [
          {
            label: `PLAY MAIN · ${card.cost} ⊙`,
            action: null,
            variant: 'primary-teal',
            disabled: true,
          },
          { label: 'CLOSE', action: null, variant: 'secondary' },
        ];
      }
      if (isOppCounterWindow) {
        const playCounter = legalActions.find(
          (a) => a.type === 'PLAY_COUNTER' && a.instanceId === inst.instanceId,
        );
        if (playCounter) {
          return [
            {
              label: `PLAY COUNTER · ${card.cost} ⊙`,
              action: playCounter,
              variant: 'primary-red',
            },
            { label: 'DECLINE', action: null, variant: 'secondary' },
          ];
        }
      }
      return [{ label: 'CLOSE', action: null, variant: 'secondary' }];
    }

    if (card.kind === 'stage') {
      if (isMain) {
        const playStage = legalActions.find(
          (a) => a.type === 'PLAY_STAGE' && a.instanceId === inst.instanceId,
        );
        if (playStage) {
          return [
            {
              label: `PLAY · ${card.cost} ⊙`,
              action: playStage,
              variant: 'primary-teal',
            },
            { label: 'CANCEL', action: null, variant: 'secondary' },
          ];
        }
      }
      return [{ label: 'CLOSE', action: null, variant: 'secondary' }];
    }

    return [{ label: 'CLOSE', action: null, variant: 'secondary' }];
  }, [inst, card, result, activePlayer, viewAs, phase, legalActions]);

  // ESC closes; focus initial = primary button; tab-trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
      if (e.key === 'Tab') {
        // Simple tab-trap between close, primary, secondary.
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = panel.querySelectorAll<HTMLElement>(
          'button:not([disabled])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    // Restore focus on close.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Initial focus = primary if present, else close.
    queueMicrotask(() => {
      if (primaryButtonRef.current) primaryButtonRef.current.focus();
      else closeButtonRef.current?.focus();
    });
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, close]);

  const onActionClick = useCallback(
    (action: Action | null) => {
      if (!action) {
        close();
        return;
      }
      dispatch(action);
      // After dispatch, clear inspection + close.
      setCardDetailOpen(false);
      setInspectedCardId(null);
    },
    [dispatch, close, setCardDetailOpen, setInspectedCardId],
  );

  // Backdrop click closes (returns to inspected state).
  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) close();
    },
    [close],
  );

  if (!open || !inst || !card) return null;

  // Effect text — fall back to a friendly placeholder when none is printed.
  const effectText = card.effectText || (card.effectTags.includes('vanilla') ? 'No effect.' : '');

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-50 flex items-start justify-center"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            paddingLeft: 16,
            paddingRight: 16,
            background: 'rgba(15,20,15,0.62)',
            backdropFilter: reduced ? undefined : 'blur(4px) saturate(0.85)',
            WebkitBackdropFilter: reduced ? undefined : 'blur(4px) saturate(0.85)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onBackdropClick}
          aria-hidden={!open}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="card-detail-name"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.2, 0.9, 0.3, 1] }}
            className="relative flex w-full max-w-[386px] flex-col"
            style={{
              maxHeight:
                'calc(100dvh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - 48px)',
              background: 'var(--color-paper-cream)',
              border: '1px solid rgba(15,20,15,0.35)',
              borderRadius: 14,
              boxShadow:
                '0 12px 32px rgba(15,20,15,0.45), inset 0 0 0 1px var(--color-brass-canary)',
              padding: '14px 16px 16px 16px',
            }}
          >
            {/* Close (top-right). */}
            <div className="flex items-center justify-end" style={{ height: 32 }}>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={close}
                aria-label="Close card details"
                className="flex h-8 w-8 items-center justify-center rounded-full
                           text-ink-black/65 hover:bg-ink-black/10
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sun-brass"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M3.7 3.7a1 1 0 0 1 1.4 0L8 6.6l2.9-2.9a1 1 0 1 1 1.4 1.4L9.4 8l2.9 2.9a1 1 0 0 1-1.4 1.4L8 9.4l-2.9 2.9a1 1 0 0 1-1.4-1.4L6.6 8 3.7 5.1a1 1 0 0 1 0-1.4Z" />
                </svg>
              </button>
            </div>

            {/* Card art (centered, 220×308). */}
            <div className="mb-3 flex justify-center">
              <CardArt card={card} size="modal" />
            </div>

            {/* Meta strip: Cost + Power pills. */}
            <div className="mb-2 flex items-center justify-center gap-3">
              {card.kind !== 'leader' && card.cost !== null && card.cost !== undefined && (
                <MetaPill label="COST" value={String(card.cost)} ring="brass" />
              )}
              {(card.kind === 'character' || card.kind === 'leader') &&
                card.power !== null &&
                card.power !== undefined && (
                  <MetaPill label="POWER" value={String(card.power)} ring="red" />
                )}
            </div>

            {/* Name + sub. */}
            <h2
              id="card-detail-name"
              className="font-display text-center text-ink-black"
              style={{ fontSize: 18, lineHeight: '22px', fontWeight: 600 }}
            >
              {card.name}
            </h2>
            <p
              className="mt-1 text-center font-body uppercase text-ink-iron"
              style={{ fontSize: 11, letterSpacing: '0.04em' }}
            >
              {card.kind?.toUpperCase()}
              {card.traits && card.traits.length > 0
                ? ` · ${card.traits.slice(0, 2).join(' / ')}`
                : ''}
            </p>

            {/* Effect text box. */}
            <div
              className="mt-3 overflow-y-auto"
              style={{
                background: 'var(--color-paper-fog)',
                border: '1px solid rgba(15,20,15,0.20)',
                borderRadius: 8,
                padding: '10px 12px',
                maxHeight: 160,
                scrollbarWidth: 'none',
              }}
            >
              <p
                className="font-body text-ink-black"
                style={{ fontSize: 13, lineHeight: 1.45 }}
              >
                {effectText || '—'}
              </p>
            </div>

            {/* Action row. */}
            <div className="mt-3 flex items-center justify-center gap-2">
              {buttons.map((btn, idx) => {
                const isPrimary = btn.variant !== 'secondary';
                const ref = isPrimary && idx === 0 ? primaryButtonRef : undefined;
                return (
                  <button
                    key={`${btn.label}-${idx}`}
                    ref={ref}
                    type="button"
                    onClick={() => onActionClick(btn.action)}
                    disabled={btn.disabled}
                    className={[
                      'min-h-[44px] font-display uppercase',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sun-brass',
                      isPrimary
                        ? btn.variant === 'primary-red'
                          ? 'bg-seal-red text-paper-cream'
                          : 'bg-hull-teal text-paper-cream'
                        : 'bg-transparent text-ink-black border-[1.5px] border-ink-black',
                      btn.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                    ].join(' ')}
                    style={{
                      borderRadius: 22,
                      padding: '0 18px',
                      minWidth: isPrimary ? 140 : 96,
                      letterSpacing: '0.06em',
                      fontSize: 14,
                      boxShadow: isPrimary ? '0 2px 0 rgba(15,20,15,0.30)' : undefined,
                    }}
                  >
                    {btn.label}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

interface MetaPillProps {
  label: string;
  value: string;
  ring: 'brass' | 'red';
}

function MetaPill({ label, value, ring }: MetaPillProps) {
  const ringColor = ring === 'brass' ? 'var(--color-brass-canary)' : 'var(--color-seal-red)';
  const labelColor =
    ring === 'brass' ? 'var(--color-brass-canary)' : 'var(--color-seal-red)';
  return (
    <div
      className="flex flex-col items-center justify-center bg-paper-cream"
      style={{
        width: 88,
        height: 36,
        borderRadius: 8,
        border: `1.5px solid ${ringColor}`,
      }}
      aria-label={`${label} ${value}`}
    >
      <span
        className="font-body uppercase"
        style={{ fontSize: 8, letterSpacing: '0.06em', color: labelColor, lineHeight: 1 }}
      >
        {label}
      </span>
      <span
        className="font-display tabular text-ink-black"
        style={{ fontSize: 18, lineHeight: 1, fontWeight: 600 }}
      >
        {value}
      </span>
    </div>
  );
}
