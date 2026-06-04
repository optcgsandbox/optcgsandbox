/**
 * Per-card semantic test — EB02-007 Cloven Rose Blizzard ([Main] event).
 * "[Main] Up to a total of 3 of your Leader and Character cards gain +1000
 *  power during this turn. Then, K.O. up to 1 of your opponent's Characters
 *  with 3000 power or less."
 * Spec: 2 on_play clauses:
 *   1) power_buff +1000 this_turn / your_leader_or_character count:3
 *   2) removal_ko / opp_character powerMax:3000
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
  id: 'TEST_L_EB02007', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function opp(id: string, power: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost: 3, power,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-007 — Cloven Rose Blizzard', () => {
  const c = loadCards().find((x) => x.id === 'EB02-007');
  if (c === undefined || c.kind !== 'event') throw new Error('EB02-007 invalid');
  const ev = c as EventCard;
  const clauses = ev.effectSpecV2!.clauses!;

  function attach(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[ev.id] = ev;
    const inst = makeInst(ev.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('shape: 2 clauses [power_buff +1000 this_turn target.count:3, removal_ko opp_character powerMax:3000]', () => {
    expect(clauses).toHaveLength(2);
    expect(clauses[0]!.action.kind).toBe('power_buff');
    expect((clauses[0]!.target as { count: number; kind: string }).count).toBe(3);
    expect((clauses[0]!.target as { count: number; kind: string }).kind).toBe('your_leader_or_character');
    expect(clauses[1]!.action.kind).toBe('removal_ko');
    expect((clauses[1]!.target as { filter: { powerMax: number } }).filter.powerMax).toBe(3000);
  });

  it('KOs power-3000 opp char; leader gets +1000', () => {
    const o = opp('TEST_OPP_PWR_3000', 3000);
    const { state, leaderInstA, fieldB } = buildState({ leaderA: L, charsB: [o] });
    const srcId = attach(state);
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0).toBe(1000);
    expect(next.players.B.field.some((i) => i.instanceId === oId)).toBe(false);
    expect(next.players.B.trash).toContain(oId);
  });

  it('does NOT KO power-4000 opp char (powerMax exclude)', () => {
    const o = opp('TEST_OPP_PWR_4000', 4000);
    const { state, fieldB } = buildState({ leaderA: L, charsB: [o] });
    const srcId = attach(state);
    const oId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oId)).toBe(true);
  });
});
