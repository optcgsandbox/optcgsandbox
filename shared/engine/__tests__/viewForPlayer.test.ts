import { describe, expect, it } from 'vitest';
import { UNKNOWN_CARD, viewForPlayer, knownDeckResidual, drawProbability } from '../view/viewForPlayer';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import { closeMulliganKeepBoth } from './_donHelpers';

function makeLeader(id: string): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}
function makeChar(id: string, cost = 2, power = 3000): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost, power,
    counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  };
}

function bootMainPhase() {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

describe('viewForPlayer', () => {
  it('redacts opp hand identities while preserving instance IDs and counts', () => {
    const s = bootMainPhase();
    const view = viewForPlayer(s, 'B');
    expect(view.players.A.hand.length).toBe(s.players.A.hand.length);
    for (const id of view.players.A.hand) {
      expect(view.instances[id].cardId).toBe(UNKNOWN_CARD.id);
    }
  });

  it('redacts viewer life identities and viewer deck identities', () => {
    const s = bootMainPhase();
    const view = viewForPlayer(s, 'B');
    for (const id of view.players.B.life) {
      expect(view.instances[id].cardId).toBe(UNKNOWN_CARD.id);
    }
    for (const id of view.players.B.deck) {
      expect(view.instances[id].cardId).toBe(UNKNOWN_CARD.id);
    }
  });

  it('leaves viewer hand cards visible', () => {
    const s = bootMainPhase();
    const view = viewForPlayer(s, 'B');
    for (const id of view.players.B.hand) {
      expect(view.instances[id].cardId).not.toBe(UNKNOWN_CARD.id);
      expect(view.instances[id].cardId).toBe(s.instances[id].cardId);
    }
  });

  it('leaves both leaders and both trashes visible', () => {
    const s = bootMainPhase();
    const view = viewForPlayer(s, 'B');
    expect(view.players.A.leader.cardId).toBe(s.players.A.leader.cardId);
    expect(view.players.B.leader.cardId).toBe(s.players.B.leader.cardId);
  });

  it('respects knownByViewer overlay — listed instances are un-redacted (V3-9)', () => {
    const s = bootMainPhase();
    const oppHandId = s.players.A.hand[0];
    expect(oppHandId).toBeDefined();
    // Default view: opp hand redacted for viewer B.
    const v1 = viewForPlayer(s, 'B');
    expect(v1.instances[oppHandId].cardId).toBe(UNKNOWN_CARD.id);
    // Lift via overlay.
    s.knownByViewer.B.push(oppHandId);
    const v2 = viewForPlayer(s, 'B');
    expect(v2.instances[oppHandId].cardId).toBe(s.instances[oppHandId].cardId);
  });

  it('does NOT mutate the source state', () => {
    const s = bootMainPhase();
    const before = JSON.stringify(s);
    viewForPlayer(s, 'A');
    viewForPlayer(s, 'B');
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('knownDeckResidual', () => {
  it('returns viewer deck + life cards minus exposed ones', () => {
    const s = bootMainPhase();
    const residual = knownDeckResidual(s, 'B');
    expect(residual.length).toBe(s.players.B.deck.length + s.players.B.life.length);
  });
});

describe('drawProbability', () => {
  it('returns 0 for an empty deck', () => {
    const s = bootMainPhase();
    s.players.B.deck = [];
    expect(drawProbability(s, 'B', () => true)).toBe(0);
  });

  it('matches the fraction of cards satisfying the predicate', () => {
    const s = bootMainPhase();
    // All deck cards are characters by construction. Predicate matches all.
    expect(drawProbability(s, 'B', (c) => c.kind === 'character')).toBe(1);
    expect(drawProbability(s, 'B', (c) => c.kind === 'event')).toBe(0);
  });
});
