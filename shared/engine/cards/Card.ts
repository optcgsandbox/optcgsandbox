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
  | 'cost_reduction'
  | 'recursion'
  | 'ramp'
  | 'lifegain'
  | 'life_to_hand'
  | 'disruption'
  | 'vanilla'
  | 'trigger';

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
}

export interface LeaderCard extends CardBase {
  kind: 'leader';
  power: number;
  life: number;
  cost: null;
}

export interface CharacterCard extends CardBase {
  kind: 'character';
  cost: number;
  power: number;
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
