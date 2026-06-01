// EB01-020 Chambres (event).
//   "[Main] If your Leader has the {Supernovas} type, return 1 of your
//    Characters to the owner's hand, and play up to 1 Character card
//    with a cost of 2 or less from your hand that is a different color
//    than the returned Character."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_020 = ALL_CARDS.find(c => c.id === 'EB01-020')!;

function boot(leaderTraits: string[]) {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['green'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: leaderTraits, keywords: [], effectTags: [],
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

function placeChar(s: any, id: string, colors: ('red'|'green'|'blue'|'purple'|'black'|'yellow')[], cost = 2, controller: 'A'|'B' = 'A') {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors,
    cost, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller,
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players[controller].field.push(s.instances[id]);
}

function giveHand(s: any, id: string, colors: ('red'|'green'|'blue'|'purple'|'black'|'yellow')[], cost = 2) {
  const c: CharacterCard = {
    id: `H_${id}`, name: id, kind: 'character', colors,
    cost, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.hand.push(id);
}

describe('EB01-020 — Chambres', () => {
  const clause = EB01_020.effectSpecV2!.clauses![0];

  it('condition TRUE when leader has Supernovas', () => {
    const s = boot(['Supernovas']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(true);
  });

  it('condition FALSE when leader lacks Supernovas', () => {
    const s = boot(['Whitebeard Pirates']);
    expect(evaluateConditionV2(s, 'A', clause.condition, 'src')).toBe(false);
  });

  it('bounces own char to hand AND plays a different-color hand char', () => {
    const s = boot(['Supernovas']);
    placeChar(s, 'green1', ['green'], 2, 'A');
    giveHand(s, 'red1', ['red'], 2);
    giveHand(s, 'green2', ['green'], 2);
    // Place source instance on field so ctx.sourceInstanceId resolves
    s.cardLibrary['SRC'] = { id: 'SRC', name: 'SRC', kind: 'event', colors: ['green'], cost: 1, counterValue: null, traits: [], effectTags: [] };
    s.instances['src'] = {
      instanceId: 'src', cardId: 'SRC', controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['green1']);
    // green1 returned to hand.
    expect(s.players.A.hand).toContain('green1');
    // red1 played — green2 stayed in hand because it shares green with bounced.
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'red1')).toBe(true);
    expect(s.players.A.hand).toContain('green2');
  });

  it('does NOT play same-color candidate (color constraint enforced)', () => {
    const s = boot(['Supernovas']);
    placeChar(s, 'green1', ['green'], 2, 'A');
    giveHand(s, 'green2', ['green'], 2);
    s.cardLibrary['SRC'] = { id: 'SRC', name: 'SRC', kind: 'event', colors: ['green'], cost: 1, counterValue: null, traits: [], effectTags: [] };
    s.instances['src'] = {
      instanceId: 'src', cardId: 'SRC', controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['green1']);
    // green1 bounced; green2 was the only candidate but shares color → not played.
    expect(s.players.A.hand).toContain('green1');
    expect(s.players.A.hand).toContain('green2');
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'green2')).toBe(false);
  });

  it('lastBouncedColors cleared at endTurn', () => {
    const s = boot(['Supernovas']);
    placeChar(s, 'green1', ['green'], 2, 'A');
    s.cardLibrary['SRC'] = { id: 'SRC', name: 'SRC', kind: 'event', colors: ['green'], cost: 1, counterValue: null, traits: [], effectTags: [] };
    s.instances['src'] = {
      instanceId: 'src', cardId: 'SRC', controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, { kind: 'removal_bounce' }, ['green1']);
    expect(s.instances['src'].lastBouncedColors).toEqual(['green']);
    const s2 = endTurn(s);
    expect(s2.instances['src'].lastBouncedColors).toBeUndefined();
  });
});
