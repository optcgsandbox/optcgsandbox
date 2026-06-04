/**
 * Per-card semantic test — EB02-019 Roronoa Zoro (character).
 * "If your opponent has 2 or more Characters, this Character can attack
 *  Characters on the turn in which it is played.
 *  [On Play] If your Leader has the {Straw Hat Crew} type, rest up to 1
 *  of your opponent's Characters with a cost of 4 or less."
 * Spec:
 *   • Clause on_play / if_leader_has_trait SH / rest_target / opp_character costMax:4.
 *   • Continuous if_opp_chars_min 2 / grant_keyword_to_self 'rush_character'.
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

const SH_LEADER: LeaderCard = {
  id: 'TEST_SH_L_EB02019', name: 'L', kind: 'leader', colors: ['green'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
};

const NON_SH_LEADER: LeaderCard = {
  id: 'TEST_NON_SH_L_EB02019', name: 'L', kind: 'leader', colors: ['green'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: ['Animal'], keywords: [], effectTags: [],
};

function opp(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['green'], cost, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-019 — Roronoa Zoro', () => {
  const c = loadCards().find((x) => x.id === 'EB02-019');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-019 invalid');
  const zoro = c as CharacterCard;
  const clause = zoro.effectSpecV2!.clauses![0]!;
  const cont = zoro.effectSpecV2!.continuous![0]!;

  it('clause shape: on_play / SH / rest_target / opp_character costMax:4', () => {
    expect(clause.trigger).toBe('on_play');
    expect((clause.condition as { type: string; trait: string }).type).toBe('if_leader_has_trait');
    expect((clause.condition as { type: string; trait: string }).trait).toBe('Straw Hat Crew');
    expect(clause.action.kind).toBe('rest_target');
    expect((clause.target as { kind: string; filter: { costMax: number } }).kind).toBe('opp_character');
    expect((clause.target as { kind: string; filter: { costMax: number } }).filter.costMax).toBe(4);
  });

  it('continuous shape: if_opp_chars_min 2 / grant_keyword_to_self rush_character', () => {
    expect((cont.condition as { type: string; n: number }).type).toBe('if_opp_chars_min');
    expect((cont.condition as { type: string; n: number }).n).toBe(2);
    expect(cont.action.kind).toBe('grant_keyword_to_self');
    expect((cont.action as { keyword: string }).keyword).toBe('rush_character');
  });

  it('SH leader + cost-4 opp char: rested', () => {
    const o = opp('TEST_OPP_REST_E19', 4);
    const { state, fieldA, fieldB } = buildState({
      leaderA: SH_LEADER, charsA: [zoro], charsB: [o],
    });
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.instances[oId]!.rested).toBe(true);
  });

  it('non-SH leader + cost-4 opp char: condition fail → NOT rested', () => {
    const o = opp('TEST_OPP_NON_SH_E19', 4);
    const { state, fieldA, fieldB } = buildState({
      leaderA: NON_SH_LEADER, charsA: [zoro], charsB: [o],
    });
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.instances[oId]!.rested).toBe(false);
  });

  it('SH leader + cost-5 opp char: filter exclude → NOT rested', () => {
    const o = opp('TEST_OPP_BIG_E19', 5);
    const { state, fieldA, fieldB } = buildState({
      leaderA: SH_LEADER, charsA: [zoro], charsB: [o],
    });
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.instances[oId]!.rested).toBe(false);
  });

  it('continuous: 2+ opp chars → rush_character granted', () => {
    const o1 = opp('TEST_O1_E19', 1);
    const o2 = opp('TEST_O2_E19', 1);
    const { state, fieldA } = buildState({
      leaderA: SH_LEADER, charsA: [zoro], charsB: [o1, o2],
    });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('rush_character');
  });

  it('continuous: 1 opp char → rush_character NOT granted', () => {
    const o1 = opp('TEST_ONE_OPP_E19', 1);
    const { state, fieldA } = buildState({
      leaderA: SH_LEADER, charsA: [zoro], charsB: [o1],
    });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).not.toContain('rush_character');
  });
});
