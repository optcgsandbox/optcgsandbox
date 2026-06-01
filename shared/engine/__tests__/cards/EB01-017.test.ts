// EB01-017 Blueno (character).
//   "[Blocker] (After your opponent declares an attack, you may rest this
//    card to make it the new target of the attack.)"
import { describe, expect, it } from 'vitest';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_017 = ALL_CARDS.find(c => c.id === 'EB01-017')!;

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

describe('EB01-017 — Blueno (vanilla Blocker)', () => {
  it('continuous grants "blocker" keyword to self', () => {
    const s = boot();
    const bl: CharacterCard = {
      id: 'BLU', name: 'Blueno', kind: 'character', colors: ['green'],
      cost: 2, power: 2000, counterValue: 1000,
      traits: ['FILM', 'CP0'], keywords: [], effectTags: [],
    };
    s.cardLibrary[bl.id] = bl;
    s.instances['bl'] = {
      instanceId: 'bl', cardId: bl.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['bl']);
    applyContinuousEffectsV2ToInstance(s, 'bl', EB01_017.effectSpecV2!.continuous!);
    expect(s.instances['bl'].grantedKeywords).toContain('blocker');
  });

  it('no clauses, no replacements (effect is purely the keyword)', () => {
    expect(EB01_017.effectSpecV2!.clauses ?? []).toHaveLength(0);
    expect(EB01_017.effectSpecV2!.replacements ?? []).toHaveLength(0);
  });
});
