/**
 * Per-card semantic test — EB02-015 Jewelry Bonney (character).
 * "[On Play] Up to 1 of your opponent's rested Characters will not become
 *  active in your opponent's next Refresh Phase. Then, set up to 1 of your
 *  DON!! cards as active at the end of this turn."
 * Spec: on_play / sequence[rest_lock_until_phase target opp_character{rested:true} until:opp_next_end_phase,
 *                          schedule_at_end_of_own_turn action{set_active_don 1}].
 *
 * Sub-action targets gap (re-ref EB01-046 BUGS_FOUND.md): sequence inner
 * action carries its own target field which the dispatcher may not resolve.
 * Behavioral positive uses it.fails.
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
  id: 'TEST_L_EB02015', name: 'L', kind: 'leader', colors: ['green'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function oppChar(id: string, rested: boolean): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['green'], cost: 3, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-015 — Jewelry Bonney', () => {
  const c = loadCards().find((x) => x.id === 'EB02-015');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-015 invalid');
  const bonney = c as CharacterCard;
  const clause = bonney.effectSpecV2!.clauses![0]!;

  it('shape: on_play / sequence[rest_lock_until_phase opp_character{rested:true} opp_next_end_phase, schedule_at_end_of_own_turn{set_active_don 1}]', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('sequence');
    const seq = clause.action as { actions: ReadonlyArray<Record<string, unknown>> };
    expect(seq.actions[0]!['kind']).toBe('rest_lock_until_phase');
    expect((seq.actions[0]!['target'] as { kind: string; filter: { rested: boolean } }).kind).toBe('opp_character');
    expect((seq.actions[0]!['target'] as { kind: string; filter: { rested: boolean } }).filter.rested).toBe(true);
    expect(seq.actions[0]!['until']).toBe('opp_next_end_phase');
    expect(seq.actions[1]!['kind']).toBe('schedule_at_end_of_own_turn');
    expect((seq.actions[1]!['action'] as { kind: string; magnitude: number }).kind).toBe('set_active_don');
    expect((seq.actions[1]!['action'] as { kind: string; magnitude: number }).magnitude).toBe(1);
  });

  it('active opp char (filter exclude): NOT rest-locked even if dispatch fires', () => {
    const active = oppChar('TEST_ACTIVE_OPP_E15', false);
    const { state, fieldA, fieldB } = buildState({
      leaderA: L, charsA: [bonney], charsB: [active],
    });
    state.instances[fieldB[0]!.instanceId]!.rested = false;
    const oppId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.instances[oppId]!.restLockedUntilTurn).toBeUndefined();
  });

  it(
    'rested opp char becomes rest-locked (closes cluster-B engine gap)',
    () => {
      const rested = oppChar('TEST_RESTED_OPP_E15', true);
      const { state, fieldA, fieldB } = buildState({
        leaderA: L, charsA: [bonney], charsB: [rested],
      });
      state.instances[fieldB[0]!.instanceId]!.rested = true;
      const oppId = fieldB[0]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
      );
      expect(next.instances[oppId]!.restLockedUntilTurn).toBeDefined();
    },
  );
});
