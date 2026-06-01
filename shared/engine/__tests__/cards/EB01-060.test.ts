// EB01-060 Did Someone Say...Kami?
//   "[Main] Play up to 1 [Enel] with a cost of 7 or less from your hand
//    or trash. Then, trash cards from the top of your Life cards until
//    you have 1 Life card."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_060 = ALL_CARDS.find(c => c.id === 'EB01-060')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['yellow'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['yellow'],
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

function addEnel(s: any, id: string, cost: number, zone: 'hand'|'trash') {
  const c: CharacterCard = {
    id, name: 'Enel', kind: 'character', colors: ['yellow'],
    cost, power: 7000, counterValue: 1000, traits: ['Sky Island'], keywords: [], effectTags: [],
  };
  s.cardLibrary[id] = c;
  s.instances[id] = {
    instanceId: id, cardId: id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A[zone].push(id);
}

describe('EB01-060 — Did Someone Say...Kami?', () => {
  const [playClause, lifeClause] = EB01_060.effectSpecV2!.clauses!;

  it('plays cost-7 Enel from hand', () => {
    const s = boot();
    addEnel(s, 'en7', 7, 'hand');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, playClause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'en7')).toBe(true);
  });

  it('plays cost-5 Enel from trash', () => {
    const s = boot();
    addEnel(s, 'en5t', 5, 'trash');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, playClause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'en5t')).toBe(true);
  });

  it('does NOT play cost-8 Enel (filter costMax 7)', () => {
    const s = boot();
    addEnel(s, 'en8', 8, 'hand');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, playClause.action, []);
    expect(s.players.A.hand).toContain('en8');
  });

  it('life clause: trashes life down to 1', () => {
    const s = boot();
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, lifeClause.action, []);
    expect(s.players.A.life.length).toBe(1);
  });
});
