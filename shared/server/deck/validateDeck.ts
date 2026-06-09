// Deck validation — Phase F-7a.
//
// Pure function. No I/O, no globals, no engine dependency beyond the
// shared Card type. Validates a `DeckSubmission` against a caller-
// supplied cardLibrary; returns either a normalized result (used by
// Matchmaker to build `initialState`) or a structured failure reason.
//
// The validator does NOT know about cards.json, the corpus loader, or
// anything Worker-runtime-specific. The Matchmaker hands it the
// cardLibrary it already has; the React client could hand it the same.
// Identical inputs → identical outputs across runtimes.
//
// Failure taxonomy (8 reasons, exact strings):
//   - malformed_input         — input not the right shape
//   - unknown_leader          — leaderId not in cardLibrary
//   - leader_not_leader       — id exists but `kind !== 'leader'`
//   - wrong_deck_size         — mainDeckIds.length !== 50
//   - unknown_card: <id>      — some mainDeckId not in cardLibrary
//   - leader_in_main_deck: <id> — a `kind === 'leader'` card in main deck
//   - too_many_copies: <id>   — > 4 copies of a single id
//   - color_mismatch: <id>    — card's colors do not intersect leader's
//
// Rules NOT enforced in F-7a (documented gaps):
//   - banlist (engine doesn't currently consult one)
//   - format / rotation (Block 1 / OP-01..OP-04) — product-level concern
//   - events / stages are deliberately accepted into the main deck per
//     OPTCG rules; only `kind === 'leader'` is rejected.

import type { Card, LeaderCard } from '../../engine-v2/cards/Card.js';
import type { CardId } from '../../engine-v2/state/types.js';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface DeckSubmission {
  readonly leaderId: string;
  readonly mainDeckIds: ReadonlyArray<string>;
  readonly name?: string;
}

export interface NormalizedDeck {
  readonly leaderId: CardId;
  readonly mainDeckIds: ReadonlyArray<CardId>;
  readonly name?: string;
}

export type ValidateDeckResult =
  | {
      readonly ok: true;
      readonly leader: LeaderCard;
      readonly cards: ReadonlyArray<Card>;
      readonly normalized: NormalizedDeck;
    }
  | { readonly ok: false; readonly reason: string };

export const REQUIRED_DECK_SIZE = 50;
export const MAX_COPIES_PER_CARD = 4;

// ─────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────

/**
 * Validate a `DeckSubmission` against the supplied cardLibrary.
 *
 * - `submission` is treated as untrusted user input. Shape and content
 *   are validated before any other rule runs.
 * - `cardLibrary` is the caller's authoritative card source. The
 *   validator never imports a global corpus; correctness is the
 *   caller's responsibility.
 *
 * Returns `{ ok: true, leader, cards, normalized }` on success. `cards`
 * is the resolved `Card` for each main-deck id in input order; consumers
 * (Matchmaker) pass it directly to `initialState({ decks: { A, B } })`.
 */
export function validateDeck(
  submission: unknown,
  cardLibrary: Readonly<Record<CardId, Card>>,
): ValidateDeckResult {
  if (submission === null || typeof submission !== 'object') {
    return { ok: false, reason: 'malformed_input' };
  }
  const s = submission as {
    leaderId?: unknown;
    mainDeckIds?: unknown;
    name?: unknown;
  };
  if (typeof s.leaderId !== 'string' || s.leaderId.length === 0) {
    return { ok: false, reason: 'malformed_input' };
  }
  if (!Array.isArray(s.mainDeckIds)) {
    return { ok: false, reason: 'malformed_input' };
  }
  if (s.name !== undefined && typeof s.name !== 'string') {
    return { ok: false, reason: 'malformed_input' };
  }
  for (const id of s.mainDeckIds) {
    if (typeof id !== 'string' || id.length === 0) {
      return { ok: false, reason: 'malformed_input' };
    }
  }

  if (cardLibrary === null || typeof cardLibrary !== 'object') {
    return { ok: false, reason: 'malformed_input' };
  }

  const leaderEntry = cardLibrary[s.leaderId];
  if (leaderEntry === undefined) {
    return { ok: false, reason: 'unknown_leader' };
  }
  if (leaderEntry.kind !== 'leader') {
    return { ok: false, reason: 'leader_not_leader' };
  }
  const leader = leaderEntry as LeaderCard;

  if (s.mainDeckIds.length !== REQUIRED_DECK_SIZE) {
    return { ok: false, reason: 'wrong_deck_size' };
  }

  const resolved: Card[] = [];
  const counts = new Map<CardId, number>();
  const leaderColors = new Set<string>(leader.colors);

  for (const id of s.mainDeckIds as string[]) {
    const card = cardLibrary[id];
    if (card === undefined) {
      return { ok: false, reason: `unknown_card: ${id}` };
    }
    if (card.kind === 'leader') {
      return { ok: false, reason: `leader_in_main_deck: ${id}` };
    }

    const next = (counts.get(id) ?? 0) + 1;
    if (next > MAX_COPIES_PER_CARD) {
      return { ok: false, reason: `too_many_copies: ${id}` };
    }
    counts.set(id, next);

    // Color identity: per OPTCG rules, a card is legal in a deck if any
    // of its colors matches any of the leader's colors. Empty-colors
    // cards (e.g. DON, which is never legitimately in a submitted main
    // deck) fail this check, which is the right posture.
    let colorIntersects = false;
    for (const c of card.colors) {
      if (leaderColors.has(c)) {
        colorIntersects = true;
        break;
      }
    }
    if (!colorIntersects) {
      return { ok: false, reason: `color_mismatch: ${id}` };
    }

    resolved.push(card);
  }

  const normalized: NormalizedDeck = {
    leaderId: leader.id,
    mainDeckIds: (s.mainDeckIds as string[]).slice(),
    ...(typeof s.name === 'string' ? { name: s.name } : {}),
  };

  return { ok: true, leader, cards: resolved, normalized };
}
