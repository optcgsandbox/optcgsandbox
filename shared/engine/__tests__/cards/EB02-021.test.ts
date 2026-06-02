// EB02-021 Gum-Gum Giant Pistol (event).
//   "[Main] Up to 1 of your {Straw Hat Crew} type Characters gains
//    +6000 power during this turn. Then, the selected Character will
//    not become active in your next Refresh Phase."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_021 = ALL_CARDS.find(c => c.id === 'EB02-021')!;

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

function placeSHC(s: any, id: string) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['green'],
    cost: 3, power: 3000, counterValue: 1000,
    traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances[id]);
}

describe('EB02-021 — Gum-Gum Giant Pistol', () => {
  const clause = EB02_021.effectSpecV2!.clauses![0];

  it('sequence: +6000 power AND restLocked land on the SAME selected SHC target', () => {
    const s = boot();
    placeSHC(s, 'shc');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['shc']);
    expect(s.instances['shc'].powerModifier).toBe(6000);
    expect(s.instances['shc'].restLocked).toBe(true);
  });

  it('+6000 buff is this-turn only (clears at end of turn)', () => {
    const s = boot();
    placeSHC(s, 'shc');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['shc']);
    expect(endTurn(s).instances['shc'].powerModifier).toBeUndefined();
  });
});
