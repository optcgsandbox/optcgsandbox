// Top-level game state. Pure data — all logic lives in phases/, rules/, and the
// per-action handlers. State is treated as immutable: applyAction returns a new state.
//
// Per backend-architecture.md §1, this module must have ZERO browser-API
// dependencies (no DOM, no localStorage, no setTimeout). Driver/runtime supplies
// the Random instance and clock.

import type { Card, LeaderCard } from './cards/Card';

export type PlayerId = 'A' | 'B';

export type Phase =
  | 'refresh'
  | 'draw'
  | 'don'
  | 'main'
  | 'attack_declaration'
  | 'block_window'
  | 'counter_window'
  | 'damage_resolution'
  | 'end';

/** State of a card on the field. */
export interface CardInstance {
  /** Unique per-game instance ID. Distinct from Card.id (the printing). */
  instanceId: string;
  cardId: string; // → Card.id
  controller: PlayerId;
  rested: boolean;
  /** DON cards attached (each grants +1000 power this turn or until detached). */
  attachedDon: number;
  /** Per-turn flags — reset at end of turn. */
  perTurn: {
    hasAttacked: boolean;
    onceEffectUsed: boolean;
  };
  /** True if the instance was played this turn — blocks attack unless Rush. Cleared in Refresh. */
  summoningSick: boolean;
}

export interface PlayerZones {
  leader: CardInstance;
  /** Hand IDs — referenced by instanceId. Card identities hidden from opponent (see serializeForPlayer). */
  hand: string[];
  /** Deck top → bottom. Card identities hidden. */
  deck: string[];
  /** Trash (discard) — face-up, public. */
  trash: string[];
  /** Character + Stage cards on the board. Capped at 5 characters per §3.4 of rules-reference.md. */
  field: CardInstance[];
  /** Life cards — top to bottom. Face-down to both players. */
  life: string[];
  /** Active (face-up) DON not yet attached. */
  donActive: number;
  /** Rested (used) DON in the cost area, to be refreshed next refresh phase. */
  donRested: number;
  /** DON deck — count of remaining DON cards (10 minus already-dealt). */
  donDeck: number;
}

export interface GameState {
  /** Seed used to spawn the Random for this game. Persisted for replay. */
  seed: number;
  /** Turn number, starts at 1 (player A's first turn). */
  turn: number;
  activePlayer: PlayerId;
  phase: Phase;
  players: Record<PlayerId, PlayerZones>;
  /** Card definitions referenced by instances in this game. Lookup by Card.id. */
  cardLibrary: Record<string, Card>;
  /** All CardInstances by instanceId (incl. ones in hand/deck so we can reveal them later). */
  instances: Record<string, CardInstance>;
  /** Append-only log of game events. Used by the UI + as the dispute-resolution truth. */
  history: GameEvent[];
  /** When non-null, the game is over. */
  result: GameResult | null;
}

export interface GameResult {
  winner: PlayerId | 'draw';
  reason: 'lethal' | 'deck_out' | 'resignation' | 'timeout';
}

export type GameEvent =
  | { type: 'GAME_STARTED'; firstPlayer: PlayerId }
  | { type: 'CARD_DRAWN'; player: PlayerId; instanceId: string }
  | { type: 'CARD_PLAYED'; player: PlayerId; instanceId: string; cost: number }
  | { type: 'ATTACK_DECLARED'; attacker: string; target: string }
  | { type: 'BLOCKER_ACTIVATED'; blocker: string }
  | { type: 'COUNTER_PLAYED'; instanceId: string; boost: number }
  | { type: 'CARD_KOED'; instanceId: string }
  | { type: 'LIFE_TAKEN'; player: PlayerId; instanceId: string }
  | { type: 'DON_DEALT'; player: PlayerId; count: number }
  | { type: 'DON_ATTACHED'; targetInstanceId: string; count: number }
  | { type: 'PHASE_CHANGED'; phase: Phase }
  | { type: 'TURN_ENDED'; player: PlayerId }
  | { type: 'GAME_ENDED'; result: GameResult };

/** Default OPTCG values per rules-reference.md §1.1. */
export const RULES = {
  DECK_SIZE: 50,
  COPIES_PER_CARD: 4,
  LIFE_DEFAULT: 5,
  DON_DECK_SIZE: 10,
  STARTING_HAND: 5,
  MAX_CHARACTERS_ON_FIELD: 5,
  DON_PER_TURN_AFTER_FIRST: 2,
  DON_PER_TURN_FIRST: 1, // First player skips DON+draw equivalent on turn 1.
} as const;

/** Build a fresh, deterministic game state given two decks + a seed. */
export function initialState(args: {
  seed: number;
  decks: Record<PlayerId, { leader: LeaderCard; cards: Card[] }>;
}): GameState {
  // Engine doesn't seed RNG here — that happens in the bootstrap phase function
  // when the caller is ready to commit to shuffle order. This keeps the surface pure.
  const library: Record<string, Card> = {};
  const instances: Record<string, CardInstance> = {};
  const players: Record<PlayerId, PlayerZones> = {} as Record<PlayerId, PlayerZones>;

  let nextInstance = 0;
  const mintInstance = (cardId: string, controller: PlayerId): CardInstance => {
    const instanceId = `i${nextInstance++}`;
    const inst: CardInstance = {
      instanceId,
      cardId,
      controller,
      rested: false,
      attachedDon: 0,
      perTurn: { hasAttacked: false, onceEffectUsed: false },
      summoningSick: false,
    };
    instances[instanceId] = inst;
    return inst;
  };

  for (const pid of ['A', 'B'] as PlayerId[]) {
    const deck = args.decks[pid];
    library[deck.leader.id] = deck.leader;
    for (const c of deck.cards) library[c.id] = c;

    const leaderInst = mintInstance(deck.leader.id, pid);
    const deckInsts = deck.cards.map((c) => mintInstance(c.id, pid).instanceId);

    players[pid] = {
      leader: leaderInst,
      hand: [],
      deck: deckInsts, // Caller must shuffle in a separate setup step using Random.
      trash: [],
      field: [],
      life: [],
      donActive: 0,
      donRested: 0,
      donDeck: RULES.DON_DECK_SIZE,
    };
  }

  return {
    seed: args.seed,
    turn: 1,
    activePlayer: 'A',
    phase: 'refresh',
    players,
    cardLibrary: library,
    instances,
    history: [],
    result: null,
  };
}
