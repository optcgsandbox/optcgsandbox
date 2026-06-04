/**
 * Per-card semantic test — EB01-014 Sanji (character).
 *
 * Printed text (cards.json):
 *   "[DON!! x1] [Your Turn] This Character gains +1000 power for every 3
 *    of your rested DON!! cards."
 *
 * 5-axis: continuous with AND(if_attached_don_min 1, is_own_turn) gate
 *   and self_power_buff action whose magnitude is a per_count formula:
 *   { kind: 'per_count', countSource: 'own_rested_don_count',
 *     divisor: 3, perUnit: 1000 }.
 *
 * Engine gap (logged in BUGS_FOUND.md): continuous handlers' readMagnitude
 *   at continuous.ts:55-61 only handles literal numbers — formula magnitudes
 *   return 0. Sanji always gets +0 power. The gate tests pass (negative
 *   cases) but the positive computation cases are it.fails.
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
  id: 'TEST_LEADER_EB014',
  name: 'TEST',
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
  const eb = allCards.find((c) => c.id === 'EB01-014');
  if (eb === undefined) throw new Error('EB01-014 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-014 should be a character');
  const sanji = eb as CharacterCard;

  describe('gate AND(DON!! x1 attached, Your Turn)', () => {
    it('NO buff when 0 DON attached (DON!! gate fails)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [sanji] });
      const sanjiId = fieldA[0]!.instanceId;
      state.players.A.donRested = [...state.players.A.donCostArea];
      state.players.A.donCostArea = [];
      const next = ContinuousManager.refold(state);
      expect(next.instances[sanjiId]!.powerModifierContinuous ?? 0).toBe(0);
    });

    it('NO buff on opponent\'s turn (Your Turn gate fails)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [sanji] });
      const sanjiId = fieldA[0]!.instanceId;
      state.instances[sanjiId]!.attachedDon = [state.players.A.donCostArea.shift()!];
      state.players.A.donRested = state.players.A.donCostArea.splice(0, 3);
      state.activePlayer = 'B';
      const next = ContinuousManager.refold(state);
      expect(next.instances[sanjiId]!.powerModifierContinuous ?? 0).toBe(0);
    });

    it('NO buff with 2 rested DON (below the 3-divisor threshold)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [sanji] });
      const sanjiId = fieldA[0]!.instanceId;
      state.instances[sanjiId]!.attachedDon = [state.players.A.donCostArea.shift()!];
      state.players.A.donRested = state.players.A.donCostArea.splice(0, 2);
      const next = ContinuousManager.refold(state);
      // Floor(2/3) = 0, so +0 power. This passes regardless of engine gap
      // since the formula evaluates to 0 anyway when rested < divisor.
      expect(next.instances[sanjiId]!.powerModifierContinuous ?? 0).toBe(0);
    });
  });

  describe('per_count formula — +1000 per 3 rested DON', () => {
    it('+1000 power with 3 rested DON (closes cluster-C engine gap; readMagnitude now evaluates formula objects via resolveMagnitude)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [sanji] });
      const sanjiId = fieldA[0]!.instanceId;
      state.instances[sanjiId]!.attachedDon = [state.players.A.donCostArea.shift()!];
      state.players.A.donRested = state.players.A.donCostArea.splice(0, 3);
      const next = ContinuousManager.refold(state);
      expect(next.instances[sanjiId]!.powerModifierContinuous).toBe(1000);
    });

    it('+2000 power with 6 rested DON (closes cluster-C engine gap)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [sanji] });
      const sanjiId = fieldA[0]!.instanceId;
      state.instances[sanjiId]!.attachedDon = [state.players.A.donCostArea.shift()!];
      state.players.A.donRested = state.players.A.donCostArea.splice(0, 6);
      const next = ContinuousManager.refold(state);
      expect(next.instances[sanjiId]!.powerModifierContinuous).toBe(2000);
    });
  });
});
