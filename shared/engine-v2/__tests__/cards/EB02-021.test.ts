/**
 * Per-card semantic test — EB02-021 Gum-Gum Giant Pistol ([Main] event).
 * "[Main] Up to 1 of your {Straw Hat Crew} type Characters gains +6000
 *  power during this turn. Then, the selected Character will not become
 *  active in your next Refresh Phase."
 * Spec: on_play / sequence[power_buff +6000 this_turn, rest_lock_until_phase opp_next_end_phase] /
 *   your_character SH.
 *
 * Note on duration enum: printed text says "your next Refresh Phase" (own),
 * but the engine EffectDuration enum (state/types.ts:34-39) lacks an
 * 'own_next_refresh_end' value — `opp_next_end_phase` is the closest enum
 * match. End-to-end refresh-skip behavior depends on the engine honoring
 * the lock flag at refresh time; PhaseScheduler.enterRefresh currently
 * blindly flips rested→active without checking restLockedUntilTurn.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, EventCard, LeaderCard } from '../../cards/Card.js';
import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';

import { buildState, makeInst } from './_fixtures.js';

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
  id: 'TEST_L_EB02021', name: 'L', kind: 'leader', colors: ['green'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function shAlly(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['green'], cost: 3, power: 3000,
    counterValue: 1000, traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
  };
}

function nonSh(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['green'], cost: 3, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-021 — Gum-Gum Giant Pistol', () => {
  const c = loadCards().find((x) => x.id === 'EB02-021');
  if (c === undefined || c.kind !== 'event') throw new Error('EB02-021 invalid');
  const ev = c as EventCard;
  const clause = ev.effectSpecV2!.clauses![0]!;

  function attach(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[ev.id] = ev;
    const inst = makeInst(ev.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('shape: on_play / sequence[power_buff +6000 this_turn, rest_lock_until_phase opp_next_end_phase] / your_character SH', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('sequence');
    const seq = clause.action as { actions: ReadonlyArray<Record<string, unknown>> };
    expect(seq.actions[0]!['kind']).toBe('power_buff');
    expect(seq.actions[0]!['magnitude']).toBe(6000);
    expect(seq.actions[0]!['duration']).toBe('this_turn');
    expect(seq.actions[1]!['kind']).toBe('rest_lock_until_phase');
    expect(seq.actions[1]!['until']).toBe('opp_next_end_phase');
    expect((clause.target as { kind: string; filter: { trait: string } }).kind).toBe('your_character');
    expect((clause.target as { kind: string; filter: { trait: string } }).filter.trait).toBe('Straw Hat Crew');
  });

  it('SH ally: +6000 power_buff this_turn AND rest-locked', () => {
    const ally = shAlly('TEST_SH_TARGET_E21');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [ally] });
    const aId = fieldA[0]!.instanceId;
    const srcId = attach(state);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.instances[aId]!.powerModifierOneShot).toBe(6000);
    expect(next.instances[aId]!.restLockedUntilTurn).toBeDefined();
  });

  it('non-SH ally: filter excludes → no buff, no rest-lock', () => {
    const other = nonSh('TEST_NON_SH_E21');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [other] });
    const oId = fieldA[0]!.instanceId;
    const srcId = attach(state);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.instances[oId]!.powerModifierOneShot ?? 0).toBe(0);
    expect(next.instances[oId]!.restLockedUntilTurn).toBeUndefined();
  });
});
