// EB02-019 Roronoa Zoro (green).
//   "If your opponent has 2 or more Characters, this Character can
//    attack Characters on the turn in which it is played.
//    [On Play] If your Leader has the {Straw Hat Crew} type, rest up
//    to 1 of your opponent's Characters with a cost of 4 or less."
//
// V0 note: 'rush_vs_characters' (limited rush) is recorded as a granted
// keyword. Attack legality for char-targeting on first turn does not
// yet inspect this keyword (gap noted).
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_019 = ALL_CARDS.find(c => c.id === 'EB02-019')!;

function boot(traits: string[]) {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['green'], cost: null,
    power: 5000, life: 5, counterValue: null, traits, keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['green'],
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

function placeOppChar(s: any, id: string, cost: number) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['green'],
    cost, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'B',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.B.field.push(s.instances[id]);
}

function placeZoro(s: any) {
  const c: CharacterCard = {
    id: 'Z', name: 'Roronoa Zoro', kind: 'character', colors: ['green'],
    cost: 4, power: 5000, counterValue: 1000,
    traits: ['East Blue', 'Straw Hat Crew'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['z'] = {
    instanceId: 'z', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['z']);
}

describe('EB02-019 — Roronoa Zoro (green)', () => {
  const clause = EB02_019.effectSpecV2!.clauses![0];
  const cont = EB02_019.effectSpecV2!.continuous!;

  it('on-play condition TRUE: SHC leader', () => {
    const s = boot(['Straw Hat Crew']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('action: rests cost-4 opp char', () => {
    const s = boot(['Straw Hat Crew']);
    placeOppChar(s, 'c4', 4);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['c4']);
    expect(s.instances['c4'].rested).toBe(true);
  });

  it('continuous: rush_vs_characters granted when opp has 2+ chars', () => {
    const s = boot(['Straw Hat Crew']);
    placeZoro(s);
    placeOppChar(s, 'a', 2);
    placeOppChar(s, 'b', 2);
    applyContinuousEffectsV2ToInstance(s, 'z', cont);
    expect(s.instances['z'].grantedKeywords).toContain('rush_vs_characters');
  });

  it('continuous: no rush_vs_characters when opp has only 1 char', () => {
    const s = boot(['Straw Hat Crew']);
    placeZoro(s);
    placeOppChar(s, 'a', 2);
    applyContinuousEffectsV2ToInstance(s, 'z', cont);
    expect(s.instances['z'].grantedKeywords ?? []).not.toContain('rush_vs_characters');
  });
});
