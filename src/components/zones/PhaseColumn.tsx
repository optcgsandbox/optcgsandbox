// PhaseColumn — playmat-redesign.md §2.9.
//
// Vertical column of 5 phase chips printed to the LEFT of the LEADER on the
// Bandai playsheet:
//
//   ┌──────────────┐
//   │ Refresh Phase│
//   └──────┬───────┘
//          │
//          ▼
//   ┌──────────────┐
//   │  Draw Phase  │
//   └──────┬───────┘
//          │
//          ▼
//   ┌──────────────┐
//   │  DON!! Phase │
//   └──────┬───────┘
//          │
//          ▼
//   ┌──────────────┐
//   │  Main Phase  │   ← ACTIVE (brass fill)
//   └──────┬───────┘
//          │
//          ▼
//   ┌──────────────┐
//   │  End Phase   │
//   └──────────────┘
//
// Active chip = sun-brass fill + ink-black text. Inactive = ink-iron fill
// with cream text — matches the Bandai cardboard playsheet (dark chips on
// gray paper). Connecting arrows are decorative.

import { memo } from 'react';
import { useGameStore } from '../../store/game';
import type { Phase, PlayerId } from '@shared/engine/GameState';

interface PhaseColumnProps {
  playerId: PlayerId;
  isYou: boolean;
}

const PHASE_SEQUENCE: { key: PhaseLike; label: string }[] = [
  { key: 'refresh', label: 'Refresh' },
  { key: 'draw', label: 'Draw' },
  { key: 'don', label: 'DON!!' },
  { key: 'main', label: 'Main' },
  { key: 'end', label: 'End' },
];

type PhaseLike = 'refresh' | 'draw' | 'don' | 'main' | 'end';

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
    <ol
      data-flip-back
      aria-label={`${ownerLabel} phase progress`}
      className="flex h-full flex-col items-center justify-center list-none p-0 m-0"
      style={{
        width: 56,
        minWidth: 56,
        gap: 0,
      }}
    >
      {PHASE_SEQUENCE.map(({ key, label }, idx) => {
        const isActive = key === currentStep;
        const isLast = idx === PHASE_SEQUENCE.length - 1;
        return (
          <li key={key} className="flex flex-col items-center" style={{ width: '100%' }}>
            <div
              aria-current={isActive ? 'step' : undefined}
              aria-label={isActive ? `${label} phase (active)` : undefined}
              aria-hidden={!isActive}
              className={[
                'flex w-full items-center justify-center rounded-[5px] font-display tracking-wider',
                'leading-none',
                isActive
                  ? 'bg-sun-brass text-ink-black shadow-[0_1px_3px_rgba(0,0,0,0.35)]'
                  : 'bg-ink-iron/85',
              ].join(' ')}
              style={{
                fontSize: 8,
                // Accordion-style: active phase shows the full label at full
                // size; inactive phases collapse to a thin label-less pill so
                // the column fits inside the leader-row vertical budget.
                padding: isActive ? '3.5px 4px' : '0 4px',
                letterSpacing: '0.06em',
                minHeight: isActive ? 14 : 4,
                width: isActive ? '100%' : '60%',
              }}
            >
              {isActive ? label : ''}
            </div>
            {!isLast && (
              <svg
                viewBox="0 0 10 8"
                width={10}
                height={4}
                aria-hidden="true"
                style={{ margin: '1px 0' }}
              >
                <path
                  d="M5 0 L5 5 M1.5 3.5 L5 7 L8.5 3.5"
                  fill="none"
                  stroke="var(--color-ink-iron)"
                  strokeOpacity={0.55}
                  strokeWidth={1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </li>
        );
      })}
    </ol>
  );
});
