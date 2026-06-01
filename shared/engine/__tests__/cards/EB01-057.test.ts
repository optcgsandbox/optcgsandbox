// EB01-057 Shirahoshi.
//   "When this Character is K.O.'d by your opponent's effect, add up to
//    1 card from the top of your deck to the top of your Life cards.
//    [Blocker]"
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_057 = ALL_CARDS.find(c => c.id === 'EB01-057')!;

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

describe('EB01-057 — Shirahoshi', () => {
  it('continuous grants blocker', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'SH', name: 'Shirahoshi', kind: 'character', colors: ['yellow'],
      cost: 2, power: 0, counterValue: 1000, traits: ['Merfolk'], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['sh'] = {
      instanceId: 'sh', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['sh']);
    applyContinuousEffectsV2ToInstance(s, 'sh', EB01_057.effectSpecV2!.continuous!);
    expect(s.instances['sh'].grantedKeywords).toContain('blocker');
  });

  it('on-ko action: moves top of deck to top of life', () => {
    const s = boot();
    const top = s.players.A.deck[0];
    const lifeBefore = s.players.A.life.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, EB01_057.effectSpecV2!.clauses![0].action, []);
    expect(s.players.A.life.length).toBe(lifeBefore + 1);
    expect(s.players.A.life[0]).toBe(top);
  });
});
