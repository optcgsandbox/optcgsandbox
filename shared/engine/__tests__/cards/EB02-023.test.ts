// EB02-023 Crocodile.
//   "[Your Turn] [Once Per Turn] When your opponent's Character is
//    returned to the owner's hand by your effect, look at 3 cards from
//    the top of your deck and place them at the top or bottom of the
//    deck in any order."
//
// Engine wiring:
// - Trigger `on_opp_char_bounce_by_me` is broadcast from `removal_bounce`
//   when a controller's effect bounces an opp character.
// - `peek_and_reorder_own_deck` keeps the deck order (a legal "any order"
//   choice without UI) and stamps `state.lastPeek` so UI/AI can react.
// - Clause is gated by `is_own_turn` and `opt:true` + `once_per_turn`.
import { describe, expect, it } from 'vitest';
import { applyActionV2, broadcastTriggerToOwnField } from '../../effectSpec/runner-v2';
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
  it('spec: trigger on_opp_char_bounce_by_me, condition is_own_turn, action peek_and_reorder_own_deck:3', () => {
    const c = EB02_023.effectSpecV2!.clauses![0];
    expect(c.trigger).toBe('on_opp_char_bounce_by_me');
    expect(c.condition?.type).toBe('is_own_turn');
    expect(c.action.kind).toBe('peek_and_reorder_own_deck');
    expect((c.action as { count: number }).count).toBe(3);
    expect(c.opt).toBe(true);
  });

  it('peek_and_reorder_own_deck stamps state.lastPeek with top 3 deck ids', () => {
    const s = boot();
    const top3 = s.players.A.deck.slice(0, 3);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, EB02_023.effectSpecV2!.clauses![0].action, []);
    const lastPeek = (s as unknown as { lastPeek?: { controller: string; zone: string; ids: string[] } }).lastPeek;
    expect(lastPeek?.controller).toBe('A');
    expect(lastPeek?.zone).toBe('ownDeck');
    expect(lastPeek?.ids).toEqual(top3);
  });

  it('broadcast on_opp_char_bounce_by_me to a Crocodile on field fires the peek (when is_own_turn)', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'CR', name: 'Crocodile', kind: 'character', colors: ['blue'],
      cost: 4, power: 5000, counterValue: 1000,
      traits: ['The Seven Warlords of the Sea', 'Baroque Works'],
      keywords: ['trigger', 'once_per_turn'],
      effectTags: [],
    };
    c.effectSpecV2 = EB02_023.effectSpecV2;
    s.cardLibrary[c.id] = c;
    s.instances['cr'] = {
      instanceId: 'cr', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['cr']);
    const top3 = s.players.A.deck.slice(0, 3);
    broadcastTriggerToOwnField(s, 'on_opp_char_bounce_by_me', 'A');
    const lastPeek = (s as unknown as { lastPeek?: { ids: string[] } }).lastPeek;
    expect(lastPeek?.ids).toEqual(top3);
    // OPT key shape mirrors fireV2Effects: opt:${trigger}:${clauseIndex}
    expect(s.instances['cr'].perTurn.effectsUsed).toContain('opt:on_opp_char_bounce_by_me:0');
  });
});
