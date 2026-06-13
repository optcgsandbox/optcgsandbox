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
import { useDonArm } from '../store/donArm';
import { CardArt, CARD_DIMS } from './CardArt';
import { INSPECT_SCALE } from './cardSizing';
import { useOverlayBox } from '../hooks/useOverlayBox';
import { FitScale } from './FitScale';
import { CarouselNav } from './InspectCarousel';
import {
  type InspectGroup,
  useCarouselKeys,
  useCarouselSwipe,
} from '../lib/inspectCarousel';
import type { Action } from '@shared/engine-v2/protocol/actions';

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
  const history = useGameStore((s) => s.state.history);
  const dispatch = useGameStore((s) => s.dispatch);
  const players = useGameStore((s) => s.state.players);
  const selectedAttackerId = useGameStore((s) => s.selectedAttackerId);
  const setSelectedAttackerId = useGameStore((s) => s.setSelectedAttackerId);
  const armedDonId = useDonArm((s) => s.armedDonId);
  const disarmDon = useDonArm((s) => s.disarm);
  const reduced = useReducedMotion() ?? false;

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Overlay-fit (owner 2026-06-12: everything that opens must fit, no
  // vertical scroll EVER — shrink instead). Measure the available column
  // on a PLAIN div (the panel animates scale on entry, which would skew
  // rects). The art + breakdown render at full INSPECT size and are
  // wrapped in <FitScale>, which measures their natural size and scales
  // the whole group down to fit the space ABOVE the action buttons. The
  // buttons stay full-size (44px touch targets) below. scale === 1 on any
  // screen tall enough → pixel-identical to the old full-size modal.
  const fitRef = useRef<HTMLDivElement>(null);
  const box = useOverlayBox(fitRef);
  const ART_TOP = 48; // breathing room above the card
  const ART_GAP = 14; // gap between the scaled card group and the buttons
  const BUTTONS_H = 44;
  const artMaxH = box.h > 0 ? box.h - ART_TOP - ART_GAP - BUTTONS_H : 9999;
  const artMaxW = box.w > 0 ? box.w : 9999;

  const inst = inspectedCardId ? instances[inspectedCardId] : undefined;
  const card = inst ? library[inst.cardId] : undefined;

  // Carousel context (owner 2026-06-12): when the modal was opened from a
  // GROUP (hand / trash), arrows + keys + swipe browse it; the action
  // buttons recompute per card. Single-card contexts (board) pass no group.
  const inspectGroup = useGameStore((s) => s.inspectGroup);
  const group: InspectGroup | null =
    open && inspectGroup && inspectGroup.length > 1 && inspectedCardId
      ? {
          ids: inspectGroup,
          currentId: inspectedCardId,
          onNavigate: (id) => setInspectedCardId(id),
        }
      : null;
  useCarouselKeys(group);
  const swipe = useCarouselSwipe(group);
  const lastIndexRef = useRef(group ? group.ids.indexOf(group.currentId) : 0);
  const curIndex = group ? group.ids.indexOf(group.currentId) : 0;
  const slideDir = curIndex >= lastIndexRef.current ? 1 : -1;
  useEffect(() => {
    lastIndexRef.current = curIndex;
  }, [curIndex]);

  const close = useCallback(() => {
    setCardDetailOpen(false);
    // CLOSE must also clear inspectedCardId so hand cards return to their
    // resting state in the fan (otherwise the inspected card stays lifted
    // + siblings stay dimmed).
    setInspectedCardId(null);
  }, [setCardDetailOpen, setInspectedCardId]);

  // Decide action buttons per kind + phase.
  const buttons: ActionButton[] = useMemo(() => {
    if (!inst || !card) return [{ label: 'CLOSE', action: null, variant: 'secondary' }];
    if (result) {
      return [{ label: 'CLOSE', action: null, variant: 'secondary' }];
    }

    const isYourTurn = activePlayer === viewAs;
    const isMain = isYourTurn && phase === 'main';
    const isOppCounterWindow = !isYourTurn && phase === 'counter_window';

    // Field-card affordances — tap any field card opens this modal; actions
    // exposed depend on whose card it is + state (per owner direction 2026-05-29).
    const friendlyId: 'A' | 'B' = viewAs;
    const friendly = players[friendlyId];
    const opponentId: 'A' | 'B' = viewAs === 'A' ? 'B' : 'A';
    const opponent = players[opponentId];
    const isFriendlyLeader = inst.instanceId === friendly.leader.instanceId;
    const isFriendlyCharOrStage =
      friendly.field.some((i) => i.instanceId === inst.instanceId) ||
      friendly.stage?.instanceId === inst.instanceId;
    const isOppLeader = inst.instanceId === opponent.leader.instanceId;
    const isOppCharOrStage =
      opponent.field.some((i) => i.instanceId === inst.instanceId) ||
      opponent.stage?.instanceId === inst.instanceId;
    const onField = isFriendlyLeader || isFriendlyCharOrStage || isOppLeader || isOppCharOrStage;

    if (onField) {
      const out: ActionButton[] = [];
      // ATTACH DON — owner has armed a DON; this is a friendly attach target.
      if (armedDonId && (isFriendlyLeader || isFriendlyCharOrStage)) {
        const attach = legalActions.find(
          (a) => a.type === 'ATTACH_DON' && a.targetInstanceId === inst.instanceId,
        );
        if (attach) {
          out.push({ label: 'ATTACH DON', action: attach, variant: 'primary-teal' });
        }
      }
      // ATTACK THIS — owner has selected an attacker; this is a legal opp target.
      if (selectedAttackerId && (isOppLeader || isOppCharOrStage)) {
        const attack = legalActions.find(
          (a) =>
            a.type === 'DECLARE_ATTACK' &&
            a.attackerInstanceId === selectedAttackerId &&
            a.targetInstanceId === inst.instanceId,
        );
        if (attack) {
          out.push({ label: 'ATTACK THIS', action: attack, variant: 'primary-red' });
        }
      }
      // SELECT AS ATTACKER — this friendly card can attack right now.
      if (isYourTurn && (isFriendlyLeader || isFriendlyCharOrStage) && !armedDonId) {
        const canAttack = legalActions.some(
          (a) => a.type === 'DECLARE_ATTACK' && a.attackerInstanceId === inst.instanceId,
        );
        if (canAttack) {
          out.push({
            label: selectedAttackerId === inst.instanceId ? 'CANCEL ATTACK' : 'SELECT AS ATTACKER',
            action: null, // handled out-of-band so we toggle state, then close
            variant: selectedAttackerId === inst.instanceId ? 'secondary' : 'primary-red',
          });
        }
      }
      // ACTIVATE — Phase C / D12 (CR §10-2-13). Friendly card with an
      // [Activate:Main] ability that isn't rested yet.
      if (isYourTurn && (isFriendlyLeader || isFriendlyCharOrStage) && !armedDonId) {
        const activate = legalActions.find(
          (a) => a.type === 'ACTIVATE_MAIN' && a.instanceId === inst.instanceId,
        );
        if (activate) {
          out.push({ label: 'ACTIVATE EFFECT', action: activate, variant: 'primary-teal' });
        }
      }
      out.push({ label: 'CLOSE', action: null, variant: 'secondary' });
      // If we tagged a SELECT button, intercept it via a sentinel before returning.
      return out;
    }

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
  }, [
    inst,
    card,
    result,
    activePlayer,
    viewAs,
    phase,
    legalActions,
    players,
    armedDonId,
    selectedAttackerId,
  ]);

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
    (action: Action | null, label?: string) => {
      // Sentinel labels handled out-of-band (toggle UI state, not dispatch).
      if (!action) {
        if (label === 'SELECT AS ATTACKER' && inst) {
          setSelectedAttackerId(inst.instanceId);
          close();
          return;
        }
        if (label === 'CANCEL ATTACK') {
          setSelectedAttackerId(null);
          close();
          return;
        }
        close();
        return;
      }
      // ATTACH_DON path clears the armed-DON state immediately.
      if (action.type === 'ATTACH_DON') disarmDon();
      // DECLARE_ATTACK path clears selectedAttacker.
      if (action.type === 'DECLARE_ATTACK') setSelectedAttackerId(null);
      dispatch(action);
      setCardDetailOpen(false);
      setInspectedCardId(null);
    },
    [dispatch, close, setCardDetailOpen, setInspectedCardId, inst, setSelectedAttackerId, disarmDon],
  );

  // Backdrop click closes. The inner card panel has stopPropagation so
  // child clicks never bubble here — any click that reaches the backdrop
  // means the user tapped outside the card content.
  const onBackdropClick = useCallback(() => close(), [close]);

  if (!open || !inst || !card) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-[55] flex items-start justify-center"
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
          onClick={(e) => {
            // F-7r: when TrashViewer is open behind us, tap-outside on the
            // detail modal must NOT close the trash too. Stop propagation so
            // TrashViewer's backdrop handler doesn't also fire.
            e.stopPropagation();
            onBackdropClick();
          }}
          aria-hidden={!open}
        >
          {/* Plain measurer column (no transform animation — rects stay
              honest). Fills the padded backdrop; clicks on empty area
              bubble to the backdrop handler and close. */}
          <div
            ref={fitRef}
            className="flex h-full w-full max-w-[386px] flex-col"
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
            className="relative flex h-full w-full flex-col items-center"
            style={{
              // Owner direction 2026-05-29: transparent — let the card itself
              // self-frame. No panel chrome, no border, no shadow, no padding.
              // NOTE: no stopPropagation here — clicks on empty panel area
              // (above/sides of the card) MUST close the modal. Only the card
              // art itself and the action buttons absorb clicks.
              background: 'transparent',
              padding: 0,
            }}
          >
            {/* Art + breakdown render at full INSPECT size and are scaled as
                a group by <FitScale> to fit the space above the buttons
                (overlay-fit, owner 2026-06-12). scale === 1 on any screen
                tall enough → pixel-identical to the old 330×462 modal; on
                short/narrow boxes the group shrinks uniformly so the card,
                its power math, AND the buttons are ALWAYS fully visible. No
                vertical scroll, ever. The ART_TOP margin is OUTSIDE FitScale
                so it never scales. */}
            <FitScale
              maxW={artMaxW}
              maxH={artMaxH}
              contentWidth="max-content"
              className="flex flex-col items-center"
              style={{ marginTop: ART_TOP }}
            >
            <div
              className="relative flex-none"
              onClick={(e) => e.stopPropagation()}
              data-testid="detail-card-art"
              style={{
                width: CARD_DIMS.modal.w * INSPECT_SCALE,
                height: CARD_DIMS.modal.h * INSPECT_SCALE,
              }}
              {...swipe}
            >
              {/* Carousel slide — keyed on the inspected card; the fit-box
                  frame never resizes during navigation. */}
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={inspectedCardId ?? 'card'}
                  initial={reduced || !group ? false : { x: 40 * slideDir, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={reduced || !group ? undefined : { x: -40 * slideDir, opacity: 0 }}
                  transition={{ duration: reduced ? 0.01 : 0.14 }}
                  style={{ position: 'absolute', inset: 0 }}
                >
                  <div
                    style={{
                      transform: `scale(${INSPECT_SCALE})`,
                      transformOrigin: 'top left',
                      width: CARD_DIMS.modal.w,
                      height: CARD_DIMS.modal.h,
                    }}
                  >
                    <CardArt card={card} size="modal" />
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {group && <CarouselNav group={group} counterAt="top" />}

            {/* Accessibility-only name (sr-only) so the dialog aria-labelledby resolves. */}
            <h2 id="card-detail-name" className="sr-only">
              {card.name} ({card.kind})
            </h2>

            {/* F-8D — power-modifier breakdown. Generic: sums the same
                buckets effectivePower uses and attributes sources from
                POWER_MODIFIED history events targeting this instance.
                Hidden when there are no live modifiers. */}
            {(() => {
              const liveInst = inspectedCardId !== null ? instances[inspectedCardId] : undefined;
              if (!liveInst) return null;
              const mods =
                (liveInst.powerModifierThisBattle ?? 0) +
                (liveInst.powerModifierOneShot ?? 0) +
                (liveInst.powerModifierContinuous ?? 0);
              // DON adds +1000 each, but ONLY while the controller is the
              // active player (power.ts:43-50). Surface it so the breakdown
              // reconciles to the power stamp (owner 2026-06-12).
              const donCount =
                activePlayer === liveInst.controller
                  ? liveInst.attachedDon.length + liveInst.attachedDonRested.length
                  : 0;
              const donBoost = donCount * 1000;
              if (mods === 0 && donBoost === 0) return null;
              // Override-aware base — matches effectivePower exactly so
              // base + DON + effects === the card's power stamp.
              const printedPower =
                typeof (card as { power?: number | null }).power === 'number'
                  ? (card as { power: number }).power
                  : 0;
              const base =
                liveInst.basePowerOverrideOneShot ??
                liveInst.basePowerOverrideContinuous ??
                printedPower;
              // Attribute sources: most recent POWER_MODIFIED events for this
              // instance whose amounts still sum toward the live total.
              const sources: Array<{ name: string; amount: number; duration: string }> = [];
              let remaining = mods;
              for (let i = history.length - 1; i >= 0 && remaining !== 0; i -= 1) {
                const ev = history[i] as { type?: string; targetInstanceId?: string; sourceInstanceId?: string; amount?: number; duration?: string };
                if (ev.type !== 'POWER_MODIFIED' || ev.targetInstanceId !== inspectedCardId) continue;
                if (typeof ev.amount !== 'number' || ev.amount === 0) continue;
                const srcInst = typeof ev.sourceInstanceId === 'string' ? instances[ev.sourceInstanceId] : undefined;
                const srcCard = srcInst ? library[srcInst.cardId] : undefined;
                sources.unshift({
                  name: srcCard?.name ?? 'Effect',
                  amount: ev.amount,
                  duration: ev.duration ?? 'this_turn',
                });
                remaining -= ev.amount;
              }
              return (
                <div
                  data-testid="detail-power-breakdown"
                  className="mx-auto mt-2 max-w-[320px] rounded-lg bg-ink-black/10 px-3 py-2 text-center"
                >
                  <span className="font-display text-[1.0625rem] leading-tight text-ink-black tabular">
                    {(() => {
                      const delta = donBoost + mods;
                      return `${base} ${delta > 0 ? '+' : ''}${delta} = ${base + delta}`;
                    })()}
                  </span>
                  {(donBoost !== 0 || sources.length > 0) && (
                    <div className="mt-1 flex flex-col items-center gap-0.5">
                      {/* DON contribution — +1000 per attached DON (owner
                          2026-06-12). Listed alongside the effect ±. Darker +
                          larger than before for legibility (owner feedback). */}
                      {donBoost !== 0 && (
                        <span
                          data-testid="detail-don-line"
                          className="text-[0.8125rem] font-body font-semibold text-ink-black/85 tabular"
                        >
                          +{donBoost} from {donCount} DON
                        </span>
                      )}
                      {sources.map((src, idx) => (
                        <span
                          key={`${src.name}-${idx}`}
                          className="text-[0.8125rem] font-body font-semibold text-ink-black/85 tabular"
                        >
                          {src.amount > 0 ? '+' : ''}{src.amount} from {src.name}
                          {src.duration === 'this_battle' ? ' (this battle)' : ' (this turn)'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            </FitScale>

            {/* Action row — OUTSIDE FitScale so buttons keep their full
                44px touch-target size on every screen; sits just below the
                scaled card group. */}
            <div
              className="flex items-center justify-center gap-2"
              style={{ marginTop: ART_GAP }}
            >
              {buttons.map((btn, idx) => {
                const isPrimary = btn.variant !== 'secondary';
                // Skip disabled primaries when binding the ref — focusing a
                // disabled button is a no-op and leaves focus stranded.
                // Fall back to closeButtonRef via the focus useEffect.
                const ref = isPrimary && idx === 0 && !btn.disabled ? primaryButtonRef : undefined;
                return (
                  <button
                    key={`${btn.label}-${idx}`}
                    ref={ref}
                    type="button"
                    onClick={() => onActionClick(btn.action, btn.label)}
                    disabled={btn.disabled}
                    className={[
                      'min-h-[44px] font-display uppercase',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sun-brass',
                      isPrimary
                        ? btn.variant === 'primary-red'
                          ? 'bg-seal-red text-paper-cream'
                          : 'bg-hull-teal text-paper-cream'
                        // Filled dark secondary (not cream) — reads clearly
                        // on the dim backdrop without introducing cream chrome.
                        : 'bg-ink-iron text-paper-cream',
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

// MetaPill removed 2026-05-29 when modal switched to transparent (card
// self-frames; cost/power now read from the scaled card art directly).
