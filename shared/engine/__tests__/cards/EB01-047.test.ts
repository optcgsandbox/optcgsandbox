// EB01-047 Laboon.
//   "[Once Per Turn] When a Character is K.O.'d, draw 1 card and trash
//    1 card from your hand."
//
// NOTE: V0 engine fires `on_ko` only for the source card itself. Per the
// printed text the trigger should fire when ANY character is KO'd (likely
// any of your own characters). Broader "at_any_ko" broadcast across
// field instances is not yet wired (audit-note flagged on the spec).
// These tests verify the per-clause action handlers work correctly so
// that, when the at_any_ko trigger is wired in the future, only the
// dispatcher layer needs to change.
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_047 = ALL_CARDS.find(c => c.id === 'EB01-047')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['black'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['black'],
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

describe('EB01-047 — Laboon', () => {
  const [drawClause, discardClause] = EB01_047.effectSpecV2!.clauses!;

  it('draw clause: draws 1 card', () => {
    const s = boot();
    const before = s.players.A.hand.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, drawClause.action, []);
    expect(s.players.A.hand.length).toBe(before + 1);
  });

  it('discard clause: trashes 1 card from hand', () => {
    const s = boot();
    const before = s.players.A.hand.length;
    const trashBefore = s.players.A.trash.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, discardClause.action, []);
    expect(s.players.A.hand.length).toBe(before - 1);
    expect(s.players.A.trash.length).toBe(trashBefore + 1);
  });
});
