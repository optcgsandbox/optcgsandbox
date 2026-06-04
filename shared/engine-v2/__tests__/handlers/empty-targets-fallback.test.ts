/**
 * Engine V2 — hardening unit test: empty-targets fallback for
 * play_for_free / recursion / bottom_of_deck_from_hand.
 *
 * When a clause omits `target`, these handlers receive empty `targets` from
 * the dispatcher. The cluster-A / cluster-E patches added zone-scan
 * fallbacks that read `action.filter` + magnitude. Validates each branch
 * in isolation.
 *
 * Scope: direct action-handler calls.
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
  id: 'TEST_ETF_L', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function char(id: string, cost: number, trait?: string, color: 'red' | 'blue' = 'red'): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: [color], cost, power: 3000,
    counterValue: 1000, traits: trait ? [trait] : [], keywords: [], effectTags: [],
  };
}

function registerInst(state: ReturnType<typeof buildState>['state'], card: CharacterCard, zone: 'hand' | 'trash'): string {
  state.cardLibrary[card.id] = card;
  const inst = makeInst(card.id, 'A');
  state.instances[inst.instanceId] = inst;
  state.players.A[zone].push(inst.instanceId);
  return inst.instanceId;
}

describe('play_for_free empty-targets hand-scan', () => {
  it('from:"hand" with filter scans hand and plays first match (count default 1)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const matchId = registerInst(state, char('PFF_MATCH', 2), 'hand');
    const nonMatchId = registerInst(state, char('PFF_NONMATCH', 5), 'hand'); // cost too high
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('play_for_free')(state, ctx, {
      kind: 'play_for_free', from: 'hand', filter: { kind: 'character', costMax: 3 },
    }, []);
    expect(state.players.A.field.some((i) => i.instanceId === matchId)).toBe(true);
    expect(state.players.A.hand).toContain(nonMatchId);
    expect(state.players.A.hand).not.toContain(matchId);
  });

  it('from:"trash" scans trash and plays match', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const trashMatchId = registerInst(state, char('PFF_TM', 2), 'trash');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('play_for_free')(state, ctx, {
      kind: 'play_for_free', from: 'trash', filter: { kind: 'character', costMax: 3 },
    }, []);
    expect(state.players.A.field.some((i) => i.instanceId === trashMatchId)).toBe(true);
    expect(state.players.A.trash).not.toContain(trashMatchId);
  });

  it('from:"hand_or_trash" checks hand first; if hand has a match, trash is not searched', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const handMatchId = registerInst(state, char('PFF_HM', 2), 'hand');
    const trashMatchId = registerInst(state, char('PFF_TM2', 2), 'trash');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('play_for_free')(state, ctx, {
      kind: 'play_for_free', from: 'hand_or_trash', filter: { kind: 'character', costMax: 3 },
    }, []);
    expect(state.players.A.field.some((i) => i.instanceId === handMatchId)).toBe(true);
    expect(state.players.A.trash).toContain(trashMatchId); // untouched
  });

  it('from:"hand_or_trash" falls back to trash when hand has no match', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const trashMatchId = registerInst(state, char('PFF_TM3', 2), 'trash');
    // No hand cards seeded → hand scan finds nothing → fallback to trash.
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('play_for_free')(state, ctx, {
      kind: 'play_for_free', from: 'hand_or_trash', filter: { kind: 'character', costMax: 3 },
    }, []);
    expect(state.players.A.field.some((i) => i.instanceId === trashMatchId)).toBe(true);
    expect(state.players.A.trash).not.toContain(trashMatchId);
  });
});

describe('recursion empty-targets trash-scan', () => {
  it('with filter — picks first matching card from trash, moves to hand (cap default 1)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const matchId = registerInst(state, char('REC_MATCH', 3, 'Water Seven'), 'trash');
    const nonMatchId = registerInst(state, char('REC_NM', 3), 'trash'); // no trait
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('recursion')(state, ctx, {
      kind: 'recursion', magnitude: 1, filter: { trait: 'Water Seven', kind: 'character' },
    }, []);
    expect(state.players.A.hand).toContain(matchId);
    expect(state.players.A.trash).toContain(nonMatchId);
    expect(state.players.A.trash).not.toContain(matchId);
  });

  it('with magnitude:2 — pulls up to 2 matching trash cards', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const m1 = registerInst(state, char('REC_M1', 3, 'CP'), 'trash');
    const m2 = registerInst(state, char('REC_M2', 3, 'CP'), 'trash');
    const m3 = registerInst(state, char('REC_M3', 3, 'CP'), 'trash');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('recursion')(state, ctx, {
      kind: 'recursion', magnitude: 2, filter: { trait: 'CP' },
    }, []);
    // First 2 in trash insertion order should move; third stays.
    expect(state.players.A.hand).toContain(m1);
    expect(state.players.A.hand).toContain(m2);
    expect(state.players.A.trash).toContain(m3);
  });

  it('non-empty pre-resolved targets path: handler still iterates targets', () => {
    // When clause-target supplied resolved IDs, fallback scan must NOT fire.
    const { state, leaderInstA } = buildState({ leaderA: L });
    const targetId = registerInst(state, char('REC_TARGET', 3), 'trash');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('recursion')(state, ctx, { kind: 'recursion' }, [targetId]);
    expect(state.players.A.hand).toContain(targetId);
  });
});

describe('bottom_of_deck_from_hand empty-targets hand-prefix scan', () => {
  it('magnitude:2 — takes first 2 hand cards in insertion order, pushes to deck', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const h1 = registerInst(state, char('BDH_1', 1), 'hand');
    const h2 = registerInst(state, char('BDH_2', 1), 'hand');
    const h3 = registerInst(state, char('BDH_3', 1), 'hand');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('bottom_of_deck_from_hand')(state, ctx, {
      kind: 'bottom_of_deck_from_hand', magnitude: 2,
    }, []);
    expect(state.players.A.hand).toEqual([h3]);
    expect(state.players.A.deck).toContain(h1);
    expect(state.players.A.deck).toContain(h2);
  });

  it('magnitude > hand.length → clamps to hand.length (moves all)', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const h1 = registerInst(state, char('BDH_CL1', 1), 'hand');
    const h2 = registerInst(state, char('BDH_CL2', 1), 'hand');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('bottom_of_deck_from_hand')(state, ctx, {
      kind: 'bottom_of_deck_from_hand', magnitude: 99,
    }, []);
    expect(state.players.A.hand).toEqual([]);
    expect(state.players.A.deck).toContain(h1);
    expect(state.players.A.deck).toContain(h2);
  });

  it('non-empty pre-resolved targets path: handler iterates them', () => {
    const { state, leaderInstA } = buildState({ leaderA: L });
    const h1 = registerInst(state, char('BDH_T1', 1), 'hand');
    const h2 = registerInst(state, char('BDH_T2', 1), 'hand');
    const ctx = { sourceInstanceId: leaderInstA.instanceId, controller: 'A' as const };
    actionHandlers.get('bottom_of_deck_from_hand')(state, ctx, {
      kind: 'bottom_of_deck_from_hand',
    }, [h2]);
    expect(state.players.A.hand).toEqual([h1]);
    expect(state.players.A.deck).toContain(h2);
    expect(state.players.A.deck).not.toContain(h1);
  });
});
