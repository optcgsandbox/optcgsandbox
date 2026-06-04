/**
 * Per-card semantic test — EB01-044 Funkfreed (character).
 *
 * Printed text (cards.json):
 *   "[Activate: Main] You may rest this Character: Up to 1 of your [Spandam]
 *    Characters gains +3000 power during this turn."
 *
 * 5-axis: activate_main / cost restSelf / power_buff +3000 this_turn /
 *   your_character filter{nameIs:'Spandam'}.
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
  id: 'TEST_LEADER_EB044',
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

function spandamChar(): CharacterCard {
  return {
    id: 'TEST_SPANDAM',
    name: 'Spandam',
    kind: 'character',
    colors: ['black'],
    cost: 3,
    power: 3000,
    counterValue: 1000,
    traits: ['CP9'],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-044 — Funkfreed (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-044');
  if (eb === undefined) throw new Error('EB01-044 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-044 should be a character');
  const fk = eb as CharacterCard;
  const clause = fk.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-044 missing clause');

  it('clause shape: activate_main / restSelf / power_buff +3000 this_turn / your_character nameIs:Spandam', () => {
    expect(clause.trigger).toBe('activate_main');
    expect(clause.cost!['restSelf']).toBe(true);
    expect(clause.action.kind).toBe('power_buff');
    expect((clause.action as { magnitude: number; duration: string }).magnitude).toBe(3000);
    expect((clause.action as { magnitude: number; duration: string }).duration).toBe('this_turn');
    expect(clause.target!.kind).toBe('your_character');
    expect((clause.target as { filter: { nameIs: string } }).filter.nameIs).toBe('Spandam');
  });

  it('rests Funkfreed and buffs Spandam +3000 this_turn (powerModifierOneShot)', () => {
    const spand = spandamChar();
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [fk, spand],
    });
    const fkId = fieldA[0]!.instanceId;
    const spandId = fieldA[1]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fkId, controller: 'A' },
      'activate_main',
    );
    expect(next.instances[fkId]!.rested).toBe(true);
    expect(next.instances[spandId]!.powerModifierOneShot ?? 0).toBe(3000);
  });

  it('does NOT buff a non-Spandam ally (filter nameIs:Spandam excludes)', () => {
    const nonSpand: CharacterCard = {
      id: 'TEST_NOT_SPANDAM',
      name: 'NotSpandam',
      kind: 'character',
      colors: ['black'],
      cost: 3,
      power: 3000,
      counterValue: 1000,
      traits: ['CP9'],
      keywords: [],
      effectTags: [],
    };
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [fk, nonSpand],
    });
    const fkId = fieldA[0]!.instanceId;
    const allyId = fieldA[1]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fkId, controller: 'A' },
      'activate_main',
    );
    expect(next.instances[allyId]!.powerModifierOneShot ?? 0).toBe(0);
  });

  it('cannot fire when Funkfreed is already rested (restSelf cost unpayable)', () => {
    const spand = spandamChar();
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [fk, spand],
    });
    const fkId = fieldA[0]!.instanceId;
    const spandId = fieldA[1]!.instanceId;
    state.instances[fkId]!.rested = true;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fkId, controller: 'A' },
      'activate_main',
    );
    // Cost cannot pay → action does not fire.
    expect(next.instances[spandId]!.powerModifierOneShot ?? 0).toBe(0);
  });
});
