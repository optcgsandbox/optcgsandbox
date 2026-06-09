// Online lobby deck builder.
//
// Separate from `src/store/game.ts:buildDeck` because that one (intentionally)
// allows >4 copies via `.slice(0, 50)` — the local sandbox is forgiving and
// the engine never checks the 4-copy rule. The lobby submits to Matchmaker
// which DOES enforce the 4-copy rule via `shared/server/deck/validateDeck.ts`,
// so the online builder respects it from the start.

import type { Card, CardColor, LeaderCard } from '@shared/engine-v2/cards/Card';
import cardsDataRaw from '@shared/data/cards.json';

const ALL_CARDS = cardsDataRaw as unknown as Card[];

export type DeckColor = CardColor;

export interface BuiltDeck {
  readonly leaderId: string;
  readonly leaderName: string;
  readonly mainDeckIds: ReadonlyArray<string>;
}

/**
 * Build a 50-card deck for the given color. Honors the 4-copy rule so
 * `validateDeck` accepts it. Picks the first single-color leader of
 * the requested color; cycles through color-matching non-leader cards
 * in corpus order, stopping at 4 copies per id, until the deck is 50.
 */
export function buildOnlineDeck(color: DeckColor): BuiltDeck {
  const leader = ALL_CARDS.find(
    (c): c is LeaderCard =>
      c.kind === 'leader' && c.colors.length === 1 && c.colors[0] === color,
  );
  if (leader === undefined) {
    throw new Error(`buildOnlineDeck: no single-color ${color} leader in corpus`);
  }

  const pool = ALL_CARDS.filter(
    (c) => c.kind !== 'leader' && c.colors.includes(color),
  );

  const ids: string[] = [];
  const counts = new Map<string, number>();
  let scan = 0;
  while (ids.length < 50 && scan < pool.length * 4) {
    const c = pool[scan % pool.length]!;
    const cur = counts.get(c.id) ?? 0;
    if (cur < 4) {
      ids.push(c.id);
      counts.set(c.id, cur + 1);
    }
    scan += 1;
  }
  if (ids.length < 50) {
    throw new Error(
      `buildOnlineDeck: only ${ids.length} legal cards available for ${color} — corpus too small`,
    );
  }

  return {
    leaderId: leader.id,
    leaderName: leader.name,
    mainDeckIds: ids,
  };
}
