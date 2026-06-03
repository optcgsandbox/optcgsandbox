/**
 * Per-card semantic test — EB01-001 Kouzuki Oden (leader).
 *
 * Printed text (cards.json):
 *   "All of your {Land of Wano} type Character cards without a Counter have
 *    a +1000 Counter, according to the rules.
 *    [DON!! x1] [When Attacking] If you have a {Land of Wano} type Character
 *    with a cost of 5 or more, this Leader gains +1000 power until the start
 *    of your next turn."
 *
 * 5-axis audit summary (per TASK_PHASE4_PER_CARD.md):
 *   Sentence 1 → continuous aura_counter_buff
 *     - Trigger axis: continuous (always-on)
 *     - Filter axis: trait 'Land of Wano' + kind 'character' + counterValueMax: 0
 *       ("without a Counter")
 *     - Magnitude: +1000
 *   Sentence 2 → clause when_attacking
 *     - Trigger: when_attacking
 *     - Conditions: AND(if_attached_don_min: 1, if_own_chars_min_cost: 1 minCost 5)
 *     - Action: power_buff +1000 on self, duration opp_next_turn
 *
 * Spec was UPDATED 2026-06-02 to add `counterValueMax: 0` to the filter.
 * The engine's `CardFilter` (filter.ts:17-44) does NOT yet honor that field —
 * the new filter entry is INERT until the engine catches up (logged in
 * BUGS_FOUND.md under EB01-001 as an engine gap, queued for post-audit fix).
 *
 * EB01-001 still plays correctly today because the `auraCounterBuff` handler
 * has an intrinsic counter-check at continuous.ts:322-329 that excludes
 * targets with printed counterValue > 0. That intrinsic is what makes the
 * "NO bonus on Land-of-Wano with printed counter > 0" tests pass; once the
 * engine learns to honor `counterValueMax` the intrinsic can be removed
 * without changing test outcomes.
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

describe('EB01-001 — Kouzuki Oden (leader)', () => {
  const allCards = loadCards();
  const eb01_001 = allCards.find((c) => c.id === 'EB01-001');
  if (eb01_001 === undefined) throw new Error('EB01-001 not in cards.json');
  if (eb01_001.kind !== 'leader') throw new Error('EB01-001 should be a leader');
  const leader = eb01_001 as LeaderCard;

  describe('continuous — "Land of Wano chars without a counter gain +1000 counter"', () => {
    it('+1000 counterBonus on a Land-of-Wano char with printed counterValue 0', () => {
      const zero: CharacterCard = {
        id: 'TEST_LOW_ZERO',
        name: 'Wano Zero',
        kind: 'character',
        colors: ['red'],
        cost: 3,
        power: 4000,
        counterValue: 0,
        traits: ['Land of Wano'],
        keywords: [],
        effectTags: [],
      };
      const { state, fieldA } = buildState({ leaderA: leader, charsA: [zero] });
      const folded = ContinuousManager.refold(state);
      expect(folded.instances[fieldA[0]!.instanceId]!.counterBonus).toBe(1000);
    });

    it('NO bonus on Land-of-Wano char with printed counterValue 1000 (filter excludes)', () => {
      const has: CharacterCard = {
        id: 'TEST_LOW_HAS',
        name: 'Wano Has',
        kind: 'character',
        colors: ['red'],
        cost: 3,
        power: 4000,
        counterValue: 1000,
        traits: ['Land of Wano'],
        keywords: [],
        effectTags: [],
      };
      const { state, fieldA } = buildState({ leaderA: leader, charsA: [has] });
      const folded = ContinuousManager.refold(state);
      expect(folded.instances[fieldA[0]!.instanceId]!.counterBonus ?? 0).toBe(0);
    });

    it('NO bonus on Land-of-Wano char with printed counterValue 2000', () => {
      const has2k: CharacterCard = {
        id: 'TEST_LOW_2K',
        name: 'Wano 2k',
        kind: 'character',
        colors: ['red'],
        cost: 3,
        power: 4000,
        counterValue: 2000,
        traits: ['Land of Wano'],
        keywords: [],
        effectTags: [],
      };
      const { state, fieldA } = buildState({ leaderA: leader, charsA: [has2k] });
      const folded = ContinuousManager.refold(state);
      expect(folded.instances[fieldA[0]!.instanceId]!.counterBonus ?? 0).toBe(0);
    });

    it('NO bonus on non-Land-of-Wano char with counterValue 0 (trait filter excludes)', () => {
      const other: CharacterCard = {
        id: 'TEST_NLOW_ZERO',
        name: 'Not Wano',
        kind: 'character',
        colors: ['red'],
        cost: 3,
        power: 4000,
        counterValue: 0,
        traits: ['Straw Hat Crew'],
        keywords: [],
        effectTags: [],
      };
      const { state, fieldA } = buildState({ leaderA: leader, charsA: [other] });
      const folded = ContinuousManager.refold(state);
      expect(folded.instances[fieldA[0]!.instanceId]!.counterBonus ?? 0).toBe(0);
    });

    it('refold idempotence — apply twice yields the same counterBonus', () => {
      const zero: CharacterCard = {
        id: 'TEST_LOW_IDEM',
        name: 'Wano Idem',
        kind: 'character',
        colors: ['red'],
        cost: 3,
        power: 4000,
        counterValue: 0,
        traits: ['Land of Wano'],
        keywords: [],
        effectTags: [],
      };
      const { state, fieldA } = buildState({ leaderA: leader, charsA: [zero] });
      const once = ContinuousManager.refold(state);
      const twice = ContinuousManager.refold(once);
      expect(twice.instances[fieldA[0]!.instanceId]!.counterBonus).toBe(1000);
    });

    it('buff applies to multiple matching Wano targets simultaneously', () => {
      const a: CharacterCard = {
        id: 'TEST_LOW_MULTI_A',
        name: 'A',
        kind: 'character',
        colors: ['red'],
        cost: 3,
        power: 4000,
        counterValue: 0,
        traits: ['Land of Wano'],
        keywords: [],
        effectTags: [],
      };
      const b: CharacterCard = { ...a, id: 'TEST_LOW_MULTI_B' };
      const { state, fieldA } = buildState({ leaderA: leader, charsA: [a, b] });
      const folded = ContinuousManager.refold(state);
      expect(folded.instances[fieldA[0]!.instanceId]!.counterBonus).toBe(1000);
      expect(folded.instances[fieldA[1]!.instanceId]!.counterBonus).toBe(1000);
    });
  });

  describe('clause [DON!! x1][When Attacking] — leader +1000 power until start of next turn', () => {
    const leaderHelper: CharacterCard = {
      id: 'TEST_LOW_C5',
      name: 'Wano Cost5',
      kind: 'character',
      colors: ['red'],
      cost: 5,
      power: 6000,
      counterValue: 1000,
      traits: ['Land of Wano'],
      keywords: [],
      effectTags: [],
    };

    function setupBothGates(): ReturnType<typeof buildState> {
      const built = buildState({ leaderA: leader, charsA: [leaderHelper] });
      // Attach 1 DON to leader for [DON!! x1].
      const donId = built.state.players.A.donCostArea.shift()!;
      built.state.instances[built.leaderInstA.instanceId]!.attachedDon.push(donId);
      built.leaderInstA.attachedDon.push(donId); // alias is the same ref via buildState
      return built;
    }

    it('NO buff when DON!! x1 missing (gate fails)', () => {
      const { state, leaderInstA } = buildState({ leaderA: leader, charsA: [leaderHelper] });
      // 0 DON attached, cost-5+ Wano on field — should not fire.
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: leaderInstA.instanceId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0).toBe(0);
    });

    it('NO buff when no Wano cost-5+ char on field (gate fails)', () => {
      const cheap: CharacterCard = {
        id: 'TEST_LOW_CHEAP',
        name: 'Wano Cheap',
        kind: 'character',
        colors: ['red'],
        cost: 2,
        power: 2000,
        counterValue: 1000,
        traits: ['Land of Wano'],
        keywords: [],
        effectTags: [],
      };
      const { state, leaderInstA } = buildState({ leaderA: leader, charsA: [cheap] });
      // Attach 1 DON but only have a cost-2 Wano char.
      const donId = state.players.A.donCostArea.shift()!;
      state.instances[leaderInstA.instanceId]!.attachedDon.push(donId);
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: leaderInstA.instanceId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0).toBe(0);
    });

    it('+1000 power on leader when both gates pass', () => {
      const { state, leaderInstA } = setupBothGates();
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: leaderInstA.instanceId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBe(1000);
      // opp_next_turn duration: expiresInTurns starts at 1 (decremented at our
      // own end-turn; cleared at opponent's end-turn → our next turn).
      expect(next.instances[leaderInstA.instanceId]!.powerModifierExpiresInTurns).toBe(1);
    });

    it('buff survives our own end-of-turn (still present after one turn boundary)', () => {
      const { state, leaderInstA } = setupBothGates();
      let next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: leaderInstA.instanceId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBe(1000);
      // End our turn — expiresInTurns ticks down from 1 to 0 but the
      // OneShot field is only cleared NEXT time it ticks (at start of our
      // next refresh, via enterRefresh + powerModifierExpiresInTurns === 0
      // clear path in PhaseScheduler.ts).
      next = PhaseScheduler.enterEnd(next);
      // After our end: the OneShot is still applied (clears at start of
      // OUR next refresh, which is after opp's full turn).
      expect(next.instances[leaderInstA.instanceId]!.powerModifierOneShot).toBe(1000);
    });
  });
});
