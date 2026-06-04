/**
 * Per-card semantic test — EB01-037 Mr. 9 (character).
 *
 * Printed text (cards.json):
 *   "[On Your Opponent's Attack] [Once Per Turn] DON!! −1: K.O. up to 1 of
 *    your opponent's Characters with a cost of 2 or less."
 *
 * 5-axis: on_opp_attack / cost donCostReturnToDeck:1 / removal_ko /
 *   target opp_character costMax:2 / opt:true.
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
  id: 'TEST_LEADER_EB037',
  name: 'TEST',
  kind: 'leader',
  colors: ['purple'],
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
    colors: ['purple'],
    cost,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-037 — Mr. 9 (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-037');
  if (eb === undefined) throw new Error('EB01-037 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-037 should be a character');
  const m9 = eb as CharacterCard;
  const clause = m9.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-037 missing clause');

  it('clause shape: on_opp_attack / donCostReturnToDeck:1 / removal_ko / opp_character costMax:2 / opt:true', () => {
    expect(clause.trigger).toBe('on_opp_attack');
    expect(clause.cost!['donCostReturnToDeck']).toBe(1);
    expect(clause.action.kind).toBe('removal_ko');
    expect(clause.target!.kind).toBe('opp_character');
    expect((clause.target as { filter: { costMax: number } }).filter.costMax).toBe(2);
    expect(clause.opt).toBe(true);
  });

  it('KOs cost-2 opp char and pays 1 DON to deck', () => {
    const opp = oppChar('TEST_OPP_C2', 2);
    const { state, fieldA, fieldB } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [m9],
      charsB: [opp],
    });
    const oppId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_opp_attack',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(false);
    expect(next.players.B.trash).toContain(oppId);
  });

  it('does NOT KO cost-3 opp char (filter exclude)', () => {
    const opp = oppChar('TEST_OPP_C3', 3);
    const { state, fieldA, fieldB } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [m9],
      charsB: [opp],
    });
    const oppId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_opp_attack',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(true);
  });

  it('second on_opp_attack same turn does not KO again (OPT)', () => {
    const opp1 = oppChar('TEST_OPP_KO1', 2);
    const opp2 = oppChar('TEST_OPP_KO2', 2);
    const { state, fieldA, fieldB } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [m9],
      charsB: [opp1, opp2],
    });
    const sId = fieldA[0]!.instanceId;
    const once = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: sId, controller: 'A' },
      'on_opp_attack',
    );
    const survivors1 = once.players.B.field.length;
    const twice = EffectDispatcher.dispatch(
      once,
      { sourceInstanceId: sId, controller: 'A' },
      'on_opp_attack',
    );
    expect(twice.players.B.field.length).toBe(survivors1);
  });
});
