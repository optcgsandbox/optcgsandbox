// EB02-018 Buggy.
//   "[On Play] If you have no other [Buggy] Characters, up to 1 of
//    your Leader gains [Double Attack] during this turn."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_018 = ALL_CARDS.find(c => c.id === 'EB02-018')!;

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

function placeBuggy(s: any, instId: string) {
  const c: CharacterCard = {
    id: 'BG', name: 'Buggy', kind: 'character', colors: ['green'],
    cost: 4, power: 6000, counterValue: null,
    traits: ['East Blue', 'Buggy Pirates'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[instId] = {
    instanceId: instId, cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances[instId]);
}

describe('EB02-018 — Buggy', () => {
  const clause = EB02_018.effectSpecV2!.clauses![0];

  it('condition TRUE: only Buggy on field is the source', () => {
    const s = boot();
    placeBuggy(s, 'bg');
    expect(evaluateConditionV2(s, 'A', clause.condition, 'bg')).toBe(true);
  });

  it('condition FALSE: another Buggy on field', () => {
    const s = boot();
    placeBuggy(s, 'bg1');
    placeBuggy(s, 'bg2');
    expect(evaluateConditionV2(s, 'A', clause.condition, 'bg1')).toBe(false);
  });

  it('action grants double_attack to own leader', () => {
    const s = boot();
    placeBuggy(s, 'bg');
    const leaderId = s.players.A.leader.instanceId;
    applyActionV2(s, { sourceInstanceId: 'bg', controller: 'A' }, clause.action, [leaderId]);
    expect(s.instances[leaderId].grantedKeywords).toContain('double_attack');
  });
});
