// EffectSpec v2 — DRAFT schema covering all 95 patterns surfaced by
// Phase A.1 of the card-effect 100% spec.
//
// STATUS: DRAFT — NOT YET WIRED INTO THE ENGINE.
//   - This file is the design output of Phase A.2.
//   - Phase A.3 will move these types into Card.ts and build the runtime
//     interpreter in `runner-v2.ts`.
//   - Current production schema lives in `Card.ts` (`EffectSpec`,
//     `EffectSpecTrigger`, etc.) — leave that path alone.
//
// Each field annotates the gap number(s) from `docs/optcg-sim/card-effect-
// 100pct-spec.md` that motivated it. Format: `(gap #N)`.

import type { CardColor } from '../cards/Card';

// ─────────────────────────────────────────────────────────────────────
// Triggers — when the effect fires
// ─────────────────────────────────────────────────────────────────────

export type EffectTriggerV2 =
  // Turn-flow triggers (V0 + V3-3/V3-4 set, retained)
  | 'on_play'
  | 'on_ko'
  | 'on_block'
  | 'when_attacking'
  | 'activate_main'
  | 'trigger'                    // life-card trigger reveal
  | 'at_start_of_game'           // CR §5-2-1-5-1
  // V3-100pct additions
  | 'at_end_of_turn_self'        // (gap #25, #63, #77, #89) — fires at end of OWN turn
  | 'at_end_of_turn'             // (gap #50) — fires at end of any turn
  | 'on_opp_attack'              // (gap #36) — reactive when opp declares an attack
  | 'on_life_changed'            // (gap #37) — reactive on life-card move
  | 'on_become_rested'           // OP14-021/027/028/032/035/119 — fires when source transitions active→rested
  | 'on_hand_trashed_by_effect'  // OP14-045/049/056 — fires when own hand discard happens via an effect
  | 'at_opp_refresh'             // (gap #38) — reactive at opp's refresh phase
  | 'on_damage_taken'            // (gap #84) — when YOU take damage (life flip)
  | 'on_own_don_returned'        // (gap #88) — when own DON returns to deck
  | 'during_opp_turn'            // (gap #50, #75) — continuous on opp's turn
  | 'on_opp_play_character'      // (gap #4, OP12-081) — opp plays a Character matching filter
  | 'on_own_char_removed_by_opp_effect' // (gap #28 variant) — your char removed by opp effect
  | 'on_opp_activate_event'      // OP01-004 Usopp — opp plays an event
  | 'on_self_activate_event'     // OP04-053 Page One — fires when controller plays an Event
  | 'on_attack_deal_damage'      // OP03-040 Nami mill — when source's attack deals damage to opp's Life
  ;

// ─────────────────────────────────────────────────────────────────────
// Conditions — predicates over GameState evaluated at trigger time
// ─────────────────────────────────────────────────────────────────────

export type EffectConditionV2 =
  | { type: 'always' }
  // Leader identity
  | { type: 'if_leader_is'; name: string }
  | { type: 'if_leader_has_trait'; trait: string }
  | { type: 'if_leader_has_type'; typeString: string }                  // (gap #19) — type-includes match
  | { type: 'if_leader_multicolored' }                                  // (gap #43)
  | { type: 'if_leader_has_color'; color: 'red' | 'green' | 'blue' | 'purple' | 'black' | 'yellow' }
  | { type: 'if_leader_power_max'; n: number }                          // (gap from OP05-009)
  | { type: 'if_leader_power_min'; n: number }                          // OP09-017 — "if your Leader has N power or more"
  // Resource counts
  | { type: 'if_don_min'; n: number }
  | { type: 'if_don_max'; n: number }
  | { type: 'if_opp_don_min'; n: number }                               // EB02-061 — opp DON in donCostArea ≥ n
  | { type: 'if_opp_don_max'; n: number }                               // mirror
  | { type: 'if_own_don_le_opp' }                                       // (gap #67)
  | { type: 'if_own_life_max'; n: number }
  | { type: 'if_own_life_min'; n: number }
  | { type: 'if_opp_life_max'; n: number }
  | { type: 'if_opp_life_min'; n: number }
  | { type: 'if_hand_max'; n: number }
  | { type: 'if_hand_min'; n: number }
  | { type: 'if_opp_hand_min'; n: number }
  | { type: 'if_opp_hand_max'; n: number }
  | { type: 'if_trash_min'; n: number }
  | { type: 'if_trash_max'; n: number }
  | { type: 'if_own_deck_max'; n: number }                              // OP03-045 Carne — 20 or less cards in deck
  | { type: 'if_own_deck_min'; n: number }
  // Field state
  | { type: 'if_own_chars_min'; n: number }                             // (gap #14)
  | { type: 'if_own_chars_min_cost'; n: number; minCost: number }
  | { type: 'if_opp_chars_min'; n: number }                             // opp has ≥N chars
  | { type: 'if_opp_chars_min_cost'; n: number; minCost: number }       // opp has ≥N chars with cost ≥ minCost
  | { type: 'if_opp_chars_max_cost'; n: number; maxCost: number }       // opp has ≥N chars with cost ≤ maxCost (EB01-045 "cost of 0")
  | { type: 'if_attached_don_min'; n: number }                          // [DON!! xN] — DON attached to SOURCE card
  | { type: 'is_opp_turn' }                                             // EB02-003 [Opponent's Turn] gate
  | { type: 'is_own_turn' }                                             // mirror
  | { type: 'if_only_chars_with_trait'; trait: string }                 // EB02-010 — every char on your field has this trait
  | { type: 'if_own_chars_max_with_min_power'; n: number; minPower: number } // EB02-022 — ≤N own chars whose power ≥ minPower
  | { type: 'if_opp_chars_min_power'; n: number; minPower: number }      // EB04-007 — opp has ≥n chars ≥minPower
  | { type: 'if_own_chars_min_with_trait'; n: number; trait: string }    // EB04-033 — own chars with trait T ≥ n
  | { type: 'if_own_chars_min_filter'; n: number; filter: TargetFilter } // generic ≥n own chars matching filter
  | { type: 'if_owned_other_with_name'; name: string }
  | { type: 'if_no_other_with_name'; name: string }                     // (gap from EB04-031)
  | { type: 'if_played_this_turn' }                                     // (gap #16)
  | { type: 'if_have_given_don_min'; n: number }                        // (gap #59, OP12-015)
  | { type: 'if_field_total_cost_min'; n: number }
  | { type: 'if_attacker_has_attribute'; attribute: string }            // (gap #92) — for on_opp_attack-style triggers
  | { type: 'if_self_power_min'; n: number }                            // OP05-004 etc. — "if this Character has N power or more"
  | { type: 'if_own_leader_active' }                                    // OP04-017 etc. — "if your Leader is active"
  | { type: 'if_own_rested_don_min'; n: number }                        // OP07-023 — "if you have N or more rested DON"
  | { type: 'if_self_active' }                                          // OP08-029 — "If this Character is active"
  | { type: 'if_self_rested' }                                          // mirror — "If this Character is rested"
  // Composite — short-circuit AND/OR
  | { type: 'and'; conditions: EffectConditionV2[] }
  | { type: 'or'; conditions: EffectConditionV2[] }
  | { type: 'not'; condition: EffectConditionV2 };

// ─────────────────────────────────────────────────────────────────────
// Targets — which instance(s) the action affects
// ─────────────────────────────────────────────────────────────────────

export interface TargetFilter {
  costMax?: number;
  costMin?: number;
  powerMax?: number;
  powerMin?: number;
  trait?: string;
  typeIncludes?: string;
  colors?: CardColor[];
  nameIs?: string;
  nameExcludes?: string;
  kind?: 'character' | 'event' | 'stage';
  rested?: boolean;
  /** EB02-022 — "no base effect" / vanilla character (effectText null/-/empty). */
  noBaseEffect?: boolean;
  /** EB03-014 — attribute is a card metadata field ('Slash', 'Strike', 'Ranged', etc.). */
  attribute?: string;
  /** EB03-S-Snake — "with a [Trigger]" effect filter; matches cards whose effectText mentions [Trigger]. */
  hasTrigger?: boolean;
  /** EB02-002, OP07-020, etc. — cards with text "trait A or trait B" require ANY of the listed traits. */
  traitsAny?: string[];
  /** Mirror — name OR name (e.g., "Sanji or Black Leg"). */
  namesAny?: string[];
}

export type EffectTargetV2 =
  // Single-target descriptors
  | { kind: 'self' }
  | { kind: 'your_leader' }
  | { kind: 'opp_leader' }
  | { kind: 'your_character'; filter?: TargetFilter }
  | { kind: 'your_leader_or_character'; filter?: TargetFilter }         // EB01-028 etc. — "Leader or Character" target
  | { kind: 'opp_character'; filter?: TargetFilter }                    // includes cost-capped via filter.costMax (gap #11, #15)
  | { kind: 'opp_leader_or_character'; filter?: TargetFilter }          // mirror — "your opponent's Leader or Character"
  | { kind: 'opp_hand_card'; filter?: TargetFilter }
  | { kind: 'own_trash_card'; filter?: TargetFilter }                   // (gap #15)
  | { kind: 'top_of_deck' }
  | { kind: 'top_of_opp_deck' }
  // Mass targets (gap #12, #55)
  | { kind: 'all_your_characters'; filter?: TargetFilter }
  | { kind: 'all_opp_characters'; filter?: TargetFilter }
  // Life-area targets (gaps #5, #71, #72)
  | { kind: 'own_life_top' }
  | { kind: 'opp_life_top' };

// ─────────────────────────────────────────────────────────────────────
// Costs — preconditions paid by the controller before action resolves
// ─────────────────────────────────────────────────────────────────────

export interface EffectCostV2 {
  donCost?: number;             // (gap #11) — rest N active DON, return to donDeck (DON!! −N)
  donCostReturnToDeck?: number; // (gap #56, #64) — return N active DON to DON!! deck (different mechanic)
  discardHand?: number;         // (gap #10)
  flipLife?: number;            // (gap #35) — turn N top Life cards face-up (or face-down per text)
  restSelf?: boolean;           // many cards
  restLeader?: boolean;         // OP04-082/088/091 etc. — "rest your 1 Leader"
  trashSelf?: boolean;          // EB01-013 etc.
  revealHand?: { count: number; filter?: TargetFilter };  // (gap #90)
  koSelfCharacter?: { filter?: TargetFilter };            // (gap #54)
  bottomOfDeckFromTrash?: number;                          // (gap #48) "place N cards from your trash at bottom"
  bottomOfDeckFromHand?: number;                           // EB01-030 Loguetown — place N cards from hand at bottom
  bottomOfDeckSelf?: boolean;                              // EB01-030 — place THIS card at bottom of deck
  lifeToHand?: number;                                     // EB01-056 — pay-cost variant: move N life to hand
  selfPowerCost?: number;                                  // EB01-004 — give your own active leader −X power this turn as cost
  donRestedToActive?: number;                              // mirror cost — set N rested DON as active as cost (rare)
  bottomOfDeckOwnChar?: { filter?: TargetFilter };         // EB01-011 — place 1 own char with X power at bottom of deck as cost
  discardHandFilter?: { count: number; filter: TargetFilter }; // EB01-008 — discard 1 Event-or-Stage card
  millSelf?: number;                                       // EB04-042 — pay N mill-self as cost
  returnSelfChar?: { filter?: TargetFilter };              // ST22-005 etc.
}

// ─────────────────────────────────────────────────────────────────────
// Magnitude — scalar OR computed by formula
// ─────────────────────────────────────────────────────────────────────

export type MagnitudeFormula =
  // (gap #39) — for-every-N pattern. magnitude = floor(countSource / divisor) * perUnit.
  | { kind: 'per_count'; countSource: CountSource; divisor: number; perUnit: number }
  // (gap #82) — dynamic match-opp count.
  | { kind: 'match_opp_don' }
  // (gap #94) — direct read of a counter (e.g. trash size).
  | { kind: 'read_state'; source: CountSource };

export type CountSource =
  | 'own_trash_count' | 'opp_trash_count'
  | 'own_hand_count'  | 'opp_hand_count'
  | 'own_life_count'  | 'opp_life_count'
  | 'own_don_count'   | 'opp_don_count'
  | 'own_rested_don_count'                       // EB01-014 — power scales per 3 rested DON
  | 'own_trash_event_count'                      // EB01-027 — power scales per N events in trash
  | 'cards_trashed_this_resolution' // for gap #39 (OP07-091)
  ;

// ─────────────────────────────────────────────────────────────────────
// Duration — how long a turn-scoped effect persists
// ─────────────────────────────────────────────────────────────────────

export type EffectDuration =
  | 'this_battle'                  // counter / +N during battle
  | 'this_turn'                    // most power/cost buffs
  | 'opp_next_turn'                // gap #93 — until end of opp's next turn
  | 'opp_next_end_phase'           // gap #93 — until end of opp's next End Phase
  | 'permanent';                   // continuous/passive — rare on instance-level

// ─────────────────────────────────────────────────────────────────────
// Actions — the verbs
// ─────────────────────────────────────────────────────────────────────

export type EffectActionV2 =
  // Card movement & draw
  | { kind: 'draw'; magnitude?: number | MagnitudeFormula }
  | { kind: 'mill_self'; magnitude?: number }                          // (gap #29)
  | { kind: 'mill_opp'; magnitude?: number }                           // (gap #74)
  | { kind: 'lifegain'; magnitude?: number }
  | { kind: 'life_to_hand'; magnitude?: number }
  | { kind: 'add_to_own_life_top'; faceUp: boolean; from: 'top_of_deck' | 'hand' | 'own_trash' }  // (gaps #71, #72, #76)
  | { kind: 'add_to_opp_life_top'; faceUp: boolean; position?: 'top' | 'bottom' }  // (gap #71); EB01-053 supports bottom too
  | { kind: 'add_to_opp_hand_from_opp_life' }                          // (gap #95)
  | { kind: 'trash_face_up_life' }                                     // (gap #77)
  | { kind: 'turn_all_own_life_face_down' }                            // (gap #86)
  | { kind: 'peek_and_reorder_own_life'; count: number }               // ST07-003
  | { kind: 'peek_and_reorder_opp_life' }                              // (gap #85)
  | { kind: 'peek_and_reorder_own_deck'; count: number }               // ST17-004
  | { kind: 'searcher_peek'; lookCount: number; addCount: number; filter?: TargetFilter; playInsteadOfHand?: boolean }  // V3-3 + filters; EB01-009 plays instead of adding to hand
  | { kind: 'reveal_opp_hand' }                                        // V3-4
  | { kind: 'reveal_top_and_conditional_play'; filter: TargetFilter; rested?: boolean }  // (gap #27)
  | { kind: 'peek_opp_deck'; count: number }                           // (gap #42, #58)
  | { kind: 'take_from_opp_hand' }                                     // V3-4
  | { kind: 'choose_cost_reveal_opp_match'; thenAction: EffectActionV2 } // (gap #79)
  | { kind: 'search_deck'; filter?: TargetFilter }
  | { kind: 'bottom_of_deck_from_trash'; magnitude: number | MagnitudeFormula }  // (gap #48)
  // EB02-024 Sogeking — place N cards from hand at bottom of deck (mandatory).
  | { kind: 'bottom_of_deck_from_hand'; magnitude: number }
  // EB02-027 Vista — place targets (opp chars) at bottom of opp's deck.
  | { kind: 'bottom_of_deck_to_opp_deck' }
  | { kind: 'recursion'; magnitude?: number; filter?: TargetFilter }
  | { kind: 'move_to_top' }
  | { kind: 'exile' }
  // Power & cost modifiers
  | { kind: 'power_buff'; magnitude: number | MagnitudeFormula; duration: EffectDuration }
  | { kind: 'set_power_zero' }
  | { kind: 'set_base_power'; magnitude: number; duration: EffectDuration }    // (gap #40)
  | { kind: 'set_base_power_copy_from'; source: 'opp_leader' | 'opp_character'; duration: EffectDuration } // (gap #57)
  | { kind: 'cost_reduction'; magnitude: number; scope?: { cardName?: string; costMin?: number } } // (gap #80)
  | { kind: 'removal_cost_reduce'; magnitude: number; duration: EffectDuration }
  // Rest / lock
  | { kind: 'rest_target' }
  | { kind: 'set_active' }                                             // (gap #59-style; OP09-037 etc.)
  | { kind: 'rest_opp_don'; magnitude: number }
  | { kind: 'attack_lock_until_phase'; until: EffectDuration }         // (gap #61)
  | { kind: 'rest_lock_until_phase'; until: EffectDuration }           // (gap #62)
  | { kind: 'restrict_opp_attack'; unless?: { discardN?: number } }    // (gap #46)
  | { kind: 'restrict_play_self_this_turn'; kind_filter?: 'character' | 'event' | 'stage' } // (gap #81)
  | { kind: 'restrict_effect_type'; effectKind: 'character_set_active' } // (gap #87)
  // Removal
  | { kind: 'removal_ko' }
  | { kind: 'removal_bounce' }
  // DON economy
  | { kind: 'ramp'; magnitude: number; rested?: boolean }
  | { kind: 'give_don_to_target'; magnitude: number; rested?: boolean }   // standard give to own
  | { kind: 'give_don_to_opp_target'; magnitude: number }                 // (gap #41)
  | { kind: 'return_opp_don_to_deck'; magnitude: number | MagnitudeFormula } // (gaps #82)
  // Effect negation / immunity
  | { kind: 'negate_target_effects'; duration: EffectDuration }            // (gap #6, #45, #51)
  | { kind: 'grant_immunity'; against: 'opp_effects' | 'opp_removal'; duration: EffectDuration } // (gap #60)
  | { kind: 'give_keyword'; keyword: string; duration: EffectDuration }    // (gaps #9, #34, #49, #53)
  // Cards out of hand or trash
  | { kind: 'play_for_free'; from: 'hand' | 'trash' | 'hand_or_trash'; filter?: TargetFilter; count?: number; uniqueByName?: boolean; rested?: boolean }
  // EB01-047 — mandatory discard from hand (not a cost). Distinct from cost.discardHand.
  | { kind: 'discard_from_hand'; magnitude: number }
  // Opp-side mirror — "your opponent trashes 1 card from their hand" (random pick).
  | { kind: 'opp_discard_from_hand'; magnitude: number }
  // OP05-079, OP06-092 — "your opponent places N cards from their trash at the bottom of their deck."
  | { kind: 'opp_bottom_of_deck_from_trash'; magnitude: number }
  // OP06-044 — "your opponent places 1 card from their hand at the bottom of their deck."
  | { kind: 'opp_bottom_of_deck_from_hand'; magnitude: number }
  // EB01-059 / EB01-060 — trash from top of own life until N remain.
  | { kind: 'trash_own_life_until'; n: number }
  // EB01-038 — defensive: redirect opp's pending attack to a chosen own char.
  | { kind: 'attack_redirect_to_target' }
  // EB01-012 / EB02-010 — flip N rested DON to active (different from per-card set_active).
  | { kind: 'set_active_don'; magnitude: number }
  // EB01-061 — copy power from the SELECTED opp character (chosen via target).
  | { kind: 'set_base_power_copy_from_target'; duration: EffectDuration }
  // EB02-009 Thousand Sunny — transfer an already-attached DON from one own
  // instance to another (rather than pulling from donCostArea).
  | { kind: 'transfer_attached_don'; magnitude: number; fromKind: 'your_leader' | 'your_character' | 'self' }
  // EB01-029 Sorry. I'm a Goner — reveal top, if it matches a cost gate,
  // run the inner action (bounce). Otherwise no-op. Card goes to bottom.
  | { kind: 'reveal_top_then_if_cost_min'; minCost: number; thenAction: EffectActionV2 }
  // EB02-061 etc. — run a sequence of actions in one clause, sharing the cost paid for the clause.
  | { kind: 'chained_actions'; actions: EffectActionV2[] }
  // Misc
  | { kind: 'activate_event_from_hand'; filter?: TargetFilter }            // (gap #47)
  | { kind: 'damage_immunity_attribute'; attribute: string }               // (gap #26)
  | { kind: 'choose_one'; options: EffectClauseV2[] }                      // (gap #1) player choice
  | { kind: 'self_trash_at_end_of_turn' }                                  // (gap #89)
  ;

// ─────────────────────────────────────────────────────────────────────
// EffectClause — one structured clause; cards have a list of these
// ─────────────────────────────────────────────────────────────────────

export interface EffectClauseV2 {
  trigger: EffectTriggerV2;
  condition?: EffectConditionV2;
  cost?: EffectCostV2;
  action: EffectActionV2;
  target?: EffectTargetV2;
  /** Once Per Turn — engine refuses to fire this clause a second time within the same turn. */
  opt?: boolean;
  verified: 'ground-truth' | 'auto' | 'human-reviewed' | 'flagged' | 'human-deferred';
}

// ─────────────────────────────────────────────────────────────────────
// Continuous effects — read on every state evaluation, not on trigger
// ─────────────────────────────────────────────────────────────────────

export interface ContinuousEffectV2 {
  condition?: EffectConditionV2;
  action:
    | { kind: 'self_power_buff'; magnitude: number | MagnitudeFormula }      // (gap #17, OP15-092)
    | { kind: 'self_immune_to_opp_effects' }                                 // (gap #60, OP15-118)
    | { kind: 'grant_keyword_to_self'; keyword: string }                     // (gap #34)
    | { kind: 'aura_power_buff'; filter: TargetFilter; magnitude: number }   // OP12-073
    | { kind: 'aura_cost_modifier'; filter: TargetFilter; delta: number }    // OP10-042
    | { kind: 'opp_aura_power_buff'; filter: TargetFilter; magnitude: number } // mirror — affects opp.field
    | { kind: 'opp_aura_cost_modifier'; filter: TargetFilter; delta: number }  // mirror — affects opp.field
    | { kind: 'aura_counter_buff'; filter: TargetFilter; magnitude: number } // EB01-001 — chars without a counter chip gain +N counter
    | { kind: 'aura_immunity'; filter: TargetFilter; against: 'opp_effects' | 'opp_removal' } // EB04-057 — chars matching filter become immune
    | { kind: 'self_cost_buff'; magnitude: number | MagnitudeFormula }       // EB04-048 — own cost scales by formula (mirrors self_power_buff)
    | { kind: 'restrict_self_attack' }                                       // "This Leader cannot attack"
    | { kind: 'cost_modifier_in_hand'; delta: number };                      // (gap #91, EB04-061)
}

// ─────────────────────────────────────────────────────────────────────
// Replacement effects — fire instead of normal processing
// ─────────────────────────────────────────────────────────────────────

export interface ReplacementEffectV2 {
  trigger: 'would_be_ko' | 'would_be_removed' | 'would_take_damage' | 'on_life_flip';
  condition?: EffectConditionV2;
  cost?: EffectCostV2;
  action: EffectActionV2;
  /** "If you do" — only run if the cost was paid. */
  conditional: boolean;
  verified: 'ground-truth' | 'auto' | 'human-reviewed' | 'flagged';
}

// ─────────────────────────────────────────────────────────────────────
// Game-rule overrides — per-leader rule changes (gaps #31, #32, #78)
// ─────────────────────────────────────────────────────────────────────

export interface GameRuleOverrideV2 {
  donDeckSize?: number;                  // OP15-058
  deckOutGrace?: 'until_end_of_turn';   // OP15-022
  deckRestrictions?: {
    bannedEventCostMin?: number;        // OP13-079
  };
  atStartOfGamePlay?: { fromZone: 'deck'; filter: TargetFilter }; // OP13-079
  nameAliases?: string[];                // EB04-038
}

// ─────────────────────────────────────────────────────────────────────
// Top-level shape that gets attached to a Card
// ─────────────────────────────────────────────────────────────────────

export interface EffectSpecV2 {
  clauses: EffectClauseV2[];
  continuous?: ContinuousEffectV2[];
  replacements?: ReplacementEffectV2[];
  rules?: GameRuleOverrideV2;
  /** Schema version — used by Phase G migration. */
  schemaVersion: 2;
  /** Provenance roll-up. If any clause is `flagged`, the whole card is
   *  flagged for review even if other clauses pass. */
  verified: 'ground-truth' | 'auto' | 'human-reviewed' | 'flagged' | 'human-deferred';
}

// ─────────────────────────────────────────────────────────────────────
// Coverage map — every gap → which schema field carries it
// ─────────────────────────────────────────────────────────────────────
//
// Run a sanity check during Phase A.3: every gap number from the spec doc
// must map to at least one field above. The map below is the source of
// truth for that check.

export const GAP_COVERAGE_MAP: Record<number, string> = {
  1: 'action.choose_one',
  2: 'condition (chained) + continuous.self_power_buff with MagnitudeFormula.read_state',
  3: 'replacements (generalized)',
  4: 'trigger.on_opp_play_character',
  5: 'action.add_to_opp_life_top',
  6: 'action.negate_target_effects',
  7: 'action.attack_lock_until_phase / rest_lock_until_phase',
  8: 'action.grant_immunity',
  9: 'action.give_keyword',
  10: 'cost.discardHand',
  11: 'cost.donCost',
  12: 'target.all_your_characters / all_opp_characters',
  13: 'magnitude.per_count',
  14: 'condition.if_own_chars_min',
  15: 'action.play_for_free with fromZone',
  16: 'condition.if_played_this_turn',
  17: 'continuous.self_power_buff',
  18: 'rules (out of effect spec scope — engine-level)',
  19: 'condition.if_leader_has_type',
  20: 'action.play_for_free.uniqueByName',
  21: 'action.give_don_to_opp_target',
  22: 'action.add_to_opp_life_top (same as 5)',
  23: 'action.peek_and_reorder_own_deck',
  24: 'trigger.on_block (already exists)',
  25: 'trigger.at_end_of_turn_self',
  26: 'action.damage_immunity_attribute',
  27: 'action.reveal_top_and_conditional_play',
  28: 'replacements (multi-flavor)',
  29: 'action.mill_self',
  30: 'rules.nameAliases',
  31: 'rules.donDeckSize',
  32: 'rules.deckRestrictions',
  33: 'rules.atStartOfGamePlay',
  34: 'continuous.grant_keyword_to_self',
  35: 'cost.flipLife',
  36: 'trigger.on_opp_attack',
  37: 'trigger.on_life_changed',
  38: 'trigger.at_opp_refresh',
  39: 'magnitude.per_count with cards_trashed_this_resolution',
  40: 'action.set_base_power',
  41: 'action.give_don_to_opp_target',
  42: 'action.peek_opp_deck',
  43: 'condition.if_leader_multicolored',
  44: 'action.play_for_free with matchTrashedName (filter field)',
  45: 'action.negate_target_effects',
  46: 'action.restrict_opp_attack',
  47: 'action.activate_event_from_hand',
  48: 'action.bottom_of_deck_from_trash',
  49: 'continuous.grant_keyword_to_self + aura_cost_modifier',
  50: 'trigger.during_opp_turn',
  51: 'action.negate_target_effects',
  52: 'action.play_for_free with all filters',
  53: 'action.give_keyword with condition',
  54: 'cost.koSelfCharacter',
  55: 'target.all_your_characters with filter',
  56: 'cost.donCostReturnToDeck',
  57: 'action.set_base_power_copy_from',
  58: 'action.peek_opp_deck',
  59: 'condition.if_have_given_don_min',
  60: 'action.grant_immunity + continuous.self_immune_to_opp_effects',
  61: 'action.attack_lock_until_phase',
  62: 'action.rest_lock_until_phase',
  63: 'trigger.at_end_of_turn_self',
  64: 'cost.donCostReturnToDeck',
  65: 'composite clause + cost combos',
  66: 'cost.flipLife + chained condition + magnitude',
  67: 'condition.if_own_don_le_opp',
  68: 'composite — handled natively by clause list',
  69: 'duration enum',
  70: 'verified — already covered',
  71: 'action.add_to_opp_life_top',
  72: 'action.add_to_own_life_top',
  73: 'action.play_for_free.count',
  74: 'action.mill_opp',
  75: 'trigger.during_opp_turn',
  76: 'action.add_to_own_life_top.faceUp',
  77: 'action.trash_face_up_life',
  78: 'rules.deckOutGrace',
  79: 'action.choose_cost_reveal_opp_match',
  80: 'action.cost_reduction.scope',
  81: 'action.restrict_play_self_this_turn',
  82: 'magnitude.match_opp_don / return_opp_don_to_deck',
  83: 'trigger.at_end_of_turn_self + condition',
  84: 'trigger.on_damage_taken',
  85: 'action.peek_and_reorder_opp_life',
  86: 'action.turn_all_own_life_face_down',
  87: 'action.restrict_effect_type',
  88: 'trigger.on_own_don_returned',
  89: 'action.self_trash_at_end_of_turn',
  90: 'cost.revealHand',
  91: 'continuous.cost_modifier_in_hand',
  92: 'condition.if_attacker_has_attribute',
  93: 'duration enum',
  94: 'magnitude.read_state',
  95: 'action.add_to_opp_hand_from_opp_life',
};
