// EB02-002 Sabo.
//   "[Activate: Main] You may rest this Character: Up to 1 of your
//    {Revolutionary Army} type Characters other than [Sabo] gains
//    +2000 power during this turn."
import { describe, expect, it } from 'vitest';
import { applyActionV2, resolveTargetV2 } from '../../effectSpec/runner-v2';
import { canPayClauseCost, payClauseCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_002 = ALL_CARDS.find(c => c.id === 'EB02-002')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['red'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['red'],
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

function placeSabo(s: any) {
  const c: CharacterCard = {
    id: 'SA', name: 'Sabo', kind: 'character', colors: ['red'],
    cost: 4, power: 5000, counterValue: 2000,
    traits: ['Dressrosa', 'Revolutionary Army'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['sa'] = {
    instanceId: 'sa', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['sa']);
}

function placeAlly(s: any, name: string, id: string, traits: string[]) {
  const c: CharacterCard = {
    id: `C_${id}`, name, kind: 'character', colors: ['red'],
    cost: 3, power: 3000, counterValue: 1000, traits, keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances[id]);
}

describe('EB02-002 — Sabo', () => {
  const clause = EB02_002.effectSpecV2!.clauses![0];

  it('cost restSelf rests Sabo', () => {
    const s = boot();
    placeSabo(s);
    expect(canPayClauseCost(s, 'A', 'sa', clause.cost!)).toBe(true);
    payClauseCost(s, 'A', 'sa', clause.cost!);
    expect(s.instances['sa'].rested).toBe(true);
  });

  it('target INCLUDES other Revolutionary Army char', () => {
    const s = boot();
    placeSabo(s);
    placeAlly(s, 'Dragon', 'drg', ['Revolutionary Army']);
    const ids = resolveTargetV2(s, 'A', 'sa', clause.target);
    expect(ids).toContain('drg');
  });

  it('target EXCLUDES non-Revolutionary char', () => {
    const s = boot();
    placeSabo(s);
    placeAlly(s, 'OtherChar', 'oc', ['Other']);
    const ids = resolveTargetV2(s, 'A', 'sa', clause.target);
    expect(ids).not.toContain('oc');
  });

  it('target EXCLUDES another Sabo (nameExcludes)', () => {
    const s = boot();
    placeSabo(s);
    placeAlly(s, 'Sabo', 'sa2', ['Revolutionary Army']);
    const ids = resolveTargetV2(s, 'A', 'sa', clause.target);
    expect(ids).not.toContain('sa2');
  });

  it('action: +2000 power this_turn; clears at endTurn', () => {
    const s = boot();
    placeSabo(s);
    placeAlly(s, 'Koala', 'koa', ['Revolutionary Army']);
    applyActionV2(s, { sourceInstanceId: 'sa', controller: 'A' }, clause.action, ['koa']);
    expect(s.instances['koa'].powerModifier).toBe(2000);
    expect(endTurn(s).instances['koa'].powerModifier).toBeUndefined();
  });
});
