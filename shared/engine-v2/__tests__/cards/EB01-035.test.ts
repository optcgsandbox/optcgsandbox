/**
 * Per-card semantic test — EB01-035 Ms. Monday (character).
 *
 * Printed text (cards.json):
 *   "[On Play] If your Leader's type includes "Baroque Works", up to 1 of
 *    your Leader or Character cards gains +1000 power during this turn."
 *
 * 5-axis: clause on_play, condition if_leader_has_type 'Baroque Works',
 *   action power_buff magnitude:1000 duration:this_turn, target
 *   your_leader_or_character.
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

const BW_LEADER: LeaderCard = {
  id: 'TEST_BW_LEADER_35',
  name: 'TEST',
  kind: 'leader',
  colors: ['purple'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Baroque Works'],
  keywords: [],
  effectTags: [],
};

const NON_BW_LEADER: LeaderCard = {
  id: 'TEST_NONBW_LEADER_35',
  name: 'TEST',
  kind: 'leader',
  colors: ['purple'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Other'],
  keywords: [],
  effectTags: [],
};

describe('EB01-035 — Ms. Monday (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-035');
  if (eb === undefined) throw new Error('EB01-035 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-035 should be a character');
  const monday = eb as CharacterCard;
  const clause = monday.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-035 missing clause');

  it('clause shape: on_play / Baroque Works / power_buff +1000 this_turn / your_leader_or_character', () => {
    expect(clause.trigger).toBe('on_play');
    expect((clause.condition as { typeString: string }).typeString).toBe('Baroque Works');
    expect(clause.action.kind).toBe('power_buff');
    expect((clause.action as { magnitude: number; duration: string }).magnitude).toBe(1000);
    expect((clause.action as { magnitude: number; duration: string }).duration).toBe('this_turn');
    expect(clause.target!.kind).toBe('your_leader_or_character');
  });

  it('with Baroque Works leader: leader gets +1000 this turn (powerModifierOneShot bucket)', () => {
    const { state, fieldA, leaderInstA } = buildState({
      leaderA: BW_LEADER,
      charsA: [monday],
    });
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_play',
    );
    expect(next.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0).toBe(1000);
  });

  it('without Baroque Works leader: no buff (condition false)', () => {
    const { state, fieldA, leaderInstA } = buildState({
      leaderA: NON_BW_LEADER,
      charsA: [monday],
    });
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_play',
    );
    expect(next.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0).toBe(0);
  });
});
