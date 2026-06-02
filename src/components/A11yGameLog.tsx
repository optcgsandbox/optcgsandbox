// A11yGameLog — WCAG 4.1.3 Status Messages.
//
// Visually-hidden aria-live="polite" region that announces engine events so
// VoiceOver / TalkBack / NVDA users hear the same beats sighted players see.
// Driven by state.history; we render the latest N events from the tape as
// English sentences. Browsers debounce live-region updates to roughly
// one-per-frame so flooding the log on multi-event ticks is safe.
//
// Out of scope for this iteration:
//   - Localization (English only, matching the rest of the UI).
//   - Per-seat perspective (e.g. "your character vs Roronoa Zoro").
//   - Pruning to "interesting" events for users with verbose-mode off.

import { memo, useMemo } from 'react';
import { useGameStore } from '../store/game';
import type { GameEvent } from '@shared/engine-v2/state/types';

/** How many tail events to surface. Live regions debounce updates anyway. */
const TAIL = 6;

function format(rawEvent: GameEvent, lookup: (id: string) => string): string | null {
  // Engine emits opaque event objects (state.history is ReadonlyArray<GameEvent>).
  // Cast to a permissive shape for per-event property reads — V1 parity.
  const e = rawEvent as { [key: string]: string | number | boolean | { winner?: string; reason?: string } | undefined; type: string };
  switch (e.type) {
    case 'GAME_STARTED':
      return `Game started. ${String(e.firstPlayer)} goes first.`;
    case 'DICE_ROLLED':
      return e.winner
        ? `Dice rolled: ${String(e.a)} vs ${String(e.b)}. ${String(e.winner)} wins.`
        : `Dice tied at ${String(e.a)}. Re-rolling.`;
    case 'FIRST_PLAYER_CHOSEN':
      return `${String(e.chooser)} chose ${String(e.goesFirst)} to go first.`;
    case 'MULLIGAN_DECISION':
      return `${String(e.player)} ${e.kept ? 'kept their hand' : 'mulliganed'}.`;
    case 'LIFE_DEALT':
      return `Life cards placed.`;
    case 'CARD_DRAWN':
      return null;
    case 'CARD_PLAYED':
    case 'CHARACTER_PLAYED':
      return `${String(e.controller ?? e.player)} played ${lookup(String(e.instanceId))} (cost ${String(e.cost)}).`;
    case 'ATTACK_DECLARED':
      return `${lookup(String(e.attackerInstanceId ?? e.attacker))} attacks ${lookup(String(e.targetInstanceId ?? e.target))}.`;
    case 'BLOCKER_DECLARED':
    case 'BLOCKER_ACTIVATED':
      return `${lookup(String(e.blockerInstanceId ?? e.blocker))} blocks.`;
    case 'COUNTER_PLAYED':
      return `Counter played, +${String(e.boost)} power.`;
    case 'CHARACTER_KOD':
    case 'CARD_KOED':
      return `${lookup(String(e.instanceId))} knocked out.`;
    case 'CARD_TRASHED_BY_RULE':
      return `${lookup(String(e.instanceId))} trashed by rule.`;
    case 'LIFE_TAKEN':
    case 'LIFE_CARD_TO_HAND':
      return `${String(e.controller ?? e.player)} took a life card.`;
    case 'DON_DEALT':
      return null;
    case 'DON_ATTACHED':
      return `DON attached to ${lookup(String(e.targetInstanceId))}.`;
    case 'TRIGGER_FLIPPED':
      return `${String(e.player)}'s life card has a Trigger.`;
    case 'TRIGGER_RESOLVED':
      return e.activated
        ? `Trigger activated.`
        : `Trigger declined; card to hand.`;
    case 'PHASE_CHANGED':
      return null;
    case 'TURN_ENDED':
      return `${String(e.player)}'s turn ended.`;
    case 'GAME_ENDED': {
      const r = e.result as { winner?: string; reason?: string } | undefined;
      return `Game over. Winner: ${r?.winner ?? 'draw'} (${r?.reason ?? '?'}).`;
    }
    default:
      return null;
  }
}

export const A11yGameLog = memo(function A11yGameLog() {
  const history = useGameStore((s) => s.state.history);
  const cardLibrary = useGameStore((s) => s.state.cardLibrary);
  const instances = useGameStore((s) => s.state.instances);

  const messages = useMemo(() => {
    const lookup = (instanceId: string) => {
      const inst = instances[instanceId];
      if (!inst) return 'a card';
      const card = cardLibrary[inst.cardId];
      return card?.name ?? 'a card';
    };
    const out: string[] = [];
    // Iterate from end so the tail is most recent. Push in chronological order
    // so SRs read older→newer.
    const slice = history.slice(-TAIL * 2); // grab extra in case some events return null
    for (const ev of slice) {
      const m = format(ev, lookup);
      if (m) out.push(m);
    }
    return out.slice(-TAIL);
  }, [history, cardLibrary, instances]);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      role="log"
      // Visually hidden but still announced. Standard "sr-only" pattern.
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: 'hidden',
        clip: 'rect(0,0,0,0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {messages.map((m, i) => (
        <div key={`${i}-${m}`}>{m}</div>
      ))}
    </div>
  );
});
