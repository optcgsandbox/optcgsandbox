// EB02-022 Usopp (blue).
//   "[On Play] If you have 2 or less Characters with 5000 power or
//    more, play up to 1 Character card with 6000 power or less and no
//    base effect from your hand."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_022 = ALL_CARDS.find(c => c.id === 'EB02-022')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['blue'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['blue'],
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

function addVanillaToHand(s: any, id: string, power: number) {
  const c: any = {
    id, name: id, kind: 'character', colors: ['blue'],
    cost: 2, power, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    effectSpecV2: { clauses: [], continuous: [], replacements: [], schemaVersion: 2, verified: 'ground-truth' },
  };
  s.cardLibrary[id] = c;
  s.instances[id] = {
    instanceId: id, cardId: id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.hand.push(id);
}

function placeOwnChar(s: any, id: string, power: number) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['blue'],
    cost: 2, power, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances[id]);
}

describe('EB02-022 — Usopp (blue)', () => {
  const clause = EB02_022.effectSpecV2!.clauses![0];

  it('condition TRUE: 0 chars with >=5000 power', () => {
    const s = boot();
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('condition TRUE: 2 chars with >=5000 power (boundary)', () => {
    const s = boot();
    placeOwnChar(s, 'a', 5000);
    placeOwnChar(s, 'b', 6000);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('condition FALSE: 3 chars with >=5000 power', () => {
    const s = boot();
    placeOwnChar(s, 'a', 5000);
    placeOwnChar(s, 'b', 6000);
    placeOwnChar(s, 'c', 5000);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(false);
  });

  it('plays a vanilla 6000-power char from hand', () => {
    const s = boot();
    addVanillaToHand(s, 'v6', 6000);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'v6')).toBe(true);
  });

  it('does NOT play 7000-power char (filter powerMax 6000)', () => {
    const s = boot();
    addVanillaToHand(s, 'v7', 7000);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain('v7');
  });
});
