/**
 * Engine V2 — core state-shape types.
 *
 * Source of truth for every mutable state field. Each field declares its
 * Lifecycle (Permanent / Continuous / OneShot:scope). Continuous fields
 * are reset + rebuilt by ContinuousManager.refold; OneShot fields persist
 * until their expiry scope (this_turn / this_battle / opp_next_turn / etc).
 *
 * Cross-references:
 * - Implementation spec §2 (this file = §2.2 + §2.4 + §2.5 + §2.6 source)
 * - Plan v1 §1.4 / Plan v2 §1.4 (split fields)
 * - Bug class coverage: C1, C2, C12, C14, C25 (see ENGINE_V2_DEFINITIVE_PLAN.md §0)
 */

// ────────────────────────────────────────────────────────────────────
// 1. Branded primitives
// ────────────────────────────────────────────────────────────────────

export type PlayerId = 'A' | 'B';
export const OTHER_PLAYER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

export type CardId = string; // e.g. "EB01-001"
export type InstanceId = string; // game-generated, unique per game

export type SchemaVersion = 2;
export const CURRENT_SCHEMA_VERSION: SchemaVersion = 2;

export type ControllerMode = 'human' | 'deterministic' | 'easy' | 'medium' | 'hard';

// ────────────────────────────────────────────────────────────────────
// 2. Effect-duration enum (shared by one-shot fields' expiry contracts)
// ────────────────────────────────────────────────────────────────────

export type EffectDuration =
  | 'this_battle'
  | 'this_turn'
  | 'opp_next_turn'
  | 'opp_next_end_phase'
  | 'permanent';

// ────────────────────────────────────────────────────────────────────
// 2b. ClauseScratch — clause-local cross-step binding context
// ────────────────────────────────────────────────────────────────────
//
// One scratch per clause-firing. Holds named BindingSnapshot entries
// written by earlier steps (cost / target / action) and read by later
// steps in the SAME clause. Lifecycle: created at clause entry by the
// dispatcher loop, destroyed at clause completion, OR moved into
// state.pending.<kind>.scratch on suspension and restored on resolve.
// Never enters ContinuousManager.refold, triggerEmitters, or history.

export interface BindingSnapshot {
  readonly instanceId: InstanceId | null;
  readonly cardId: CardId;
  readonly name: string;
  readonly traits: ReadonlyArray<string>;
  readonly colors: ReadonlyArray<string>;
  readonly cost: number;
  readonly basePower: number;
  readonly kind: 'leader' | 'character' | 'event' | 'stage';
  readonly attribute: string | null;
}

export type ClauseScratch = Record<string, BindingSnapshot>;

// ────────────────────────────────────────────────────────────────────
// 3. CardInstance — every field has explicit Lifecycle + Reset policy
// ────────────────────────────────────────────────────────────────────

/**
 * One row per playable card instance in the game.
 * instanceId is stable across zones (hand → field → trash).
 *
 * Lifecycle legend:
 *   Permanent  — set at construction, never changes
 *   Continuous — reset to zero before each refold, rebuilt from continuous handlers
 *   OneShot    — written by one-shot actions; expires per *ExpiresInTurns counter
 *                or per explicit cleanup at scope boundary
 */
export interface CardInstance {
  // Permanent identity
  readonly instanceId: InstanceId;
  readonly cardId: CardId;
  controller: PlayerId; // can change via owner-change actions (rare)

  // Zone-state (set by zone moves)
  rested: boolean;
  summoningSick: boolean;

  // DON attachment (per-card; total of both arrays counts toward effectivePower)
  attachedDon: InstanceId[]; // active-attached DON instance IDs
  attachedDonRested: InstanceId[]; // rested-attached DON instance IDs

  // Per-turn tracking (cleared in endTurn for ACTIVE player only)
  perTurn: {
    hasAttacked: boolean;
    effectsUsed: string[]; // OPT keys: `opt:${trigger}:${idx}` and `repl:${trigger}:${i}`
  };

  // --- Continuous fields (reset before each refold) ---
  powerModifierContinuous?: number | undefined;
  costModifierContinuous?: number | undefined;
  basePowerOverrideContinuous?: number | undefined;
  grantedKeywordsContinuous?: string[] | undefined;
  counterBonus?: number | undefined; // continuous aura_counter_buff
  immunityContinuous?: { against?: string | undefined } | undefined;
  attackLockedContinuous?: boolean | undefined;
  damageImmunityAttribute?: string | undefined;
  restrictEffectType?: string | undefined;

  // --- OneShot fields (set by one-shot actions; expire per Expires fields) ---
  powerModifierOneShot?: number | undefined;
  powerModifierExpiresInTurns?: number | undefined;
  costModifierOneShot?: number | undefined;
  costModifierExpiresInTurns?: number | undefined;
  basePowerOverrideOneShot?: number | undefined;
  basePowerOverrideExpiresInTurns?: number | undefined;
  grantedKeywordsOneShot?: { keyword: string; until: EffectDuration }[] | undefined;
  immunityOneShot?: { against?: string | undefined; until: EffectDuration } | undefined;
  attackLockedOneShot?: { until: EffectDuration } | undefined;
  powerModifierThisBattle?: number | undefined; // cleared at every pendingAttack=null

  // --- Mid-game stateful flags ---
  restLockedUntilTurn?: number | undefined; // absolute turn-number; refresh skips when state.turn <= this
  endOfTurnTrash?: boolean | undefined; // set by self_trash_at_end_of_turn

  // --- Effect-negation flag (continuous effects target this) ---
  effectsNegated?: boolean | undefined;
  effectsNegatedExpiresInTurns?: number | undefined;
}

// ────────────────────────────────────────────────────────────────────
// 4. PlayerZones
// ────────────────────────────────────────────────────────────────────

export interface PlayerZones {
  leader: CardInstance;
  hand: InstanceId[];
  deck: InstanceId[];
  trash: InstanceId[];
  field: CardInstance[]; // chars only; capped at 5 (FIELD_CAP)
  stage: CardInstance | null;
  life: InstanceId[];
  lifeFaceUp: Record<InstanceId, boolean>;
  donDeck: InstanceId[];
  donCostArea: InstanceId[]; // active DON in cost area
  donRested: InstanceId[]; // rested DON in cost area
  exile: InstanceId[];

  // Turn-scoped state
  donReturnedThisTurn?: number | undefined;
  armedReplacementsThisTurn?: ArmedReplacement[] | undefined;
  pendingEndOfTurn?: PendingEndOfTurnEntry[] | undefined;
  nextPlayCostModifier?: number | undefined;
  // Optional filter — if set, nextPlayCostModifier only applies to a play
  // whose card matches this filter. Cleared when modifier is consumed.
  nextPlayCostModifierScope?: Readonly<Record<string, unknown>> | undefined;

  // Restriction flags
  restrictions?: {
    oppAttackUnlessDiscard?: number | undefined;
    cantPlayKind?: 'character' | 'event' | 'stage' | undefined;
    cantUseEffectType?: string | undefined;
  } | undefined;
}

export interface ArmedReplacement {
  readonly replacement: unknown; // ReplacementEffectV2 (declared in spec.ts)
  readonly sourceInstanceId: InstanceId;
  readonly controller: PlayerId;
  // Index of `replacement` within the source card's effectSpecV2.replacements
  // array. Used to build a STABLE OPT key (repl:trigger:sourceInstance:index)
  // so reordering across battle/turn/card-intrinsic pools doesn't change the
  // OPT identity. Optional for backwards compat; defaults to 0 if absent.
  readonly cardReplacementIndex?: number;
}

export interface PendingEndOfTurnEntry {
  readonly action: unknown; // EffectActionV2 (declared in spec.ts)
  readonly sourceInstanceId: InstanceId;
}

// ────────────────────────────────────────────────────────────────────
// 5. PendingState — discriminated union for player-choice continuations
// ────────────────────────────────────────────────────────────────────

export type PendingState =
  | { readonly kind: 'attack'; readonly pendingAttack: PendingAttack }
  | { readonly kind: 'trigger'; readonly pendingTrigger: PendingTrigger }
  | { readonly kind: 'peek'; readonly pendingPeek: PendingPeek }
  | { readonly kind: 'discard'; readonly pendingDiscard: PendingDiscard }
  | { readonly kind: 'choose_one'; readonly pendingChoose: PendingChoose }
  | { readonly kind: 'attack_target_pick'; readonly pendingTargetPick: PendingTargetPick }
  | { readonly kind: 'searcher_peek'; readonly pendingSearcherPeek: PendingSearcherPeek }
  | { readonly kind: 'effect_offer'; readonly pendingEffectOffer: PendingEffectOffer };

/**
 * F-8D addendum — "You may pay <cost>: <effect>" pre-prompt. Created by the
 * dispatcher BEFORE cost payment for OPTIONAL-COSTED clauses on human seats
 * (trigger !== activate_main — activating was already the player's choice).
 * Decline pays NOTHING; accept re-enters the clause pipeline (target → cost
 * → action). AI / simulation / server keep the V0 auto-pay path.
 */
export interface PendingEffectOffer {
  readonly controller: PlayerId;
  readonly sourceInstanceId: InstanceId;
  readonly clause: import('../spec/types.js').EffectClauseV2;
  readonly clauseIndex: number;
  readonly trigger: string;
  readonly resumePhase: Phase;
  readonly costSummary: string;
  readonly effectSummary: string;
}

/**
 * F-8B — human-facing searcher/peek/top-deck choice window.
 *
 * Created by the `searcher_peek` action handler ONLY when the controller is
 * listed in `state.humanControllers` (opt-in; simulation / server / AI
 * states never set it, so those paths keep the deterministic auto-resolve).
 * The looked-at cards are REMOVED from the deck head at suspend time
 * (mirrors the PendingPeek precedent) and routed by RESOLVE_SEARCHER_PEEK.
 */
export interface PendingSearcherPeek {
  readonly controller: PlayerId;
  readonly sourceInstanceId: InstanceId;
  /** Top-N deck cards shown to the controller, in original deck order. */
  readonly lookedAtInstanceIds: ReadonlyArray<InstanceId>;
  /** Subset of lookedAt that satisfies the clause filter (selectable). */
  readonly validPickInstanceIds: ReadonlyArray<InstanceId>;
  /** Printed "up to X" — max picks. */
  readonly pickLimit: number;
  /** True for "up to" wording: confirming zero picks is legal. */
  readonly mayChooseNone: boolean;
  /** True when leftover placement is order-sensitive (top/bottom). */
  readonly bottomOrderRequired: boolean;
  /** Printed "reveal ... and add it to your hand" → opponent sees the pick. */
  readonly revealPickedToOpponent: boolean;
  /** Human-readable filter line for the prompt subtitle. */
  readonly filterSummary: string;
  /** Leftover routing from the clause (default 'bottom'). */
  readonly placement: 'top' | 'bottom' | 'trash' | 'shuffle';
  /** Some searchers play the found character instead of adding to hand. */
  readonly playInsteadOfHand: boolean;
  readonly rested: boolean;
  readonly resumePhase: Phase;
  readonly scratch?: ClauseScratch;
}

export interface PendingAttack {
  readonly attackerInstanceId: InstanceId;
  targetInstanceId: InstanceId; // mutable: blocker can redirect
  counterBoost: number; // accumulator during counter window
  armedReplacements?: ArmedReplacement[] | undefined; // battle-scoped (cleared per attack)
}

export interface PendingTrigger {
  readonly lifeCardInstanceId: InstanceId;
  readonly controller: PlayerId;
  readonly resumePhase: Phase;
  readonly scratch?: ClauseScratch;
  /** F8A-F3 [Double Attack] (CR §10-1-2): life-damage flips still owed after
   *  this trigger window. RESOLVE_TRIGGER continues the damage procedure via
   *  continueLeaderDamage() when > 0. Absent/0 for ordinary triggers. */
  readonly remainingLifeFlips?: number;
}

export interface PendingPeek {
  readonly controller: PlayerId;
  readonly sourceInstanceId: InstanceId;
  readonly peekedIds: InstanceId[];
  readonly addCount: number;
  readonly resumePhase: Phase;
  readonly scratch?: ClauseScratch;
}

export interface PendingDiscard {
  readonly controller: PlayerId;
  readonly sourceInstanceId: InstanceId; // 'system' for hand-size-limit enforcement
  readonly revealedFrom: 'opp_hand' | 'self_hand'; // self_hand = hand-size limit (CR §6-5-7)
  readonly count: number;
  readonly resumePhase: Phase;
  readonly scratch?: ClauseScratch;
}

export interface PendingChoose {
  readonly controller: PlayerId;
  readonly sourceInstanceId: InstanceId;
  readonly options: ReadonlyArray<unknown>; // EffectClauseV2[] (declared in spec.ts)
  readonly resumePhase: Phase;
  readonly scratch?: ClauseScratch;
}

export interface PendingTargetPick {
  readonly controller: PlayerId;
  readonly sourceInstanceId: InstanceId;
  readonly candidateIds: ReadonlyArray<InstanceId>;
  readonly resumePhase: Phase;
  readonly scratch?: ClauseScratch;
  /** F-8D — clause continuation (closes plan-gap A7). When present, the
   *  suspension happened at the dispatcher's target step (cost already
   *  paid); RESOLVE_TARGET_PICK runs the action on the picked targets,
   *  emits CLAUSE_FIRED, and marks OPT. Created ONLY for seats in
   *  state.humanControllers — AI / simulation / server keep V0
   *  deterministic resolution. */
  readonly clause?: import('../spec/types.js').EffectClauseV2;
  readonly clauseIndex?: number;
  readonly trigger?: string;
  readonly pickLimit?: number;
  /** Printed "up to" dominates the corpus — pickers always allow zero
   *  picks in v1 (cost, if any, stays paid per CR pay-then-resolve). */
  readonly mayChooseNone?: boolean;
  readonly filterSummary?: string;
  /** True when the clause's cost was paid before suspension (always the
   *  case for dispatcher-created picks; informational for UI copy). */
  readonly paidCost?: boolean;
  /** Precomputed OPT key for the suspended clause (marked on resolve). */
  readonly optKey?: string;
  /** F-8D — when present this pick PAYS a clause cost instead of choosing
   *  an action target. The suspension happened BEFORE payment; resolution
   *  re-enters the dispatcher with the picks in opts.chosenCostIds so the
   *  cost handler pays with exactly the chosen cards (ask → pick payment →
   *  pay → resolve). Human seats only. */
  readonly costPick?: {
    /** Cost key these picks pay (e.g. 'bottomOfDeckFromHand'). */
    readonly costKey: string;
    /** Picks already committed for EARLIER choice keys on this cost. */
    readonly chosen: Readonly<Record<string, ReadonlyArray<InstanceId>>>;
    /** True when this clause's effect_offer was accepted — the re-dispatch
     *  must carry offerAcceptedIndex so the offer is not re-asked. */
    readonly offerAccepted: boolean;
  };
  /** Printed exact counts ("place 1 card") — confirm requires EXACTLY
   *  pickLimit picks; partial and empty picks are rejected. */
  readonly exactCount?: boolean;
}

// ────────────────────────────────────────────────────────────────────
// 6. PendingDecision — companion to PendingState (resolves the choice)
// ────────────────────────────────────────────────────────────────────

export type PendingDecision =
  | { readonly kind: 'attack'; readonly blockerInstanceId: InstanceId | null }
  | { readonly kind: 'trigger'; readonly activate: boolean }
  | { readonly kind: 'peek'; readonly pickedIds: ReadonlyArray<InstanceId> }
  | { readonly kind: 'discard'; readonly pickedId: InstanceId | null }
  | { readonly kind: 'choose_one'; readonly optionIndex: number }
  | { readonly kind: 'attack_target_pick'; readonly pickedId: InstanceId };

// ────────────────────────────────────────────────────────────────────
// 7. Phase
// ────────────────────────────────────────────────────────────────────

export type Phase =
  | 'dice_roll'
  | 'first_player_choice'
  | 'mulligan_first'
  | 'mulligan_second'
  | 'deal_life'
  | 'refresh'
  | 'draw'
  | 'don'
  | 'main'
  | 'block_window'
  | 'counter_window'
  | 'damage_resolution'
  | 'trigger_window'
  | 'peek_choice'
  | 'discard_choice'
  | 'choose_one'
  | 'attack_target_pick'
  | 'searcher_peek_choice'
  | 'effect_offer'
  | 'end';

// ────────────────────────────────────────────────────────────────────
// 8. GameRules — Permanent-only (per plan v2 B1 rule-out)
// ────────────────────────────────────────────────────────────────────

export interface GameRulesOverrides {
  readonly donDeckSize?: number; // default 10
  readonly deckOutGracePlayer?: PlayerId; // leader rule override
  readonly nameAliases?: Readonly<Record<CardId, ReadonlyArray<string>>>;
  readonly bannedEventCostMin?: number;
  readonly atStartOfGamePlay?: ReadonlyArray<{ readonly cardId: CardId; readonly player: PlayerId }>;
}

// ────────────────────────────────────────────────────────────────────
// 9. KO source stack (for if_self_kod_by_opp_effect)
// ────────────────────────────────────────────────────────────────────

export interface KoSourceFrame {
  readonly instanceId: InstanceId;
  readonly source: 'opp_effect' | 'own_effect' | 'battle';
}

// ────────────────────────────────────────────────────────────────────
// 10. GameState — top-level container
// ────────────────────────────────────────────────────────────────────

export interface GameState {
  readonly schemaVersion: SchemaVersion;

  // Game progression
  readonly seed: number;
  rngCounter: number; // monotonic; threaded through every random draw
  turn: number;
  activePlayer: PlayerId;
  firstPlayer: PlayerId | null;
  phase: Phase;
  controllerMode: Record<PlayerId, ControllerMode>;

  // Player zones
  players: Record<PlayerId, PlayerZones>;

  // Card definitions (loaded once at game start; immutable per game)
  cardLibrary: Record<CardId, import('../cards/Card.js').Card>;

  // All instances (zone-agnostic lookup; keyed by instanceId)
  instances: Record<InstanceId, CardInstance>;

  // Event log. Engine emits opaque event objects; UI / replays type-narrow.
  history: ReadonlyArray<GameEvent>;

  // Game result
  result: GameResult | null;

  // Pending choices (suspends the reducer pipeline)
  pending: PendingState | null;

  /**
   * F-8B — seats driven by a live human UI. OPT-IN: undefined everywhere
   * except local-store games (src/store/game.ts sets it at boot). Effect
   * handlers that can either auto-resolve or open a choice window (e.g.
   * searcher_peek) suspend ONLY for controllers listed here, so simulation,
   * engine tests, and the server keep deterministic V0 behavior unchanged.
   * (Not derived from `controllerMode` — its initialState default marks
   * seat A 'human' for every consumer, which would deadlock headless runs.)
   */
  humanControllers?: ReadonlyArray<PlayerId>;

  // KO source stack — populated during removal_ko / battle KO,
  // read by if_self_kod_by_opp_effect condition
  koSourceStack: KoSourceFrame[];

  // Per-emission DON-returned counter (transient within a single broadcast)
  pendingDonReturned: Partial<Record<PlayerId, number>>;

  // Mulligan tracking
  mulliganUsed: Record<PlayerId, boolean>;

  // Dice-roll result (used during setup). Both slots fill independently;
  // ties null both and increment `rolls`. Once non-null + unequal, the high
  // roller becomes the chooser for first/second.
  diceRoll: { A: number | null; B: number | null; rolls: number } | null;

  // View-side metadata (per-player visibility tracking)
  knownByViewer: Record<PlayerId, InstanceId[]>;

  // Game rules (leader-baked permanent overrides)
  gameRules: GameRulesOverrides;

  // Continuous-fold recursion guard
  continuousApplyDepth: number;

  // Per-clause-resolution counter of cards trashed by THIS dispatch (cost or
  // action). Reset to 0 at the start of each clause; read by formula
  // magnitudes (per_count countSource:'cards_trashed_this_resolution').
  cardsTrashedThisResolution: number;
}

export interface GameResult {
  readonly loser: PlayerId;
  readonly reason: 'deck_out' | 'life_zero' | 'concede' | 'timeout';
}

/**
 * Engine emits opaque event objects to state.history. UI / replays narrow
 * via the `type` discriminator. The engine itself does NOT validate event
 * shapes — handlers push objects matching the conventions of this union.
 */
export interface GameEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

// ────────────────────────────────────────────────────────────────────
// 11. Constants
// ────────────────────────────────────────────────────────────────────

export const FIELD_CAP = 5; // CR §3-7-6
export const DON_DECK_SIZE = 10; // default; overridable via gameRules.donDeckSize
export const STARTING_HAND_SIZE = 5; // CR §5-2-1-6
