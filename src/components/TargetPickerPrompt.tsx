// TargetPickerPrompt — F-8D generic target chooser for every targeted
// effect family (reduce/give power, removal_ko, bounce, rest/unrest,
// give_don, ...). Entirely corpus/metadata-driven: the engine supplies the
// candidate set, pick limit, and a generated summary — nothing here is
// card-specific.
//
// Mounts when `state.phase === 'attack_target_pick'` and `viewAs` controls
// the pending pick. Layout contract = F-8C standard: fixed no-scroll
// overlay (header / internal-scroll grid / fixed footer), PROMPT-size
// tiles, View → shared CardInspectOverlay (size C).

import { memo, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';
import { CardInspectOverlay } from './CardInspectOverlay';
import { printedSegmentFor } from './printedEffect';

export const TargetPickerPrompt = memo(function TargetPickerPrompt() {
  const phase = useGameStore((s) => s.state.phase);
  const pending = useGameStore((s) =>
    s.state.pending?.kind === 'attack_target_pick' ? s.state.pending.pendingTargetPick : null,
  );
  const viewAs = useGameStore((s) => s.viewAs);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;

  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
  const [inspectId, setInspectId] = useState<string | null>(null);

  const open =
    phase === 'attack_target_pick' && pending !== null && pending.controller === viewAs;

  const windowKey = pending?.candidateIds.join(',') ?? '';
  useEffect(() => {
    setSelected([]);
    setInspectId(null);
  }, [windowKey]);

  const limit = pending?.pickLimit ?? 1;

  const toggle = useCallback(
    (id: string) => {
      setSelected((cur) => {
        if (cur.includes(id)) return cur.filter((x) => x !== id);
        if (cur.length >= limit) {
          return limit === 1 ? [id] : cur;
        }
        return [...cur, id];
      });
    },
    [limit],
  );

  const confirm = useCallback(
    (picks: ReadonlyArray<string>) => {
      dispatch({
        type: 'RESOLVE_TARGET_PICK',
        pickedId: picks[0] ?? null,
        pickedIds: picks,
      });
      setSelected([]);
      setInspectId(null);
    },
    [dispatch],
  );

  const sourceInst = pending ? instances[pending.sourceInstanceId] : undefined;
  const sourceCard = sourceInst ? library[sourceInst.cardId] : undefined;
  const inspectInst = inspectId !== null ? instances[inspectId] : undefined;
  const inspectCard = inspectInst ? library[inspectInst.cardId] : undefined;

  // F-8D — COST-PAYMENT mode: the picks PAY the clause's cost. Exact count
  // is mandatory (confirm gated); there is no choose-none at this stage.
  const isCostPick = pending?.costPick !== undefined;
  const exact = pending?.exactCount === true;
  const confirmReady = exact ? selected.length === limit : (selected.length > 0 || pending?.mayChooseNone === true);
  // Printed card text — the wording the player actually knows.
  const printed = printedSegmentFor(
    (sourceCard as { effectText?: string } | undefined)?.effectText,
    pending?.trigger,
  );

  return (
    <AnimatePresence>
      {open && pending && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="target-picker-heading"
          data-pending-kind="attack_target_pick"
          data-cost-pick={isCostPick || undefined}
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
              id="target-picker-heading"
              className="font-display text-[1.5rem] leading-tight text-ink-black text-center"
            >
              {isCostPick ? 'Pay the cost' : 'Choose a target'}
            </h2>
            {sourceCard && (
              <p className="text-[0.75rem] font-body font-extrabold uppercase tracking-wider text-ink-iron text-center">
                {sourceCard.name}
              </p>
            )}
            {printed !== null && (
              <p
                data-picker-printed-text
                className="max-w-[380px] text-[0.75rem] leading-snug text-ink-black/80 text-center italic"
              >
                {printed}
              </p>
            )}
            <p className="max-w-[380px] text-[0.8125rem] leading-snug text-ink-iron text-center font-medium">
              {pending.filterSummary ?? `Choose up to ${limit} target${limit > 1 ? 's' : ''}.`}
            </p>
          </div>

          {/* Internal-scroll tile grid — the PAGE never scrolls */}
          <div className="flex-1 min-h-0 w-full overflow-y-auto px-4 py-2">
            <div className="flex flex-wrap gap-3 justify-center max-w-[460px] mx-auto">
              {pending.candidateIds.map((id) => {
                const inst = instances[id];
                if (!inst) return null;
                const card = library[inst.cardId];
                const isSelected = selected.includes(id);
                return (
                  <div key={id} className="flex flex-col items-center gap-1">
                    <div
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? 'Deselect' : 'Select'} ${card?.name ?? 'card'}`}
                      onClick={() => toggle(id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggle(id);
                        }
                      }}
                      data-target-card={id}
                      data-target-selected={isSelected}
                      className={[
                        'cursor-pointer rounded-[4px] transition-shadow focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none',
                        isSelected ? 'ring-4 ring-seal-red shadow-[0_0_12px_rgba(168,38,31,0.45)]' : '',
                      ].join(' ')}
                    >
                      <CardArt inst={inst} card={card} size="prompt" />
                    </div>
                    <button
                      type="button"
                      onClick={() => setInspectId(id)}
                      aria-label={`View ${card?.name ?? 'card'} enlarged`}
                      data-target-view={id}
                      className="rounded px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide
                                 bg-ink-black/10 text-ink-iron hover:bg-ink-black/20"
                    >
                      View
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Fixed footer */}
          <div className="flex-none flex gap-3 px-4 pb-5 pt-2">
            {pending.mayChooseNone === true && (
              <button
                type="button"
                onClick={() => confirm([])}
                data-target-choose-none
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
              disabled={!confirmReady}
              data-target-confirm
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
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default TargetPickerPrompt;
