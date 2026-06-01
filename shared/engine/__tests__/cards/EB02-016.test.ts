// EB02-016 Chopperman.
//   "Also treat this card's name as [Tony Tony.Chopper] according to
//    the rules.
//    [On Play] Play up to 1 {Animal} type Character card with a cost
//    of 3 or less from your hand."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_016 = ALL_CARDS.find(c => c.id === 'EB02-016')!;

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

describe('EB02-016 — Chopperman', () => {
  it('plays a cost-3 Animal char from hand', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'AN3', name: 'Animal3', kind: 'character', colors: ['green'],
      cost: 3, power: 4000, counterValue: 1000, traits: ['Animal'], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['an3'] = {
      instanceId: 'an3', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.hand.push('an3');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, EB02_016.effectSpecV2!.clauses![0].action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'an3')).toBe(true);
  });

  it('does NOT play cost-4 Animal', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'AN4', name: 'Animal4', kind: 'character', colors: ['green'],
      cost: 4, power: 5000, counterValue: 1000, traits: ['Animal'], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['an4'] = {
      instanceId: 'an4', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.hand.push('an4');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, EB02_016.effectSpecV2!.clauses![0].action, []);
    expect(s.players.A.hand).toContain('an4');
  });

  it('name alias rule recorded in rules.nameAliases', () => {
    const r = (EB02_016.effectSpecV2 as { rules?: { nameAliases?: string[] } } | undefined)?.rules;
    expect(r?.nameAliases).toContain('Tony Tony.Chopper');
  });
});
