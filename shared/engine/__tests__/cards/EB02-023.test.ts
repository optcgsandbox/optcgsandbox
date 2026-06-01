// EB02-023 Crocodile.
//   "[Your Turn] [Once Per Turn] When your opponent's Character is
//    returned to the owner's hand by your effect, look at 3 cards from
//    the top of your deck and place them at the top or bottom of the
//    deck in any order."
//
// V0 engine notes:
// - Reactive "when opp's char is bounced by me" trigger is not yet
//   wired (gap-flagged on spec).
// - peek_and_reorder_own_deck is a V0 no-op (no UI for reorder).
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_023 = ALL_CARDS.find(c => c.id === 'EB02-023')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['blue'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['blue'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  }));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: lead, cards: filler }, B: { leader: { ...lead, id: 'LB', name: 'LB' }, cards: filler } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

describe('EB02-023 — Crocodile', () => {
  it('peek_and_reorder_own_deck action is a V0 no-op (state unchanged)', () => {
    const s = boot();
    const before = JSON.stringify(s);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, EB02_023.effectSpecV2!.clauses![0].action, []);
    expect(JSON.stringify(s)).toBe(before);
  });
});
