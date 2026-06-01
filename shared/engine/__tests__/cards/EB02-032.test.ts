// EB02-032 Iceburg.
//   "[On Play] If you have 3 or more DON!! cards on your field, look
//    at 7 cards from the top of your deck; reveal up to 1
//    [Galley-La Company] and add it to your hand. Then, place the
//    rest at the bottom of your deck in any order and play up to 1
//    [Galley-La Company] from your hand."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_032 = ALL_CARDS.find(c => c.id === 'EB02-032')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['purple'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['purple'],
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

describe('EB02-032 — Iceburg', () => {
  const [searchClause, playClause] = EB02_032.effectSpecV2!.clauses!;

  it('condition TRUE: 3 DON in cost area', () => {
    const s = boot();
    while (s.players.A.donCostArea.length < 3) s.players.A.donCostArea.push(`d${s.players.A.donCostArea.length}`);
    expect(evaluateConditionV2(s, 'A', searchClause.condition, 'src')).toBe(true);
  });

  it('search: pulls a card named "Galley-La Company"', () => {
    const s = boot();
    while (s.players.A.donCostArea.length < 3) s.players.A.donCostArea.push(`d${s.players.A.donCostArea.length}`);
    const gl: CharacterCard = {
      id: 'GL', name: 'Galley-La Company', kind: 'character', colors: ['purple'],
      cost: 3, power: 4000, counterValue: 1000, traits: ['Water Seven'], keywords: [], effectTags: [],
    };
    s.cardLibrary[gl.id] = gl;
    s.instances['gl'] = {
      instanceId: 'gl', cardId: gl.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.deck.unshift('gl');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, searchClause.action, []);
    expect(s.players.A.hand).toContain('gl');
  });

  it('play: plays Galley-La Company from hand', () => {
    const s = boot();
    s.players.A.hand = [];
    const gl: CharacterCard = {
      id: 'GL2', name: 'Galley-La Company', kind: 'character', colors: ['purple'],
      cost: 3, power: 4000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[gl.id] = gl;
    s.instances['gl2'] = {
      instanceId: 'gl2', cardId: gl.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.hand.push('gl2');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, playClause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'gl2')).toBe(true);
  });
});
