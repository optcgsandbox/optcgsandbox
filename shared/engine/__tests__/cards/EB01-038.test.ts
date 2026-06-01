// EB01-038 Oh Come My Way (event).
//   "[Counter] DON!! −1: If your Leader's type includes 'Baroque Works',
//    select 1 of your Characters. Change the attack target to the
//    selected Character."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_038 = ALL_CARDS.find(c => c.id === 'EB01-038')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['purple'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: ['Baroque Works'], keywords: [], effectTags: [],
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

describe('EB01-038 — Oh Come My Way', () => {
  const clause = EB01_038.effectSpecV2!.clauses![0];

  it('redirects pendingAttack.defenderInstanceId to target', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'CH', name: 'Decoy', kind: 'character', colors: ['purple'],
      cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['decoy'] = {
      instanceId: 'decoy', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['decoy']);
    s.pendingAttack = {
      attackerInstanceId: 'someAttacker',
      attackerController: 'B',
      defenderInstanceId: s.players.A.leader.instanceId,
      defenderController: 'A',
      seed: 0,
    };
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['decoy']);
    expect(s.pendingAttack!.defenderInstanceId).toBe('decoy');
  });

  it('no-op when no pendingAttack', () => {
    const s = boot();
    s.pendingAttack = null;
    expect(() =>
      applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['x']),
    ).not.toThrow();
  });
});
