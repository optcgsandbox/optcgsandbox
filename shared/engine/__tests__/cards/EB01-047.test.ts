// EB01-047 Laboon.
//   "[Once Per Turn] When a Character is K.O.'d, draw 1 card and trash
//    1 card from your hand."
//
// Trigger: `on_any_char_ko` — broadcast after any KO (own or opp) by
// applyAction (battle path) and runner-v2 removal_ko (effect path).
// Single sequence clause: draw 1 → discard 1.
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
  const clauses = EB01_047.effectSpecV2!.clauses!;

  it('spec shape: single on_any_char_ko sequence clause (draw 1 → discard 1)', () => {
    expect(clauses.length).toBe(1);
    expect(clauses[0].trigger).toBe('on_any_char_ko');
    expect(clauses[0].action.kind).toBe('sequence');
    const seq = clauses[0].action as { kind: 'sequence'; actions: Array<{ kind: string; magnitude: number }> };
    expect(seq.actions[0].kind).toBe('draw');
    expect(seq.actions[0].magnitude).toBe(1);
    expect(seq.actions[1].kind).toBe('discard_from_hand');
    expect(seq.actions[1].magnitude).toBe(1);
  });

  it('sequence resolves: +1 hand from draw, -1 hand and +1 trash from discard (net 0 hand, +1 trash)', () => {
    const s = boot();
    const handBefore = s.players.A.hand.length;
    const trashBefore = s.players.A.trash.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clauses[0].action, []);
    expect(s.players.A.hand.length).toBe(handBefore);
    expect(s.players.A.trash.length).toBe(trashBefore + 1);
  });
});
