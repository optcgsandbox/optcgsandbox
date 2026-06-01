// EB01-035 Ms. Monday.
//   "[On Play] If your Leader's type includes 'Baroque Works', up to 1
//    of your Leader or Character cards gains +1000 power during this
//    turn."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_035 = ALL_CARDS.find(c => c.id === 'EB01-035')!;

function boot(traits: string[]) {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['purple'], cost: null,
    power: 5000, life: 5, counterValue: null, traits, keywords: [], effectTags: [],
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

describe('EB01-035 — Ms. Monday', () => {
  const clause = EB01_035.effectSpecV2!.clauses![0];

  it('condition TRUE: Baroque Works leader', () => {
    const s = boot(['Baroque Works']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('condition FALSE: non-Baroque leader', () => {
    const s = boot(['Other']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(false);
  });

  it('+1000 to leader (this_turn duration) clears at endTurn', () => {
    const s = boot(['Baroque Works']);
    const leaderId = s.players.A.leader.instanceId;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, [leaderId]);
    expect(s.instances[leaderId].powerModifier).toBe(1000);
    expect(endTurn(s).instances[leaderId].powerModifier).toBeUndefined();
  });

  it('+1000 to own char (target your_leader_or_character)', () => {
    const s = boot(['Baroque Works']);
    const c: CharacterCard = {
      id: 'OC', name: 'OC', kind: 'character', colors: ['purple'],
      cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['oc'] = {
      instanceId: 'oc', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['oc']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['oc']);
    expect(s.instances['oc'].powerModifier).toBe(1000);
  });
});
