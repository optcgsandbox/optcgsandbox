// EB01-014 Sanji.
//   "[DON!! x1] [Your Turn] This Character gains +1000 power for every 3
//    of your rested DON!! cards."
import { describe, expect, it } from 'vitest';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_014 = ALL_CARDS.find(c => c.id === 'EB01-014')!;

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

function placeSanji(s: any, attachedDon: number) {
  const sa: CharacterCard = {
    id: 'SAN', name: 'Sanji', kind: 'character', colors: ['green'],
    cost: 4, power: 5000, counterValue: 2000,
    traits: ['FILM', 'Straw Hat Crew'], keywords: [], effectTags: [],
  };
  s.cardLibrary[sa.id] = sa;
  s.instances['sa'] = {
    instanceId: 'sa', cardId: sa.id, controller: 'A',
    rested: false,
    attachedDon: attachedDon > 0 ? s.players.A.donCostArea.splice(0, attachedDon) : [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['sa']);
}

describe('EB01-014 — Sanji', () => {
  const cont = EB01_014.effectSpecV2!.continuous!;

  it('no buff when DON!! x1 attachment missing (gate fails)', () => {
    const s = boot();
    placeSanji(s, 0);
    // pile up rested DON
    s.players.A.donRested = [...s.players.A.donCostArea];
    s.players.A.donCostArea = [];
    applyContinuousEffectsV2ToInstance(s, 'sa', cont);
    expect(s.instances['sa'].powerModifier ?? 0).toBe(0);
  });

  it('no buff on opponent\'s turn (Your Turn gate fails)', () => {
    const s = boot();
    placeSanji(s, 1);
    s.players.A.donRested = s.players.A.donCostArea.splice(0, 3);
    s.activePlayer = 'B';
    applyContinuousEffectsV2ToInstance(s, 'sa', cont);
    expect(s.instances['sa'].powerModifier ?? 0).toBe(0);
  });

  it('+1000 power with 3 rested DON', () => {
    const s = boot();
    placeSanji(s, 1);
    s.players.A.donRested = ['d1', 'd2', 'd3'];
    applyContinuousEffectsV2ToInstance(s, 'sa', cont);
    expect(s.instances['sa'].powerModifier).toBe(1000);
  });

  it('+0 power with 2 rested DON (below 3 threshold)', () => {
    const s = boot();
    placeSanji(s, 1);
    s.players.A.donRested = ['d1', 'd2'];
    applyContinuousEffectsV2ToInstance(s, 'sa', cont);
    expect(s.instances['sa'].powerModifier ?? 0).toBe(0);
  });

  it('+2000 power with 6 rested DON', () => {
    const s = boot();
    placeSanji(s, 1);
    // Need at least 6 cost-area DON. Start of A's turn has 2 by default;
    // pad with synthetic IDs.
    s.players.A.donRested = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
    applyContinuousEffectsV2ToInstance(s, 'sa', cont);
    expect(s.instances['sa'].powerModifier).toBe(2000);
  });
});
