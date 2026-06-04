/**
 * Per-card semantic test — EB01-048 Laboon (character, 4c/5000p).
 *
 * Printed text (cards.json):
 *   "[Activate: Main] You may rest this Character: Give up to 1 of your
 *    opponent's Characters −4 cost during this turn."
 *
 * 5-axis: activate_main / cost restSelf / removal_cost_reduce magnitude:4
 *   duration:this_turn / target opp_character.
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

const VANILLA_LEADER: LeaderCard = {
  id: 'TEST_LEADER_EB048',
  name: 'TEST',
  kind: 'leader',
  colors: ['black'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

function oppChar(id: string, cost: number): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['black'],
    cost,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-048 — Laboon 4c (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-048');
  if (eb === undefined) throw new Error('EB01-048 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-048 should be a character');
  const lab = eb as CharacterCard;
  const clause = lab.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-048 missing clause');

  it('clause shape: activate_main / restSelf / removal_cost_reduce 4 this_turn / opp_character', () => {
    expect(clause.trigger).toBe('activate_main');
    expect(clause.cost!['restSelf']).toBe(true);
    expect(clause.action.kind).toBe('removal_cost_reduce');
    expect((clause.action as { magnitude: number }).magnitude).toBe(4);
    expect((clause.action as { duration: string }).duration).toBe('this_turn');
    expect(clause.target!.kind).toBe('opp_character');
  });

  it('rests Laboon and reduces opp char cost by 4 this turn', () => {
    const opp = oppChar('TEST_OPP_REDUCE_48', 6);
    const { state, fieldA, fieldB } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [lab],
      charsB: [opp],
    });
    const sId = fieldA[0]!.instanceId;
    const oppId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: sId, controller: 'A' },
      'activate_main',
    );
    expect(next.instances[sId]!.rested).toBe(true);
    const r = next.instances[oppId]!;
    const costMod = (r.costModifierThisTurn ?? 0)
      + (r.costModifierOneShot ?? 0)
      + (r.costModifierContinuous ?? 0);
    expect(costMod).toBe(-4);
  });

  it('cannot fire when Laboon is already rested (restSelf cost unpayable)', () => {
    const opp = oppChar('TEST_OPP_RESTED', 6);
    const { state, fieldA, fieldB } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [lab],
      charsB: [opp],
    });
    const sId = fieldA[0]!.instanceId;
    const oppId = fieldB[0]!.instanceId;
    state.instances[sId]!.rested = true;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: sId, controller: 'A' },
      'activate_main',
    );
    const r = next.instances[oppId]!;
    const costMod = (r.costModifierThisTurn ?? 0)
      + (r.costModifierOneShot ?? 0)
      + (r.costModifierContinuous ?? 0);
    expect(costMod).toBe(0);
  });
});
