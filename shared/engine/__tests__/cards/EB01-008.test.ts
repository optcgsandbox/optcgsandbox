// EB01-008 LittleOars Jr.
//   "[Once Per Turn] If this Character would be K.O.'d by an effect, you
//    may trash 1 Event or Stage card from your hand instead."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, EventCard, LeaderCard, StageCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_008 = ALL_CARDS.find(c => c.id === 'EB01-008')!;

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

function placeLOJ(s: any, controller: 'A' | 'B') {
  // LittleOars Jr. printed card. Must be registered in cardLibrary with
  // the SAME id as the cards.json entry so the engine can look up
  // EB01-008's replacements when the KO action fires.
  s.cardLibrary['EB01-008'] = EB01_008;
  s.instances['loj'] = {
    instanceId: 'loj', cardId: 'EB01-008', controller,
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players[controller].field.push(s.instances['loj']);
}

function giveHand(s: any, controller: 'A' | 'B', cards: Card[]) {
  for (const c of cards) {
    s.cardLibrary[c.id] = c;
    s.instances[c.id] = {
      instanceId: c.id, cardId: c.id, controller,
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players[controller].hand.push(c.id);
  }
}

const eventCard: EventCard = {
  id: 'EVT1', name: 'Some Event', kind: 'event', colors: ['red'], cost: 2,
  counterValue: null, traits: [], effectTags: [],
};
const stageCard: StageCard = {
  id: 'STG1', name: 'Some Stage', kind: 'stage', colors: ['red'], cost: 1,
  counterValue: null, traits: [], effectTags: [],
};
const charCard: CharacterCard = {
  id: 'CHR1', name: 'Some Char', kind: 'character', colors: ['red'],
  cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
};

describe('EB01-008 — LittleOars Jr.', () => {
  it('KOs normally when no Event/Stage in hand (replacement cost unpayable)', () => {
    const s = boot();
    placeLOJ(s, 'A');
    // Empty A's hand of any event/stage cards by setting hand to a single character only.
    s.players.A.hand = [];
    giveHand(s, 'A', [charCard]);
    applyActionV2(s, { sourceInstanceId: 'killer', controller: 'B' }, { kind: 'removal_ko' }, ['loj']);
    expect(s.players.A.field.find((i: { instanceId: string }) => i.instanceId === 'loj')).toBeUndefined();
    expect(s.players.A.trash).toContain('loj');
  });

  it('survives KO when an Event in hand is discarded', () => {
    const s = boot();
    placeLOJ(s, 'A');
    s.players.A.hand = [];
    giveHand(s, 'A', [eventCard]);
    const trashBefore = s.players.A.trash.length;
    applyActionV2(s, { sourceInstanceId: 'killer', controller: 'B' }, { kind: 'removal_ko' }, ['loj']);
    expect(s.players.A.field.find((i: { instanceId: string }) => i.instanceId === 'loj')).toBeDefined();
    expect(s.players.A.hand).not.toContain('EVT1');
    expect(s.players.A.trash.length).toBe(trashBefore + 1);
    expect(s.players.A.trash).toContain('EVT1');
  });

  it('survives KO when a Stage in hand is discarded', () => {
    const s = boot();
    placeLOJ(s, 'A');
    s.players.A.hand = [];
    giveHand(s, 'A', [stageCard]);
    applyActionV2(s, { sourceInstanceId: 'killer', controller: 'B' }, { kind: 'removal_ko' }, ['loj']);
    expect(s.players.A.field.find((i: { instanceId: string }) => i.instanceId === 'loj')).toBeDefined();
    expect(s.players.A.hand).not.toContain('STG1');
  });

  it('does NOT consume a character from hand as the cost', () => {
    const s = boot();
    placeLOJ(s, 'A');
    s.players.A.hand = [];
    // Only a character in hand → cost unpayable → KO proceeds, char untouched.
    giveHand(s, 'A', [charCard]);
    applyActionV2(s, { sourceInstanceId: 'killer', controller: 'B' }, { kind: 'removal_ko' }, ['loj']);
    expect(s.players.A.hand).toContain('CHR1');
  });
});
