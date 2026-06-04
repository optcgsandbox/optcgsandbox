/**
 * Per-card semantic test — EB02-005 Fake Straw Hat Crew (character).
 * "[Your Turn] This Character gains +2000 power.
 *  [Opponent's Turn] Give this Character −2000 power."
 * Spec: TWO continuous entries:
 *   1) is_own_turn / self_power_buff +2000
 *   2) is_opp_turn / self_power_buff -2000
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

import { buildState } from './_fixtures.js';

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
  id: 'TEST_L_EB02005', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

describe('EB02-005 — Fake Straw Hat Crew', () => {
  const c = loadCards().find((x) => x.id === 'EB02-005');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-005 invalid');
  const fake = c as CharacterCard;
  const conts = fake.effectSpecV2!.continuous!;

  it('two continuous entries: own_turn +2000 / opp_turn -2000', () => {
    expect(conts).toHaveLength(2);
    expect(conts[0]!.condition!.type).toBe('is_own_turn');
    expect((conts[0]!.action as { magnitude: number }).magnitude).toBe(2000);
    expect(conts[1]!.condition!.type).toBe('is_opp_turn');
    expect((conts[1]!.action as { magnitude: number }).magnitude).toBe(-2000);
  });

  it('own turn → +2000', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [fake] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.powerModifierContinuous).toBe(2000);
  });

  it('opp turn → -2000', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [fake] });
    state.activePlayer = 'B';
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.powerModifierContinuous).toBe(-2000);
  });
});
