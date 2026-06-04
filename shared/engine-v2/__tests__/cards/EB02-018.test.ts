/**
 * Per-card semantic test — EB02-018 Buggy (character).
 * "[On Play] If you have no other [Buggy] Characters, up to 1 of your
 *  Leader gains [Double Attack] during this turn."
 * Spec: on_play / if_no_other_with_name 'Buggy' / give_keyword double_attack this_turn / your_leader.
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
  id: 'TEST_L_EB02018', name: 'L', kind: 'leader', colors: ['green'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function otherBuggy(): CharacterCard {
  return {
    id: 'TEST_OTHER_BUGGY_E18', name: 'Buggy', kind: 'character', colors: ['green'],
    cost: 4, power: 6000, counterValue: 1000, traits: ['East Blue', 'Buggy Pirates'],
    keywords: [], effectTags: [],
  };
}

function nonBuggy(): CharacterCard {
  return {
    id: 'TEST_NON_BUGGY_E18', name: 'NotBuggy', kind: 'character', colors: ['green'],
    cost: 2, power: 2000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-018 — Buggy', () => {
  const c = loadCards().find((x) => x.id === 'EB02-018');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-018 invalid');
  const bug = c as CharacterCard;
  const clause = bug.effectSpecV2!.clauses![0]!;

  it('shape: on_play / if_no_other_with_name Buggy / give_keyword double_attack this_turn / your_leader', () => {
    expect(clause.trigger).toBe('on_play');
    expect((clause.condition as { type: string; name: string }).type).toBe('if_no_other_with_name');
    expect((clause.condition as { type: string; name: string }).name).toBe('Buggy');
    expect(clause.action.kind).toBe('give_keyword');
    expect((clause.action as { keyword: string; duration: string }).keyword).toBe('double_attack');
    expect((clause.action as { keyword: string; duration: string }).duration).toBe('this_turn');
    expect(clause.target!.kind).toBe('your_leader');
  });

  it('no other Buggy on field: leader gains double_attack this turn', () => {
    const { state, fieldA, leaderInstA } = buildState({ leaderA: L, charsA: [bug] });
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    const grants = next.instances[leaderInstA.instanceId]!.grantedKeywordsOneShot ?? [];
    expect(grants.some((g) => g.keyword === 'double_attack')).toBe(true);
  });

  it('another Buggy on field: condition fail → leader does NOT gain double_attack', () => {
    const ob = otherBuggy();
    const { state, fieldA, leaderInstA } = buildState({ leaderA: L, charsA: [bug, ob] });
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    const grants = next.instances[leaderInstA.instanceId]!.grantedKeywordsOneShot ?? [];
    expect(grants.some((g) => g.keyword === 'double_attack')).toBe(false);
  });

  it('non-Buggy ally on field: condition holds → leader gains double_attack', () => {
    const nb = nonBuggy();
    const { state, fieldA, leaderInstA } = buildState({ leaderA: L, charsA: [bug, nb] });
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    const grants = next.instances[leaderInstA.instanceId]!.grantedKeywordsOneShot ?? [];
    expect(grants.some((g) => g.keyword === 'double_attack')).toBe(true);
  });
});
