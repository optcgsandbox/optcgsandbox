/**
 * Per-card semantic test — EB01-059 Kingdom Come ([Main] event).
 * "[Main] K.O. up to 1 of your opponent's Characters. Then, trash cards
 *  from the top of your Life cards until you have 1 Life card."
 * Spec: TWO on_play clauses:
 *   1) removal_ko / opp_character
 *   2) trash_own_life_until n:1
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
  id: 'TEST_L_EB059', name: 'L', kind: 'leader', colors: ['yellow'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function opp(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['yellow'], cost: 5, power: 5000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

function seedLife(state: ReturnType<typeof buildState>['state'], n: number): void {
  for (let i = 0; i < n; i++) {
    const id = `A-LIFE-59-${i}`;
    state.instances[id] = makeInst('__VANILLA', 'A');
    state.instances[id].instanceId = id;
    state.players.A.life.push(id);
  }
}

describe('EB01-059 — Kingdom Come', () => {
  const c = loadCards().find((x) => x.id === 'EB01-059');
  if (c === undefined || c.kind !== 'event') throw new Error('EB01-059 invalid');
  const ev = c as EventCard;
  const clauses = ev.effectSpecV2!.clauses!;

  function attach(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[ev.id] = ev;
    const inst = makeInst(ev.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('shape: two on_play clauses [removal_ko opp_character, trash_own_life_until n:1]', () => {
    expect(clauses).toHaveLength(2);
    expect(clauses[0]!.action.kind).toBe('removal_ko');
    expect(clauses[0]!.target!.kind).toBe('opp_character');
    expect(clauses[1]!.action.kind).toBe('trash_own_life_until');
    expect((clauses[1]!.action as { n: number }).n).toBe(1);
  });

  it('clause 1 (removal_ko) fires: opp char KOed', () => {
    const o = opp('TEST_OPP_KO_59');
    const { state, fieldB } = buildState({ leaderA: L, charsB: [o] });
    seedLife(state, 4);
    const oId = fieldB[0]!.instanceId;
    const srcId = attach(state);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oId)).toBe(false);
    expect(next.players.B.trash).toContain(oId);
  });

  it(
    'clause 2 (trash_own_life_until) trims life to 1 — printed "until you have 1 Life card" — closes cluster-D engine gap',
    () => {
      const { state } = buildState({ leaderA: L });
      seedLife(state, 4);
      const srcId = attach(state);
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
      );
      expect(next.players.A.life.length).toBe(1);
    },
  );
});
