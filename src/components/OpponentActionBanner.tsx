// OpponentActionBanner — transient "what just happened" pill above the playmat.
//
// Owner direction 2026-05-29: opp turns were running at 250ms/action with no
// visible feedback. The store now paces AI actions to 1500ms (game.ts:
// AI_ACTION_DELAY_MS); this banner is the readability surface that pairs
// with the slowed pacing — it labels each engine event as it happens so the
// human can follow what the opponent is doing.
//
// Pattern: subscribe to state.history (append-only), track lastProcessed
// index, and surface ONE pill at a time on a sequential queue. New events
// that arrive while a pill is showing are queued and replayed in order
// (no overlap). Each pill holds for ~1.4s then dismisses. Engine state is
// NEVER mutated.
//
// Skipped event types: PHASE_CHANGED for attack_declaration / block_window
// / counter_window / trigger_window — those already have dedicated
// fullscreen overlays (AttackResolutionOverlay, TriggerPrompt). The banner
// surfaces the play loop OUTSIDE those dramatic moments.

import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import type { GameEvent, GameState, PlayerId, Phase } from '@shared/engine/GameState';

const HOLD_MS = 1400;

interface QueuedPill {
  /** Unique key for AnimatePresence — we want each new pill to mount fresh. */
  key: number;
  message: string;
}

/** Map an engine event into a banner-friendly message string, or null to
 *  skip it (overlay handles it elsewhere, or it's noise). `state` is needed
 *  to look up card names + resolve target labels. `viewAs` re-points
 *  "you" / "opponent" to the viewer's seat. */
function describeEvent(
  ev: GameEvent,
  state: GameState,
  viewAs: PlayerId,
): string | null {
  const owner = (pid: PlayerId): string => (pid === viewAs ? 'You' : 'Opponent');

  // Resolve a card name from an instanceId via the cardLibrary lookup.
  const nameOf = (instanceId: string): string => {
    const inst = state.instances[instanceId];
    if (!inst) return 'a card';
    const card = state.cardLibrary[inst.cardId];
    return card?.name ?? 'a card';
  };

  switch (ev.type) {
    case 'PHASE_CHANGED': {
      // Skip reactive-window phases — they already have dedicated overlays.
      const skip: Phase[] = [
        'attack_declaration',
        'block_window',
        'counter_window',
        'trigger_window',
        'damage_resolution',
        'dice_roll',
        'first_player_choice',
        'mulligan_first',
        'mulligan_second',
        'end',
      ];
      if (skip.includes(ev.phase)) return null;
      const owningPlayer = state.activePlayer;
      const label =
        ev.phase === 'refresh'
          ? 'Refresh'
          : ev.phase === 'draw'
            ? 'Draw'
            : ev.phase === 'don'
              ? 'DON!! Phase'
              : ev.phase === 'main'
                ? 'Main'
                : null;
      if (!label) return null;
      return `${owner(owningPlayer)}: ${label}`;
    }
    case 'CARD_DRAWN':
      return `${owner(ev.player)} drew a card`;
    case 'DON_DEALT':
      return `${owner(ev.player)} +${ev.count} DON`;
    case 'CARD_PLAYED':
      return `${owner(ev.player)} played ${nameOf(ev.instanceId)}`;
    case 'DON_ATTACHED':
      return `${owner(state.activePlayer)} attached +${ev.count * 1000} DON`;
    case 'ATTACK_DECLARED':
      return `${owner(state.activePlayer)} attacks ${nameOf(ev.target)}`;
    case 'CARD_KOED':
      return `${nameOf(ev.instanceId)} K.O.'d`;
    case 'LIFE_TAKEN':
      return `${owner(ev.player)} damaged`;
    case 'TURN_ENDED':
      return `${owner(ev.player)} ends turn`;
    default:
      return null;
  }
}

export const OpponentActionBanner = memo(function OpponentActionBanner() {
  const history = useGameStore((s) => s.state.history);
  const state = useGameStore((s) => s.state);
  const viewAs = useGameStore((s) => s.viewAs);
  const reduced = useReducedMotion() ?? false;

  // Last index we've already enqueued. Ref so we don't re-render when it
  // advances — only when the visible pill flips.
  const lastSeenRef = useRef(0);
  // Queue of pills waiting to display. Sequential — pill N+1 doesn't mount
  // until pill N has dismissed.
  const [queue, setQueue] = useState<QueuedPill[]>([]);
  const [active, setActive] = useState<QueuedPill | null>(null);
  // Monotonic key — guarantees AnimatePresence treats each pill as a new
  // child even if the message string repeats.
  const nextKeyRef = useRef(1);

  // Drain new history entries into the queue.
  useEffect(() => {
    if (history.length <= lastSeenRef.current) return;
    const incoming: QueuedPill[] = [];
    for (let i = lastSeenRef.current; i < history.length; i++) {
      const message = describeEvent(history[i], state, viewAs);
      if (message) {
        incoming.push({ key: nextKeyRef.current++, message });
      }
    }
    lastSeenRef.current = history.length;
    if (incoming.length > 0) {
      setQueue((q) => [...q, ...incoming]);
    }
  }, [history, state, viewAs]);

  // Pump the queue: when nothing active, take the head.
  useEffect(() => {
    if (active || queue.length === 0) return;
    setActive(queue[0]);
    setQueue((q) => q.slice(1));
  }, [active, queue]);

  // Dismiss the active pill after the hold window.
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => setActive(null), reduced ? 250 : HOLD_MS);
    return () => window.clearTimeout(t);
  }, [active, reduced]);

  // Reset on game reset (history shrinks back to a small number).
  useEffect(() => {
    if (history.length < lastSeenRef.current) {
      lastSeenRef.current = 0;
      setQueue([]);
      setActive(null);
    }
  }, [history.length]);

  return (
    <div
      // Top-center overlay, sits above app chrome but below modals (z-50).
      // pointer-events-none so the pill never blocks taps on the playmat.
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ top: 'calc(6dvh + env(safe-area-inset-top, 0px) + 12px)' }}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <AnimatePresence>
        {active && (
          <motion.div
            key={active.key}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.01 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-full bg-paper-cream/95 px-4 py-1.5
                       text-[0.8125rem] font-body font-bold tracking-wide
                       text-ink-iron shadow-[0_4px_12px_rgba(15,69,73,0.18)]
                       ring-1 ring-marine-fog/30"
            style={{
              borderLeft: '4px solid var(--color-brass-canary, #e8b43d)',
              maxWidth: 'min(360px, 92vw)',
            }}
          >
            {active.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default OpponentActionBanner;
