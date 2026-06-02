/**
 * Engine V2 — canonical Card type.
 *
 * One row per printed card definition. Loaded once at game start into
 * `state.cardLibrary` (keyed by Card.id). Instances reference cards via
 * CardInstance.cardId.
 *
 * Cross-references:
 * - Implementation spec §2.4 (Card shape)
 * - Plan v1 §6.6 (corpus origin: vegapull + punk-records + Crew Builder Supabase)
 */

import type { EffectSpecV2 } from '../spec/types.js'; // forward-declared

// ────────────────────────────────────────────────────────────────────
// Card primitives
// ────────────────────────────────────────────────────────────────────

export type CardColor = 'red' | 'green' | 'blue' | 'purple' | 'black' | 'yellow';

export type CardKind = 'leader' | 'character' | 'event' | 'stage' | 'don';

export type CardAttribute = 'slash' | 'strike' | 'ranged' | 'special' | 'wisdom';

/**
 * Printed keywords. Engine V2 distinguishes printed keywords (immutable per
 * card) from runtime granted-keywords (CardInstance.grantedKeywords{OneShot,Continuous}).
 * Always use the `instHasKeyword(state, inst, kw)` helper to read at consumption sites.
 */
export type Keyword =
  | 'blocker'
  | 'rush'
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

// ────────────────────────────────────────────────────────────────────
// Card variants (discriminated union by `kind`)
// ────────────────────────────────────────────────────────────────────

interface CardBase {
  readonly id: string;
  readonly name: string;
  readonly colors: ReadonlyArray<CardColor>;
  readonly traits: ReadonlyArray<string>;
  readonly keywords: ReadonlyArray<Keyword>;
  readonly attribute?: CardAttribute;
  readonly effectText: string;
  readonly effectSpecV2?: EffectSpecV2;
}

export interface LeaderCard extends CardBase {
  readonly kind: 'leader';
  readonly cost: null;
  readonly power: number;
  readonly life: number;
  readonly counterValue: null;
}

export interface CharacterCard extends CardBase {
  readonly kind: 'character';
  readonly cost: number;
  readonly power: number;
  readonly life?: null;
  readonly counterValue: number | null;
}

export interface EventCard extends CardBase {
  readonly kind: 'event';
  readonly cost: number;
  readonly power: null;
  readonly life?: null;
  readonly counterValue: null;
  readonly counterEventBoost: number | null;
}

export interface StageCard extends CardBase {
  readonly kind: 'stage';
  readonly cost: number;
  readonly power: null;
  readonly life?: null;
  readonly counterValue: null;
}

export interface DonCard extends CardBase {
  readonly kind: 'don';
  readonly cost: null;
  readonly power: null;
  readonly life?: null;
  readonly counterValue: null;
}

export type Card = LeaderCard | CharacterCard | EventCard | StageCard | DonCard;

// ────────────────────────────────────────────────────────────────────
// Type guards
// ────────────────────────────────────────────────────────────────────

export function isLeader(card: Card): card is LeaderCard {
  return card.kind === 'leader';
}

export function isCharacter(card: Card): card is CharacterCard {
  return card.kind === 'character';
}

export function isEvent(card: Card): card is EventCard {
  return card.kind === 'event';
}

export function isStage(card: Card): card is StageCard {
  return card.kind === 'stage';
}

export function isDon(card: Card): card is DonCard {
  return card.kind === 'don';
}

/** Returns the card's base power (LeaderCard or CharacterCard), or null for non-combat cards. */
export function basePower(card: Card): number | null {
  if (isLeader(card) || isCharacter(card)) return card.power;
  return null;
}
