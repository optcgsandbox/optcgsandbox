// EB01-045 Brook.
//   "[On Play] If your opponent has a Character with a cost of 0, this
//    Character gains [Rush] during this turn."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_045 = ALL_CARDS.find(c => c.id === 'EB01-045')!;

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

function placeBrook(s: any) {
  const c: CharacterCard = {
    id: 'BR', name: 'Brook', kind: 'character', colors: ['black'],
    cost: 3, power: 4000, counterValue: 1000,
    traits: ['Rumbar Pirates'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['br'] = {
    instanceId: 'br', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['br']);
}

function placeOppChar(s: any, id: string, cost: number) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['black'],
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

describe('EB01-045 — Brook', () => {
  const clause = EB01_045.effectSpecV2!.clauses![0];

  it('condition TRUE: opp has a cost-0 character', () => {
    const s = boot();
    placeOppChar(s, 'zero', 0);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('condition FALSE: opp has only cost-1+ chars', () => {
    const s = boot();
    placeOppChar(s, 'one', 1);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(false);
  });

  it('action: grants "rush" keyword to self this_turn', () => {
    const s = boot();
    placeBrook(s);
    placeOppChar(s, 'zero', 0);
    applyActionV2(s, { sourceInstanceId: 'br', controller: 'A' }, clause.action, ['br']);
    expect(s.instances['br'].grantedKeywords).toContain('rush');
  });
});
