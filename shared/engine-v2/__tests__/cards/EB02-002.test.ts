/**
 * Per-card semantic test — EB02-002 Sabo (character).
 * "[Activate: Main] You may rest this Character: Up to 1 of your
 *  {Revolutionary Army} type Characters other than [Sabo] gains +2000
 *  power during this turn."
 * Spec: activate_main / restSelf / power_buff +2000 this_turn /
 *   your_character filter{trait:Revolutionary Army, nameExcludes:Sabo}.
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
  id: 'TEST_L_EB02002', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function raCharacter(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost: 3, power: 4000,
    counterValue: 1000, traits: ['Revolutionary Army'], keywords: [], effectTags: [],
  };
}

describe('EB02-002 — Sabo', () => {
  const c = loadCards().find((x) => x.id === 'EB02-002');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-002 invalid');
  const sabo = c as CharacterCard;
  const clause = sabo.effectSpecV2!.clauses![0]!;

  it('shape: activate_main / restSelf / power_buff +2000 this_turn / your_character RA, nameExcludes:Sabo', () => {
    expect(clause.trigger).toBe('activate_main');
    expect(clause.cost!['restSelf']).toBe(true);
    expect(clause.action.kind).toBe('power_buff');
    expect((clause.action as { magnitude: number; duration: string }).magnitude).toBe(2000);
    expect((clause.action as { magnitude: number; duration: string }).duration).toBe('this_turn');
    expect((clause.target as { filter: { trait: string; nameExcludes: string } }).filter.trait).toBe('Revolutionary Army');
    expect((clause.target as { filter: { trait: string; nameExcludes: string } }).filter.nameExcludes).toBe('Sabo');
  });

  it('cannot fire when Sabo already rested (restSelf cost unpayable)', () => {
    const ally = raCharacter('TEST_RA_ALLY_RESTED');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sabo, ally] });
    const sId = fieldA[0]!.instanceId;
    const aId = fieldA[1]!.instanceId;
    state.instances[sId]!.rested = true;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: sId, controller: 'A' }, 'activate_main',
    );
    expect(next.instances[aId]!.powerModifierOneShot ?? 0).toBe(0);
  });

  it('non-RA ally is NOT buffed (filter trait excludes)', () => {
    const nonRA: CharacterCard = {
      id: 'TEST_NON_RA',
      name: 'NonRA',
      kind: 'character',
      colors: ['red'],
      cost: 3,
      power: 4000,
      counterValue: 1000,
      traits: ['Other'],
      keywords: [],
      effectTags: [],
    };
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sabo, nonRA] });
    const sId = fieldA[0]!.instanceId;
    const aId = fieldA[1]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: sId, controller: 'A' }, 'activate_main',
    );
    expect(next.instances[aId]!.powerModifierOneShot ?? 0).toBe(0);
  });

  it('Sabo himself is NOT buffed (nameExcludes:Sabo)', () => {
    const ally = raCharacter('TEST_RA_ALLY_SAFE');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sabo, ally] });
    const sId = fieldA[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: sId, controller: 'A' }, 'activate_main',
    );
    expect(next.instances[sId]!.powerModifierOneShot ?? 0).toBe(0);
  });

  it('rests Sabo + buffs another RA char +2000 this_turn', () => {
    const ally = raCharacter('TEST_RA_ALLY');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sabo, ally] });
    const sId = fieldA[0]!.instanceId;
    const aId = fieldA[1]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: sId, controller: 'A' }, 'activate_main',
    );
    expect(next.instances[sId]!.rested).toBe(true);
    expect(next.instances[aId]!.powerModifierOneShot ?? 0).toBe(2000);
  });
});
