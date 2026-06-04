/**
 * Per-card semantic test — EB02-044 Sengoku (character).
 * "[Blocker]
 *  [On Play] Play up to 1 black {Navy} type Character card with a cost
 *  of 4 or less from your trash rested."
 * Spec: continuous grant_keyword_to_self blocker. Clause on_play /
 *   play_for_free from:trash filter{trait:Navy, costMax:4, kind:character,
 *   colors:[black]} rested:true.
 *
 * Engine gap re-ref EB01-013: play_for_free no clause-target → no-op.
 * Positive uses it.fails.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { ContinuousManager } from '../../effects/ContinuousManager.js';
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
  id: 'TEST_L_EB02044', name: 'L', kind: 'leader', colors: ['black'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function navyChar(id: string, cost: number, color: string = 'black'): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: [color as 'black'], cost, power: 3000,
    counterValue: 1000, traits: ['Navy'], keywords: [], effectTags: [],
  };
}

function nonNavy(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['black'], cost, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-044 — Sengoku', () => {
  const c = loadCards().find((x) => x.id === 'EB02-044');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-044 invalid');
  const sen = c as CharacterCard;
  const clause = sen.effectSpecV2!.clauses![0]!;
  const cont = sen.effectSpecV2!.continuous![0]!;

  it('shape: on_play / play_for_free trash Navy costMax:4 black rested + continuous blocker', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('play_for_free');
    const a = clause.action as { from: string; rested: boolean; filter: { trait: string; costMax: number; kind: string; colors: string[] } };
    expect(a.from).toBe('trash');
    expect(a.rested).toBe(true);
    expect(a.filter.trait).toBe('Navy');
    expect(a.filter.costMax).toBe(4);
    expect(a.filter.kind).toBe('character');
    expect(a.filter.colors).toContain('black');
    expect((cont.action as { kind: string; keyword: string }).kind).toBe('grant_keyword_to_self');
    expect((cont.action as { kind: string; keyword: string }).keyword).toBe('blocker');
  });

  it('continuous grants blocker', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sen] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
  });

  it('cost-5 black Navy in trash: NOT played (costMax exclude)', () => {
    const big = navyChar('TEST_BIG_NAVY_E44', 5);
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sen] });
    state.cardLibrary[big.id] = big;
    const bigInst = makeInst(big.id, 'A');
    state.instances[bigInst.instanceId] = bigInst;
    state.players.A.trash.push(bigInst.instanceId);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(bigInst.instanceId);
  });

  it('cost-4 non-Navy in trash: NOT played (trait exclude)', () => {
    const other = nonNavy('TEST_NON_NAVY_E44', 4);
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sen] });
    state.cardLibrary[other.id] = other;
    const otherInst = makeInst(other.id, 'A');
    state.instances[otherInst.instanceId] = otherInst;
    state.players.A.trash.push(otherInst.instanceId);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(otherInst.instanceId);
  });

  it(
    'cost-4 black Navy in trash: played onto field rested',
    () => {
      const cand = navyChar('TEST_CAND_E44', 4);
      const { state, fieldA } = buildState({ leaderA: L, charsA: [sen] });
      state.cardLibrary[cand.id] = cand;
      const candInst = makeInst(cand.id, 'A');
      state.instances[candInst.instanceId] = candInst;
      state.players.A.trash.push(candInst.instanceId);
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
      );
      expect(next.players.A.field.map((i) => i.instanceId)).toContain(candInst.instanceId);
    },
  );
});
