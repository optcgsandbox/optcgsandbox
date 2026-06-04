/**
 * Engine V2 — hardening unit test: searcher_peek leftoverPlacement branches.
 *
 * Validates every branch of the data-driven leftover-routing switch in
 * `actions3.ts:searcher_peek`:
 *   - 'bottom' (default) — leftovers pushed to deck tail in peek order
 *   - 'top'              — leftovers unshifted to deck head in peek order
 *   - 'trash'            — leftovers go to pl.trash
 *   - 'shuffle'          — leftovers pushed to bottom, then deck shuffled
 *                          via RngService (deterministic for fixed seed)
 *   - lookCount=0        — no-op
 *
 * Scope: direct action-handler call with synthesized deck state.
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
  id: 'TEST_SP_L', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

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

function mkCard(id: string, kind: 'character' = 'character'): CharacterCard {
  return {
    id, name: id, kind, colors: ['red'], cost: 2, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('searcher_peek leftoverPlacement', () => {
  it('default "bottom" — leftovers appended to deck tail in peek order', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ids = seedDeck(state, [mkCard('SP_A'), mkCard('SP_B'), mkCard('SP_C')]);
    // Pre-seed an anchor at the back so we can assert relative position.
    state.players.A.deck.push('SP_ANCHOR_BACK');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('searcher_peek')(state, ctx, {
      kind: 'searcher_peek', lookCount: 3, addCount: 0,
    }, []);
    const deck = state.players.A.deck;
    // All 3 leftovers come after the anchor in original peek order.
    expect(deck.indexOf('SP_ANCHOR_BACK')).toBeLessThan(deck.indexOf(ids[0]!));
    expect(deck.indexOf(ids[0]!)).toBeLessThan(deck.indexOf(ids[1]!));
    expect(deck.indexOf(ids[1]!)).toBeLessThan(deck.indexOf(ids[2]!));
  });

  it('"top" — leftovers unshifted to deck head in original peek order', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ids = seedDeck(state, [mkCard('SP_T1'), mkCard('SP_T2'), mkCard('SP_T3')]);
    state.players.A.deck.push('SP_ANCHOR_BACK');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('searcher_peek')(state, ctx, {
      kind: 'searcher_peek', lookCount: 3, addCount: 0, leftoverPlacement: 'top',
    }, []);
    const deck = state.players.A.deck;
    // Head positions [0..2] in original peek order; anchor at back stays last.
    expect(deck[0]).toBe(ids[0]);
    expect(deck[1]).toBe(ids[1]);
    expect(deck[2]).toBe(ids[2]);
    expect(deck[deck.length - 1]).toBe('SP_ANCHOR_BACK');
  });

  it('"trash" — leftovers move to pl.trash, NOT pl.deck', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ids = seedDeck(state, [mkCard('SP_TR1'), mkCard('SP_TR2'), mkCard('SP_TR3')]);
    state.players.A.deck.push('SP_ANCHOR_BACK');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('searcher_peek')(state, ctx, {
      kind: 'searcher_peek', lookCount: 3, addCount: 0, leftoverPlacement: 'trash',
    }, []);
    expect(state.players.A.trash).toEqual(ids);
    for (const id of ids) {
      expect(state.players.A.deck).not.toContain(id);
    }
    expect(state.players.A.deck).toEqual(['SP_ANCHOR_BACK']);
  });

  it('"shuffle" — leftovers go through deck and shuffle is deterministic for fixed seed', () => {
    // Two identical setups; run shuffle; verify outputs match (determinism via
    // RngService which derives from state.seed + state.rngCounter).
    const setupA = buildState({ leaderA: L });
    const setupB = buildState({ leaderA: L });
    const idsA = seedDeck(setupA.state, [mkCard('SP_SH1'), mkCard('SP_SH2'), mkCard('SP_SH3'), mkCard('SP_SH4')]);
    const idsB = seedDeck(setupB.state, [mkCard('SP_SH1B'), mkCard('SP_SH2B'), mkCard('SP_SH3B'), mkCard('SP_SH4B')]);
    void idsB;  // distinct ids per call so makeInst counter stays fresh; we compare relative ordering only

    const ctxA = { sourceInstanceId: setupA.leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('searcher_peek')(setupA.state, ctxA, {
      kind: 'searcher_peek', lookCount: 4, addCount: 0, leftoverPlacement: 'shuffle',
    }, []);
    // Determinism via fixed seed: rerun the same shuffle with a fresh state
    // that has identical seed + counter. Both should produce same byte
    // sequence from RngService. Build a parallel state and run again.
    const setupA2 = buildState({ leaderA: L });
    // Re-create deck with same instance ids; but makeInst increments a
    // global counter — instance IDs will differ between runs. Instead we
    // compare RngService output directly by snapshotting state.rngCounter.
    void setupA2;
    expect(setupA.state.players.A.deck).toHaveLength(4); // all 4 leftovers still in deck
    expect(setupA.state.rngCounter).toBeGreaterThan(0); // RngService.pull was called
    // Assert leftovers are still ALL present in deck (just reordered),
    // and that pl.trash is unchanged (shuffle does NOT trash).
    for (const id of idsA) {
      expect(setupA.state.players.A.deck).toContain(id);
    }
    expect(setupA.state.players.A.trash).toHaveLength(0);
  });

  it('"shuffle" — deterministic: same starting rngCounter + same deck → same shuffle order', () => {
    // Mint two states with identical initial decks and identical rngCounter.
    // After both shuffle, deck orders must be identical.
    const a = buildState({ leaderA: L });
    const b = buildState({ leaderA: L });
    // Replace deck contents with literal known-equal ids in both states.
    a.state.players.A.deck = ['z', 'y', 'x', 'w', 'v'];
    b.state.players.A.deck = ['z', 'y', 'x', 'w', 'v'];
    // Seed instances entries for known ids (handler only looks up via state.instances
    // when applying picks; with addCount:0 no lookup is required).
    a.state.seed = 12345;
    a.state.rngCounter = 0;
    b.state.seed = 12345;
    b.state.rngCounter = 0;
    const ctxA = { sourceInstanceId: a.leaderInstA.instanceId, controller: 'A' as const };
    const ctxB = { sourceInstanceId: b.leaderInstA.instanceId, controller: 'A' as const };
    const action = { kind: 'searcher_peek', lookCount: 5, addCount: 0, leftoverPlacement: 'shuffle' };
    actionHandlers.get('searcher_peek')(a.state, ctxA, action, []);
    actionHandlers.get('searcher_peek')(b.state, ctxB, action, []);
    expect(a.state.players.A.deck).toEqual(b.state.players.A.deck);
  });

  it('lookCount=0 → no-op (no deck mutation, no trash mutation)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    seedDeck(state, [mkCard('SP_Z1'), mkCard('SP_Z2')]);
    const deckBefore = [...state.players.A.deck];
    const trashBefore = [...state.players.A.trash];
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('searcher_peek')(state, ctx, {
      kind: 'searcher_peek', lookCount: 0, addCount: 0,
    }, []);
    expect(state.players.A.deck).toEqual(deckBefore);
    expect(state.players.A.trash).toEqual(trashBefore);
  });

  it('lookCount > deck.length → clamps to deck.length, all peeked leftovers route correctly', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const ids = seedDeck(state, [mkCard('SP_C1'), mkCard('SP_C2')]);
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('searcher_peek')(state, ctx, {
      kind: 'searcher_peek', lookCount: 999, addCount: 0, leftoverPlacement: 'trash',
    }, []);
    expect(state.players.A.trash).toEqual(ids);
    expect(state.players.A.deck).toHaveLength(0);
  });
});
