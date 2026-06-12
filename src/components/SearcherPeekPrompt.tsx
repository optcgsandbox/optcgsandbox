// SearcherPeekPrompt — F-8B generic searcher / peek / top-deck choice window.
// F-8C layout pass: fixed no-scroll overlay (header / internal-scroll grid /
// fixed footer), PROMPT-size tiles (unified size B), View opens the shared
// inspect overlay (unified size C — same presentation as CardDetailModal).
//
// Interaction model:
//   - every looked-at card renders as a fixed prompt-size tile
//     (valid = selectable, invalid = dimmed with "No match", all inspectable)
//   - VIEW opens CardInspectOverlay (330×462 standard read view)
//   - select up to pickLimit valid cards, then CONFIRM
//   - CHOOSE NONE always available when the printed text says "up to"
//   - leftovers go to the printed destination; order = shown order (v1
//     default order with explicit note; reorder UI is a follow-up)

import { memo, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';
import { CardInspectOverlay } from './CardInspectOverlay';
import { printedSegmentFor } from './printedEffect';

const PLACEMENT_NOTE: Record<string, string> = {
  bottom: 'Remaining cards go to the BOTTOM of your deck in the order shown.',
  top: 'Remaining cards go back on TOP of your deck in the order shown.',
  trash: 'Remaining cards are trashed.',
  shuffle: 'Remaining cards are shuffled back into your deck.',
};

export const SearcherPeekPrompt = memo(function SearcherPeekPrompt() {
  const phase = useGameStore((s) => s.state.phase);
  const pending = useGameStore((s) =>
    s.state.pending?.kind === 'searcher_peek' ? s.state.pending.pendingSearcherPeek : null,
  );
  const viewAs = useGameStore((s) => s.viewAs);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;

  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
  const [inspectId, setInspectId] = useState<string | null>(null);

  const open =
    phase === 'searcher_peek_choice' && pending !== null && pending.controller === viewAs;

  // Reset local selection whenever a new window opens.
  const windowKey = pending?.lookedAtInstanceIds.join(',') ?? '';
  useEffect(() => {
    setSelected([]);
    setInspectId(null);
  }, [windowKey]);

  const toggle = useCallback(
    (id: string) => {
      if (pending === null) return;
      setSelected((cur) => {
        if (cur.includes(id)) return cur.filter((x) => x !== id);
        if (cur.length >= pending.pickLimit) {
          // At limit: single-pick effects swap the selection; multi-pick
          // effects ignore the extra tap.
          return pending.pickLimit === 1 ? [id] : cur;
        }
        return [...cur, id];
      });
    },
    [pending],
  );

  const confirm = useCallback(
    (picks: ReadonlyArray<string>) => {
      if (pending === null) return;
      const pickedSet = new Set(picks);
      dispatch({
        type: 'RESOLVE_SEARCHER_PEEK',
        pickedInstanceIds: picks,
        bottomOrderInstanceIds: pending.lookedAtInstanceIds.filter((id) => !pickedSet.has(id)),
      });
      setSelected([]);
      setInspectId(null);
    },
    [dispatch, pending],
  );

  const inspectInst = inspectId !== null ? instances[inspectId] : undefined;
  const inspectCard = inspectInst ? library[inspectInst.cardId] : undefined;

  // F-8D — printed card text for the source searcher (the wording the
  // player actually knows). Generated filterSummary stays as the action line.
  const srcInst = pending ? instances[pending.sourceInstanceId] : undefined;
  const srcCard = srcInst ? library[srcInst.cardId] : undefined;
  const printed = printedSegmentFor(
    (srcCard as { effectText?: string } | undefined)?.effectText,
    undefined,
  );

  return (
    <AnimatePresence>
      {open && pending && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="searcher-peek-heading"
          data-pending-kind="searcher_peek"
          className="fixed inset-0 z-[70] flex flex-col items-center
                     bg-paper-cream/95 backdrop-blur-sm overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.18 }}
        >
          {/* Fixed header */}
          <div className="flex-none flex flex-col items-center px-4 pt-5 pb-2">
            <h2
              id="searcher-peek-heading"
              className="font-display text-[1.5rem] leading-tight text-ink-black text-center"
            >
              Look at top {pending.lookedAtInstanceIds.length}
            </h2>
            {printed !== null && (
              <p
                data-picker-printed-text
                className="max-w-[380px] text-[0.75rem] leading-snug text-ink-black/80 text-center italic"
              >
                {printed}
              </p>
            )}
            <p className="max-w-[380px] text-[0.8125rem] leading-snug text-ink-iron text-center font-medium">
              {pending.filterSummary}
            </p>
            <p className="max-w-[380px] text-[0.6875rem] leading-snug text-ink-iron/80 text-center">
              {PLACEMENT_NOTE[pending.placement] ?? PLACEMENT_NOTE['bottom']}
            </p>
          </div>

          {/* Internal-scroll tile grid — the PAGE never scrolls */}
          <div className="flex-1 min-h-0 w-full overflow-y-auto px-4 py-2">
            <div className="flex flex-wrap gap-3 justify-center max-w-[460px] mx-auto">
              {pending.lookedAtInstanceIds.map((id) => {
                const inst = instances[id];
                if (!inst) return null;
                const card = library[inst.cardId];
                const isValid = pending.validPickInstanceIds.includes(id);
                const isSelected = selected.includes(id);
                return (
                  <div key={id} className="flex flex-col items-center gap-1">
                    <div
                      role="button"
                      tabIndex={0}
                      aria-disabled={!isValid}
                      aria-pressed={isSelected}
                      aria-label={
                        isValid
                          ? `${isSelected ? 'Deselect' : 'Select'} ${card?.name ?? 'card'}`
                          : `${card?.name ?? 'card'} — does not match the requirement`
                      }
                      onClick={() => (isValid ? toggle(id) : undefined)}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && isValid) {
                          e.preventDefault();
                          toggle(id);
                        }
                      }}
                      data-searcher-card={id}
                      data-searcher-valid={isValid}
                      data-searcher-selected={isSelected}
                      className={[
                        'rounded-[4px] transition-shadow focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none',
                        isValid ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
                        isSelected ? 'ring-4 ring-sun-brass shadow-[0_0_12px_rgba(193,142,42,0.55)]' : '',
                      ].join(' ')}
                    >
                      <CardArt inst={inst} card={card} size="prompt" />
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setInspectId(id)}
                        aria-label={`View ${card?.name ?? 'card'} enlarged`}
                        data-searcher-view={id}
                        className="rounded px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide
                                   bg-ink-black/10 text-ink-iron hover:bg-ink-black/20"
                      >
                        View
                      </button>
                      {!isValid && (
                        <span className="text-[0.625rem] font-bold uppercase tracking-wide text-blood-red/80">
                          No match
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Fixed footer — always visible, never scrolled away */}
          <div className="flex-none flex gap-3 px-4 pb-5 pt-2">
            {pending.mayChooseNone && (
              <button
                type="button"
                onClick={() => confirm([])}
                data-searcher-choose-none
                className="min-h-[44px] min-w-[130px] rounded-2xl px-5 py-2
                           font-body font-extrabold uppercase tracking-wider
                           bg-ink-black/15 text-ink-black text-[0.875rem]
                           focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
              >
                Choose none
              </button>
            )}
            <button
              type="button"
              onClick={() => confirm(selected)}
              disabled={selected.length === 0 && !pending.mayChooseNone}
              data-searcher-confirm
              className="min-h-[44px] min-w-[140px] rounded-2xl px-5 py-2
                         font-body font-extrabold uppercase tracking-wider
                         bg-hull-teal text-paper-cream text-[0.875rem]
                         shadow-[0_4px_12px_rgba(15,69,73,0.30)]
                         disabled:opacity-40
                         focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
            >
              Confirm{selected.length > 0 ? ` (${selected.length})` : ''}
            </button>
          </div>

          {/* Standard read view (size C) */}
          {inspectId !== null && (
            <CardInspectOverlay
              inst={inspectInst}
              card={inspectCard}
              onClose={() => setInspectId(null)}
              group={{ ids: pending.lookedAtInstanceIds, currentId: inspectId, onNavigate: setInspectId }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default SearcherPeekPrompt;
