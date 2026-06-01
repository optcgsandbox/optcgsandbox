// EB01-013 Kouzuki Hiyori.
//   "[Activate: Main] You may trash this Character: Play up to 1
//    {Land of Wano} type Character card with a cost of 5 or less other
//    than [Kouzuki Hiyori] from your hand. Then, draw 1 card."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { canPayClauseCost, payClauseCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_013 = ALL_CARDS.find(c => c.id === 'EB01-013')!;

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

function placeHiyori(s: any) {
  const hi: CharacterCard = {
    id: 'HIY', name: 'Kouzuki Hiyori', kind: 'character', colors: ['green'],
    cost: 4, power: 0, counterValue: 1000,
    traits: ['Land of Wano', 'Kouzuki Clan'], keywords: [], effectTags: [],
  };
  s.cardLibrary[hi.id] = hi;
  s.instances['hi'] = {
    instanceId: 'hi', cardId: hi.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['hi']);
}

function giveHand(s: any, card: Card, instId: string) {
  s.cardLibrary[card.id] = card;
  s.instances[instId] = {
    instanceId: instId, cardId: card.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.hand.push(instId);
}

describe('EB01-013 — Kouzuki Hiyori', () => {
  const clause = EB01_013.effectSpecV2!.clauses![0];

  it('cost trashSelf payable when Hiyori on field', () => {
    const s = boot();
    placeHiyori(s);
    expect(canPayClauseCost(s, 'A', 'hi', clause.cost!)).toBe(true);
  });

  it('paying trashSelf moves Hiyori from field to trash', () => {
    const s = boot();
    placeHiyori(s);
    payClauseCost(s, 'A', 'hi', clause.cost!);
    expect(s.players.A.field.find((i: { instanceId: string }) => i.instanceId === 'hi')).toBeUndefined();
    expect(s.players.A.trash).toContain('hi');
  });

  it('sequence: plays a matching Wano char from hand AND draws 1', () => {
    const s = boot();
    placeHiyori(s);
    const candidate: CharacterCard = {
      id: 'WANO5', name: 'Wano Char', kind: 'character', colors: ['green'],
      cost: 5, power: 6000, counterValue: 1000,
      traits: ['Land of Wano'], keywords: [], effectTags: [],
    };
    giveHand(s, candidate, 'wano5');
    const handBefore = s.players.A.hand.length;
    applyActionV2(s, { sourceInstanceId: 'hi', controller: 'A' }, clause.action, []);
    // Wano char is on field, summoning-sick.
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'wano5')).toBe(true);
    expect(s.instances['wano5'].summoningSick).toBe(true);
    // Net hand size: -1 (played wano5) + 1 (drew) = unchanged.
    expect(s.players.A.hand.length).toBe(handBefore);
  });

  it('play_for_free skips Hiyori itself (nameExcludes filter)', () => {
    const s = boot();
    placeHiyori(s);
    // Put another Hiyori card in hand — must NOT be played.
    const otherHi: CharacterCard = {
      id: 'HIY2', name: 'Kouzuki Hiyori', kind: 'character', colors: ['green'],
      cost: 4, power: 0, counterValue: 1000,
      traits: ['Land of Wano', 'Kouzuki Clan'], keywords: [], effectTags: [],
    };
    giveHand(s, otherHi, 'hi2');
    applyActionV2(s, { sourceInstanceId: 'hi', controller: 'A' }, clause.action, []);
    // hi2 still in hand (filter excludes name 'Kouzuki Hiyori').
    expect(s.players.A.hand).toContain('hi2');
  });

  it('play_for_free skips cost-6 chars (filter costMax=5)', () => {
    const s = boot();
    placeHiyori(s);
    const wano6: CharacterCard = {
      id: 'WANO6', name: 'Wano6', kind: 'character', colors: ['green'],
      cost: 6, power: 7000, counterValue: 1000,
      traits: ['Land of Wano'], keywords: [], effectTags: [],
    };
    giveHand(s, wano6, 'wano6');
    applyActionV2(s, { sourceInstanceId: 'hi', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain('wano6');
  });
});
