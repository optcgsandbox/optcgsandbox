// EndTurnButton — phase-reactive End-Turn / DECLINE BLOCK / DECLINE COUNTER
// button. Owner direction 2026-05-29: lives inline in the leader row to the
// RIGHT of the Deck slot, filling the empty space (was floating bottom-right
// in App.tsx). Hidden when CardDetailModal is open so it doesn't bleed
// through into the modal context.

import { memo, useCallback, useMemo } from 'react';
import { useGameStore } from '../store/game';
import type { Action } from '@shared/protocol/actions';
import type { Phase, PlayerId } from '@shared/engine/GameState';

interface Affordance {
  label: string;
  enabled: boolean;
  action: Action | null;
  isEndTurn: boolean;
}

function computeAffordance(
  phase: Phase,
  activePlayer: PlayerId,
  viewAs: PlayerId,
  gameOver: boolean,
): Affordance {
  if (gameOver) {
    return { label: 'GAME OVER', enabled: false, action: null, isEndTurn: false };
  }
  const isYourTurn = activePlayer === viewAs;
  if (isYourTurn) {
    if (phase === 'main') {
      return { label: 'END TURN', enabled: true, action: null, isEndTurn: true };
    }
    if (phase === 'attack_declaration' || phase === 'damage_resolution') {
      return { label: 'ATTACKING…', enabled: false, action: null, isEndTurn: false };
    }
    if (phase === 'trigger_window') {
      return { label: 'TRIGGER…', enabled: false, action: null, isEndTurn: false };
    }
    return { label: 'OPPONENT’S TURN', enabled: false, action: null, isEndTurn: false };
  }
  if (phase === 'block_window') {
    return {
      label: 'DECLINE BLOCK',
      enabled: true,
      action: { type: 'SKIP_BLOCKER' },
      isEndTurn: false,
    };
  }
  if (phase === 'counter_window') {
    return {
      label: 'DECLINE COUNTER',
      enabled: true,
      action: { type: 'SKIP_COUNTER' },
      isEndTurn: false,
    };
  }
  if (phase === 'trigger_window') {
    return { label: 'TRIGGER…', enabled: false, action: null, isEndTurn: false };
  }
  return { label: 'OPPONENT’S TURN', enabled: false, action: null, isEndTurn: false };
}

export const EndTurnButton = memo(function EndTurnButton() {
  const state = useGameStore((s) => s.state);
  const viewAs = useGameStore((s) => s.viewAs);
  const aiThinking = useGameStore((s) => s.aiThinking);
  const endTurnAndAdvance = useGameStore((s) => s.endTurnAndAdvance);
  const dispatch = useGameStore((s) => s.dispatch);
  const cardDetailOpen = useGameStore((s) => s.cardDetailOpen);

  const affordance = useMemo(
    () => computeAffordance(state.phase, state.activePlayer, viewAs, !!state.result),
    [state.phase, state.activePlayer, viewAs, state.result],
  );

  const onClick = useCallback(() => {
    if (!affordance.enabled) return;
    if (affordance.isEndTurn) {
      void endTurnAndAdvance();
      return;
    }
    if (affordance.action) dispatch(affordance.action);
  }, [affordance, endTurnAndAdvance, dispatch]);

  if (cardDetailOpen) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!affordance.enabled || aiThinking}
      aria-label={affordance.label}
      aria-busy={aiThinking}
      className="rounded-[10px] bg-seal-red px-1.5 py-1 font-body text-[0.65rem]
                 font-extrabold uppercase tracking-wider text-paper-cream
                 shadow-[0_3px_8px_rgba(168,38,31,0.30)]
                 disabled:opacity-40 disabled:cursor-not-allowed
                 focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none
                 leading-tight text-center"
      style={{
        // Width matches the trash slot (--zone-trash-w 52px) so the End-Turn
        // button + trash pile form a vertical pair on the right edge.
        width: 'var(--zone-trash-w, 52px)',
        minHeight: 36,
        // Force "END TURN" / "DECLINE BLOCK" etc. onto two lines via
        // word-wrap; tracking-wider gives the lines breathing room.
        whiteSpace: 'normal',
        wordBreak: 'break-word',
      }}
    >
      {affordance.label}
    </button>
  );
});
