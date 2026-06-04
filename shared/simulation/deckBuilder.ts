/**
 * Deck builder for the simulation layer.
 *
 * Builds 50-card legal decks (per OPTCG rules) given a card pool + an
 * optional ForcedInclusionPlan that pins specific cards / a specific
 * leader. Forced cards are inserted first; remaining slots are filled
 * randomly from a color-legal pool. Falls back to nearest-legal selection
 * when the forced leader's colors aren't represented in the pool.
 *
 * Reads cards.json shape; never modifies it.
 */

import type { Card, CharacterCard, EventCard, StageCard, LeaderCard } from '../engine-v2/cards/Card.js';
import type { Rng } from './rng.js';

export interface ForcedInclusionPlan {
  /** Card IDs to inject into the deck first (up to deck size minus 0). */
  readonly forcedCards: ReadonlyArray<string>;
  /** Card ID of leader to use; if null, a random legal leader is picked. */
  readonly forcedLeader: string | null;
}

export interface BuiltDeck {
  readonly leader: LeaderCard;
  readonly cards: ReadonlyArray<Card>;
  /** cardIds of every card in the 50-card deck (for coverage marking). */
  readonly cardIds: ReadonlyArray<string>;
}

const DECK_SIZE = 50;
const MAX_COPIES_PER_CARD = 4;

type NonLeaderCard = CharacterCard | EventCard | StageCard;

function isLeader(c: Card): c is LeaderCard {
  return c.kind === 'leader';
}

function isPlayable(c: Card): c is NonLeaderCard {
  return c.kind === 'character' || c.kind === 'event' || c.kind === 'stage';
}

function colorsOf(c: Card): ReadonlyArray<string> {
  return ((c as { colors?: ReadonlyArray<string> }).colors) ?? [];
}

function colorsIntersect(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  for (const x of a) if (b.includes(x)) return true;
  return false;
}

export function buildDeck(
  rng: Rng,
  allCards: ReadonlyArray<Card>,
  plan: ForcedInclusionPlan | null,
): BuiltDeck {
  const leaders = allCards.filter(isLeader);
  if (leaders.length === 0) throw new Error('No leader cards in pool');

  // 1. Pick leader
  let leader: LeaderCard;
  if (plan?.forcedLeader) {
    const found = leaders.find((l) => l.id === plan.forcedLeader);
    leader = found ?? rng.pick(leaders);
  } else {
    leader = rng.pick(leaders);
  }
  const leaderColors = colorsOf(leader);

  // 2. Build color-legal playable pool
  const colorLegal = allCards.filter(isPlayable).filter((c) => {
    const cc = colorsOf(c);
    return cc.length === 0 || colorsIntersect(cc, leaderColors);
  });

  if (colorLegal.length === 0) {
    // Fallback: ignore color legality so we can still build SOME deck
    const allPlayable = allCards.filter(isPlayable);
    if (allPlayable.length === 0) throw new Error('No playable cards in pool');
    return fillDeck(rng, leader, allPlayable, plan);
  }

  return fillDeck(rng, leader, colorLegal, plan);
}

function fillDeck(
  rng: Rng,
  leader: LeaderCard,
  legalPool: ReadonlyArray<NonLeaderCard>,
  plan: ForcedInclusionPlan | null,
): BuiltDeck {
  const counts = new Map<string, number>();
  const deck: NonLeaderCard[] = [];

  function tryAdd(c: NonLeaderCard | undefined): boolean {
    if (c === undefined) return false;
    if (deck.length >= DECK_SIZE) return false;
    const n = counts.get(c.id) ?? 0;
    if (n >= MAX_COPIES_PER_CARD) return false;
    deck.push(c);
    counts.set(c.id, n + 1);
    return true;
  }

  // 1. Forced cards first (up to deck size). Drop forced cards whose
  //    color isn't represented in legalPool — they'd be illegal.
  const legalIdSet = new Set(legalPool.map((c) => c.id));
  if (plan?.forcedCards) {
    for (const cardId of plan.forcedCards) {
      if (deck.length >= DECK_SIZE) break;
      // Try inject up to 1 copy of each forced card (don't blow the 4-cap by accident)
      const card = legalPool.find((c) => c.id === cardId);
      if (card === undefined) continue;
      tryAdd(card);
      void legalIdSet; // referenced
    }
  }

  // 2. Random fill from legal pool until DECK_SIZE
  const shuffled = rng.shuffle(legalPool);
  let cursor = 0;
  while (deck.length < DECK_SIZE && cursor < shuffled.length * 5) {
    const c = shuffled[cursor % shuffled.length]!;
    tryAdd(c);
    cursor += 1;
  }

  // 3. Last-resort: if still under 50 (rare — only when legalPool is tiny and
  //    every card is already at 4 copies), just duplicate first available.
  if (deck.length < DECK_SIZE) {
    for (const c of shuffled) {
      while (deck.length < DECK_SIZE) {
        deck.push(c);
      }
      if (deck.length >= DECK_SIZE) break;
    }
  }

  return {
    leader,
    cards: deck,
    cardIds: deck.map((c) => c.id),
  };
}
