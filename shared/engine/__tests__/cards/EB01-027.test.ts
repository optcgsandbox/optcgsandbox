// EB01-027 Mr.1 (Daz Bonez).
//   "If your Leader's type includes 'Baroque Works', this Character
//    gains +1000 power for every 2 Events in your trash.
//    [On Play] Draw 2 cards and trash 1 card from your hand."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, EventCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_027 = ALL_CARDS.find(c => c.id === 'EB01-027')!;

function boot(leaderTraits: string[]) {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['blue'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: leaderTraits, keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['blue'],
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

function placeMr1(s: any) {
  const m: CharacterCard = {
    id: 'MR1', name: 'Mr.1', kind: 'character', colors: ['blue'],
    cost: 5, power: 6000, counterValue: 1000,
    traits: ['Baroque Works'], keywords: [], effectTags: [],
  };
  s.cardLibrary[m.id] = m;
  s.instances['m1'] = {
    instanceId: 'm1', cardId: m.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['m1']);
}

function pushEventToTrash(s: any, id: string) {
  const e: EventCard = {
    id: `E_${id}`, name: id, kind: 'event', colors: ['blue'], cost: 1,
    counterValue: null, traits: [], effectTags: [],
  };
  s.cardLibrary[e.id] = e;
  s.instances[id] = {
    instanceId: id, cardId: e.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.trash.push(id);
}

describe('EB01-027 — Mr.1 (Daz.Bonez)', () => {
  it('continuous: +1000 per 2 events in trash when leader Baroque Works', () => {
    const s = boot(['Baroque Works']);
    placeMr1(s);
    pushEventToTrash(s, 'e1');
    pushEventToTrash(s, 'e2');
    pushEventToTrash(s, 'e3');
    applyContinuousEffectsV2ToInstance(s, 'm1', EB01_027.effectSpecV2!.continuous!);
    // floor(3/2)*1000 = 1000
    expect(s.instances['m1'].powerModifier).toBe(1000);
  });

  it('continuous: +2000 with 4 events in trash', () => {
    const s = boot(['Baroque Works']);
    placeMr1(s);
    for (let i = 1; i <= 4; i++) pushEventToTrash(s, `e${i}`);
    applyContinuousEffectsV2ToInstance(s, 'm1', EB01_027.effectSpecV2!.continuous!);
    expect(s.instances['m1'].powerModifier).toBe(2000);
  });

  it('continuous: +0 with 1 event (below 2-per-2 threshold)', () => {
    const s = boot(['Baroque Works']);
    placeMr1(s);
    pushEventToTrash(s, 'e1');
    applyContinuousEffectsV2ToInstance(s, 'm1', EB01_027.effectSpecV2!.continuous!);
    expect(s.instances['m1'].powerModifier ?? 0).toBe(0);
  });

  it('continuous: +0 when leader lacks Baroque Works', () => {
    const s = boot(['Other']);
    placeMr1(s);
    pushEventToTrash(s, 'e1');
    pushEventToTrash(s, 'e2');
    applyContinuousEffectsV2ToInstance(s, 'm1', EB01_027.effectSpecV2!.continuous!);
    expect(s.instances['m1'].powerModifier ?? 0).toBe(0);
  });

  it('on-play action: net +1 in hand (draw 2, discard 1)', () => {
    const s = boot(['Baroque Works']);
    placeMr1(s);
    const before = s.players.A.hand.length;
    applyActionV2(s, { sourceInstanceId: 'm1', controller: 'A' }, EB01_027.effectSpecV2!.clauses![0].action, []);
    expect(s.players.A.hand.length).toBe(before + 1);
  });
});
