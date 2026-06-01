// EB01-009 "Just Shut Up and Come with Us!!!!" (event).
//   "[Counter] Look at 5 cards from the top of your deck and play up to 1
//    {Animal} type Character card with a cost of 3 or less. Then, place
//    the rest at the bottom of your deck in any order."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_009 = ALL_CARDS.find(c => c.id === 'EB01-009')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['red'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['red'],
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

function placeOnTop(s: any, controller: 'A' | 'B', card: CharacterCard, id: string) {
  s.cardLibrary[card.id] = card;
  s.instances[id] = {
    instanceId: id, cardId: card.id, controller,
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players[controller].deck.unshift(id);
}

describe('EB01-009 — Just Shut Up and Come with Us!!!!', () => {
  const clause = EB01_009.effectSpecV2!.clauses![0];

  it('plays a cost-2 Animal char from the top of the deck onto the field, summoning-sick', () => {
    const s = boot();
    const animal: CharacterCard = {
      id: 'ANIM', name: 'Animal', kind: 'character', colors: ['red'],
      cost: 2, power: 3000, counterValue: 1000,
      traits: ['Animal'], keywords: [], effectTags: [],
    };
    placeOnTop(s, 'A', animal, 'anim');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'anim')).toBe(true);
    expect(s.instances['anim'].summoningSick).toBe(true);
  });

  it('does NOT play a non-Animal char (filter rejects)', () => {
    const s = boot();
    const human: CharacterCard = {
      id: 'HUM', name: 'Human', kind: 'character', colors: ['red'],
      cost: 2, power: 3000, counterValue: 1000,
      traits: ['Human'], keywords: [], effectTags: [],
    };
    placeOnTop(s, 'A', human, 'hum');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'hum')).toBe(false);
  });

  it('does NOT play a cost-4 Animal (cost cap > 3)', () => {
    const s = boot();
    const bigAnim: CharacterCard = {
      id: 'BIG', name: 'BigAnimal', kind: 'character', colors: ['red'],
      cost: 4, power: 5000, counterValue: 1000,
      traits: ['Animal'], keywords: [], effectTags: [],
    };
    placeOnTop(s, 'A', bigAnim, 'big');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'big')).toBe(false);
  });

  it('does NOT find an Animal placed at position 6 (outside lookCount=5)', () => {
    const s = boot();
    const animal: CharacterCard = {
      id: 'DEEP', name: 'Deep', kind: 'character', colors: ['red'],
      cost: 2, power: 3000, counterValue: 1000,
      traits: ['Animal'], keywords: [], effectTags: [],
    };
    s.cardLibrary[animal.id] = animal;
    s.instances['deep'] = {
      instanceId: 'deep', cardId: animal.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    // Put it at deck position 5 (0-indexed) — outside the top 5.
    s.players.A.deck.splice(5, 0, 'deep');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'deep')).toBe(false);
    // And it should still be in the deck.
    expect(s.players.A.deck).toContain('deep');
  });

  it('places the un-played top 5 cards at the bottom of the deck', () => {
    const s = boot();
    // Snapshot top 5 BEFORE the action — none match (Animal trait).
    const top5Before = s.players.A.deck.slice(0, 5);
    const initialDeckLen = s.players.A.deck.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    // No play happened (filler chars are not Animal); deck length unchanged.
    expect(s.players.A.deck.length).toBe(initialDeckLen);
    // The original top 5 must now be at the BOTTOM (last 5 in same order).
    expect(s.players.A.deck.slice(-5)).toEqual(top5Before);
  });
});
