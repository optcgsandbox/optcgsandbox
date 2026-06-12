// App — visual-spec.md §4.4 letterbox shell.
// Portrait phone aspect (max-width 430px), centered on desktop with the
// daylight backdrop bleeding to the screen edges. Header carries the mode
// switcher + reset + theme toggle. PlayfieldStage owns all gameplay surface.

import { useCallback, useState } from 'react';
import { useGameStore } from './store/game';
import { useTheme } from './hooks/useTheme';
import { PlayfieldStage } from './components/PlayfieldStage';
import DevGameSandbox from './dev/DevGameSandbox';
import OnlineLobby from './online/OnlineLobby';
import type { GameMode } from './store/game';

const isDevSandbox =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('dev') === '1';

const isOnlineLobby =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('online') === '1';

const MODE_LABEL: Record<GameMode, string> = {
  'vs-easy': 'Easy',
  'vs-medium': 'Medium',
  'vs-hard': 'Hard',
};

const MODES: GameMode[] = ['vs-easy', 'vs-medium', 'vs-hard'];

// Phase-reactive End-Turn affordance moved to src/components/EndTurnButton.tsx
// 2026-05-29 (rendered inline in LeaderRow on YOUR side).

export default function App() {
  // Route-style switches live OUTSIDE the game component so its hooks are
  // unconditional (react-hooks/rules-of-hooks).
  if (isOnlineLobby) return <OnlineLobby />;
  if (isDevSandbox) return <DevGameSandbox />;
  return <GameApp />;
}

function GameApp() {
  const state = useGameStore((s) => s.state);
  const mode = useGameStore((s) => s.mode);
  const setMode = useGameStore((s) => s.setMode);
  const reset = useGameStore((s) => s.reset);
  const aiThinking = useGameStore((s) => s.aiThinking);
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

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
      // TRUE FULLSCREEN (owner 2026-06-12): a fixed box pinned to the
      // viewport whose BOTTOM extends past it by the home-indicator inset —
      // installed-app standalone viewports end above that strip, so plain
      // inset-0 left it unpainted. Fixed elements create no document
      // overflow, so scrolling (incl. iOS rubber-band) stays impossible.
      // Browsers report inset 0 → identical to inset-0 there.
      className="fixed grid w-full place-items-center overflow-hidden"
      style={{
        background: 'var(--backdrop-gradient)',
        top: 0,
        left: 0,
        right: 0,
        bottom: 'calc(-1 * env(safe-area-inset-bottom, 0px))',
      }}
    >
      {/* ORIGINAL board shell (geometry restored per owner 2026-06-12):
          portrait letterbox, full height, max-width 430px, NO transform
          scaling — the playmat sizes itself with dvh rows exactly as the
          deployed build does. New F-8D features mount ON TOP of it. */}
      {/* Edge-to-edge (owner 2026-06-12): the installed app draws UNDER the
          iOS status clock + the gesture bars on both platforms — the safe-
          area strips are play surface, not reserved padding. Android hides
          the status bar outright via manifest display:fullscreen. */}
      <div
        className="relative h-full w-full max-w-[430px] bg-paper-cream
                   shadow-[var(--shadow-frame)] ring-1 ring-marine-fog/30"
      >
        {/* F-8D addendum — compact header (logo mini + turn/phase + active
            player) with secondary controls (difficulty / reset / theme)
            tucked into a hamburger sheet. Same absolute overlay slot as the
            original header — board sizing is untouched by it. Gameplay
            actions (End Turn, prompts) stay on the board. */}
        <header
          data-testid="app-header"
          className="absolute inset-x-0 top-0 z-50 flex items-center
                     justify-between gap-2 px-3 py-1.5"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="flex items-baseline gap-2 min-w-0">
            <h1
              className="font-display text-[0.8125rem] leading-none whitespace-nowrap"
              style={{ color: 'var(--color-text-1)' }}
            >
              OPTCG<span className="text-sun-brass">S</span>
            </h1>
            <p
              className="truncate text-[0.6rem] font-body font-bold uppercase tracking-wider"
              style={{ color: 'var(--color-text-2)' }}
              role="status"
              aria-live="polite"
            >
              T{state.turn} · {state.phase} · {state.activePlayer === 'A' ? 'Your turn' : 'Opponent'}
              {aiThinking ? ' · AI…' : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label="Open game menu"
            data-testid="header-menu-button"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-full
                       bg-paper-fog/60 text-ink-iron ring-1 ring-marine-fog/40
                       hover:bg-paper-fog
                       focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
              <path fillRule="evenodd" d="M3 5.25a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 5.25Zm0 4.75A.75.75 0 0 1 3.75 9.25h12.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 10Zm0 4.75a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
            </svg>
          </button>

          {menuOpen && (
            <div
              data-testid="header-menu"
              role="menu"
              className="absolute right-2 top-full z-50 mt-1 flex w-48 flex-col gap-2
                         rounded-xl bg-paper-cream p-3 shadow-[0_8px_24px_rgba(15,20,15,0.25)]
                         ring-1 ring-marine-fog/40"
            >
              <span className="text-[0.6rem] font-body font-extrabold uppercase tracking-wider text-ink-iron">
                Difficulty
              </span>
              <div className="flex items-center gap-1">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { onPickMode(m); setMenuOpen(false); }}
                    aria-pressed={mode === m}
                    className={[
                      'min-h-[28px] flex-1 rounded-full px-2 py-0.5 text-[0.6rem]',
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
              </div>
              <button
                type="button"
                onClick={() => { reset(); setMenuOpen(false); }}
                className="min-h-[32px] rounded-full bg-paper-fog/60 px-2 py-1
                           text-[0.65rem] font-body font-extrabold uppercase
                           tracking-wider text-ink-iron ring-1 ring-marine-fog/40
                           hover:bg-paper-fog
                           focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
              >
                Reset game
              </button>
              <button
                type="button"
                onClick={() => { toggleTheme(); }}
                aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
                className="min-h-[32px] rounded-full bg-hull-teal px-2 py-1
                           text-[0.65rem] font-body font-extrabold uppercase
                           tracking-wider text-paper-cream
                           focus-visible:ring-2 focus-visible:ring-sun-brass focus-visible:outline-none"
              >
                {theme === 'light' ? 'Dark theme' : 'Light theme'}
              </button>
            </div>
          )}
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

      {/* Portrait-only policy — rotated phone browsers see this instead of
          a broken board (CSS-gated; never matches desktop or portrait). */}
      <div
        className="rotate-gate fixed inset-0 z-[100] flex-col items-center justify-center
                   gap-3 bg-paper-cream px-6 text-center"
        role="status"
        data-testid="rotate-gate"
      >
        <span className="font-display text-[1.4rem] text-ink-black">
          Please rotate your device
        </span>
        <span className="max-w-[300px] text-[0.8125rem] font-body text-ink-iron">
          OPTCGSandbox is a portrait game — turn your phone upright to play.
        </span>
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
