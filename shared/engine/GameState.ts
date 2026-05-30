// Top-level game state. Pure data — all logic lives in phases/, rules/, and the
// per-action handlers. State is treated as immutable: applyAction returns a new state.
//
// Per backend-architecture.md §1, this module must have ZERO browser-API
// dependencies (no DOM, no localStorage, no setTimeout). Driver/runtime supplies
// the Random instance and clock.

import { DON_CARD } from './cards/Card';
import type { Card, LeaderCard } from './cards/Card';

export type PlayerId = 'A' | 'B';

export type Phase =
  // D10 (CR §5-2-1-6): mulligan window. Active player decides first
  // (`mulligan_first`), then the other player (`mulligan_second`). Once both
  // have either MULLIGAN'd or KEPT, life cards are dealt (CR §5-2-1-7) and the
  // engine transitions to `refresh` for player A's first turn.
  | 'mulligan_first'
  | 'mulligan_second'
  | 'refresh'
  | 'draw'
  | 'don'
  | 'main'
  | 'attack_declaration'
  | 'block_window'
  | 'counter_window'
  | 'damage_resolution'
  | 'trigger_window'
  | 'end';

/** State of a card on the field. */
export interface CardInstance {
  /** Unique per-game instance ID. Distinct from Card.id (the printing). */
  instanceId: string;
  cardId: string; // → Card.id
  controller: PlayerId;
  rested: boolean;
  /** DON instance IDs attached to this character/leader. Each grants +1000 power
   *  for the controller's turn. On KO / end-of-turn they return to donRested. */
  attachedDon: string[];
  /** Per-turn flags — reset at end of turn. */
  perTurn: {
    hasAttacked: boolean;
    /** D4 (rules-reference.md §15.1 / CR §10-2-13): `[Once Per Turn]` is
     *  per-card, per-effect. Each entry is an effect identifier that has
     *  already fired on THIS card this turn (e.g. `'activate_main'`,
     *  `'on_play_searcher'`). Stored as a string[] because Set is not
     *  preserved through structuredClone in all runtimes; uniqueness is
     *  enforced by consumers via `includes`/`push` guards. */
    effectsUsed: string[];
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
  /** Character cards on the board. Capped at 5 per CR §3-7-6.
   *  Stage cards live in their own single-slot zone (`stage`); they are NEVER
   *  placed here. Pre-2026-05-29 this list mixed Characters + Stage; D1 split
   *  them out per CR §3-8. */
  field: CardInstance[];
  /** Stage Area — single slot, CR §3-8-5. Null when empty. Replacing a Stage
   *  trashes the existing one (CR §3-8-5-1) — handled in applyAction.PLAY_STAGE. */
  stage: CardInstance | null;
  /** Life cards — top to bottom. Face-down to both players. */
  life: string[];
  /** DON deck — remaining DON instance IDs (popped to costArea each DON phase). 10 at setup. */
  donDeck: string[];
  /** Active (face-up) DON in the cost area, available to spend or attach. */
  donCostArea: string[];
  /** Rested (used) DON in the cost area, to be refreshed next refresh phase. */
  donRested: string[];
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
  /** Active attack being resolved through block + counter windows. Null when no attack in flight. */
  pendingAttack: PendingAttack | null;
  /** When non-null, a life card with [Trigger] was just flipped and is awaiting
   *  the controller's choice (activate vs decline). See rules-reference.md §1.7. */
  pendingTrigger: PendingTrigger | null;
  /** D10 (CR §5-2-1-6-1): per-player flag tracking whether the player has
   *  already exhausted their one-time mulligan during the setup window.
   *  Initially false for both. Set true the moment MULLIGAN resolves
   *  (KEEP_HAND does NOT flip this — keeping leaves the option formally
   *  consumed by the phase transition, but the flag is reserved for actual
   *  reshuffles so test surfaces can assert the rule). */
  mulliganUsed: Record<PlayerId, boolean>;
}

export interface PendingAttack {
  attackerInstanceId: string;
  /** Original target chosen by attacker. May be redirected to a blocker. */
  targetInstanceId: string;
  /** Sum of counter boosts played by defender so far (in points; e.g. 1000, 2000). */
  counterBoost: number;
}

export interface PendingTrigger {
  /** The life-card instance that was flipped and has a `trigger` effect tag. */
  lifeCardInstanceId: string;
  /** Whose life was taken — the player who may activate the trigger. */
  controller: PlayerId;
  /** Phase to restore after the trigger choice is resolved. Set to
   *  'damage_resolution' when additional life flips remain (e.g. attacker has
   *  Double Attack and this was the first of two flips); set to 'main' when
   *  damage resolution is finished and play continues in the main phase. */
  resumePhase: Phase;
  /** Number of additional life flips owed AFTER the controller resolves this
   *  trigger. Used for Double Attack (rules-reference.md §1.8): a successful
   *  attack on a leader by a Double Attack source flips 2 life cards in
   *  sequence, with a trigger window between them if either has [Trigger].
   *  Zero for normal single-flip attacks. */
  remainingLifeFlips: number;
}

export interface GameResult {
  winner: PlayerId | 'draw';
  reason: 'lethal' | 'deck_out' | 'resignation' | 'timeout';
}

export type GameEvent =
  | { type: 'GAME_STARTED'; firstPlayer: PlayerId }
  /** D10 (CR §5-2-1-6): emitted when a player resolves their mulligan window —
   *  either by reshuffling (`kept: false`) or keeping their opening 5
   *  (`kept: true`). UI uses this for log feedback. */
  | { type: 'MULLIGAN_DECISION'; player: PlayerId; kept: boolean }
  /** D10 (CR §5-2-1-7): emitted once both players have resolved mulligan and
   *  life cards have been dealt. Drives UI transitions out of the mulligan
   *  overlay and into the first refresh phase. */
  | { type: 'LIFE_DEALT'; firstPlayer: PlayerId }
  | { type: 'CARD_DRAWN'; player: PlayerId; instanceId: string }
  | { type: 'CARD_PLAYED'; player: PlayerId; instanceId: string; cost: number }
  | { type: 'ATTACK_DECLARED'; attacker: string; target: string }
  | { type: 'BLOCKER_ACTIVATED'; blocker: string }
  | { type: 'COUNTER_PLAYED'; instanceId: string; boost: number }
  | { type: 'CARD_KOED'; instanceId: string }
  | { type: 'LIFE_TAKEN'; player: PlayerId; instanceId: string }
  | { type: 'DON_DEALT'; player: PlayerId; count: number }
  | { type: 'DON_ATTACHED'; targetInstanceId: string; count: number }
  | { type: 'TRIGGER_FLIPPED'; player: PlayerId; instanceId: string }
  | { type: 'TRIGGER_RESOLVED'; player: PlayerId; instanceId: string; activated: boolean }
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
  const library: Record<string, Card> = { [DON_CARD.id]: DON_CARD };
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
      attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
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

    // Mint 10 DON instances per player. Each DON card has cardId === DON_CARD.id;
    // controller is fixed (DON belongs to the player who deals it).
    const donDeck: string[] = [];
    for (let i = 0; i < RULES.DON_DECK_SIZE; i++) {
      donDeck.push(mintInstance(DON_CARD.id, pid).instanceId);
    }

    players[pid] = {
      leader: leaderInst,
      hand: [],
      deck: deckInsts, // Caller must shuffle in a separate setup step using Random.
      trash: [],
      field: [],
      stage: null,
      life: [],
      donDeck,
      donCostArea: [],
      donRested: [],
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
    pendingAttack: null,
    pendingTrigger: null,
    mulliganUsed: { A: false, B: false },
  };
}
