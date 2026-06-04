// App — visual-spec.md §4.4 letterbox shell.
// Portrait phone aspect (max-width 430px), centered on desktop with the
// daylight backdrop bleeding to the screen edges. Header carries the mode
// switcher + reset + theme toggle. PlayfieldStage owns all gameplay surface.

import { useCallback } from 'react';
import { useGameStore } from './store/game';
import { useTheme } from './hooks/useTheme';
import { PlayfieldStage } from './components/PlayfieldStage';
import type { GameMode } from './store/game';

const MODE_LABEL: Record<GameMode, string> = {
  'vs-easy': 'Easy',
  'vs-medium': 'Medium',
  'vs-hard': 'Hard',
};

const MODES: GameMode[] = ['vs-easy', 'vs-medium', 'vs-hard'];

// Phase-reactive End-Turn affordance moved to src/components/EndTurnButton.tsx
// 2026-05-29 (rendered inline in LeaderRow on YOUR side).

export default function App() {
  const state = useGameStore((s) => s.state);
  const mode = useGameStore((s) => s.mode);
  const setMode = useGameStore((s) => s.setMode);
  const reset = useGameStore((s) => s.reset);
  const aiThinking = useGameStore((s) => s.aiThinking);
  const { theme, toggleTheme } = useTheme();

  // End-Turn affordance moved into src/components/EndTurnButton.tsx
  // (rendered inline in LeaderRow on YOUR side).

  const onPickMode = useCallback(
    (m: GameMode) => {
      setMode(m);
      reset();
    },
    [setMode, reset],
  );

  // Game-over splash sits inside the same letterboxed frame so the layout
  // stays consistent (no flash to a different background gradient).
  const isGameOver = !!state.result;

  return (
    <div
      className="grid min-h-dvh w-full place-items-center overflow-hidden"
      style={{ background: 'var(--backdrop-gradient)' }}
    >
      <div
        className="relative h-dvh w-full max-w-[430px] bg-paper-cream
                   shadow-[var(--shadow-frame)] ring-1 ring-marine-fog/30"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Top toolbar — sits above the stage so it never gets eaten by the tilt. */}
        <header
          className="absolute inset-x-0 top-0 z-50 flex items-center justify-between
                     gap-2 px-3 py-1.5"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="flex flex-col">
            <h1
              className="font-display text-[1rem] leading-none"
              style={{ color: 'var(--color-text-1)' }}
            >
              OPTCG<span className="text-sun-brass">Sandbox</span>
            </h1>
            <p
              className="text-[0.6rem] font-body font-bold uppercase tracking-wider"
              style={{ color: 'var(--color-text-2)' }}
              role="status"
              aria-live="polite"
            >
              T{state.turn} · {state.phase}
              {aiThinking ? ' · AI…' : ''}
            </p>
          </div>

          <div className="flex items-center gap-1">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onPickMode(m)}
                aria-pressed={mode === m}
                className={[
                  'min-h-[28px] rounded-full px-2 py-0.5 text-[0.6rem]',
                  'font-body font-extrabold uppercase tracking-wider',
                  'focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none',
                  mode === m
                    ? 'bg-sun-brass text-ink-black'
                    : 'bg-paper-fog/60 text-ink-iron ring-1 ring-marine-fog/40 hover:bg-paper-fog',
                ].join(' ')}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => reset()}
              className="min-h-[28px] rounded-full bg-paper-fog/60 px-2 py-0.5
                         text-[0.6rem] font-body font-extrabold uppercase
                         tracking-wider text-ink-iron ring-1 ring-marine-fog/40
                         hover:bg-paper-fog
                         focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
              className="flex h-7 w-7 items-center justify-center rounded-full
                         bg-hull-teal text-paper-cream
                         focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
            >
              {theme === 'light' ? (
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M17.293 13.293A8 8 0 0 1 6.707 2.707a8.001 8.001 0 1 0 10.586 10.586Z" />
                </svg>
              ) : (
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M10 3a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1Zm0 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6-4a1 1 0 0 1-1 1h-1a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1Zm-11 0a1 1 0 0 1-1 1H3a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1Zm9.192 5.192a1 1 0 0 1-1.414 0l-.707-.707a1 1 0 1 1 1.414-1.414l.707.707a1 1 0 0 1 0 1.414Zm-9.07-9.07a1 1 0 0 1-1.414 0l-.707-.707A1 1 0 1 1 4.414 4.0l.707.707a1 1 0 0 1 0 1.414ZM10 16a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm5.192-10.192a1 1 0 0 1 0-1.414l.707-.707a1 1 0 0 1 1.414 1.414l-.707.707a1 1 0 0 1-1.414 0Zm-9.07 9.07a1 1 0 0 1 0-1.414l.707-.707a1 1 0 1 1 1.414 1.414l-.707.707a1 1 0 0 1-1.414 0Z" />
                </svg>
              )}
            </button>
          </div>
        </header>

        {isGameOver ? (
          <GameOverSplash />
        ) : (
          <>
            <PlayfieldStage />
            {/* End-Turn button moved 2026-05-29 into LeaderRow (your side)
                so it fills the empty space next to Leader/Stage/Deck. See
                src/components/EndTurnButton.tsx. */}
          </>
        )}
      </div>
    </div>
  );
}

function GameOverSplash() {
  const result = useGameStore((s) => s.state.result);
  const reset = useGameStore((s) => s.reset);
  if (!result) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Game over"
      className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4
                 bg-paper-cream/95 backdrop-blur-sm"
    >
      <h2 className="font-display text-[2.5rem] leading-none text-ink-black">
        {`${result.loser === 'A' ? 'B' : 'A'} wins`}
      </h2>
      <p className="font-body text-[0.875rem] uppercase tracking-wider text-ink-iron">
        by {result.reason}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="min-h-[44px] rounded-2xl bg-hull-teal px-6 py-2 font-body
                   font-extrabold uppercase tracking-wider text-paper-cream
                   shadow-[0_4px_12px_rgba(15,69,73,0.30)]
                   focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
      >
        New game
      </button>
    </div>
  );
}
