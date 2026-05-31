// OPTCG card type model. Source: docs/optcg-sim/rules-reference.md §1.3.
//
// A "Card" here is the canonical printing — the rules of the card itself.
// In-game instances (with state like rest/active, attached DON, counters)
// are CardInstance, defined in zones/Field.ts.

export type CardColor = 'red' | 'green' | 'blue' | 'purple' | 'black' | 'yellow';

export type CardKind = 'leader' | 'character' | 'event' | 'stage' | 'don';

export type CardAttribute = 'slash' | 'strike' | 'ranged' | 'special' | 'wisdom';

/** Trigger keywords from §1.8. */
export type Keyword =
  | 'blocker'
  | 'rush'
  // D9 (CR §10-1-6): Character variant of Rush — char may attack opp
  // characters (NOT leader) on the turn played. Plain `rush` permits both.
  | 'rush_character'
  | 'double_attack'
  | 'banish'
  | 'unblockable'
  | 'on_play'
  | 'on_ko'
  | 'when_attacking'
  | 'activate_main'
  | 'trigger'
  | 'counter'
  | 'once_per_turn';

/** Effect taxonomy from §2 of rules-reference.md, aligned with Crew Builder's CLAUDE.md tag schema. */
export type EffectTag =
  | 'searcher'
  | 'draw'
  | 'removal_ko'
  | 'removal_bounce'
  | 'removal_cost_reduce'
  | 'blocker'
  | 'rush'
  | 'double_attack'
  | 'counter_event'
  | 'counter_character'
  | 'power_buff'
  // D16 (CR §4-12): reduce target's effective power by its current effective
  // power (i.e., set to 0). Turn-scoped — cleared in endTurn.
  | 'set_power_zero'
  // D19 (CR §8-1-3-4): one representative replacement effect — when this
  // character would be K.O.'d, it moves to its controller's hand instead.
  // The K.O. is replaced, so on_ko triggers do NOT fire. V0 token impl;
  // generalized replacement registry deferred.
  | 'replace_ko_to_hand'
  | 'cost_reduction'
  | 'recursion'
  | 'ramp'
  | 'lifegain'
  | 'life_to_hand'
  | 'disruption'
  | 'vanilla'
  | 'trigger'
  // V3-5: new effect surface to cover real card text outside the v0 spine.
  | 'rest_opp_don'        // Move N of opp's active DON → opp's rested DON.
  | 'mill'                // Top N of deck → trash. param = N, default 1.
  | 'reveal_opp_hand'     // Expose opp hand to controller for this resolution.
  | 'take_from_opp_hand'  // Move 1 from opp hand → controller hand. v0 random.
  | 'search_deck'         // Take first matching card from deck → hand, shuffle.
  | 'exile'               // Send target to controller's exile zone (no recur).
  | 'play_for_free'       // Place target hand card on field without paying cost.
  | 'rest_target'         // Set target instance to rested.
  | 'move_to_top';        // Move target from hand/trash → top of own deck.

/** Base card definition. Card-specific effect functions are attached separately
 *  by the effects/ modules; this type is just the printed data. */
export interface CardBase {
  /** Bandai code, e.g., "OP01-001". Unique per printing. */
  id: string;
  name: string;
  kind: CardKind;
  colors: CardColor[]; // Multi-color cards possible (dual-color leaders).
  /** Cost to play. Leaders/DON have null. */
  cost: number | null;
  /** Printed power. Characters/Leaders only. */
  power: number | null;
  /** Counter value (printed on most Characters/Events). null if no counter. */
  counterValue: number | null;
  attribute?: CardAttribute;
  /** Traits in the printed-effect box (e.g., "Straw Hat Crew", "Marine"). */
  traits: string[];
  keywords: Keyword[];
  effectTags: EffectTag[];
  /** Lifetime cards on the leader (5 base, variable per leader). */
  life?: number;
  /** Effect text — used in UI tooltip and as fallback when no effect handler is wired. */
  effectText?: string;
  /** V3 per-card param binding. Maps an EffectTag → the numeric or object
   *  param that template fires with. Without an entry, the template uses its
   *  default (draw=1, power_buff=+1000, etc.). Object params drive windowed
   *  flows (searcher {lookCount, addCount}; disruption {reveal: true}). */
  templateParams?: Partial<Record<EffectTag, number | Record<string, unknown>>>;
}

export interface LeaderCard extends CardBase {
  kind: 'leader';
  power: number;
  life: number;
  cost: null;
  /** D17 (CR §10-2-10): [DON!!−X] activate cost. Number of DON to return from
   *  the cost area to the DON deck when ACTIVATE_MAIN is dispatched. Distinct
   *  from `cost` (which is the play cost; null for leaders). v0 only consumes
   *  cost-area DON; attached-DON payment is voluntary and deferred. */
  donCost?: number;
}

export interface CharacterCard extends CardBase {
  kind: 'character';
  cost: number;
  power: number;
  /** D17 (CR §10-2-10): [DON!!−X] activate cost — see LeaderCard.donCost. */
  donCost?: number;
}

export interface EventCard extends CardBase {
  kind: 'event';
  cost: number;
  power: null;
  /** D3 (CR §7-1-3-2-2): Event cards with a `[Counter]` effect block grant a
   *  power boost to the defender during the Counter Step. Unlike Characters
   *  (whose Counter is the printed chip on the card and lives in
   *  `counterValue`), Events have no printed chip — the boost is encoded by
   *  the effect text. `null` when the Event has no `[Counter]` block. */
  counterEventBoost: number | null;
}

export interface StageCard extends CardBase {
  kind: 'stage';
  cost: number;
  power: null;
  /** D17 (CR §10-2-10): [DON!!−X] activate cost — see LeaderCard.donCost. */
  donCost?: number;
}

export interface DonCard extends CardBase {
  kind: 'don';
  cost: null;
  power: null;
}

export type Card = LeaderCard | CharacterCard | EventCard | StageCard | DonCard;

/** The canonical DON!! card. Identical for every game; reused 10x in DON deck. */
export const DON_CARD: DonCard = {
  id: 'DON',
  name: 'DON!!',
  kind: 'don',
  colors: [],
  cost: null,
  power: null,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};
