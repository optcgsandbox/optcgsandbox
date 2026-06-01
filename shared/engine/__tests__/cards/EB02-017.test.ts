// EB02-017 Nami.
//   "[On Play] Look at 5 cards from the top of your deck; reveal up to
//    1 {Straw Hat Crew} type card other than [Nami] and add it to your
//    hand. Then, place the rest at the bottom of your deck in any order."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_017 = ALL_CARDS.find(c => c.id === 'EB02-017')!;

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

function placeOnTop(s: any, id: string, name: string, traits: string[]) {
  const c: CharacterCard = {
    id, name, kind: 'character', colors: ['green'],
    cost: 2, power: 3000, counterValue: 1000, traits, keywords: [], effectTags: [],
  };
  s.cardLibrary[id] = c;
  s.instances[id] = {
    instanceId: id, cardId: id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.deck.unshift(id);
}

describe('EB02-017 — Nami', () => {
  const clause = EB02_017.effectSpecV2!.clauses![0];

  it('pulls a Straw Hat char (not Nami) into hand', () => {
    const s = boot();
    placeOnTop(s, 'usopp', 'Usopp', ['Straw Hat Crew']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain('usopp');
  });

  it('does NOT pull another Nami (nameExcludes)', () => {
    const s = boot();
    placeOnTop(s, 'nami2', 'Nami', ['Straw Hat Crew']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).not.toContain('nami2');
  });

  it('does NOT pull non-Straw-Hat char', () => {
    const s = boot();
    placeOnTop(s, 'oth', 'Other', ['Marine']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).not.toContain('oth');
  });
});
