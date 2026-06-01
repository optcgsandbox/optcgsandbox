// EB01-033 Blueno.
//   "[On Play] DON!! −1: If your Leader has the {Water Seven} type, play
//    up to 1 {Water Seven} type Character card with a cost of 5 other
//    than [Blueno] from your hand or trash."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_033 = ALL_CARDS.find(c => c.id === 'EB01-033')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['purple'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: ['Water Seven'], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['purple'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  }));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: lead, cards: filler }, B: { leader: { ...lead, id: 'LB', name: 'LB', traits: [] }, cards: filler } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

function addToHand(s: any, name: string, cost: number, traits: string[]) {
  const id = `H_${name}`;
  const c: CharacterCard = {
    id, name, kind: 'character', colors: ['purple'],
    cost, power: 5000, counterValue: 1000, traits, keywords: [], effectTags: [],
  };
  s.cardLibrary[id] = c;
  s.instances[id] = {
    instanceId: id, cardId: id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.hand.push(id);
  return id;
}

describe('EB01-033 — Blueno (purple)', () => {
  const clause = EB01_033.effectSpecV2!.clauses![0];

  it('plays cost-5 Water Seven char from hand (filter matches)', () => {
    const s = boot();
    const id = addToHand(s, 'OtherW7', 5, ['Water Seven']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === id)).toBe(true);
    expect(s.players.A.hand).not.toContain(id);
  });

  it('rejects another Blueno (nameExcludes)', () => {
    const s = boot();
    const id = addToHand(s, 'Blueno', 5, ['Water Seven']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain(id);
  });

  it('rejects cost-4 Water Seven char (must be cost=5)', () => {
    const s = boot();
    const id = addToHand(s, 'C4', 4, ['Water Seven']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain(id);
  });

  it('rejects non-Water-Seven cost-5 char', () => {
    const s = boot();
    const id = addToHand(s, 'NonW7', 5, ['Other']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain(id);
  });

  it('finds candidate from trash too (from: hand_or_trash)', () => {
    const s = boot();
    const id = 'TR_W7';
    const c: CharacterCard = {
      id, name: 'TrashedW7', kind: 'character', colors: ['purple'],
      cost: 5, power: 5000, counterValue: 1000, traits: ['Water Seven'], keywords: [], effectTags: [],
    };
    s.cardLibrary[id] = c;
    s.instances[id] = {
      instanceId: id, cardId: id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.trash.push(id);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === id)).toBe(true);
  });
});
