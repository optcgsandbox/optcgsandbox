// EB01-019 Off-White (event).
//   "[Counter] Up to 1 of your Leader or Character cards gains +4000
//    power during this battle. Then, look at 3 cards from the top of
//    your deck; reveal up to 1 {Donquixote Pirates} type Character card
//    and add it to your hand. Then, place the rest at the bottom of
//    your deck in any order."
import { describe, expect, it } from 'vitest';
import { applyActionV2, resolveTargetV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_019 = ALL_CARDS.find(c => c.id === 'EB01-019')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['green'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['green'],
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

describe('EB01-019 — Off-White', () => {
  const [c0, c1] = EB01_019.effectSpecV2!.clauses!;

  it('target of buff clause INCLUDES own leader (your_leader_or_character)', () => {
    const s = boot();
    const ids = resolveTargetV2(s, 'A', 'src', c0.target);
    expect(ids).toContain(s.players.A.leader.instanceId);
  });

  it('+4000 power can be applied to own character', () => {
    const s = boot();
    const ally: CharacterCard = {
      id: 'AL', name: 'Ally', kind: 'character', colors: ['green'],
      cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[ally.id] = ally;
    s.instances['al'] = {
      instanceId: 'al', cardId: ally.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['al']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, c0.action, ['al']);
    expect(s.instances['al'].powerModifier).toBe(4000);
  });

  it('+4000 power applied to leader; clears at endTurn (this_battle ~= this_turn)', () => {
    const s = boot();
    const leaderId = s.players.A.leader.instanceId;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, c0.action, [leaderId]);
    expect(s.instances[leaderId].powerModifier).toBe(4000);
    expect(endTurn(s).instances[leaderId].powerModifier).toBeUndefined();
  });

  it('searcher_peek pulls a Donquixote Pirates char from top 3 of deck', () => {
    const s = boot();
    const dp: CharacterCard = {
      id: 'DP', name: 'Donq', kind: 'character', colors: ['green'],
      cost: 4, power: 5000, counterValue: 1000,
      traits: ['Donquixote Pirates'], keywords: [], effectTags: [],
    };
    s.cardLibrary[dp.id] = dp;
    s.instances['dp'] = {
      instanceId: 'dp', cardId: dp.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.deck.unshift('dp');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, c1.action, []);
    expect(s.players.A.hand).toContain('dp');
  });

  it('searcher_peek lookCount=3: a Donq char at deck position 3 (4th) is NOT found', () => {
    const s = boot();
    const dp: CharacterCard = {
      id: 'DP2', name: 'Donq2', kind: 'character', colors: ['green'],
      cost: 4, power: 5000, counterValue: 1000,
      traits: ['Donquixote Pirates'], keywords: [], effectTags: [],
    };
    s.cardLibrary[dp.id] = dp;
    s.instances['dp2'] = {
      instanceId: 'dp2', cardId: dp.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.deck.splice(3, 0, 'dp2');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, c1.action, []);
    expect(s.players.A.hand).not.toContain('dp2');
  });
});
