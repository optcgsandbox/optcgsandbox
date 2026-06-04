/**
 * Per-card semantic test — EB01-061 Mr.2.Bon.Kurei (Bentham) (character).
 * "[On Play] Add up to 1 DON!! card from your DON!! deck and set it as
 *  active.
 *  [When Attacking] Select up to 1 of your opponent's Characters. This
 *  Character's base power becomes the same as the selected Character's
 *  power during this turn."
 * Spec: TWO clauses:
 *   1) on_play / ramp magnitude:1
 *   2) when_attacking / set_base_power_copy_from_target duration:this_turn /
 *      opp_character
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
  id: 'TEST_L_EB061', name: 'L', kind: 'leader', colors: ['purple'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function opp(id: string, power: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['purple'], cost: 3, power,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB01-061 — Mr.2 Bentham', () => {
  const c = loadCards().find((x) => x.id === 'EB01-061');
  if (c === undefined || c.kind !== 'character') throw new Error('EB01-061 invalid');
  const bon = c as CharacterCard;
  const clauses = bon.effectSpecV2!.clauses!;

  it('shape: 2 clauses [on_play/ramp 1, when_attacking/set_base_power_copy_from_target this_turn opp_character]', () => {
    expect(clauses).toHaveLength(2);
    expect(clauses[0]!.trigger).toBe('on_play');
    expect(clauses[0]!.action.kind).toBe('ramp');
    expect(clauses[1]!.trigger).toBe('when_attacking');
    expect(clauses[1]!.action.kind).toBe('set_base_power_copy_from_target');
    expect((clauses[1]!.action as { duration: string }).duration).toBe('this_turn');
    expect(clauses[1]!.target!.kind).toBe('opp_character');
  });

  it('on_play: ramps +1 active DON', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [bon] });
    // Pre-seed donDeck.
    const did = 'A-DON-RAMP-61';
    state.instances[did] = {
      instanceId: did, cardId: '__DON', controller: 'A',
      rested: false, summoningSick: false, attachedDon: [],
      attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    state.players.A.donDeck.push(did);
    const beforeActive = state.players.A.donCostArea.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.donCostArea.length).toBe(beforeActive + 1);
  });

  it('when_attacking: copies opp char power onto Bentham this_turn', () => {
    const o = opp('TEST_OPP_PWR_61', 8000);
    const { state, fieldA, fieldB } = buildState({ leaderA: L, charsA: [bon], charsB: [o] });
    const bonId = fieldA[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: bonId, controller: 'A' }, 'when_attacking',
    );
    const inst = next.instances[bonId]!;
    expect(inst.basePowerOverrideOneShot).toBe(8000);
  });
});
