// PhaseColumn — design-reference.md §3.4 L7.
// Vertical column of phase chips: Refresh → Draw → DON!! → Main → End.
// Active chip = sun-brass background + ink-black text (full opacity);
// inactive chips = marine-fog at 30% opacity with ink-iron text. Replaces
// the horizontal PhaseRibbon for the official Bandai-aligned layout.
//
// `aria-current="step"` is set on the active chip so screen readers can
// follow turn progress.

import { memo } from 'react';
import { useGameStore } from '../../store/game';
import type { Phase, PlayerId } from '@shared/engine/GameState';

interface PhaseColumnProps {
  /** Which player's phase column this is — used to gray out when it isn't this player's turn. */
  playerId: PlayerId;
  isYou: boolean;
}

/** The five player-visible turn phases shown on the Bandai playmat.
 *  Reactive windows (attack/block/counter/damage/trigger) are NOT shown here;
 *  they live in the AttackResolutionOverlay + TriggerPrompt. The `end` phase
 *  is collapsed into "End". */
const PHASE_SEQUENCE: { key: PhaseLike; label: string }[] = [
  { key: 'refresh', label: 'Refresh' },
  { key: 'draw', label: 'Draw' },
  { key: 'don', label: 'DON!!' },
  { key: 'main', label: 'Main' },
  { key: 'end', label: 'End' },
];

type PhaseLike = 'refresh' | 'draw' | 'don' | 'main' | 'end';

/** Map any engine phase to the player-facing 5-step sequence. Reactive
 *  windows resolve back to 'main' since they're sub-states of the Main Phase. */
function mapPhase(phase: Phase): PhaseLike | null {
  switch (phase) {
    case 'refresh':
    case 'draw':
    case 'don':
    case 'main':
    case 'end':
      return phase;
    case 'attack_declaration':
    case 'block_window':
    case 'counter_window':
    case 'damage_resolution':
    case 'trigger_window':
      return 'main';
    default:
      return null;
  }
}

export const PhaseColumn = memo(function PhaseColumn({ playerId, isYou }: PhaseColumnProps) {
  const phase = useGameStore((s) => s.state.phase);
  const activePlayer = useGameStore((s) => s.state.activePlayer);

  const currentStep = activePlayer === playerId ? mapPhase(phase) : null;
  const ownerLabel = isYou ? 'Your' : 'Opponent';

  return (
    <div
      role="list"
      aria-label={`${ownerLabel} phase progress`}
      className="flex h-full flex-col items-stretch justify-center gap-1"
      style={{ width: '52px', minWidth: '52px' }}
    >
      {PHASE_SEQUENCE.map(({ key, label }) => {
        const isActive = key === currentStep;
        return (
          <div
            key={key}
            role="listitem"
            aria-current={isActive ? 'step' : undefined}
            className={[
              'rounded-md px-1.5 py-0.5 text-center font-body text-[0.55rem]',
              'font-extrabold uppercase tracking-wider leading-tight',
              isActive
                ? 'bg-sun-brass text-ink-black shadow-[0_1px_3px_rgba(0,0,0,0.30)]'
                : 'bg-marine-fog/30 text-ink-iron',
            ].join(' ')}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
});
