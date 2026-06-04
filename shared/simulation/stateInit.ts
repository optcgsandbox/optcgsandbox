/**
 * State-init wrapper around engine-v2 setup.
 *
 * Reads cards.json once (lazily, module-scope cache), exposes a deterministic
 * factory for fresh GameStates given a seed + two built decks. Delegates ALL
 * shape construction to engine-v2's `initialState` + `setupGame` — no
 * shadow-state, no field mutations.
 *
 * Also handles one-time registry init for action reducers + handlers.
 */

// @ts-expect-error Node built-ins resolve at runtime
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime
import { fileURLToPath } from 'node:url';

import type { Card } from '../engine-v2/cards/Card.js';
import { registerAllReducers } from '../engine-v2/reducers/index.js';
import { registerAllHandlers } from '../engine-v2/registry/handlers/index.js';
import { initialState } from '../engine-v2/setup/initialState.js';
import { setupGame } from '../engine-v2/setup/setupGame.js';
import type { GameState } from '../engine-v2/state/types.js';

import type { BuiltDeck } from './deckBuilder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

let allCardsCache: ReadonlyArray<Card> | null = null;
let registriesInitialized = false;

export function loadAllCards(): ReadonlyArray<Card> {
  if (allCardsCache !== null) return allCardsCache;
  const path = resolve(__dirname, '../data/cards.json');
  const raw = readFileSync(path, 'utf-8');
  allCardsCache = JSON.parse(raw) as ReadonlyArray<Card>;
  return allCardsCache;
}

export function ensureRegistries(): void {
  if (registriesInitialized) return;
  registerAllReducers();
  registerAllHandlers();
  registriesInitialized = true;
}

/**
 * Build a fresh, ready-to-play GameState. Engine-v2's setupGame shuffles
 * decks (via its own RngService seeded from `seed`), deals opening hands,
 * and opens the dice_roll window. Phase = 'dice_roll' on return.
 */
export function buildInitialState(
  seed: number,
  decks: { A: BuiltDeck; B: BuiltDeck },
): GameState {
  ensureRegistries();
  const args = {
    seed,
    decks: {
      A: { leader: decks.A.leader, cards: decks.A.cards },
      B: { leader: decks.B.leader, cards: decks.B.cards },
    },
  };
  const s0 = initialState(args);
  return setupGame(s0);
}
