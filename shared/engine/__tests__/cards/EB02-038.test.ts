// EB02-038 Magellan.
//   "[On Play] Play up to 1 {Impel Down} type Character card with a
//    cost of 2 or less from your hand."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_038 = ALL_CARDS.find(c => c.id === 'EB02-038')!;

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

describe('EB02-038 — Magellan', () => {
  const clause = EB02_038.effectSpecV2!.clauses![0];

  it('plays a cost-2 Impel Down char from hand', () => {
    const s = boot();
    s.players.A.hand = [];
    const c: CharacterCard = {
      id: 'ID2', name: 'ID2', kind: 'character', colors: ['purple'],
      cost: 2, power: 3000, counterValue: 1000, traits: ['Impel Down'], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['id2'] = {
      instanceId: 'id2', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.hand.push('id2');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'id2')).toBe(true);
  });

  it('does NOT play cost-3 Impel Down', () => {
    const s = boot();
    s.players.A.hand = [];
    const c: CharacterCard = {
      id: 'ID3', name: 'ID3', kind: 'character', colors: ['purple'],
      cost: 3, power: 4000, counterValue: 1000, traits: ['Impel Down'], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['id3'] = {
      instanceId: 'id3', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.hand.push('id3');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain('id3');
  });

  it('does NOT play non-Impel-Down cost-2', () => {
    const s = boot();
    s.players.A.hand = [];
    const c: CharacterCard = {
      id: 'OTH', name: 'OTH', kind: 'character', colors: ['purple'],
      cost: 2, power: 3000, counterValue: 1000, traits: ['Other'], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['oth'] = {
      instanceId: 'oth', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.hand.push('oth');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain('oth');
  });
});
