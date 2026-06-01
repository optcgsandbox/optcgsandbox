// EB01-054 Gan.Fall.
//   "[Blocker]
//    [On Play] If your opponent has 1 or less Life cards, K.O. up to 1
//    of your opponent's Characters with a cost of 3 or less."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_054 = ALL_CARDS.find(c => c.id === 'EB01-054')!;

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

function placeGan(s: any) {
  const c: CharacterCard = {
    id: 'GF', name: 'Gan.Fall', kind: 'character', colors: ['yellow'],
    cost: 3, power: 4000, counterValue: 1000, traits: ['Sky Island'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['gf'] = {
    instanceId: 'gf', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['gf']);
}

function placeOppChar(s: any, id: string, cost: number) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['yellow'],
    cost, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'B',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.B.field.push(s.instances[id]);
}

describe('EB01-054 — Gan.Fall', () => {
  const clause = EB01_054.effectSpecV2!.clauses![0];

  it('continuous grants blocker', () => {
    const s = boot();
    placeGan(s);
    applyContinuousEffectsV2ToInstance(s, 'gf', EB01_054.effectSpecV2!.continuous!);
    expect(s.instances['gf'].grantedKeywords).toContain('blocker');
  });

  it('condition TRUE: opp life = 1', () => {
    const s = boot();
    s.players.B.life = s.players.B.life.slice(0, 1);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('condition FALSE: opp life = 2', () => {
    const s = boot();
    s.players.B.life = s.players.B.life.slice(0, 2);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(false);
  });

  it('action: KOs cost-3 opp char', () => {
    const s = boot();
    placeOppChar(s, 'c3', 3);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['c3']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'c3')).toBe(false);
  });
});
