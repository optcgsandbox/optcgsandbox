// EB02-033 Klabautermann.
//   "If you have [Merry Go] on your field, this Character gains [Blocker]."
import { describe, expect, it } from 'vitest';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard, StageCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_033 = ALL_CARDS.find(c => c.id === 'EB02-033')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['purple'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['purple'],
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

function placeKlab(s: any) {
  const c: CharacterCard = {
    id: 'KL', name: 'Klabautermann', kind: 'character', colors: ['purple'],
    cost: 1, power: 0, counterValue: 1000, traits: ['Sprite'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['kl'] = {
    instanceId: 'kl', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['kl']);
}

function placeMerryGo(s: any) {
  const stg: StageCard = {
    id: 'MG', name: 'Merry Go', kind: 'stage', colors: ['purple'],
    cost: 1, counterValue: null, traits: [], effectTags: [],
  };
  s.cardLibrary[stg.id] = stg;
  s.instances['mg'] = {
    instanceId: 'mg', cardId: stg.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.stage = s.instances['mg'];
}

describe('EB02-033 — Klabautermann', () => {
  const cont = EB02_033.effectSpecV2!.continuous!;

  it('no blocker without Merry Go on field', () => {
    const s = boot();
    placeKlab(s);
    applyContinuousEffectsV2ToInstance(s, 'kl', cont);
    expect(s.instances['kl'].grantedKeywords ?? []).not.toContain('blocker');
  });

  it('grants blocker when Merry Go (stage) is on field', () => {
    const s = boot();
    placeKlab(s);
    placeMerryGo(s);
    applyContinuousEffectsV2ToInstance(s, 'kl', cont);
    expect(s.instances['kl'].grantedKeywords).toContain('blocker');
  });
});
