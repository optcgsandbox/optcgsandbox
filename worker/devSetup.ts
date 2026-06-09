// Dev-only initial-state builder for the Worker.
//
// Mints a deterministic, minimal V2 `GameState` so the v0.3 Matchmaker
// can hand a real, valid initial state to GameRoom `/init`. NOT a
// production match — F-7+ matchmaker passes real player-submitted decks.
// This file exists exclusively so the `room_not_initialized` blocker
// surfaced by F-5d.0 stops blocking everything downstream.
//
// Card definitions are inlined here on purpose: the engine test fixtures
// (`shared/engine-v2/__tests__/fixtures.ts`) live under a path the
// Wrangler bundler may or may not include, and importing test files into
// runtime code is the wrong shape regardless. Local stubs keep the
// runtime bundle clean and the test fixtures self-contained.

import type { Card, LeaderCard } from '@shared/engine-v2/cards/Card';
import { initialState } from '@shared/engine-v2/setup/initialState';
import { setupGame } from '@shared/engine-v2/setup/setupGame';
import { applyAction } from '@shared/engine-v2/reducers';
import { PhaseScheduler } from '@shared/engine-v2/phases/PhaseScheduler';
import type { GameState, PlayerId } from '@shared/engine-v2/state/types';

// Engine registration is the CALLER's responsibility:
//   - Worker runtime: `worker/GameRoom.ts:50-51` calls
//     `registerAllReducers()` + `registerAllHandlers()` at module load.
//     GameRoom.ts is bundled with Matchmaker.ts, so the call fires
//     before any Matchmaker request executes.
//   - Tests: each test file does its own beforeAll registration.
// We do NOT register here because the engine's registry rejects
// duplicate registrations (`shared/engine-v2/reducers/registry.ts:27`).

const DEV_LEADER: LeaderCard = {
  id: 'DEV-LEADER-RED',
  kind: 'leader',
  name: 'Dev Red Leader',
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  colors: ['red'],
  traits: ['Dev'],
  keywords: [],
  effectText: '',
};

const DEV_VANILLA: Card = {
  id: 'DEV-CHAR-VANILLA',
  kind: 'character',
  name: 'Dev Vanilla 3K',
  cost: 2,
  power: 3000,
  counterValue: 1000,
  colors: ['red'],
  traits: ['Dev'],
  keywords: [],
  effectText: '',
};

const DECK_SIZE = 15;

/**
 * Build a deterministic, minimal V2 `GameState` for room bootstrap.
 *
 * - Both sides get the same leader + 15 identical vanilla characters.
 * - `seed` is threaded through; equal seeds yield equal initial states.
 * - Phase starts at `'refresh'` (engine V2 default); no opening hand or
 *   dice roll is performed — Matchmaker just needs a state MatchSession
 *   can hold and project. Real match flow continues from there.
 */
export function buildDevInitialState(seed: number): GameState {
  const deckCards: Card[] = Array.from({ length: DECK_SIZE }, () => DEV_VANILLA);
  return initialState({
    seed,
    decks: {
      A: { leader: DEV_LEADER, cards: deckCards },
      B: { leader: DEV_LEADER, cards: deckCards },
    },
  });
}

// ────────────────────────────────────────────────────────────────────
// F-7g — buildPlayableInitialState
// ────────────────────────────────────────────────────────────────────

const MAX_DICE_RETRIES = 100;

export interface PlayableInitialStateArgs {
  readonly seed: number;
  readonly decks: Readonly<
    Record<PlayerId, { readonly leader: LeaderCard; readonly cards: ReadonlyArray<Card> }>
  >;
}

/**
 * Build a deterministic, PLAYABLE V2 `GameState`. Drives the full
 * engine setup chain via `applyAction` + `PhaseScheduler`, returning
 * a state where:
 *   - `phase === 'main'`
 *   - `activePlayer === 'A'`
 *   - A has a starting hand + life cards + DON-deck/cost-area state
 *
 * Setup chain (per `shared/engine-v2/reducers/setup.ts:5-19`):
 *   initialState → setupGame → dice_roll → first_player_choice →
 *   mulligan_first → mulligan_second → deal_life (auto) → refresh
 *   (firstPlayer turn 1) → enterRefresh → enterDraw → enterDon → enterMain
 *
 * Determinism: if A loses the initial dice roll, the function bumps
 * the seed and rebuilds from `initialState`. Capped at
 * `MAX_DICE_RETRIES` (100) to guarantee termination.
 *
 * First-turn handicap (CR §5-2-1-6): the engine's enterDraw/enterDon
 * already skip draw + DON-gain for the first player on turn 1. The
 * resulting state respects that rule.
 */
export function buildPlayableInitialState(
  args: PlayableInitialStateArgs,
): GameState {
  for (let attempt = 0; attempt <= MAX_DICE_RETRIES; attempt += 1) {
    const tryState = tryDriveSetup({
      ...args,
      seed: args.seed + attempt,
    });
    if (tryState !== null) return tryState;
  }
  throw new Error(
    `buildPlayableInitialState: failed to obtain A-first dice roll within ${MAX_DICE_RETRIES} retries`,
  );
}

function tryDriveSetup(args: PlayableInitialStateArgs): GameState | null {
  let s = initialState(args);
  s = setupGame(s);

  // Dice roll. Both players roll; if A wins, phase advances to
  // 'first_player_choice' with activePlayer='A'. Anything else (tie,
  // or B won) → null so caller bumps seed and retries.
  s = applyAction(
    s,
    'A',
    { type: 'ROLL_DICE', player: 'A' },
    { checkInvariants: false },
  ).state;
  s = applyAction(
    s,
    'B',
    { type: 'ROLL_DICE', player: 'B' },
    { checkInvariants: false },
  ).state;
  if (s.phase !== 'first_player_choice' || s.activePlayer !== 'A') {
    return null;
  }

  // A chooses to go first. Engine then opens mulligan_first.
  s = applyAction(s, 'A', { type: 'CHOOSE_FIRST' }, { checkInvariants: false })
    .state;
  if (s.phase !== 'mulligan_first' || s.activePlayer !== 'A') {
    throw new Error(
      `buildPlayableInitialState: CHOOSE_FIRST reducer left state in phase=${s.phase} activePlayer=${s.activePlayer}`,
    );
  }

  // A keeps. Mulligan window advances to second player.
  s = applyAction(s, 'A', { type: 'KEEP_HAND' }, { checkInvariants: false })
    .state;
  if (s.phase !== 'mulligan_second' || s.activePlayer !== 'B') {
    throw new Error(
      `buildPlayableInitialState: A KEEP_HAND reducer left state in phase=${s.phase} activePlayer=${s.activePlayer}`,
    );
  }

  // B keeps. Engine auto-deals life and enters refresh of A's turn 1
  // (per `shared/engine-v2/reducers/setup.ts:19`).
  s = applyAction(s, 'B', { type: 'KEEP_HAND' }, { checkInvariants: false })
    .state;
  if (s.activePlayer !== 'A') {
    throw new Error(
      `buildPlayableInitialState: post-mulligan activePlayer=${s.activePlayer} (expected A)`,
    );
  }

  // Advance through refresh → draw → don → main. enterDraw + enterDon
  // both honor the first-player-handicap rule internally.
  s = PhaseScheduler.enterRefresh(s);
  s = PhaseScheduler.enterDraw(s);
  s = PhaseScheduler.enterDon(s);
  s = PhaseScheduler.enterMain(s);

  if (s.phase !== 'main') {
    throw new Error(
      `buildPlayableInitialState: enterMain left state in phase=${s.phase}`,
    );
  }
  return s;
}

