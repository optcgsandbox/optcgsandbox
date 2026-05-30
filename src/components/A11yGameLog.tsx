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
import type { GameEvent } from '@shared/engine/GameState';

/** How many tail events to surface. Live regions debounce updates anyway. */
const TAIL = 6;

function format(event: GameEvent, lookup: (id: string) => string): string | null {
  switch (event.type) {
    case 'GAME_STARTED':
      return `Game started. ${event.firstPlayer} goes first.`;
    case 'DICE_ROLLED':
      return event.winner
        ? `Dice rolled: ${event.a} vs ${event.b}. ${event.winner} wins.`
        : `Dice tied at ${event.a}. Re-rolling.`;
    case 'FIRST_PLAYER_CHOSEN':
      return `${event.chooser} chose ${event.goesFirst} to go first.`;
    case 'MULLIGAN_DECISION':
      return `${event.player} ${event.kept ? 'kept their hand' : 'mulliganed'}.`;
    case 'LIFE_DEALT':
      return `Life cards placed.`;
    case 'CARD_DRAWN':
      return null; // too chatty for live region
    case 'CARD_PLAYED':
      return `${event.player} played ${lookup(event.instanceId)} (cost ${event.cost}).`;
    case 'ATTACK_DECLARED':
      return `${lookup(event.attacker)} attacks ${lookup(event.target)}.`;
    case 'BLOCKER_ACTIVATED':
      return `${lookup(event.blocker)} blocks.`;
    case 'COUNTER_PLAYED':
      return `Counter played, +${event.boost} power.`;
    case 'CARD_KOED':
      return `${lookup(event.instanceId)} knocked out.`;
    case 'LIFE_TAKEN':
      return `${event.player} took a life card.`;
    case 'DON_DEALT':
      return null; // routine
    case 'DON_ATTACHED':
      return `+${event.count} DON attached to ${lookup(event.targetInstanceId)}.`;
    case 'TRIGGER_FLIPPED':
      return `${event.player}'s life card has a Trigger.`;
    case 'TRIGGER_RESOLVED':
      return event.activated
        ? `Trigger activated.`
        : `Trigger declined; card to hand.`;
    case 'PHASE_CHANGED':
      return null; // already announced by phase pill aria-current
    case 'TURN_ENDED':
      return `${event.player}'s turn ended.`;
    case 'GAME_ENDED':
      return `Game over. Winner: ${event.result.winner ?? 'draw'} (${event.result.reason}).`;
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
