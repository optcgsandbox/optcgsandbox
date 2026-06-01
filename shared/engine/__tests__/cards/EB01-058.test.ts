// EB01-058 Mont Blanc Cricket.
//   "[DON!! x1] [Your Turn] If you have 2 or less Life cards, this
//    Character gains +2000 power."
import { describe, expect, it } from 'vitest';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_058 = ALL_CARDS.find(c => c.id === 'EB01-058')!;

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

function placeCricket(s: any, attachedDon: number) {
  const c: CharacterCard = {
    id: 'CR', name: 'Cricket', kind: 'character', colors: ['yellow'],
    cost: 2, power: 3000, counterValue: 1000,
    traits: ['Monkey Mountain Alliance'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['cr'] = {
    instanceId: 'cr', cardId: c.id, controller: 'A',
    rested: false,
    attachedDon: attachedDon > 0 ? s.players.A.donCostArea.splice(0, attachedDon) : [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['cr']);
}

describe('EB01-058 — Mont Blanc Cricket', () => {
  const cont = EB01_058.effectSpecV2!.continuous!;

  it('all conditions met (1 DON, own turn, life=2) → +2000', () => {
    const s = boot();
    placeCricket(s, 1);
    s.players.A.life = s.players.A.life.slice(0, 2);
    applyContinuousEffectsV2ToInstance(s, 'cr', cont);
    expect(s.instances['cr'].powerModifier).toBe(2000);
  });

  it('no buff: 0 DON attached', () => {
    const s = boot();
    placeCricket(s, 0);
    s.players.A.life = s.players.A.life.slice(0, 2);
    applyContinuousEffectsV2ToInstance(s, 'cr', cont);
    expect(s.instances['cr'].powerModifier ?? 0).toBe(0);
  });

  it('no buff: life = 3', () => {
    const s = boot();
    placeCricket(s, 1);
    s.players.A.life = s.players.A.life.slice(0, 3);
    applyContinuousEffectsV2ToInstance(s, 'cr', cont);
    expect(s.instances['cr'].powerModifier ?? 0).toBe(0);
  });

  it('no buff: opp turn', () => {
    const s = boot();
    placeCricket(s, 1);
    s.players.A.life = s.players.A.life.slice(0, 2);
    s.activePlayer = 'B';
    applyContinuousEffectsV2ToInstance(s, 'cr', cont);
    expect(s.instances['cr'].powerModifier ?? 0).toBe(0);
  });
});
