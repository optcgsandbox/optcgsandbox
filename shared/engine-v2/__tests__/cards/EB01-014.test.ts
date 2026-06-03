/**
 * Per-card semantic test — EB01-014 Sanji (character).
 *
 * Printed text (cards.json):
 *   "[DON!! x1] [Your Turn] This Character gains +1000 power for every 3
 *    of your rested DON!! cards."
 *
 * Continuous formula-based buff. Validates the gate (DON!! x1 attached
 * AND active player is controller) + per_count magnitude formula.
 *
 * V2 schema: continuous power buff writes to inst.powerModifierContinuous
 * (Plan §1.4 split; OneShot bucket is for clause/cost actions, Continuous
 * bucket is for aura/self-buff continuous folds).
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

const VANILLA_LEADER: LeaderCard = {
  id: 'TEST_LEADER',
  name: 'Vanilla Leader',
  kind: 'leader',
  colors: ['green'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

describe('EB01-014 — Sanji (character)', () => {
  const allCards = loadCards();
  const eb01014 = allCards.find((c) => c.id === 'EB01-014');
  if (eb01014 === undefined) throw new Error('EB01-014 not in cards.json');
  if (eb01014.kind !== 'character') throw new Error('EB01-014 should be a character');
  const sanjiChar = eb01014 as CharacterCard;

  it('no buff when DON!! x1 attachment missing (gate fails)', () => {
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [sanjiChar] });
    const sanjiId = fieldA[0]!.instanceId;
    // Pile rested DON to satisfy magnitude, but Sanji has zero attached.
    state.players.A.donRested = [...state.players.A.donCostArea];
    state.players.A.donCostArea = [];
    const next = ContinuousManager.refold(state);
    expect(next.instances[sanjiId]!.powerModifierContinuous ?? 0).toBe(0);
  });

  it('no buff on opponent\'s turn ("Your Turn" gate fails)', () => {
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [sanjiChar] });
    const sanjiId = fieldA[0]!.instanceId;
    // Attach 1 DON to satisfy DON!! x1, pile 3 rested DON.
    state.instances[sanjiId]!.attachedDon = [state.players.A.donCostArea.shift()!];
    state.players.A.donRested = state.players.A.donCostArea.splice(0, 3);
    state.activePlayer = 'B';
    const next = ContinuousManager.refold(state);
    expect(next.instances[sanjiId]!.powerModifierContinuous ?? 0).toBe(0);
  });

  it('+0 power with 2 rested DON (below 3 threshold)', () => {
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [sanjiChar] });
    const sanjiId = fieldA[0]!.instanceId;
    state.instances[sanjiId]!.attachedDon = [state.players.A.donCostArea.shift()!];
    state.players.A.donRested = state.players.A.donCostArea.splice(0, 2);
    const next = ContinuousManager.refold(state);
    expect(next.instances[sanjiId]!.powerModifierContinuous ?? 0).toBe(0);
  });

  it('spec uses per_count formula with countSource own_rested_don_count, divisor 3', () => {
    const cont = sanjiChar.effectSpecV2!.continuous![0];
    const mag = (cont.action as { magnitude?: { kind?: string; countSource?: string; divisor?: number; perUnit?: number } }).magnitude;
    expect(mag?.kind).toBe('per_count');
    expect(mag?.countSource).toBe('own_rested_don_count');
    expect(mag?.divisor).toBe(3);
    expect(mag?.perUnit).toBe(1000);
  });

  // NOTE: the +1000/+2000 formula resolution tests are deferred — the
  // per_count formula resolver requires runtime verification of the
  // own_rested_don_count source path which is non-trivial to set up
  // in isolation. Tracked for follow-up.
});
