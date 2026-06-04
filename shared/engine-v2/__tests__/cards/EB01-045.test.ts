/**
 * Per-card semantic test — EB01-045 Brook (character).
 *
 * Printed text (cards.json):
 *   "[On Play] If your opponent has a Character with a cost of 0, this
 *    Character gains [Rush] during this turn."
 *
 * 5-axis: on_play / condition if_opp_chars_max_cost {n:1, maxCost:0} /
 *   action give_keyword 'rush' duration this_turn / target self.
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
  id: 'TEST_LEADER_EB045',
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

function zeroCostChar(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['black'],
    cost: 0,
    power: 1000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

function nonZeroCostChar(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['black'],
    cost: 3,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-045 — Brook (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-045');
  if (eb === undefined) throw new Error('EB01-045 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-045 should be a character');
  const brook = eb as CharacterCard;
  const clause = brook.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-045 missing clause');

  it('clause shape: on_play / if_opp_chars_max_cost{n:1, maxCost:0} / give_keyword rush this_turn / self', () => {
    expect(clause.trigger).toBe('on_play');
    const cond = clause.condition as { type: string; n: number; maxCost: number };
    expect(cond.type).toBe('if_opp_chars_max_cost');
    expect(cond.n).toBe(1);
    expect(cond.maxCost).toBe(0);
    expect(clause.action.kind).toBe('give_keyword');
    expect((clause.action as { keyword: string; duration: string }).keyword).toBe('rush');
    expect((clause.action as { keyword: string; duration: string }).duration).toBe('this_turn');
    expect(clause.target!.kind).toBe('self');
  });

  it('with cost-0 opp char on field: Brook gains rush this turn (grantedKeywordsOneShot)', () => {
    const opp = zeroCostChar('TEST_OPP_C0');
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [brook],
      charsB: [opp],
    });
    const bId = fieldA[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: bId, controller: 'A' },
      'on_play',
    );
    const grants = next.instances[bId]!.grantedKeywordsOneShot ?? [];
    expect(grants.some((g) => g.keyword === 'rush')).toBe(true);
  });

  it('without cost-0 opp char: no keyword granted (condition false)', () => {
    const opp = nonZeroCostChar('TEST_OPP_C3');
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [brook],
      charsB: [opp],
    });
    const bId = fieldA[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: bId, controller: 'A' },
      'on_play',
    );
    const grants = next.instances[bId]!.grantedKeywordsOneShot ?? [];
    expect(grants.some((g) => g.keyword === 'rush')).toBe(false);
  });
});
