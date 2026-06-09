/**
 * validateDeck — Phase F-7a.
 *
 * Pure-function tests. Uses small synthetic card libraries built inline
 * — does NOT import `shared/data/cards.json`. Validator correctness is
 * orthogonal to corpus content.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_COPIES_PER_CARD,
  REQUIRED_DECK_SIZE,
  validateDeck,
} from '../deck/validateDeck.js';
import type { Card, CardColor, LeaderCard } from '../../engine-v2/cards/Card.js';

// ─────────────────────────────────────────────────────────────────────
// Library fixtures
// ─────────────────────────────────────────────────────────────────────

function leader(
  id: string,
  colors: CardColor[],
  name = 'Leader',
): LeaderCard {
  return {
    id,
    name,
    kind: 'leader',
    cost: null,
    power: 5000,
    life: 5,
    counterValue: null,
    colors,
    traits: [],
    keywords: [],
    effectText: '',
  };
}

function char(
  id: string,
  colors: CardColor[],
  name = 'Char',
): Card {
  return {
    id,
    name,
    kind: 'character',
    cost: 2,
    power: 3000,
    counterValue: 1000,
    colors,
    traits: [],
    keywords: [],
    effectText: '',
  };
}

const RED_LEADER = leader('LEADER-R', ['red']);
const MULTI_LEADER = leader('LEADER-RG', ['red', 'green'], 'Multi');
const RED_CHAR_A = char('CHAR-RA', ['red']);
const RED_CHAR_B = char('CHAR-RB', ['red']);
const GREEN_CHAR = char('CHAR-G', ['green']);
const BLUE_CHAR = char('CHAR-B', ['blue']);
const MULTI_RG_CHAR = char('CHAR-RG', ['red', 'green'], 'MultiChar');

const LIBRARY = {
  [RED_LEADER.id]: RED_LEADER,
  [MULTI_LEADER.id]: MULTI_LEADER,
  [RED_CHAR_A.id]: RED_CHAR_A,
  [RED_CHAR_B.id]: RED_CHAR_B,
  [GREEN_CHAR.id]: GREEN_CHAR,
  [BLUE_CHAR.id]: BLUE_CHAR,
  [MULTI_RG_CHAR.id]: MULTI_RG_CHAR,
} as const;

/**
 * Build a deck of `size` ids by cycling through two compatible char ids
 * — `CHAR-RA` then `CHAR-RB` — never exceeding `MAX_COPIES_PER_CARD` per id.
 */
function buildRedDeck(size: number = REQUIRED_DECK_SIZE): string[] {
  const ids: string[] = [];
  for (let i = 0; i < size; i++) {
    // Pair of ids, each appearing at most 4 times consecutively, then
    // rotate. 50 cards = 25 of each, but we max 4 per id so we need
    // more variety. Use 13 different "slots" by re-keying RED_CHAR_A
    // and RED_CHAR_B per index. For the synthetic library we just
    // alternate within the 4-copy cap by spreading across the two ids
    // and accepting that 50 cards / 2 ids = 25 copies each, which
    // exceeds 4. So we extend the library with more red chars below.
    ids.push(i % 2 === 0 ? RED_CHAR_A.id : RED_CHAR_B.id);
  }
  return ids;
}

/**
 * Build a library + deck where the deck is exactly 50 cards across
 * enough distinct ids that the 4-copy rule is satisfied. The simplest
 * shape: 13 ids × 4 copies = 52 → cap at 50 by dropping 2 of the last
 * id. So we end up with 12 ids × 4 + 1 id × 2 = 50.
 */
function buildValidRedLibraryAndDeck(): {
  library: Record<string, Card>;
  deck: string[];
} {
  const library: Record<string, Card> = {
    [RED_LEADER.id]: RED_LEADER,
  };
  const deck: string[] = [];
  let total = 0;
  let i = 0;
  while (total < REQUIRED_DECK_SIZE) {
    const id = `RED-${i.toString().padStart(3, '0')}`;
    library[id] = char(id, ['red'], `Red ${i}`);
    const want = Math.min(
      MAX_COPIES_PER_CARD,
      REQUIRED_DECK_SIZE - total,
    );
    for (let j = 0; j < want; j++) deck.push(id);
    total += want;
    i += 1;
  }
  return { library, deck };
}

// ─────────────────────────────────────────────────────────────────────
// Happy paths
// ─────────────────────────────────────────────────────────────────────

describe('validateDeck — happy paths', () => {
  it('accepts a valid single-color deck (exactly 50 cards, ≤4 of each id)', () => {
    const { library, deck } = buildValidRedLibraryAndDeck();
    const r = validateDeck(
      { leaderId: RED_LEADER.id, mainDeckIds: deck, name: 'My Red Deck' },
      library,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.leader.id).toBe(RED_LEADER.id);
      expect(r.cards.length).toBe(REQUIRED_DECK_SIZE);
      expect(r.normalized.leaderId).toBe(RED_LEADER.id);
      expect(r.normalized.mainDeckIds.length).toBe(REQUIRED_DECK_SIZE);
      expect(r.normalized.name).toBe('My Red Deck');
    }
  });

  it('accepts a multi-color leader deck where main cards match EITHER leader color', () => {
    // 25 red + 25 green = 50; each card type ≤4 copies via library expansion.
    const library: Record<string, Card> = {
      [MULTI_LEADER.id]: MULTI_LEADER,
    };
    const deck: string[] = [];
    let total = 0;
    let i = 0;
    while (total < REQUIRED_DECK_SIZE) {
      const color: CardColor = total < REQUIRED_DECK_SIZE / 2 ? 'red' : 'green';
      const id = `${color.toUpperCase()}-${i.toString().padStart(3, '0')}`;
      library[id] = char(id, [color]);
      const want = Math.min(
        MAX_COPIES_PER_CARD,
        REQUIRED_DECK_SIZE - total,
      );
      for (let j = 0; j < want; j++) deck.push(id);
      total += want;
      i += 1;
    }
    const r = validateDeck(
      { leaderId: MULTI_LEADER.id, mainDeckIds: deck },
      library,
    );
    expect(r.ok).toBe(true);
  });

  it('accepts a multi-color card under a single-color leader if intersect non-empty', () => {
    // Multi-color leader RED+GREEN, card RED+GREEN under single-RED leader.
    const library: Record<string, Card> = {
      [RED_LEADER.id]: RED_LEADER,
      [MULTI_RG_CHAR.id]: MULTI_RG_CHAR,
    };
    const deck = Array.from({ length: REQUIRED_DECK_SIZE }, () => MULTI_RG_CHAR.id);
    // 50 copies of the same card hits too_many_copies — replace with
    // unique ids that all carry [red, green].
    const realLib: Record<string, Card> = { [RED_LEADER.id]: RED_LEADER };
    const realDeck: string[] = [];
    let total = 0;
    let i = 0;
    while (total < REQUIRED_DECK_SIZE) {
      const id = `MULTI-${i.toString().padStart(3, '0')}`;
      realLib[id] = char(id, ['red', 'green']);
      const want = Math.min(MAX_COPIES_PER_CARD, REQUIRED_DECK_SIZE - total);
      for (let j = 0; j < want; j++) realDeck.push(id);
      total += want;
      i += 1;
    }
    const r = validateDeck(
      { leaderId: RED_LEADER.id, mainDeckIds: realDeck },
      realLib,
    );
    expect(r.ok).toBe(true);
    // Touch the dead local so it isn't flagged unused.
    expect(deck.length).toBe(50);
    expect(library[MULTI_RG_CHAR.id]).toBeDefined();
  });

  it('name field is optional and survives normalization when omitted', () => {
    const { library, deck } = buildValidRedLibraryAndDeck();
    const r = validateDeck(
      { leaderId: RED_LEADER.id, mainDeckIds: deck },
      library,
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.normalized.name).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Boundary cases
// ─────────────────────────────────────────────────────────────────────

describe('validateDeck — boundary cases', () => {
  it('accepts EXACTLY 4 copies of a single card (boundary)', () => {
    const { library, deck } = buildValidRedLibraryAndDeck();
    // Replace first 4 cards with 4 copies of CHAR-RA so the count of
    // RED-000 drops from 4 to 0 and CHAR-RA appears 4 times.
    library[RED_CHAR_A.id] = RED_CHAR_A;
    const newDeck = [
      RED_CHAR_A.id,
      RED_CHAR_A.id,
      RED_CHAR_A.id,
      RED_CHAR_A.id,
      ...deck.slice(4),
    ];
    const r = validateDeck(
      { leaderId: RED_LEADER.id, mainDeckIds: newDeck },
      library,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects 5 copies of the same card (boundary)', () => {
    const { library, deck } = buildValidRedLibraryAndDeck();
    library[RED_CHAR_A.id] = RED_CHAR_A;
    const newDeck = [
      RED_CHAR_A.id,
      RED_CHAR_A.id,
      RED_CHAR_A.id,
      RED_CHAR_A.id,
      RED_CHAR_A.id,
      ...deck.slice(5),
    ];
    const r = validateDeck(
      { leaderId: RED_LEADER.id, mainDeckIds: newDeck },
      library,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(`too_many_copies: ${RED_CHAR_A.id}`);
  });

  it('rejects 49 cards (under)', () => {
    const { library, deck } = buildValidRedLibraryAndDeck();
    const r = validateDeck(
      { leaderId: RED_LEADER.id, mainDeckIds: deck.slice(0, 49) },
      library,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong_deck_size');
  });

  it('rejects 51 cards (over)', () => {
    const { library, deck } = buildValidRedLibraryAndDeck();
    const r = validateDeck(
      { leaderId: RED_LEADER.id, mainDeckIds: [...deck, deck[0]!] },
      library,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong_deck_size');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Failure cases — full taxonomy
// ─────────────────────────────────────────────────────────────────────

describe('validateDeck — failure taxonomy', () => {
  it('rejects null submission', () => {
    const r = validateDeck(null, LIBRARY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed_input');
  });

  it('rejects missing leaderId', () => {
    const r = validateDeck({ mainDeckIds: [] } as unknown, LIBRARY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed_input');
  });

  it('rejects non-array mainDeckIds', () => {
    const r = validateDeck(
      { leaderId: 'X', mainDeckIds: 'not-an-array' } as unknown,
      LIBRARY,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed_input');
  });

  it('rejects non-string element in mainDeckIds', () => {
    const r = validateDeck(
      {
        leaderId: RED_LEADER.id,
        mainDeckIds: [42, 'X'],
      } as unknown,
      LIBRARY,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed_input');
  });

  it('rejects unknown leaderId', () => {
    const r = validateDeck(
      { leaderId: 'NO-SUCH-LEADER', mainDeckIds: [] },
      LIBRARY,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown_leader');
  });

  it('rejects when leader slot points at a non-leader card', () => {
    const r = validateDeck(
      { leaderId: RED_CHAR_A.id, mainDeckIds: [] },
      LIBRARY,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('leader_not_leader');
  });

  it('rejects unknown main-deck card id', () => {
    const { library, deck } = buildValidRedLibraryAndDeck();
    const corrupted = [...deck];
    corrupted[3] = 'CARD-DOES-NOT-EXIST';
    const r = validateDeck(
      { leaderId: RED_LEADER.id, mainDeckIds: corrupted },
      library,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown_card: CARD-DOES-NOT-EXIST');
  });

  it('rejects leader card embedded in main deck', () => {
    // Use the same valid base then swap one slot for a leader id.
    const { library, deck } = buildValidRedLibraryAndDeck();
    const corrupted = [...deck];
    corrupted[7] = RED_LEADER.id;
    const r = validateDeck(
      { leaderId: RED_LEADER.id, mainDeckIds: corrupted },
      library,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe(`leader_in_main_deck: ${RED_LEADER.id}`);
    }
  });

  it('rejects color mismatch (blue card under red leader)', () => {
    // Build a valid red deck, then swap one card for the blue one.
    const { library, deck } = buildValidRedLibraryAndDeck();
    library[BLUE_CHAR.id] = BLUE_CHAR;
    const corrupted = [...deck];
    corrupted[10] = BLUE_CHAR.id;
    const r = validateDeck(
      { leaderId: RED_LEADER.id, mainDeckIds: corrupted },
      library,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(`color_mismatch: ${BLUE_CHAR.id}`);
  });

  it('rejects undefined cardLibrary', () => {
    const r = validateDeck(
      { leaderId: 'X', mainDeckIds: [] },
      null as unknown as Record<string, Card>,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed_input');
  });

  it('rejects non-string name', () => {
    const r = validateDeck(
      {
        leaderId: RED_LEADER.id,
        mainDeckIds: [],
        name: 42,
      } as unknown,
      LIBRARY,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed_input');
  });
});
