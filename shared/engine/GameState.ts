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
  // D24 (CR §5-2-1-4): dice-roll first-player decision. Both players roll a
  // single d6; high roll wins. Ties stay in `dice_roll` and re-roll. Winner
  // transitions to `first_player_choice` where they decide whether to go first
  // or second. Whoever ends up going first becomes `activePlayer` heading into
  // the mulligan window.
  | 'dice_roll'
  | 'first_player_choice'
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
  // V3-3 (CR §10-1-3-1): paused mid-effect awaiting the controller's pick
  // of which peeked card(s) to add to hand. Resumed via RESOLVE_PEEK or
  // SKIP_PEEK; the engine restores `pendingPeek.resumePhase` once resolved.
  | 'peek_choice'
  // V3-4: paused mid-effect awaiting the controller's pick of which opp
  // hand card to discard. Resumed via RESOLVE_DISCARD; the engine restores
  // `pendingDiscard.resumePhase`.
  | 'discard_choice'
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
  /** D16 (CR §4-12): turn-scoped power delta. Added to effectivePower. Set by
   *  the `set_power_zero` template to `-(currentEffectivePower)` so the card
   *  reads as 0 power until end-of-turn. Cleared in `endTurn` per CR §4-12
   *  (effect lasts "the specified duration" — v0 covers turn-scoped only). */
  powerModifier?: number;
  /** EB01-001 + others: how many additional endTurn boundaries `powerModifier`
   *  must survive before being cleared. Set when an effect with
   *  `duration: 'opp_next_turn'` writes a power buff — the buff is meant to
   *  persist through opp's next turn, expiring at the start of the caster's
   *  next turn (i.e. one extra endTurn cycle). Default behaviour (no field /
   *  0) is the legacy `this_turn` semantic: clear at the first endTurn. */
  powerModifierExpiresInTurns?: number;
  /** V3-2: turn-scoped cost delta. Added to `card.cost` whenever a consumer
   *  checks this instance's effective cost (e.g. "KO a char of cost ≤ 3").
   *  Set by `removal_cost_reduce` to a negative number. Cleared in `endTurn`
   *  alongside `powerModifier`. */
  costModifier?: number;
  /** A.3.4: turn-scoped lock — when true, attack-eligibility code should
   *  reject this attacker. Set by `attack_lock_until_phase`. Consumed by
   *  legality / declareAttack once A.3.9 wires the runner into the engine.
   *  Cleared in `endTurn`. */
  attackLocked?: boolean;
  /** A.3.4: turn-scoped lock — when true, this instance does not become
   *  active in the next refresh. Set by `rest_lock_until_phase`. Consumed
   *  by `runRefreshPhase` once A.3.9 wires this in. Cleared in `endTurn`. */
  restLocked?: boolean;
  /** A.3.4: turn-scoped base-power override. Engine reads this in place of
   *  printed power when present. Set by `set_base_power` /
   *  `set_base_power_copy_from`. Cleared in `endTurn`. */
  basePowerOverride?: number;
  /** A.3.5: when true, this instance's effects are suppressed for the
   *  duration. Set by `negate_target_effects`. Engine should check before
   *  firing this instance's effects. */
  effectsNegated?: boolean;
  /** A.3.5: immunity flag — when set, this instance is shielded against
   *  the named source (e.g. opp_effects, opp_removal). Cleared by endTurn
   *  or when duration expires (V0 = this_turn). */
  immunity?: { against: 'opp_effects' | 'opp_removal' };
  /** A.3.5: keywords granted by effects (separate from printed keywords).
   *  E.g. "[X] gains [Rush] during this turn" appends 'rush' here.
   *  Cleared in `endTurn`. */
  grantedKeywords?: string[];
  /** A.3.5: set true by `self_trash_at_end_of_turn` so endTurn knows to
   *  trash this instance. */
  endOfTurnTrash?: boolean;
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
  /** V3-2: one-shot cost modifier consumed by the next PLAY_CARD. Negative
   *  values reduce the cost paid. Set by the `cost_reduction` template.
   *  Cleared on play OR at end of turn (whichever first) per CR's "this turn"
   *  duration. */
  nextPlayCostModifier?: number;
  /** V3-5: exile zone — cards sent here are removed from the game and cannot
   *  be recursed back. Distinct from `trash`. Initialized empty; populated by
   *  the `exile` effect template. */
  exile: string[];
  /** A.3.4: turn-scoped restriction flags. Cleared in `endTurn`. */
  restrictions?: {
    /** Opp can't attack unless they pay this discard cost. */
    oppAttackUnlessDiscard?: number;
    /** Player can't play cards of this kind this turn. */
    cantPlayKind?: 'character' | 'event' | 'stage';
    /** Player can't trigger this effect-type this turn (e.g. "set DON
     *  active via Character effects"). */
    cantUseEffectType?: string;
  };
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
  /** V3-3: searcher with `{lookCount, addCount}` param has peeked the top N
   *  of the controller's deck and is awaiting the controller's add-to-hand
   *  pick. Phase is `peek_choice` until resolved. */
  pendingPeek: PendingPeek | null;
  /** V3-4: disruption with object param has revealed opp's hand and is
   *  awaiting the controller's pick of which card to discard. Phase is
   *  `discard_choice` until resolved. */
  pendingDiscard: PendingDiscard | null;
  /** D10 (CR §5-2-1-6-1): per-player flag tracking whether the player has
   *  already exhausted their one-time mulligan during the setup window.
   *  Initially false for both. Set true the moment MULLIGAN resolves
   *  (KEEP_HAND does NOT flip this — keeping leaves the option formally
   *  consumed by the phase transition, but the flag is reserved for actual
   *  reshuffles so test surfaces can assert the rule). */
  mulliganUsed: Record<PlayerId, boolean>;
  /** D24 (CR §5-2-1-4): outcome of the dice-roll first-player decision. Each
   *  field holds the most recent d6 result for that player, or null before any
   *  roll has occurred. `rolls` counts how many rounds were rolled (incremented
   *  on every ROLL_DICE — including ties that produced no winner). Null
   *  before `setupGame`, retained read-only after the window closes so the UI
   *  log can replay the result. */
  diceRoll: { A: number | null; B: number | null; rolls: number } | null;
  /** D24 (CR §5-2-1-4 + §6-3-1 + §6-4-1): who goes first this game. Set by
   *  CHOOSE_FIRST / CHOOSE_SECOND once the dice-roll window closes. Null until
   *  the first-player decision is made. The first player skips their turn-1
   *  draw (CR §6-3-1) and gets only 1 DON instead of 2 on turn 1 (CR §6-4-1).
   *  Also gates "no attacks on your first turn" (CR §6-5-6-1) so that the
   *  rule follows the actual first player rather than always blocking A.
   *  Tests that bypass dice/mulligan via `closeMulliganKeepBoth` get
   *  `firstPlayer = 'A'` so their pre-D24 assumptions hold. */
  firstPlayer: PlayerId | null;
  /** V3-9: per-viewer "I have legitimately seen these instance identities"
   *  set. Populated when an effect reveals a card to a viewer (e.g.
   *  reveal_opp_hand, take_from_opp_hand, or a future "look at top N"). The
   *  viewForPlayer helper consults this overlay before redacting hidden zones
   *  so the AI/UI can reason about previously-peeked cards. Cleared per-zone
   *  when that zone is shuffled (deferred V0; no shuffle hook today). */
  knownByViewer: Record<PlayerId, string[]>;
  /** A.3.8: per-leader game-rule overrides (DON deck size, name aliases,
   *  deck-out grace, etc.). Initialized lazily — undefined means "all
   *  default rules". */
  gameRules?: {
    deckOutGracePlayer?: PlayerId;
    nameAliases?: Record<PlayerId, string[]>;
    bannedEventCostMin?: Record<PlayerId, number>;
  };
}

export interface PendingAttack {
  attackerInstanceId: string;
  /** Original target chosen by attacker. May be redirected to a blocker. */
  targetInstanceId: string;
  /** Sum of counter boosts played by defender so far (in points; e.g. 1000, 2000). */
  counterBoost: number;
}

export interface PendingPeek {
  controller: PlayerId;
  sourceInstanceId: string;
  /** Cards moved out of the deck for the controller to choose from. Order
   *  preserved as they came off the top so the UI can show them top-down. */
  peekedIds: string[];
  /** Max number the controller may add to hand. */
  addCount: number;
  /** Phase to restore once RESOLVE_PEEK / SKIP_PEEK resolves. */
  resumePhase: Phase;
}

export interface PendingDiscard {
  controller: PlayerId;
  sourceInstanceId: string;
  /** Player whose hand is exposed (always opp of controller in V3-4). */
  revealedFrom: PlayerId;
  /** Phase to restore once RESOLVE_DISCARD resolves. */
  resumePhase: Phase;
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
  /** D24 (CR §5-2-1-4): emitted on every ROLL_DICE — including ties. `winner`
   *  is null on a tie, A/B otherwise. UI uses this for the dice-spin animation
   *  log and to know when to surface a re-roll button. */
  | { type: 'DICE_ROLLED'; a: number; b: number; winner: PlayerId | null }
  /** D24 (CR §5-2-1-4): emitted when the dice-winner declares first/second.
   *  `goesFirst` is the player ID who will be active for the mulligan window
   *  and turn 1. */
  | { type: 'FIRST_PLAYER_CHOSEN'; chooser: PlayerId; goesFirst: PlayerId }
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
  /** V3-7 (D6, CR §3-7-6-1-1): emitted when a character is trashed by rule
   *  processing (e.g. the 6th-character slot rule) rather than as a K.O.
   *  Distinct from CARD_KOED so [On K.O.] cascades do not fire on this path. */
  | { type: 'CARD_TRASHED_BY_RULE'; instanceId: string }
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
      exile: [],
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
    pendingPeek: null,
    pendingDiscard: null,
    mulliganUsed: { A: false, B: false },
    diceRoll: null,
    firstPlayer: null,
    knownByViewer: { A: [], B: [] },
  };
}
