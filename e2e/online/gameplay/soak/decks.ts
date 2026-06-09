/**
 * F-7k BUG-007 — Soak matchup matrix.
 *
 * The online lobby's color selector (`src/online/OnlineLobby.tsx`) drives
 * `buildOnlineDeck(color)` from `src/online/buildDeck.ts:28`. We pick six
 * colors and a fixed-order matchup matrix the soak orchestrator iterates.
 * Each matchup runs N games with alternating first-player roles when
 * possible (the worker's randomU32 seed plus dice-roll loop in
 * `worker/devSetup.ts:115-127` decides actual first-player, so alternation
 * is best-effort — we re-pair on each game so the seed changes).
 *
 * Task-specified archetypes (red aggro / blue control / black removal /
 * yellow trigger / purple ramp / green rest) are NOT differentiated at
 * deck-composition level: `buildOnlineDeck` picks legal cards per color
 * without an archetype filter. The soak proves the engine + projection
 * + UI survive REAL play against REAL corpus decks across all six
 * colors; it does not prove archetype-level strategy.
 */

export type DeckColor = 'red' | 'blue' | 'green' | 'purple' | 'black' | 'yellow';

export interface Matchup {
  readonly id: string;
  readonly a: DeckColor;
  readonly b: DeckColor;
  /** Number of games to attempt for this matchup. */
  readonly games: number;
}

export const SOAK_MATCHUPS: ReadonlyArray<Matchup> = process.env.SOAK_FULL === '1'
  ? [
      { id: 'red-vs-blue', a: 'red', b: 'blue', games: 3 },
      { id: 'red-vs-green', a: 'red', b: 'green', games: 3 },
      { id: 'red-vs-yellow', a: 'red', b: 'yellow', games: 3 },
      { id: 'purple-vs-black', a: 'purple', b: 'black', games: 3 },
      { id: 'yellow-vs-green', a: 'yellow', b: 'green', games: 3 },
      { id: 'mirror-red', a: 'red', b: 'red', games: 3 },
    ]
  : [{ id: 'red-vs-blue', a: 'red', b: 'blue', games: 1 }];

/** Sum of games across matchups — quick reference for the orchestrator. */
export const SOAK_TOTAL_GAMES: number = SOAK_MATCHUPS.reduce(
  (acc, m) => acc + m.games,
  0,
);
