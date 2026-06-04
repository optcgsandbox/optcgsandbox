/**
 * Engine V2 — snapshot regression test: searcher_peek zone-delta baselines.
 *
 * Pattern (zero deviation):
 *   1. buildState + seed deck/hand/trash explicitly
 *   2. capture pre-state zone sizes + specific instance IDs
 *   3. dispatch ONE action via actionHandlers.get(...)
 *   4. assert ONLY deltas (size changes, ID presence/absence in target zones)
 *
 * No full-state snapshots; no unrelated-zone assertions; no engine internals.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { actionHandlers } from '../../registry/types.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';
import type { CharacterCard, LeaderCard } from '../../cards/Card.js';

import { buildState, makeInst } from '../cards/_fixtures.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

const L: LeaderCard = {
  id: 'SP_SNAP_L', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function deckChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost: 2, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

function seedDeck(state: ReturnType<typeof buildState>['state'], cards: CharacterCard[]): string[] {
  const ids: string[] = [];
  for (const c of cards) {
    state.cardLibrary[c.id] = c;
    const inst = makeInst(c.id, 'A');
    state.instances[inst.instanceId] = inst;
    state.players.A.deck.push(inst.instanceId);
    ids.push(inst.instanceId);
  }
  return ids;
}

describe('searcher_peek snapshot — leftoverPlacement zone deltas', () => {
  it('"bottom" default: deck size unchanged, leftovers at deck tail in peek order', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ids = seedDeck(state, [deckChar('SPS_B1'), deckChar('SPS_B2'), deckChar('SPS_B3')]);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };

    // PRE-STATE SNAPSHOT
    const pre = {
      deckSize: state.players.A.deck.length,
      handSize: state.players.A.hand.length,
      trashSize: state.players.A.trash.length,
    };

    actionHandlers.get('searcher_peek')(state, ctx, {
      kind: 'searcher_peek', lookCount: 3, addCount: 0,
    }, []);

    // DELTA ASSERTIONS
    expect(state.players.A.deck.length).toBe(pre.deckSize); // 0 cards picked → deck size unchanged
    expect(state.players.A.hand.length).toBe(pre.handSize);
    expect(state.players.A.trash.length).toBe(pre.trashSize);
    // Order: leftovers preserved at deck TAIL in peek order
    const deck = state.players.A.deck;
    expect(deck[deck.length - 3]).toBe(ids[0]);
    expect(deck[deck.length - 2]).toBe(ids[1]);
    expect(deck[deck.length - 1]).toBe(ids[2]);
  });

  it('"top": leftovers at deck head in original peek order; total deck size unchanged', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ids = seedDeck(state, [deckChar('SPS_T1'), deckChar('SPS_T2'), deckChar('SPS_T3')]);
    state.players.A.deck.push('SPS_BACK_ANCHOR');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const preDeckSize = state.players.A.deck.length;

    actionHandlers.get('searcher_peek')(state, ctx, {
      kind: 'searcher_peek', lookCount: 3, addCount: 0, leftoverPlacement: 'top',
    }, []);

    expect(state.players.A.deck.length).toBe(preDeckSize);
    expect(state.players.A.deck[0]).toBe(ids[0]);
    expect(state.players.A.deck[1]).toBe(ids[1]);
    expect(state.players.A.deck[2]).toBe(ids[2]);
    expect(state.players.A.deck[state.players.A.deck.length - 1]).toBe('SPS_BACK_ANCHOR');
  });

  it('"trash": leftovers move from deck → trash; deck shrinks by 3, trash grows by 3', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ids = seedDeck(state, [deckChar('SPS_TR1'), deckChar('SPS_TR2'), deckChar('SPS_TR3')]);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = {
      deckSize: state.players.A.deck.length,
      trashSize: state.players.A.trash.length,
    };

    actionHandlers.get('searcher_peek')(state, ctx, {
      kind: 'searcher_peek', lookCount: 3, addCount: 0, leftoverPlacement: 'trash',
    }, []);

    expect(state.players.A.deck.length).toBe(pre.deckSize - 3);
    expect(state.players.A.trash.length).toBe(pre.trashSize + 3);
    for (const id of ids) {
      expect(state.players.A.deck).not.toContain(id);
      expect(state.players.A.trash).toContain(id);
    }
  });

  it('"shuffle": deck size unchanged, all leftovers still present, order deterministic for fixed seed', () => {
    // Build two parallel states with identical seed + counter; run shuffle;
    // assert deck order matches between runs (determinism baseline).
    const setupA = buildState({ leaderA: L });
    const setupB = buildState({ leaderA: L });
    setupA.state.players.A.deck = ['v', 'w', 'x', 'y', 'z'];
    setupB.state.players.A.deck = ['v', 'w', 'x', 'y', 'z'];
    setupA.state.seed = 4242;
    setupA.state.rngCounter = 0;
    setupB.state.seed = 4242;
    setupB.state.rngCounter = 0;
    const action = { kind: 'searcher_peek', lookCount: 5, addCount: 0, leftoverPlacement: 'shuffle' };
    const ctxA = { sourceInstanceId: setupA.leaderInstA.instanceId, controller: 'A' as const };
    const ctxB = { sourceInstanceId: setupB.leaderInstA.instanceId, controller: 'A' as const };

    actionHandlers.get('searcher_peek')(setupA.state, ctxA, action, []);
    actionHandlers.get('searcher_peek')(setupB.state, ctxB, action, []);

    // Delta assertions: deck size preserved, all elements present (set
    // equality via copy-sort to avoid mutating the deck), and the deck
    // orders match across two identically-seeded runs (determinism baseline).
    expect(setupA.state.players.A.deck.length).toBe(5);
    expect(setupB.state.players.A.deck.length).toBe(5);
    expect([...setupA.state.players.A.deck].sort()).toEqual(['v', 'w', 'x', 'y', 'z']);
    expect(setupA.state.players.A.deck).toEqual(setupB.state.players.A.deck);
    expect(setupA.state.players.A.trash.length).toBe(0);
  });

  it('addCount > 0 + filter: matching card moves deck → hand, leftovers route per placement', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ids = seedDeck(state, [deckChar('SPS_M1'), deckChar('SPS_M2')]);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    const pre = {
      deckSize: state.players.A.deck.length,
      handSize: state.players.A.hand.length,
      trashSize: state.players.A.trash.length,
    };

    actionHandlers.get('searcher_peek')(state, ctx, {
      kind: 'searcher_peek', lookCount: 2, addCount: 1, leftoverPlacement: 'bottom',
    }, []);

    // 1 card picked to hand (default behavior, no playInsteadOfHand)
    expect(state.players.A.hand.length).toBe(pre.handSize + 1);
    expect(state.players.A.hand).toContain(ids[0]);
    // Leftover (ids[1]) appended to deck tail
    expect(state.players.A.deck.length).toBe(pre.deckSize - 1);
    expect(state.players.A.deck[state.players.A.deck.length - 1]).toBe(ids[1]);
    expect(state.players.A.trash.length).toBe(pre.trashSize); // no trash delta
  });
});
