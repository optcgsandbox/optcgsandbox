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

  // --- Look-behind context stamps (used by chained effects like Chambres) ---
  lastBouncedColors?: string[] | undefined;
  lastDiscardedName?: string | undefined;

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
  | { readonly kind: 'attack_target_pick'; readonly pendingTargetPick: PendingTargetPick };

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
}

export interface PendingPeek {
  readonly controller: PlayerId;
  readonly sourceInstanceId: InstanceId;
  readonly peekedIds: InstanceId[];
  readonly addCount: number;
  readonly resumePhase: Phase;
}

export interface PendingDiscard {
  readonly controller: PlayerId;
  readonly sourceInstanceId: InstanceId; // 'system' for hand-size-limit enforcement
  readonly revealedFrom: 'opp_hand' | 'self_hand'; // self_hand = hand-size limit (CR §6-5-7)
  readonly count: number;
  readonly resumePhase: Phase;
}

export interface PendingChoose {
  readonly controller: PlayerId;
  readonly sourceInstanceId: InstanceId;
  readonly options: ReadonlyArray<unknown>; // EffectClauseV2[] (declared in spec.ts)
  readonly resumePhase: Phase;
}

export interface PendingTargetPick {
  readonly controller: PlayerId;
  readonly sourceInstanceId: InstanceId;
  readonly candidateIds: ReadonlyArray<InstanceId>;
  readonly resumePhase: Phase;
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
  cardLibrary: Record<CardId, unknown>; // Card (declared in cards/Card.ts)

  // All instances (zone-agnostic lookup; keyed by instanceId)
  instances: Record<InstanceId, CardInstance>;

  // Event log
  history: ReadonlyArray<unknown>; // GameEvent (declared in events/types.ts)

  // Game result
  result: GameResult | null;

  // Pending choices (suspends the reducer pipeline)
  pending: PendingState | null;

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

// ────────────────────────────────────────────────────────────────────
// 11. Constants
// ────────────────────────────────────────────────────────────────────

export const FIELD_CAP = 5; // CR §3-7-6
export const DON_DECK_SIZE = 10; // default; overridable via gameRules.donDeckSize
export const STARTING_HAND_SIZE = 5; // CR §5-2-1-6
