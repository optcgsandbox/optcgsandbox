/**
 * Per-card semantic test — EB01-058 Mont Blanc Cricket (character).
 * "[DON!! x1] [Your Turn] If you have 2 or less Life cards, this Character
 *  gains +2000 power."
 * Spec: continuous AND(if_attached_don_min:1, is_own_turn, if_own_life_max:2) /
 *   self_power_buff +2000 (literal magnitude — NOT a formula, so no engine gap).
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { ContinuousManager } from '../../effects/ContinuousManager.js';
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
  id: 'TEST_L_EB058', name: 'L', kind: 'leader', colors: ['yellow'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function seedLife(state: ReturnType<typeof buildState>['state'], n: number): void {
  for (let i = 0; i < n; i++) {
    const id = `A-LIFE-58-${i}`;
    state.instances[id] = makeInst('__VANILLA', 'A');
    state.instances[id].instanceId = id;
    state.players.A.life.push(id);
  }
}

describe('EB01-058 — Mont Blanc Cricket', () => {
  const c = loadCards().find((x) => x.id === 'EB01-058');
  if (c === undefined || c.kind !== 'character') throw new Error('EB01-058 invalid');
  const mc = c as CharacterCard;
  const cont = mc.effectSpecV2!.continuous![0]!;

  it('continuous shape: AND(don≥1, own_turn, life≤2) / self_power_buff +2000', () => {
    const cond = cont.condition as { type: string; conditions: ReadonlyArray<{ type: string }> };
    expect(cond.type).toBe('and');
    expect(cond.conditions.map((c) => c.type)).toEqual([
      'if_attached_don_min', 'is_own_turn', 'if_own_life_max',
    ]);
    expect(cont.action.kind).toBe('self_power_buff');
    expect((cont.action as { magnitude: number }).magnitude).toBe(2000);
  });

  it('all conditions met → +2000', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [mc] });
    state.instances[fieldA[0]!.instanceId]!.attachedDon = [state.players.A.donCostArea.shift()!];
    seedLife(state, 2);
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.powerModifierContinuous).toBe(2000);
  });

  it('life=3 (above threshold) → no buff', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [mc] });
    state.instances[fieldA[0]!.instanceId]!.attachedDon = [state.players.A.donCostArea.shift()!];
    seedLife(state, 3);
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.powerModifierContinuous ?? 0).toBe(0);
  });

  it('0 DON attached → no buff (don gate fails)', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [mc] });
    // No DON attached.
    seedLife(state, 2);
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.powerModifierContinuous ?? 0).toBe(0);
  });

  it('opp turn → no buff (is_own_turn fails)', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [mc] });
    state.instances[fieldA[0]!.instanceId]!.attachedDon = [state.players.A.donCostArea.shift()!];
    seedLife(state, 2);
    state.activePlayer = 'B';
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.powerModifierContinuous ?? 0).toBe(0);
  });
});
