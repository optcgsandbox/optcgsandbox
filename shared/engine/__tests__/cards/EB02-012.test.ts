// EB02-012 Gaimon.
//   "If you have a [Sarfunkel], this Character gains [Blocker]."
import { describe, expect, it } from 'vitest';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_012 = ALL_CARDS.find(c => c.id === 'EB02-012')!;

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

function placeGaimon(s: any) {
  const c: CharacterCard = {
    id: 'GA', name: 'Gaimon', kind: 'character', colors: ['green'],
    cost: 1, power: 1000, counterValue: 1000, traits: ['East Blue'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['ga'] = {
    instanceId: 'ga', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['ga']);
}

function placeSarfunkel(s: any) {
  const c: CharacterCard = {
    id: 'SF', name: 'Sarfunkel', kind: 'character', colors: ['green'],
    cost: 2, power: 3000, counterValue: 1000, traits: ['East Blue'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['sf'] = {
    instanceId: 'sf', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['sf']);
}

describe('EB02-012 — Gaimon', () => {
  const cont = EB02_012.effectSpecV2!.continuous!;

  it('no blocker when Sarfunkel absent', () => {
    const s = boot();
    placeGaimon(s);
    applyContinuousEffectsV2ToInstance(s, 'ga', cont);
    expect(s.instances['ga'].grantedKeywords ?? []).not.toContain('blocker');
  });

  it('grants blocker when Sarfunkel on field', () => {
    const s = boot();
    placeGaimon(s);
    placeSarfunkel(s);
    applyContinuousEffectsV2ToInstance(s, 'ga', cont);
    expect(s.instances['ga'].grantedKeywords).toContain('blocker');
  });
});
