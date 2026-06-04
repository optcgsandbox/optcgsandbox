/**
 * Per-card semantic test — EB02-035 Sanji & Pudding (character).
 * "[Your Turn] [Once Per Turn] When 2 or more DON!! cards on your field
 *  are returned to your DON!! deck, add up to 1 DON!! card from your DON!!
 *  deck and set it as active.
 *  [On Play] If the number of DON!! cards on your field is equal to or less
 *  than the number on your opponent's field, draw 1 card."
 * Spec: 2 clauses:
 *   1) on_own_don_returned / AND(is_own_turn, if_don_returned_count_min:2) /
 *      ramp magnitude:1 rested:false / opt:true
 *   2) on_play / if_own_don_le_opp / draw 1
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';

import { buildState, makeInst } from './_fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

function loadCards(): Card[] {
  const raw = readFileSync(resolve(__dirname, '../../../data/cards.json'), 'utf-8');
  return JSON.parse(raw) as Card[];
}

const L: LeaderCard = {
  id: 'TEST_L_EB02035', name: 'L', kind: 'leader', colors: ['purple'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function deckChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['purple'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

function addDonToDeck(state: ReturnType<typeof buildState>['state'], player: 'A' | 'B', n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `${player}-DON-DECK-${i}-${Math.random().toString(36).slice(2, 8)}`;
    state.instances[id] = {
      instanceId: id, cardId: '__DON', controller: player, rested: false,
      summoningSick: false, attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    state.players[player].donDeck.push(id);
    ids.push(id);
  }
  return ids;
}

describe('EB02-035 — Sanji & Pudding', () => {
  const c = loadCards().find((x) => x.id === 'EB02-035');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-035 invalid');
  const sp = c as CharacterCard;
  const clauses = sp.effectSpecV2!.clauses!;

  it('shape: 2 clauses [on_own_don_returned/AND(own_turn, count>=2)/ramp 1 active/opt, on_play/if_own_don_le_opp/draw 1]', () => {
    expect(clauses).toHaveLength(2);
    const c0 = clauses[0]!;
    expect(c0.trigger).toBe('on_own_don_returned');
    const cond = c0.condition as { type: string; conditions: ReadonlyArray<{ type: string; n?: number }> };
    expect(cond.type).toBe('and');
    expect(cond.conditions.map((x) => x.type)).toEqual(['is_own_turn', 'if_don_returned_count_min']);
    expect(cond.conditions[1]!.n).toBe(2);
    expect(c0.action.kind).toBe('ramp');
    expect((c0.action as { magnitude: number; rested: boolean }).magnitude).toBe(1);
    expect((c0.action as { magnitude: number; rested: boolean }).rested).toBe(false);
    expect(c0.opt).toBe(true);
    const c1 = clauses[1]!;
    expect(c1.trigger).toBe('on_play');
    expect((c1.condition as { type: string }).type).toBe('if_own_don_le_opp');
    expect(c1.action.kind).toBe('draw');
    expect((c1.action as { magnitude: number }).magnitude).toBe(1);
  });

  it('on_play: A DON ≤ B DON → draws 1', () => {
    const { state, fieldA } = buildState({
      leaderA: L, charsA: [sp], donInCostA: 5, donInCostB: 10,
    });
    const card = deckChar('TEST_DRAW_E35');
    state.cardLibrary[card.id] = card;
    const drawInst = makeInst(card.id, 'A');
    state.instances[drawInst.instanceId] = drawInst;
    state.players.A.deck.push(drawInst.instanceId);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore + 1);
  });

  it('on_play: A DON > B DON → no draw (condition fail)', () => {
    const { state, fieldA } = buildState({
      leaderA: L, charsA: [sp], donInCostA: 10, donInCostB: 5,
    });
    const card = deckChar('TEST_NO_DRAW_E35');
    state.cardLibrary[card.id] = card;
    const drawInst = makeInst(card.id, 'A');
    state.instances[drawInst.instanceId] = drawInst;
    state.players.A.deck.push(drawInst.instanceId);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore);
  });

  it('on_own_don_returned: own turn + 2 DON returned → ramp 1 active', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sp] });
    addDonToDeck(state, 'A', 3);
    state.pendingDonReturned.A = 2;
    const costBefore = state.players.A.donCostArea.length;
    const restedBefore = state.players.A.donRested.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_own_don_returned',
    );
    expect(next.players.A.donCostArea.length).toBe(costBefore + 1);
    expect(next.players.A.donRested.length).toBe(restedBefore);
  });

  it('on_own_don_returned: only 1 DON returned → condition fail (no ramp)', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sp] });
    addDonToDeck(state, 'A', 3);
    state.pendingDonReturned.A = 1;
    const costBefore = state.players.A.donCostArea.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_own_don_returned',
    );
    expect(next.players.A.donCostArea.length).toBe(costBefore);
  });

  it('on_own_don_returned OPT: second fire same turn no-op', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sp] });
    addDonToDeck(state, 'A', 3);
    state.pendingDonReturned.A = 2;
    const once = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_own_don_returned',
    );
    const costAfterOnce = once.players.A.donCostArea.length;
    const twice = EffectDispatcher.dispatch(
      once, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_own_don_returned',
    );
    expect(twice.players.A.donCostArea.length).toBe(costAfterOnce);
  });
});
