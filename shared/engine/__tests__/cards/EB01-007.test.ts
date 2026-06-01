// EB01-007 Yamato.
//   "[Activate: Main] [Once Per Turn] Give up to 1 rested DON!! card to
//    your Leader or 1 of your Characters."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_007 = ALL_CARDS.find(c => c.id === 'EB01-007')!;

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

describe('EB01-007 — Yamato', () => {
  const clause = EB01_007.effectSpecV2!.clauses![0];

  it('attaches 1 DON from cost area to the targeted Leader', () => {
    const s = boot();
    const leaderId = s.players.A.leader.instanceId;
    const costBefore = s.players.A.donCostArea.length;
    const attBefore = s.instances[leaderId].attachedDon.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, [leaderId]);
    expect(s.instances[leaderId].attachedDon.length).toBe(attBefore + 1);
    expect(s.players.A.donCostArea.length).toBe(costBefore - 1);
  });

  it('attaches 1 DON to a friendly Character target', () => {
    const s = boot();
    const ally: CharacterCard = {
      id: 'ALLY', name: 'Ally', kind: 'character', colors: ['red'],
      cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[ally.id] = ally;
    s.instances['ally1'] = {
      instanceId: 'ally1', cardId: ally.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['ally1']);
    const costBefore = s.players.A.donCostArea.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['ally1']);
    expect(s.instances['ally1'].attachedDon.length).toBe(1);
    expect(s.players.A.donCostArea.length).toBe(costBefore - 1);
  });

  it('no-op when DON cost area is empty', () => {
    const s = boot();
    s.players.A.donCostArea = [];
    const leaderId = s.players.A.leader.instanceId;
    const attBefore = s.instances[leaderId].attachedDon.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, [leaderId]);
    expect(s.instances[leaderId].attachedDon.length).toBe(attBefore);
  });

  it('keyword once_per_turn is present (OPT gating enforced by dispatch)', () => {
    expect((EB01_007 as { keywords: string[] }).keywords).toContain('once_per_turn');
  });
});
