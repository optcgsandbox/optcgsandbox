// EB01-044 Funkfreed.
//   "[Activate: Main] You may rest this Character: Up to 1 of your
//    [Spandam] Characters gains +3000 power during this turn."
import { describe, expect, it } from 'vitest';
import { applyActionV2, resolveTargetV2 } from '../../effectSpec/runner-v2';
import { canPayClauseCost, payClauseCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_044 = ALL_CARDS.find(c => c.id === 'EB01-044')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['black'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['black'],
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

function placeFunk(s: any) {
  const c: CharacterCard = {
    id: 'FUN', name: 'Funkfreed', kind: 'character', colors: ['black'],
    cost: 1, power: 1000, counterValue: 1000,
    traits: ['CP9'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances['fun'] = {
    instanceId: 'fun', cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['fun']);
}

function placeNamed(s: any, name: string, id: string) {
  const c: CharacterCard = {
    id: `C_${id}`, name, kind: 'character', colors: ['black'],
    cost: 3, power: 3000, counterValue: 1000, traits: ['CP9'], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances[id]);
}

describe('EB01-044 — Funkfreed', () => {
  const clause = EB01_044.effectSpecV2!.clauses![0];

  it('cost restSelf payable when active', () => {
    const s = boot();
    placeFunk(s);
    expect(canPayClauseCost(s, 'A', 'fun', clause.cost!)).toBe(true);
  });

  it('cost rests Funkfreed', () => {
    const s = boot();
    placeFunk(s);
    payClauseCost(s, 'A', 'fun', clause.cost!);
    expect(s.instances['fun'].rested).toBe(true);
  });

  it('target INCLUDES Spandam character', () => {
    const s = boot();
    placeFunk(s);
    placeNamed(s, 'Spandam', 'spd');
    const ids = resolveTargetV2(s, 'A', 'fun', clause.target);
    expect(ids).toContain('spd');
  });

  it('target EXCLUDES non-Spandam character', () => {
    const s = boot();
    placeFunk(s);
    placeNamed(s, 'Other', 'oth');
    const ids = resolveTargetV2(s, 'A', 'fun', clause.target);
    expect(ids).not.toContain('oth');
  });

  it('action: +3000 power to Spandam this_turn, clears at endTurn', () => {
    const s = boot();
    placeFunk(s);
    placeNamed(s, 'Spandam', 'spd');
    applyActionV2(s, { sourceInstanceId: 'fun', controller: 'A' }, clause.action, ['spd']);
    expect(s.instances['spd'].powerModifier).toBe(3000);
    expect(endTurn(s).instances['spd'].powerModifier).toBeUndefined();
  });
});
