// EB02-039 GERMA 66 (event).
//   "[Main] You may trash 1 {GERMA 66} type Character card with 4000
//    power or less from your hand: If the number of DON!! cards on
//    your field is equal to or less than the number on your
//    opponent's field, play up to 1 Character card with 5000 to 7000
//    power and the same card name as the trashed card from your trash."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { payClauseCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_039 = ALL_CARDS.find(c => c.id === 'EB02-039')!;

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

function placeSource(s: any) {
  // Stand-in for the event in play (so ctx.sourceInstanceId resolves to a CardInstance
  // whose `lastDiscardedName` can be inspected).
  s.cardLibrary['SRC'] = { id: 'SRC', name: 'SRC', kind: 'event', colors: ['purple'], cost: 4, counterValue: null, traits: [], effectTags: [] };
  s.instances['src'] = {
    instanceId: 'src', cardId: 'SRC', controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
}

function addGerma(s: any, id: string, name: string, power: number, zone: 'hand'|'trash') {
  const c: CharacterCard = {
    id, name, kind: 'character', colors: ['purple'],
    cost: 3, power, counterValue: 1000,
    traits: ['GERMA 66', 'The Vinsmoke Family'], keywords: [], effectTags: [],
  };
  s.cardLibrary[id] = c;
  s.instances[id] = {
    instanceId: id, cardId: id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A[zone].push(id);
}

describe('EB02-039 — GERMA 66 (event)', () => {
  const clause = EB02_039.effectSpecV2!.clauses![0];

  it('pay cost: discards GERMA 66 char (power 4000) and stamps lastDiscardedName', () => {
    const s = boot();
    placeSource(s);
    s.players.A.hand = [];
    addGerma(s, 'g4', 'Vinsmoke Reiju', 4000, 'hand');
    const trashBefore = s.players.A.trash.length;
    payClauseCost(s, 'A', 'src', clause.cost!);
    expect(s.players.A.trash.length).toBe(trashBefore + 1);
    expect(s.players.A.trash).toContain('g4');
    expect(s.instances['src'].lastDiscardedName).toBe('Vinsmoke Reiju');
  });

  it('action: plays 6000-power same-name char from trash (matches lastDiscardedName)', () => {
    const s = boot();
    placeSource(s);
    s.instances['src'].lastDiscardedName = 'Vinsmoke Reiju';
    addGerma(s, 'big', 'Vinsmoke Reiju', 6000, 'trash');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'big')).toBe(true);
  });

  it('action: does NOT play different-name char (nameMatchesLastDiscarded gate)', () => {
    const s = boot();
    placeSource(s);
    s.instances['src'].lastDiscardedName = 'Vinsmoke Reiju';
    addGerma(s, 'other', 'Vinsmoke Sanji', 6000, 'trash');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'other')).toBe(false);
  });

  it('lastDiscardedName clears at endTurn', () => {
    const s = boot();
    placeSource(s);
    s.instances['src'].lastDiscardedName = 'X';
    const s2 = endTurn(s);
    expect(s2.instances['src'].lastDiscardedName).toBeUndefined();
  });
});
