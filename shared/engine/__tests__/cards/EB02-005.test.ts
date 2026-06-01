// EB02-005 Fake Straw Hat Crew.
//   "[Your Turn] This Character gains +2000 power.
//    [Opponent's Turn] Give this Character −2000 power."
import { describe, expect, it } from 'vitest';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_005 = ALL_CARDS.find(c => c.id === 'EB02-005')!;

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

function placeFake(s: any) {
  const c: CharacterCard = {
    id: 'FK', name: 'Fake', kind: 'character', colors: ['red'],
    cost: 2, power: 3000, counterValue: null,
    traits: ['Fake Straw Hat Crew'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['fk'] = {
    instanceId: 'fk', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['fk']);
}

describe('EB02-005 — Fake Straw Hat Crew', () => {
  const cont = EB02_005.effectSpecV2!.continuous!;

  it('+2000 on own turn', () => {
    const s = boot();
    placeFake(s);
    applyContinuousEffectsV2ToInstance(s, 'fk', cont);
    expect(s.instances['fk'].powerModifier).toBe(2000);
  });

  it('-2000 on opp turn', () => {
    const s = boot();
    placeFake(s);
    s.activePlayer = 'B';
    applyContinuousEffectsV2ToInstance(s, 'fk', cont);
    expect(s.instances['fk'].powerModifier).toBe(-2000);
  });
});
