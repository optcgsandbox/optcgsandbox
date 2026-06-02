// EB02-006 Yamato (red 6-cost).
//   "[Activate: Main] [Once Per Turn] If your Leader has the
//    {Land of Wano} type or is [Portgas.D.Ace], give up to 1 rested
//    DON!! card to 1 of your Leader. Then, this Character gains [Rush]
//    during this turn."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_006 = ALL_CARDS.find(c => c.id === 'EB02-006')!;

function boot(name: string, traits: string[]) {
  const lead: LeaderCard = {
    id: 'LA', name, kind: 'leader', colors: ['red'], cost: null,
    power: 5000, life: 5, counterValue: null, traits, keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['red'],
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

describe('EB02-006 — Yamato (red 6-cost)', () => {
  const clause = EB02_006.effectSpecV2!.clauses![0];

  it('condition TRUE: Land of Wano leader', () => {
    const s = boot('Wano', ['Land of Wano']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('condition TRUE: Portgas.D.Ace leader (by name)', () => {
    const s = boot('Portgas.D.Ace', ['Whitebeard Pirates']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('condition FALSE: other leader', () => {
    const s = boot('Other', ['Other']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(false);
  });

  it('sequence: attaches 1 DON to leader AND grants rush to self in one resolution', () => {
    const s = boot('Wano', ['Land of Wano']);
    const leaderId = s.players.A.leader.instanceId;
    const cBefore = s.players.A.donCostArea.length;
    const attBefore = s.instances[leaderId].attachedDon.length;
    s.cardLibrary['YAM'] = {
      id: 'YAM', name: 'Yamato', kind: 'character', colors: ['red'],
      cost: 6, power: 7000, counterValue: null, traits: ['Land of Wano'], keywords: [], effectTags: [],
    };
    s.instances['yam'] = {
      instanceId: 'yam', cardId: 'YAM', controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['yam']);
    applyActionV2(s, { sourceInstanceId: 'yam', controller: 'A' }, clause.action, []);
    expect(s.instances[leaderId].attachedDon.length).toBe(attBefore + 1);
    expect(s.players.A.donCostArea.length).toBe(cBefore - 1);
    expect(s.instances['yam'].grantedKeywords).toContain('rush');
  });
});
