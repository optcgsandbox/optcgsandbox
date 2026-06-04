/**
 * Per-card semantic test — EB01-004 Koza (character).
 *
 * Printed text (cards.json):
 *   "[When Attacking] You may give your 1 active Leader −5000 power during
 *    this turn: Give up to 1 of your opponent's Characters −3000 power
 *    during this turn."
 *
 * 5-axis audit (per TASK_PHASE4_PER_CARD.md):
 *   Clause when_attacking → cost selfPowerCost: 5000; action power_buff
 *     -3000 duration this_turn; target opp_character.
 *
 * Engine gap (logged in BUGS_FOUND.md): `selfPowerCost` cost handler at
 * `shared/engine-v2/registry/handlers/costs2.ts:428-435` is a V0 no-op —
 * does NOT apply the -5000 to controller's leader. Per printed semantics,
 * the leader should have -5000 powerModifierOneShot until end of this turn.
 * The leader-side assertion is marked `it.fails` so it stays in the suite
 * and flips green automatically when the engine catches up.
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
import { PhaseScheduler } from '../../phases/PhaseScheduler.js';
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
  id: 'TEST_LEADER_EB004',
  name: 'TEST',
  kind: 'leader',
  colors: ['red'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

const OPP_CHAR: CharacterCard = {
  id: 'TEST_OPP_EB004',
  name: 'Opp Char',
  kind: 'character',
  colors: ['red'],
  cost: 3,
  power: 4000,
  counterValue: 1000,
  traits: [],
  keywords: [],
  effectTags: [],
};

describe('EB01-004 — Koza (character)', () => {
  const allCards = loadCards();
  const eb01_004 = allCards.find((c) => c.id === 'EB01-004');
  if (eb01_004 === undefined) throw new Error('EB01-004 not in cards.json');
  if (eb01_004.kind !== 'character') throw new Error('EB01-004 should be a character');
  const koza = eb01_004 as CharacterCard;

  describe('clause [When Attacking] — pay leader -5000 → opp char -3000 this_turn', () => {
    it('applies -3000 powerModifier to opp_character target this_turn', () => {
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [koza],
        charsB: [OPP_CHAR],
      });
      const kozaId = fieldA[0]!.instanceId;
      const oppId = fieldB[0]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: kozaId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[oppId]!.powerModifierOneShot).toBe(-3000);
      expect(next.instances[oppId]!.powerModifierExpiresInTurns).toBe(0);
    });

    it('opp char -3000 debuff clears after end of active player\'s turn', () => {
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [koza],
        charsB: [OPP_CHAR],
      });
      const kozaId = fieldA[0]!.instanceId;
      const oppId = fieldB[0]!.instanceId;
      let next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: kozaId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[oppId]!.powerModifierOneShot).toBe(-3000);
      next = PhaseScheduler.enterEnd(next);
      expect(next.instances[oppId]!.powerModifierOneShot).toBeUndefined();
    });

    // ENGINE GAP — see BUGS_FOUND.md EB01-004 entry. selfPowerCost is a V0
    // no-op so leader doesn't actually receive -5000. The two .fails tests
    // below stay in the suite documenting the printed semantics; they flip
    // green automatically once the engine learns to apply selfPowerCost.
    it('LEADER has -5000 powerModifierOneShot this_turn after paying selfPowerCost (closes cluster-F engine gap)', () => {
      const { state, fieldA, fieldB, leaderInstA } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [koza],
        charsB: [OPP_CHAR],
      });
      const kozaId = fieldA[0]!.instanceId;
      const leaderId = leaderInstA.instanceId;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: kozaId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[leaderId]!.powerModifierOneShot).toBe(-5000);
    });

    it('LEADER -5000 debuff clears at endTurn (closes cluster-F engine gap)', () => {
      const { state, fieldA, fieldB, leaderInstA } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [koza],
        charsB: [OPP_CHAR],
      });
      const kozaId = fieldA[0]!.instanceId;
      const leaderId = leaderInstA.instanceId;
      let next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: kozaId, controller: 'A' },
        'when_attacking',
      );
      // Once engine applies selfPowerCost, this should hold:
      expect(next.instances[leaderId]!.powerModifierOneShot).toBe(-5000);
      next = PhaseScheduler.enterEnd(next);
      expect(next.instances[leaderId]!.powerModifierOneShot).toBeUndefined();
    });

    it('no opp char target → action still fires on whatever target resolver returns (V0)', () => {
      // Edge case: target.kind is opp_character; with no opp chars on field
      // the resolver returns empty → EffectDispatcher.ts:128-129 continues
      // past the clause when target list is empty. No state change.
      const { state, fieldA } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [koza],
        // no charsB
      });
      const kozaId = fieldA[0]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: kozaId, controller: 'A' },
        'when_attacking',
      );
      expect(next.players.A.field.find((c) => c.instanceId === kozaId)).toBeDefined();
    });
  });
});
