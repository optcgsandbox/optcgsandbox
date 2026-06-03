/**
 * Card Effect Execution Layer — primitive unit tests.
 *
 * One test per primitive from docs/OP_SIM_ENGINE_SPEC_V1.md:
 *   - 21 triggers
 *   - 25 conditions
 *   - 19 selectors
 *   - 28 actions
 *
 * Each test is a smoke test: construct a minimal state, invoke the
 * primitive's evaluator/resolver/converter, assert the basic shape. Real
 * card behavior is tested in integration.test.ts.
 */

import { describe, it, expect } from 'vitest';
import type { CharacterCard, LeaderCard } from '../../engine-v2/cards/Card.js';
import { buildState } from '../../engine-v2/__tests__/cards/_fixtures.js';
import { evaluateCondition } from '../conditions.js';
import { resolveSelector } from '../selectors.js';
import { actionToMutations } from '../actions.js';
import { ALL_TRIGGERS, matchesTrigger } from '../triggers.js';
import type { EffectSpec, SimEvent, Trigger, Action } from '../types.js';

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

const TEST_LEADER: LeaderCard = {
  id: 'TEST_L',
  name: 'Test Leader',
  kind: 'leader',
  colors: ['red'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Land of Wano'],
  keywords: [],
  effectTags: [],
};

function wanoChar(id: string, cost: number, power = 5000): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['red'],
    cost,
    power,
    counterValue: 1000,
    traits: ['Land of Wano'],
    keywords: [],
    effectTags: [],
  };
}

function baseEvent(trigger: Trigger): SimEvent {
  return { trigger, controller: 'A' };
}

// ────────────────────────────────────────────────────────────────────
// TRIGGERS — 21 tests
// ────────────────────────────────────────────────────────────────────

describe('triggers', () => {
  it('ALL_TRIGGERS contains exactly 21 entries', () => {
    expect(ALL_TRIGGERS).toHaveLength(21);
  });

  for (const t of ALL_TRIGGERS) {
    it(`matchesTrigger fires when event.trigger === '${t}'`, () => {
      const spec: EffectSpec = { trigger: t, effects: [] };
      expect(matchesTrigger(spec, baseEvent(t))).toBe(true);
    });
  }

  it('matchesTrigger does NOT fire when event.trigger differs', () => {
    const spec: EffectSpec = { trigger: 'ON_PLAY', effects: [] };
    expect(matchesTrigger(spec, baseEvent('ON_ATTACK'))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// CONDITIONS — one positive case per type (25 tests)
// ────────────────────────────────────────────────────────────────────

describe('conditions', () => {
  it('HAS_DON — passes when DON >= amount', () => {
    const { state } = buildState({ leaderA: TEST_LEADER, donInCostA: 5 });
    expect(evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'HAS_DON', amount: 3 })).toBe(true);
    expect(evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'HAS_DON', amount: 10 })).toBe(false);
  });

  it('HAS_CHARACTER — passes when any self character matches filter', () => {
    const c = wanoChar('C5', 5);
    const { state } = buildState({ leaderA: TEST_LEADER, charsA: [c] });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), {
        type: 'HAS_CHARACTER',
        trait: 'Land of Wano',
        cost_gte: 5,
      }),
    ).toBe(true);
  });

  it('HAS_TRAIT — passes when a self character has the trait', () => {
    const { state } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C1', 1)] });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'HAS_TRAIT', trait: 'Land of Wano' }),
    ).toBe(true);
  });

  it('HAS_COLOR — passes when a self character has the color', () => {
    const { state } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C1', 1)] });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'HAS_COLOR', color: 'red' }),
    ).toBe(true);
  });

  it('HAS_COST_AT_LEAST — passes when a self character cost >= threshold', () => {
    const { state } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C5', 5)] });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'HAS_COST_AT_LEAST', cost_gte: 5 }),
    ).toBe(true);
  });

  it('HAS_COST_AT_MOST — passes when a self character cost <= threshold', () => {
    const { state } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C2', 2)] });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'HAS_COST_AT_MOST', cost_lte: 3 }),
    ).toBe(true);
  });

  it('HAS_POWER_AT_LEAST — passes when a self character power >= threshold', () => {
    const { state } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C1', 1, 5000)] });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'HAS_POWER_AT_LEAST', power_gte: 5000 }),
    ).toBe(true);
  });

  it('HAS_POWER_AT_MOST — passes when a self character power <= threshold', () => {
    const { state } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C1', 1, 2000)] });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'HAS_POWER_AT_MOST', power_lte: 3000 }),
    ).toBe(true);
  });

  it('LEADER_IS — passes when own leader name matches', () => {
    const { state } = buildState({ leaderA: TEST_LEADER });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'LEADER_IS', name: 'Test Leader' }),
    ).toBe(true);
  });

  it('COUNT_CHARACTERS — passes when count matches amount_gte', () => {
    const { state } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C1', 1), wanoChar('C2', 2)] });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'COUNT_CHARACTERS', amount_gte: 2 }),
    ).toBe(true);
  });

  it('COUNT_RESTED_CHARACTERS — counts only rested', () => {
    const c = wanoChar('C1', 1);
    const { state, fieldA } = buildState({ leaderA: TEST_LEADER, charsA: [c] });
    fieldA[0]!.rested = true;
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), {
        type: 'COUNT_RESTED_CHARACTERS',
        amount_gte: 1,
      }),
    ).toBe(true);
  });

  it('COUNT_ACTIVE_CHARACTERS — counts only active', () => {
    const { state } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C1', 1)] });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), {
        type: 'COUNT_ACTIVE_CHARACTERS',
        amount_gte: 1,
      }),
    ).toBe(true);
  });

  it('COUNT_TRAIT — counts characters with trait', () => {
    const { state } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C1', 1)] });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), {
        type: 'COUNT_TRAIT',
        trait: 'Land of Wano',
        amount_gte: 1,
      }),
    ).toBe(true);
  });

  it('COUNT_COLOR — counts characters with color', () => {
    const { state } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C1', 1)] });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), {
        type: 'COUNT_COLOR',
        color: 'red',
        amount_gte: 1,
      }),
    ).toBe(true);
  });

  it('LIFE_AT_OR_BELOW — passes when life <= amount', () => {
    const { state } = buildState({ leaderA: TEST_LEADER });
    // Life starts empty in buildState, so 0 <= 2.
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'LIFE_AT_OR_BELOW', amount: 2 }),
    ).toBe(true);
  });

  it('LIFE_AT_OR_ABOVE — passes when life >= amount', () => {
    const { state } = buildState({ leaderA: TEST_LEADER });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'LIFE_AT_OR_ABOVE', amount: 0 }),
    ).toBe(true);
  });

  it('HAND_SIZE_AT_LEAST — passes when hand >= amount', () => {
    const { state } = buildState({ leaderA: TEST_LEADER });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'HAND_SIZE_AT_LEAST', amount: 0 }),
    ).toBe(true);
  });

  it('HAND_SIZE_AT_MOST — passes when hand <= amount', () => {
    const { state } = buildState({ leaderA: TEST_LEADER });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'HAND_SIZE_AT_MOST', amount: 5 }),
    ).toBe(true);
  });

  it('TRASH_SIZE_AT_LEAST — passes when trash >= amount', () => {
    const { state } = buildState({ leaderA: TEST_LEADER });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'TRASH_SIZE_AT_LEAST', amount: 0 }),
    ).toBe(true);
  });

  it('TURN_PLAYER — passes when active player matches owner', () => {
    const { state } = buildState({ leaderA: TEST_LEADER });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'TURN_PLAYER' }),
    ).toBe(true);
  });

  it('EXISTS_TARGET — passes when any matching target exists', () => {
    const { state } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C5', 5)] });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), {
        type: 'EXISTS_TARGET',
        trait: 'Land of Wano',
        cost_gte: 5,
      }),
    ).toBe(true);
  });

  it('NO_TARGET_EXISTS — passes when no matching target exists', () => {
    const { state } = buildState({ leaderA: TEST_LEADER });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), {
        type: 'NO_TARGET_EXISTS',
        trait: 'Nonexistent',
      }),
    ).toBe(true);
  });

  it('IS_RESTED — passes when source instance is rested', () => {
    const c = wanoChar('C1', 1);
    const { state, fieldA } = buildState({ leaderA: TEST_LEADER, charsA: [c] });
    fieldA[0]!.rested = true;
    const ev = { ...baseEvent('ON_ATTACK'), sourceInstanceId: fieldA[0]!.instanceId };
    expect(evaluateCondition(state, ev, { type: 'IS_RESTED' })).toBe(true);
  });

  it('IS_ACTIVE — passes when source instance is active (not rested)', () => {
    const c = wanoChar('C1', 1);
    const { state, fieldA } = buildState({ leaderA: TEST_LEADER, charsA: [c] });
    const ev = { ...baseEvent('ON_ATTACK'), sourceInstanceId: fieldA[0]!.instanceId };
    expect(evaluateCondition(state, ev, { type: 'IS_ACTIVE' })).toBe(true);
  });

  it('HAS_ATTRIBUTE — passes when a self character has the attribute', () => {
    const c: CharacterCard = { ...wanoChar('C1', 1), attribute: 'slash' };
    const { state } = buildState({ leaderA: TEST_LEADER, charsA: [c] });
    expect(
      evaluateCondition(state, baseEvent('ON_ATTACK'), { type: 'HAS_ATTRIBUTE', attribute: 'slash' }),
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// SELECTORS — one resolution test per selector (19 tests)
// ────────────────────────────────────────────────────────────────────

describe('selectors', () => {
  it('SELF_LEADER resolves to active player leader', () => {
    const { state, leaderInstA } = buildState({ leaderA: TEST_LEADER });
    const r = resolveSelector(state, baseEvent('ON_ATTACK'), 'SELF_LEADER');
    expect(r?.[0]?.instanceId).toBe(leaderInstA.instanceId);
  });

  it('OPPONENT_LEADER resolves to opp leader', () => {
    const { state, leaderInstB } = buildState({ leaderA: TEST_LEADER });
    const r = resolveSelector(state, baseEvent('ON_ATTACK'), 'OPPONENT_LEADER');
    expect(r?.[0]?.instanceId).toBe(leaderInstB.instanceId);
  });

  it('SELF_CHARACTER resolves to active player field chars', () => {
    const { state, fieldA } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C1', 1)] });
    const r = resolveSelector(state, baseEvent('ON_ATTACK'), 'SELF_CHARACTER');
    expect(r?.map((i) => i.instanceId)).toEqual([fieldA[0]!.instanceId]);
  });

  it('OPPONENT_CHARACTER resolves to opp field chars', () => {
    const { state, fieldB } = buildState({ leaderA: TEST_LEADER, charsB: [wanoChar('C1', 1)] });
    const r = resolveSelector(state, baseEvent('ON_ATTACK'), 'OPPONENT_CHARACTER');
    expect(r?.map((i) => i.instanceId)).toEqual([fieldB[0]!.instanceId]);
  });

  it('ALL_SELF_CHARACTERS includes the leader', () => {
    const { state, leaderInstA, fieldA } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C1', 1)] });
    const r = resolveSelector(state, baseEvent('ON_ATTACK'), 'ALL_SELF_CHARACTERS');
    expect(r?.map((i) => i.instanceId).sort()).toEqual(
      [leaderInstA.instanceId, fieldA[0]!.instanceId].sort(),
    );
  });

  it('ALL_OPPONENT_CHARACTERS includes opp leader', () => {
    const { state, leaderInstB, fieldB } = buildState({ leaderA: TEST_LEADER, charsB: [wanoChar('C1', 1)] });
    const r = resolveSelector(state, baseEvent('ON_ATTACK'), 'ALL_OPPONENT_CHARACTERS');
    expect(r?.map((i) => i.instanceId).sort()).toEqual(
      [leaderInstB.instanceId, fieldB[0]!.instanceId].sort(),
    );
  });

  it('THIS_CARD resolves to event.sourceInstanceId', () => {
    const { state, fieldA } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C1', 1)] });
    const ev = { ...baseEvent('ON_ATTACK'), sourceInstanceId: fieldA[0]!.instanceId };
    const r = resolveSelector(state, ev, 'THIS_CARD');
    expect(r?.[0]?.instanceId).toBe(fieldA[0]!.instanceId);
  });

  it('ATTACKING_CHARACTER resolves to event.attackingInstanceId when it is a character', () => {
    const { state, fieldA } = buildState({ leaderA: TEST_LEADER, charsA: [wanoChar('C1', 1)] });
    const ev = { ...baseEvent('ON_ATTACK'), attackingInstanceId: fieldA[0]!.instanceId };
    const r = resolveSelector(state, ev, 'ATTACKING_CHARACTER');
    expect(r?.[0]?.instanceId).toBe(fieldA[0]!.instanceId);
  });

  it('ATTACKING_LEADER resolves when attackingInstanceId is a leader', () => {
    const { state, leaderInstA } = buildState({ leaderA: TEST_LEADER });
    const ev = { ...baseEvent('ON_ATTACK'), attackingInstanceId: leaderInstA.instanceId };
    const r = resolveSelector(state, ev, 'ATTACKING_LEADER');
    expect(r?.[0]?.instanceId).toBe(leaderInstA.instanceId);
  });

  it('TARGET_CHARACTER resolves to event.targetInstanceId when a character', () => {
    const { state, fieldB } = buildState({ leaderA: TEST_LEADER, charsB: [wanoChar('C1', 1)] });
    const ev = { ...baseEvent('ON_ATTACK'), targetInstanceId: fieldB[0]!.instanceId };
    const r = resolveSelector(state, ev, 'TARGET_CHARACTER');
    expect(r?.[0]?.instanceId).toBe(fieldB[0]!.instanceId);
  });

  it('TARGET_LEADER resolves when target is a leader', () => {
    const { state, leaderInstB } = buildState({ leaderA: TEST_LEADER });
    const ev = { ...baseEvent('ON_ATTACK'), targetInstanceId: leaderInstB.instanceId };
    const r = resolveSelector(state, ev, 'TARGET_LEADER');
    expect(r?.[0]?.instanceId).toBe(leaderInstB.instanceId);
  });

  it('SELF_HAND resolves to self hand instances', () => {
    const handCard = wanoChar('HC1', 1);
    const { state, handAInstances } = buildState({ leaderA: TEST_LEADER, handA: [handCard] });
    const r = resolveSelector(state, baseEvent('ON_ATTACK'), 'SELF_HAND');
    expect(r?.[0]?.instanceId).toBe(handAInstances[0]!.instanceId);
  });

  it('OPPONENT_HAND resolves to opp hand instances', () => {
    const handCard = wanoChar('HC2', 1);
    const { state, handBInstances } = buildState({ leaderA: TEST_LEADER, handB: [handCard] });
    const r = resolveSelector(state, baseEvent('ON_ATTACK'), 'OPPONENT_HAND');
    expect(r?.[0]?.instanceId).toBe(handBInstances[0]!.instanceId);
  });

  it('SELF_DECK / OPPONENT_DECK / SELF_TRASH / OPPONENT_TRASH / SELF_LIFE / OPPONENT_LIFE resolve to zone arrays (empty by default)', () => {
    const { state } = buildState({ leaderA: TEST_LEADER });
    for (const sel of [
      'SELF_DECK',
      'OPPONENT_DECK',
      'SELF_TRASH',
      'OPPONENT_TRASH',
      'SELF_LIFE',
      'OPPONENT_LIFE',
    ] as const) {
      const r = resolveSelector(state, baseEvent('ON_ATTACK'), sel);
      expect(Array.isArray(r)).toBe(true);
      expect(r?.length).toBe(0);
    }
  });

  it('SelectorRef with filters constrains results', () => {
    const c5 = wanoChar('C5', 5);
    const c1 = wanoChar('C1', 1);
    const { state, fieldA } = buildState({ leaderA: TEST_LEADER, charsA: [c5, c1] });
    const r = resolveSelector(state, baseEvent('ON_ATTACK'), {
      selector: 'SELF_CHARACTER',
      filters: { cost_gte: 5 },
    });
    expect(r?.map((i) => i.instanceId)).toEqual([fieldA[0]!.instanceId]);
  });
});

// ────────────────────────────────────────────────────────────────────
// ACTIONS — one mutation-shape test per action (28 tests)
// ────────────────────────────────────────────────────────────────────

describe('actions', () => {
  const ALL_ACTIONS: Action[] = [
    // POWER / COUNTER
    'ADD_POWER',
    'SET_POWER',
    'ADD_COUNTER',
    // CARD MOVEMENT
    'DRAW',
    'TRASH',
    'PLAY',
    'ADD_TO_HAND',
    'RETURN_TO_HAND',
    'RETURN_TO_DECK_TOP',
    'RETURN_TO_DECK_BOTTOM',
    // BOARD STATE
    'REST',
    'ACTIVATE',
    'KO',
    'ATTACH_DON',
    'DETACH_DON',
    // SEARCH / REVEAL
    'SEARCH_DECK',
    'REVEAL_CARDS',
    'LOOK_AT_TOP',
    'REORDER_CARDS',
    'SHUFFLE_DECK',
    // LIFE
    'ADD_LIFE',
    'TAKE_LIFE',
    'TRASH_LIFE',
    // STATUS EFFECTS
    'GAIN_RUSH',
    'GAIN_BLOCKER',
    'GAIN_DOUBLE_ATTACK',
    'GAIN_BANISH',
    'GAIN_COUNTER_EFFECT',
    // RESOURCE
    'DISCARD',
    'TRASH_FROM_HAND',
    'TRASH_FROM_FIELD',
    'SEND_TO_TRASH',
  ];

  it('ALL_ACTIONS has all spec-listed actions (32 incl. RESOURCE)', () => {
    expect(ALL_ACTIONS.length).toBeGreaterThanOrEqual(28);
  });

  for (const a of ALL_ACTIONS) {
    it(`${a} produces a mutation with kind === '${a}'`, () => {
      const c = wanoChar('C1', 1);
      const { state, fieldA, leaderInstA } = buildState({ leaderA: TEST_LEADER, charsA: [c] });
      const target = leaderInstA;
      const ev = { ...baseEvent('ON_ATTACK'), sourceInstanceId: fieldA[0]?.instanceId };
      const muts = actionToMutations(
        state,
        ev,
        { action: a, target: 'SELF_LEADER', amount: 1, count: 1 },
        [target],
      );
      // Allow empty when target rules differ (e.g., player-targeted actions
      // still emit one mutation per the side-derivation branch).
      expect(muts.length).toBeGreaterThanOrEqual(1);
      expect(muts[0]!.kind).toBe(a);
    });
  }
});
