// BlockerPrompt — F-7q — 2-step blocker picker.
//
// Owner direction (F-7q): "Blocker/counter interaction: YES — 2-step
// confirm. tap card → enlarge/read/select. Then: [Use This Blocker].
// Never immediate commit."
//
// First tap: lift + outline the chosen blocker, dim others. Bottom CTA
// changes to "Use This Blocker (name)". Second tap on the same card OR
// tap the CTA dispatches DECLARE_BLOCKER. Tapping a different blocker
// switches selection. "Skip Blocker" remains available at any time.
//
// No timer. Owner reads cards at their own pace per F-7q rule D.

import { memo, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt, CARD_DIMS } from './CardArt';
import { CardInspectOverlay } from './CardInspectOverlay';
import type { Action } from '@shared/engine-v2/protocol/actions';

export const BlockerPrompt = memo(function BlockerPrompt() {
  const phase = useGameStore((s) => s.state.phase);
  const viewAs = useGameStore((s) => s.viewAs);
  const pending = useGameStore((s) =>
    s.state.pending?.kind === 'attack' ? s.state.pending.pendingAttack : null,
  );
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const legalActions = useGameStore((s) => s.legalActions);
  const dispatch = useGameStore((s) => s.dispatch);
  const reduced = useReducedMotion() ?? false;

  const blockerOptions = legalActions.filter(
    (a): a is Extract<Action, { type: 'DECLARE_BLOCKER' }> => a.type === 'DECLARE_BLOCKER',
  );
  const hasSkip = legalActions.some((a) => a.type === 'SKIP_BLOCKER');

  const defenderId = pending ? instances[pending.targetInstanceId]?.controller : null;
  const isDefender = defenderId !== null && defenderId === viewAs;

  const open =
    phase === 'block_window' &&
    isDefender &&
    (blockerOptions.length > 0 || hasSkip);

  const [selectedIid, setSelectedIid] = useState<string | null>(null);
  // F-8C — standard read view (size C) opened from a tile's VIEW button.
  const [inspectIid, setInspectIid] = useState<string | null>(null);

  // Reset selection when the prompt closes. (useEffect — never set state
  // during render.)
  useEffect(() => {
    if (!open && selectedIid !== null) setSelectedIid(null);
    if (!open && inspectIid !== null) setInspectIid(null);
  }, [open, selectedIid, inspectIid]);

  const handleSkip = useCallback(() => {
    setSelectedIid(null);
    dispatch({ type: 'SKIP_BLOCKER' });
  }, [dispatch]);

  const handleTileTap = useCallback(
    (a: Extract<Action, { type: 'DECLARE_BLOCKER' }>) => {
      if (selectedIid === a.blockerInstanceId) {
        // Second tap on same tile → commit.
        setSelectedIid(null);
        dispatch(a);
      } else {
        setSelectedIid(a.blockerInstanceId);
      }
    },
    [dispatch, selectedIid],
  );

  const handleConfirm = useCallback(() => {
    if (selectedIid === null) return;
    const a = blockerOptions.find((x) => x.blockerInstanceId === selectedIid);
    if (!a) return;
    setSelectedIid(null);
    dispatch(a);
  }, [dispatch, selectedIid, blockerOptions]);

  const selectedName = selectedIid
    ? library[instances[selectedIid]?.cardId ?? '']?.name ?? 'this blocker'
    : null;

  const attackerInst = pending ? instances[pending.attackerInstanceId] : undefined;
  const attackerCard = attackerInst ? library[attackerInst.cardId] : undefined;
  const targetInst = pending ? instances[pending.targetInstanceId] : undefined;
  const targetCard = targetInst ? library[targetInst.cardId] : undefined;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="blocker-prompt-heading"
          data-pending-kind="block_window"
          className="fixed inset-0 z-50 flex flex-col items-center
                     bg-paper-cream/95 backdrop-blur-sm overflow-hidden"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduced ? undefined : { opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.18 }}
        >
          {/* F-8C — fixed header. Never scrolls. */}
          <div className="flex-none flex flex-col items-center gap-1.5 px-4 pt-4 pb-2">
            <h2
              id="blocker-prompt-heading"
              className="font-display text-[1.4rem] leading-tight text-ink-black"
            >
              Block Step
            </h2>

            {/* F-8D — same duel language as the combat beats (see
                CounterPrompt): attacker LEFT +5°, defender RIGHT −5°. */}
            <div className="flex items-center gap-3" aria-label="Attack summary" data-duel-header>
              {attackerCard && (
                <div className="flex flex-col items-center gap-0.5">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`View ${attackerCard.name} enlarged`}
                    data-duel-header-card={pending?.attackerInstanceId}
                    onClick={() => setInspectIid(pending?.attackerInstanceId ?? null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setInspectIid(pending?.attackerInstanceId ?? null);
                      }
                    }}
                    style={{ width: CARD_DIMS.hand.w, height: CARD_DIMS.hand.h, transform: 'rotate(5deg)' }}
                    className="relative cursor-pointer rounded-[3px] focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
                  >
                    <CardArt inst={attackerInst} card={attackerCard} size="hand" />
                  </div>
                  <span className="text-[0.5625rem] font-body font-extrabold uppercase tracking-wider text-ink-iron">
                    Attacker
                  </span>
                </div>
              )}
              <span className="font-display text-[1.5rem] leading-none text-sun-brass" aria-hidden="true">⚔</span>
              {targetCard && (
                <div className="flex flex-col items-center gap-0.5">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`View ${targetCard.name} enlarged`}
                    data-duel-header-card={pending?.targetInstanceId}
                    onClick={() => setInspectIid(pending?.targetInstanceId ?? null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setInspectIid(pending?.targetInstanceId ?? null);
                      }
                    }}
                    style={{ width: CARD_DIMS.hand.w, height: CARD_DIMS.hand.h, transform: 'rotate(-5deg)' }}
                    className="relative cursor-pointer rounded-[3px] focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
                  >
                    <CardArt inst={targetInst} card={targetCard} size="hand" />
                  </div>
                  <span className="text-[0.5625rem] font-body font-extrabold uppercase tracking-wider text-ink-iron">
                    Defender
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* F-8C — internal-scroll PROMPT-size tile list. Fixed tile size;
              selection highlights via ring, never resizes. */}
          {blockerOptions.length > 0 && (
            <div className="flex-1 min-h-0 w-full overflow-y-auto px-4 py-1">
              <p className="text-[0.6875rem] text-center font-body font-extrabold uppercase tracking-wider text-ink-iron mb-2">
                Tap a blocker to select · View to read
              </p>
              <div className="flex flex-wrap items-start justify-center gap-3 max-w-[460px] mx-auto" aria-label="Available blockers">
                {blockerOptions.map((a) => {
                  const inst = instances[a.blockerInstanceId];
                  const card = inst ? library[inst.cardId] : undefined;
                  if (!inst || !card) return null;
                  const isSelected = selectedIid === a.blockerInstanceId;
                  const dimmed = selectedIid !== null && !isSelected;
                  return (
                    <div key={a.blockerInstanceId} className="flex flex-col items-center gap-1">
                      <div
                        role="button"
                        tabIndex={0}
                        data-blocker-instance-id={a.blockerInstanceId}
                        data-selected={isSelected || undefined}
                        aria-pressed={isSelected}
                        aria-label={`${isSelected ? 'Confirm' : 'Select'} blocker ${card.name}`}
                        onClick={() => handleTileTap(a)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleTileTap(a);
                          }
                        }}
                        className={[
                          'relative cursor-pointer rounded-[4px] transition-opacity',
                          'focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none',
                          dimmed ? 'opacity-40' : 'opacity-100',
                          isSelected ? 'ring-4 ring-seal-red shadow-[0_0_12px_rgba(168,38,31,0.45)]' : '',
                        ].join(' ')}
                      >
                        <CardArt inst={inst} card={card} size="prompt" highlighted={isSelected} />
                      </div>
                      <span
                        className={[
                          'max-w-[110px] truncate text-[0.625rem] font-body font-extrabold uppercase tracking-wider tabular',
                          isSelected ? 'text-seal-red' : 'text-ink-iron',
                        ].join(' ')}
                      >
                        {card.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => setInspectIid(a.blockerInstanceId)}
                        aria-label={`View ${card.name} enlarged`}
                        data-blocker-view={a.blockerInstanceId}
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
          )}

          {/* F-8C — fixed footer: confirm (if selected) + skip always visible. */}
          <div className="flex-none flex flex-col items-center gap-2 px-4 pb-4 pt-2">
            {selectedIid !== null && (
              <button
                type="button"
                onClick={handleConfirm}
                data-action="CONFIRM_BLOCKER"
                className="min-h-[48px] min-w-[200px] rounded-2xl bg-seal-red
                           px-5 py-2 font-body font-extrabold uppercase tracking-wider
                           text-paper-cream shadow-[0_4px_12px_rgba(168,38,31,0.30)]
                           focus-visible:ring-2 focus-visible:ring-sun-brass
                           focus-visible:outline-none"
              >
                Use {selectedName}
              </button>
            )}
            <button
              type="button"
              onClick={handleSkip}
              disabled={!hasSkip}
              aria-disabled={!hasSkip}
              data-action="SKIP_BLOCKER"
              className="min-h-[44px] min-w-[160px] rounded-2xl bg-hull-teal
                         px-5 py-2 font-body font-extrabold uppercase tracking-wider
                         text-paper-cream shadow-[0_4px_12px_rgba(15,69,73,0.30)]
                         focus-visible:ring-2 focus-visible:ring-sun-brass
                         focus-visible:outline-none disabled:opacity-50
                         disabled:cursor-not-allowed"
            >
              Skip Blocker
            </button>
          </div>

          {/* Standard read view (size C — same as CardDetailModal) */}
          {inspectIid !== null && (
            <CardInspectOverlay
              inst={instances[inspectIid]}
              card={instances[inspectIid] ? library[instances[inspectIid]!.cardId] : undefined}
              onClose={() => setInspectIid(null)}
              group={{
                ids: blockerOptions.map((a) => a.blockerInstanceId),
                currentId: inspectIid,
                onNavigate: setInspectIid,
              }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default BlockerPrompt;
