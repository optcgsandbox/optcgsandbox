/**
 * Per-card semantic test — EB02-049 Monkey.D.Garp (character).
 * "[On Play] Give up to 2 rested DON!! cards to 1 of your Leader.
 *  [Activate: Main] You may rest this Character: If your Leader is
 *  [Monkey.D.Garp], K.O. up to 1 of your opponent's Characters with a cost
 *  of 1 or less."
 * Spec: 2 clauses:
 *   1) on_play / give_don_to_target magnitude:2 rested:true / your_leader
 *   2) activate_main / restSelf / if_leader_is Monkey.D.Garp / removal_ko / opp_character costMax:1
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

const GARP_LEADER: LeaderCard = {
  id: 'TEST_GARP_LEADER_E49', name: 'Monkey.D.Garp', kind: 'leader',
  colors: ['black'], cost: null, power: 5000, life: 5, counterValue: null,
  traits: ['Navy'], keywords: [], effectTags: [],
};

const OTHER_LEADER: LeaderCard = {
  id: 'TEST_OTHER_L_E49', name: 'NotGarp', kind: 'leader',
  colors: ['black'], cost: null, power: 5000, life: 5, counterValue: null,
  traits: [], keywords: [], effectTags: [],
};

function opp(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['black'], cost, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-049 — Monkey.D.Garp', () => {
  const c = loadCards().find((x) => x.id === 'EB02-049');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-049 invalid');
  const g = c as CharacterCard;
  const clauses = g.effectSpecV2!.clauses!;

  it('shape: 2 clauses [on_play give_don_to_target 2 rested your_leader, activate_main restSelf if_leader_is Garp removal_ko opp_character costMax:1]', () => {
    expect(clauses).toHaveLength(2);
    expect(clauses[0]!.trigger).toBe('on_play');
    expect(clauses[0]!.action.kind).toBe('give_don_to_target');
    expect((clauses[0]!.action as { magnitude: number; rested: boolean }).magnitude).toBe(2);
    expect((clauses[0]!.action as { magnitude: number; rested: boolean }).rested).toBe(true);
    expect(clauses[0]!.target!.kind).toBe('your_leader');
    expect(clauses[1]!.trigger).toBe('activate_main');
    expect(clauses[1]!.cost!['restSelf']).toBe(true);
    expect((clauses[1]!.condition as { type: string; name: string }).type).toBe('if_leader_is');
    expect((clauses[1]!.condition as { type: string; name: string }).name).toBe('Monkey.D.Garp');
    expect(clauses[1]!.action.kind).toBe('removal_ko');
    expect((clauses[1]!.target as { kind: string; filter: { costMax: number } }).kind).toBe('opp_character');
    expect((clauses[1]!.target as { kind: string; filter: { costMax: number } }).filter.costMax).toBe(1);
  });

  it('on_play: 2 rested DON given to leader', () => {
    const { state, fieldA, leaderInstA } = buildState({ leaderA: GARP_LEADER, charsA: [g] });
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.instances[leaderInstA.instanceId]!.attachedDonRested?.length ?? 0).toBe(2);
  });

  it('activate_main: Garp leader + cost-1 opp char → KO + self rested', () => {
    const target = opp('TEST_OPP_C1_E49', 1);
    const { state, fieldA, fieldB } = buildState({
      leaderA: GARP_LEADER, charsA: [g], charsB: [target],
    });
    const garpId = fieldA[0]!.instanceId;
    const oppId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: garpId, controller: 'A' }, 'activate_main',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(false);
    expect(next.players.B.trash).toContain(oppId);
    expect(next.instances[garpId]!.rested).toBe(true);
  });

  it('activate_main: non-Garp leader → condition fail (no KO)', () => {
    const target = opp('TEST_OPP_NON_GARP_E49', 1);
    const { state, fieldA, fieldB } = buildState({
      leaderA: OTHER_LEADER, charsA: [g], charsB: [target],
    });
    const oppId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'activate_main',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(true);
  });

  it('activate_main: cost-2 opp char → filter exclude (costMax)', () => {
    const big = opp('TEST_OPP_C2_E49', 2);
    const { state, fieldA, fieldB } = buildState({
      leaderA: GARP_LEADER, charsA: [g], charsB: [big],
    });
    const oppId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'activate_main',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(true);
  });
});
