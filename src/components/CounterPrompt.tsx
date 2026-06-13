// CounterPrompt — F-7q — 2-step counter picker with live power math.
//
// Owner direction (F-7q): "Counter step. Show: Attacker Power vs Defender
// Power. 5000 ⚔️ 4000. Then available counter cards AS CARDS. Clickable.
// Card click: animates to counter pile, power updates immediately.
// 5000 ⚔️ 6000. Show: '+2000 Guard Point'. No hidden effect. NO 8-second
// fake timer. Optional: 2-minute chess timer ONLY."
//
// Default: NO timer (owner direction "DEFAULT OFF"). Override per spec or
// future settings via `window.__COUNTER_TIMER_MS`.

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt, CARD_DIMS } from './CardArt';
import { CardInspectOverlay } from './CardInspectOverlay';
import { ArrowPagedRow } from './ArrowPagedRow';
import { FitScale } from './FitScale';
import { useOverlayBox } from '../hooks/useOverlayBox';
import { effectivePowerForDisplay } from '@shared/engine-v2/state/derived/power';
import type { Action } from '@shared/engine-v2/protocol/actions';

function readTimerMs(): number | null {
  if (typeof window !== 'undefined') {
    const override = (window as unknown as { __COUNTER_TIMER_MS?: number }).__COUNTER_TIMER_MS;
    if (typeof override === 'number' && override > 0) return override;
  }
  // Owner direction: default OFF. The 2-minute chess timer is opt-in
  // (future settings toggle); for now, returning null disables the
  // auto-skip.
  return null;
}

function fmtMmss(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const CounterPrompt = memo(function CounterPrompt() {
  const phase = useGameStore((s) => s.state.phase);
  const viewAs = useGameStore((s) => s.viewAs);
  const fullState = useGameStore((s) => s.state);
  const dispatch = useGameStore((s) => s.dispatch);
  const legalActions = useGameStore((s) => s.legalActions);
  const reduced = useReducedMotion() ?? false;

  const pending = fullState.pending?.kind === 'attack' ? fullState.pending.pendingAttack : null;
  const instances = fullState.instances;
  const library = fullState.cardLibrary;

  const counterOptions = legalActions.filter(
    (a): a is Extract<Action, { type: 'PLAY_COUNTER' }> => a.type === 'PLAY_COUNTER',
  );
  const hasSkip = legalActions.some((a) => a.type === 'SKIP_COUNTER');

  const defenderId = pending ? instances[pending.targetInstanceId]?.controller : null;
  const isDefender = defenderId !== null && defenderId === viewAs;

  const open =
    phase === 'counter_window' &&
    isDefender &&
    (counterOptions.length > 0 || hasSkip);

  // Battle math.
  const attackerInst = pending ? instances[pending.attackerInstanceId] : undefined;
  const attackerCard = attackerInst ? library[attackerInst.cardId] : undefined;
  const targetInst = pending ? instances[pending.targetInstanceId] : undefined;
  const targetCard = targetInst ? library[targetInst.cardId] : undefined;
  const attackerPower = attackerInst ? effectivePowerForDisplay(fullState, attackerInst) : null;
  const targetPower = targetInst ? effectivePowerForDisplay(fullState, targetInst) : null;
  const counterBoost = pending?.counterBoost ?? 0;
  const targetEffective =
    targetPower !== null && targetPower !== undefined ? targetPower + counterBoost : null;
  const survives =
    attackerPower !== null && attackerPower !== undefined &&
    targetEffective !== null && targetEffective !== undefined &&
    targetEffective >= attackerPower;

  // 2-step selection state.
  const [selectedIid, setSelectedIid] = useState<string | null>(null);
  // F-8C — standard read view (size C) opened from a tile's VIEW button.
  const [inspectIid, setInspectIid] = useState<string | null>(null);
  // Overlay-fit (owner 2026-06-12): the tile lane never vertical-scrolls —
  // tiles shrink to the lane's real height; width overflow pages with ‹ ›.
  const laneRef = useRef<HTMLDivElement | null>(null);
  const laneBox = useOverlayBox(laneRef);

  useEffect(() => {
    if (!open && selectedIid !== null) setSelectedIid(null);
    if (!open && inspectIid !== null) setInspectIid(null);
  }, [open, selectedIid, inspectIid]);

  // Optional timer (default OFF per owner direction). Initialise to the
  // override value (if set) so the countdown text renders synchronously
  // on first frame — the effect below then ticks it down.
  const [remainingMs, setRemainingMs] = useState<number>(() => readTimerMs() ?? 0);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      startedAtRef.current = null;
      setRemainingMs(0);
      return undefined;
    }
    const total = readTimerMs();
    if (total === null) {
      // Timer disabled.
      startedAtRef.current = null;
      setRemainingMs(0);
      return undefined;
    }
    startedAtRef.current = Date.now();
    setRemainingMs(total);
    const tickInterval = window.setInterval(() => {
      const started = startedAtRef.current;
      if (started === null) return;
      const elapsed = Date.now() - started;
      const next = Math.max(0, total - elapsed);
      setRemainingMs(next);
      if (next === 0) {
        window.clearInterval(tickInterval);
        const cur = useGameStore.getState();
        if (cur.state.phase !== 'counter_window') return;
        if (cur.state.pending?.kind !== 'attack') return;
        const def = cur.state.instances[cur.state.pending.pendingAttack.targetInstanceId]?.controller;
        if (def !== cur.viewAs) return;
        dispatch({ type: 'SKIP_COUNTER' });
      }
    }, 250);
    return () => {
      window.clearInterval(tickInterval);
      startedAtRef.current = null;
    };
  }, [open, dispatch]);

  const handleSkip = useCallback(() => {
    setSelectedIid(null);
    dispatch({ type: 'SKIP_COUNTER' });
  }, [dispatch]);

  const handleTileTap = useCallback(
    (a: Extract<Action, { type: 'PLAY_COUNTER' }>) => {
      if (selectedIid === a.instanceId) {
        setSelectedIid(null);
        dispatch(a);
      } else {
        setSelectedIid(a.instanceId);
      }
    },
    [dispatch, selectedIid],
  );

  const handleConfirm = useCallback(() => {
    if (selectedIid === null) return;
    const a = counterOptions.find((x) => x.instanceId === selectedIid);
    if (!a) return;
    setSelectedIid(null);
    dispatch(a);
  }, [dispatch, selectedIid, counterOptions]);

  const selectedCard = selectedIid
    ? library[instances[selectedIid]?.cardId ?? '']
    : null;
  const selectedBoost = selectedCard
    ? selectedCard.counterValue ??
      (selectedCard as { counterEventBoost?: number | null }).counterEventBoost ??
      null
    : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="counter-prompt-heading"
          data-pending-kind="counter_window"
          className="prompt-safe fixed inset-0 z-50 flex flex-col items-center
                     bg-paper-cream/95 backdrop-blur-sm overflow-hidden"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduced ? undefined : { opacity: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.18 }}
        >
          {/* F-8C — fixed header: context + math. Never scrolls. */}
          <div className="flex-none flex flex-col items-center gap-1.5 px-4 pt-4 pb-2">
            <h2 id="counter-prompt-heading" className="font-display text-[1.4rem] leading-tight text-ink-black">
              Counter Step
            </h2>

            {/* F-8D — attack summary uses the SAME duel language as the
                combat beats (attacker LEFT +5°, defender RIGHT −5°, power
                plates) so combat reads identically in every direction. */}
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
                  <span className="font-display text-[0.875rem] leading-none text-seal-red tabular">{attackerPower ?? ''}</span>
                  <span className="text-[0.5625rem] font-body font-extrabold uppercase tracking-wider text-ink-iron">Attacker</span>
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
                  <span className="font-display text-[0.875rem] leading-none text-hull-teal tabular">{targetEffective ?? ''}</span>
                  <span className="text-[0.5625rem] font-body font-extrabold uppercase tracking-wider text-ink-iron">Defender</span>
                </div>
              )}
            </div>

            {/* Power-math readout */}
            {attackerPower !== null && attackerPower !== undefined &&
              targetEffective !== null && targetEffective !== undefined && (
                <div className="flex flex-col items-center gap-0.5" aria-live="polite">
                  <div className="flex items-baseline gap-2 tabular">
                    <span className="font-display text-[1.4rem] leading-none text-seal-red">{attackerPower}</span>
                    <span className="font-display text-[1rem] leading-none text-ink-iron">⚔</span>
                    <span className={[
                      'font-display text-[1.4rem] leading-none',
                      survives ? 'text-hull-teal' : 'text-ink-iron',
                    ].join(' ')}>{targetEffective}</span>
                  </div>
                  <span
                    data-testid="counter-prompt-boost"
                    className="text-[0.6875rem] font-body font-extrabold uppercase tracking-wider text-ink-iron"
                  >
                    Counter so far: +{counterBoost}
                    {selectedBoost !== null ? ` · selected: +${selectedBoost}` : ''}
                  </span>
                </div>
              )}
          </div>

          {/* Overlay-fit (owner 2026-06-12): NO vertical scroll — one
              ArrowPagedRow of fixed PROMPT tiles (side-scroll with ‹ ›);
              FitScale shrinks the block only when the lane is shorter
              than one tile row. */}
          {counterOptions.length > 0 && (
            <div
              ref={laneRef}
              className="flex flex-col flex-1 min-h-0 w-full items-center justify-center overflow-hidden px-4 py-1"
            >
              <FitScale maxW={laneBox.w} maxH={laneBox.h} contentWidth={laneBox.w || undefined}>
              <p className="text-[0.6875rem] text-center font-body font-extrabold uppercase tracking-wider text-ink-iron mb-2">
                Tap a counter to select · View to read
              </p>
              <ArrowPagedRow step={122} gap={12} idPrefix="counter-row" ariaLabel="Available counters">
                {counterOptions.map((a) => {
                  const inst = instances[a.instanceId];
                  const card = inst ? library[inst.cardId] : undefined;
                  if (!inst || !card) return null;
                  const cv = card.counterValue ?? (card as { counterEventBoost?: number | null }).counterEventBoost ?? null;
                  const isSelected = selectedIid === a.instanceId;
                  const dimmed = selectedIid !== null && !isSelected;
                  return (
                    <div key={a.instanceId} className="flex flex-col items-center gap-1">
                      <div
                        role="button"
                        tabIndex={0}
                        data-counter-instance-id={a.instanceId}
                        data-selected={isSelected || undefined}
                        aria-pressed={isSelected}
                        aria-label={`${isSelected ? 'Confirm' : 'Select'} counter ${card.name}`}
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
                        {cv !== null ? `+${cv}` : 'Counter'} · {card.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => setInspectIid(a.instanceId)}
                        aria-label={`View ${card.name} enlarged`}
                        data-counter-view={a.instanceId}
                        className="rounded px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide
                                   bg-ink-black/10 text-ink-iron hover:bg-ink-black/20"
                      >
                        View
                      </button>
                    </div>
                  );
                })}
              </ArrowPagedRow>
              </FitScale>
            </div>
          )}

          {/* F-8C — fixed footer: CTAs always visible, never scrolled away. */}
          <div className="flex-none flex flex-col items-center gap-2 px-4 pb-4 pt-2">
            {selectedIid !== null && (
              <button
                type="button"
                onClick={handleConfirm}
                data-action="CONFIRM_COUNTER"
                className="min-h-[48px] min-w-[200px] rounded-2xl bg-seal-red
                           px-5 py-2 font-body font-extrabold uppercase tracking-wider
                           text-paper-cream shadow-[0_4px_12px_rgba(168,38,31,0.30)]
                           focus-visible:ring-2 focus-visible:ring-sun-brass
                           focus-visible:outline-none"
              >
                Use {selectedCard?.name ?? 'Counter'}{selectedBoost !== null ? ` (+${selectedBoost})` : ''}
              </button>
            )}
            <button
              type="button"
              onClick={handleSkip}
              disabled={!hasSkip}
              aria-disabled={!hasSkip}
              data-action="SKIP_COUNTER"
              className="min-h-[44px] min-w-[180px] rounded-2xl bg-hull-teal
                         px-5 py-2 font-body font-extrabold uppercase tracking-wider
                         text-paper-cream shadow-[0_4px_12px_rgba(15,69,73,0.30)]
                         focus-visible:ring-2 focus-visible:ring-sun-brass
                         focus-visible:outline-none disabled:opacity-50
                         disabled:cursor-not-allowed"
            >
              {counterBoost > 0 ? 'Done' : 'Skip Counter'}
            </button>
            {remainingMs > 0 && (
              <span
                data-testid="counter-prompt-countdown"
                className="text-[0.625rem] font-body font-extrabold uppercase tracking-wider text-ink-iron tabular"
              >
                Auto-decline in {fmtMmss(remainingMs)}
              </span>
            )}
          </div>

          {/* Standard read view (size C — same as CardDetailModal) */}
          {inspectIid !== null && (
            <CardInspectOverlay
              inst={instances[inspectIid]}
              card={instances[inspectIid] ? library[instances[inspectIid]!.cardId] : undefined}
              onClose={() => setInspectIid(null)}
              group={{
                ids: counterOptions.map((a) => a.instanceId),
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

export default CounterPrompt;
