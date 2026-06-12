// TrashViewer — rules-reference.md §4.4 / CR §3-5.
//
// Trash is an OPEN area: either player may inspect either player's trash
// at any time. The TrashSlot on the playmat shows only the TOP card; this
// modal exposes the full ordered stack so the player can scroll through
// every card that has been trashed, KO'd, or used as a counter.
//
// Ordering: CR §3-5 — new cards placed on TOP. Engine `trash: string[]`
// pushes new entries with `push`, so the last index IS the top. We render
// the viewer top-first (most-recent first) for readability.
//
// Tap routing: taps inside the viewer open the existing CardDetailModal
// for the chosen card (read-only — the action set will be empty for trash
// cards but the read affordance is what owners want).
//
// Trigger: `useGameStore.viewingTrashOf: 'A' | 'B' | null` opens/closes
// the viewer. TrashSlot.tsx sets it on tap; this overlay reads it and
// dismisses via tap-outside, ESC, or the explicit CLOSE button.

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';

export const TrashViewer = memo(function TrashViewer() {
  const viewingTrashOf = useGameStore((s) => s.viewingTrashOf);
  const setViewingTrashOf = useGameStore((s) => s.setViewingTrashOf);
  const players = useGameStore((s) => s.state.players);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const viewAs = useGameStore((s) => s.viewAs);
  const setInspectedCardId = useGameStore((s) => s.setInspectedCardId);
  const setCardDetailOpen = useGameStore((s) => s.setCardDetailOpen);
  const setInspectGroup = useGameStore((s) => s.setInspectGroup);
  const reduced = useReducedMotion() ?? false;

  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const open = viewingTrashOf !== null;
  const trash = viewingTrashOf ? players[viewingTrashOf].trash : [];
  const isYours = viewingTrashOf === viewAs;

  // Top-of-stack first (most recent). Engine pushes new cards to the end,
  // so reversing gives newest-on-top per CR §3-5 ordering. useMemo so the
  // array identity is stable for the render list.
  const ordered = useMemo(() => trash.slice().reverse(), [trash]);

  const close = useCallback(() => {
    setViewingTrashOf(null);
  }, [setViewingTrashOf]);

  const onCardTap = useCallback(
    (instanceId: string) => {
      // F-7r: open CardDetailModal layered on top of the trash viewer so
      // closing the detail returns the player to the trash context (owner
      // complaint: "no way back to trash except close and reopen").
      // Both render at z-50; the modal mounts second so it lands on top.
      // Carousel (owner 2026-06-12): browse the whole trash in shown order.
      setInspectGroup(ordered);
      setInspectedCardId(instanceId);
      setCardDetailOpen(true);
    },
    [setInspectedCardId, setCardDetailOpen, setInspectGroup, ordered],
  );

  // ESC closes; focus initial = close button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    queueMicrotask(() => {
      closeButtonRef.current?.focus();
    });
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, close]);

  const onBackdropClick = useCallback(() => close(), [close]);

  const titleLabel = isYours ? 'Your trash' : 'Opponent trash';
  const headerLabel = `${titleLabel} · ${trash.length} card${trash.length === 1 ? '' : 's'}`;

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
            aria-labelledby="trash-viewer-title"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.2, 0.9, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex w-full max-w-[386px] flex-col bg-paper-cream rounded-md shadow-xl"
            style={{
              maxHeight:
                'calc(100% - 48px)' /* F-8D: % of the fixed board canvas */,
              border: '1px solid var(--color-ink-black)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: '1px solid rgba(15,20,15,0.18)' }}
            >
              <h2
                id="trash-viewer-title"
                className="font-display uppercase text-ink-black"
                style={{ fontSize: 13, letterSpacing: '0.08em', fontWeight: 600 }}
              >
                {headerLabel}
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={close}
                aria-label="Close trash viewer"
                className="font-display uppercase bg-ink-iron text-paper-cream
                           focus-visible:outline-none focus-visible:ring-2
                           focus-visible:ring-sun-brass"
                style={{
                  borderRadius: 18,
                  padding: '6px 14px',
                  fontSize: 12,
                  letterSpacing: '0.06em',
                  minHeight: 32,
                }}
              >
                CLOSE
              </button>
            </div>

            {/* Body — scrollable grid of full card faces. */}
            <div
              className="overflow-y-auto px-4 py-3"
              style={{ scrollbarWidth: 'none' }}
              role="list"
              aria-label={`${titleLabel} contents, ${trash.length} cards`}
            >
              {ordered.length === 0 ? (
                <p
                  className="font-body text-ink-black/60 text-center"
                  style={{ fontSize: 12, padding: '24px 0' }}
                >
                  Trash is empty.
                </p>
              ) : (
                <div
                  className="grid grid-cols-4 gap-2"
                  style={{ paddingBottom: 8 }}
                >
                  {ordered.map((instanceId, idx) => {
                    const inst = instances[instanceId];
                    const card = inst ? library[inst.cardId] : undefined;
                    if (!inst || !card) return null;
                    // ordered is reversed; top-of-stack index in the original
                    // trash array is `trash.length - 1 - idx`.
                    const stackPos = trash.length - idx; // 1-based, top = highest
                    return (
                      <div
                        key={instanceId}
                        role="listitem"
                        tabIndex={0}
                        onClick={() => onCardTap(instanceId)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onCardTap(instanceId);
                          }
                        }}
                        aria-label={`${card.name}, position ${stackPos} of ${trash.length}`}
                        className="relative bg-transparent border-0 p-0 cursor-pointer
                                   focus-visible:outline-none focus-visible:ring-2
                                   focus-visible:ring-sun-brass rounded-[4px]"
                        style={{ width: 64, height: 88 }}
                      >
                        <CardArt card={card} size="hand" />
                        {idx === 0 && (
                          <span
                            className="absolute top-1 right-1 bg-brass-canary
                                       text-ink-black font-display tabular
                                       rounded-[2px]"
                            style={{
                              padding: '1px 4px',
                              fontSize: 7,
                              lineHeight: 1.1,
                              border: '0.5px solid var(--color-ink-black)',
                            }}
                            aria-hidden="true"
                          >
                            TOP
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
