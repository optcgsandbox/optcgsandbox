/**
 * buildPlayableInitialState — Phase F-7g.
 *
 * Validates that the worker's playable-setup helper produces a state
 * the engine considers a real main-phase first-player turn 1.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildPlayableInitialState,
} from '../../../worker/devSetup.js';
import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import { getLegalActions } from '../../engine-v2/rules/legality.js';
import type { Card, LeaderCard } from '../../engine-v2/cards/Card.js';
import { MatchSession } from '../MatchSession.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

// ─────────────────────────────────────────────────────────────────────
// Tiny library — same shape as devSetup.ts' DEV cards.
// ─────────────────────────────────────────────────────────────────────

const DEV_LEADER: LeaderCard = {
  id: 'TEST-PLAYABLE-LEADER',
  kind: 'leader',
  name: 'Test Playable Leader',
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  colors: ['red'],
  traits: ['Dev'],
  keywords: [],
  effectText: '',
};

const DEV_CHAR: Card = {
  id: 'TEST-PLAYABLE-CHAR',
  kind: 'character',
  name: 'Test Playable Char',
  cost: 2,
  power: 3000,
  counterValue: 1000,
  colors: ['red'],
  traits: ['Dev'],
  keywords: [],
  effectText: '',
};

function deck(size = 50): Card[] {
  return Array.from({ length: size }, () => DEV_CHAR);
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('buildPlayableInitialState — engine-driven setup', () => {
  it('returns phase=main, activePlayer=A on the standard 50-card dev deck', () => {
    const state = buildPlayableInitialState({
      seed: 42,
      decks: {
        A: { leader: DEV_LEADER, cards: deck() },
        B: { leader: DEV_LEADER, cards: deck() },
      },
    });
    expect(state.phase).toBe('main');
    expect(state.activePlayer).toBe('A');
    expect(state.firstPlayer).toBe('A');
    expect(state.turn).toBe(1);
  });

  it('A has a non-empty hand after setup', () => {
    const state = buildPlayableInitialState({
      seed: 7,
      decks: {
        A: { leader: DEV_LEADER, cards: deck() },
        B: { leader: DEV_LEADER, cards: deck() },
      },
    });
    expect(state.players['A'].hand.length).toBeGreaterThan(0);
  });

  it('A has life cards (engine dealt life at deal_life phase)', () => {
    const state = buildPlayableInitialState({
      seed: 7,
      decks: {
        A: { leader: DEV_LEADER, cards: deck() },
        B: { leader: DEV_LEADER, cards: deck() },
      },
    });
    expect(state.players['A'].life.length).toBeGreaterThan(0);
    expect(state.players['B'].life.length).toBeGreaterThan(0);
  });

  it('getLegalActions for A includes at least one non-CONCEDE action', () => {
    const state = buildPlayableInitialState({
      seed: 7,
      decks: {
        A: { leader: DEV_LEADER, cards: deck() },
        B: { leader: DEV_LEADER, cards: deck() },
      },
    });
    const legal = getLegalActions(state, 'A');
    const types = legal.map((a) => a.type);
    expect(types).toContain('CONCEDE');
    // The smoke + UI rely on at least ONE non-CONCEDE action being
    // present. END_TURN is always legal in main phase.
    const nonConcede = legal.filter((a) => a.type !== 'CONCEDE');
    expect(nonConcede.length).toBeGreaterThan(0);
  });

  it('MatchSession accepts the first non-CONCEDE action without errors', () => {
    const state = buildPlayableInitialState({
      seed: 7,
      decks: {
        A: { leader: DEV_LEADER, cards: deck() },
        B: { leader: DEV_LEADER, cards: deck() },
      },
    });
    const session = new MatchSession(state);
    const legal = getLegalActions(state, 'A');
    const first = legal.find((a) => a.type !== 'CONCEDE');
    expect(first).toBeDefined();
    if (first === undefined) return;
    const result = session.applyPlayerAction('A', first);
    expect(result.accepted).toBe(true);
  });

  it('produces deterministic states from the same seed', () => {
    const a = buildPlayableInitialState({
      seed: 99,
      decks: {
        A: { leader: DEV_LEADER, cards: deck() },
        B: { leader: DEV_LEADER, cards: deck() },
      },
    });
    const b = buildPlayableInitialState({
      seed: 99,
      decks: {
        A: { leader: DEV_LEADER, cards: deck() },
        B: { leader: DEV_LEADER, cards: deck() },
      },
    });
    // Same seed → same A hand, same A life, same activePlayer/phase.
    expect(a.phase).toBe(b.phase);
    expect(a.activePlayer).toBe(b.activePlayer);
    expect(a.players['A'].hand).toEqual(b.players['A'].hand);
    expect(a.players['A'].life).toEqual(b.players['A'].life);
  });
});
