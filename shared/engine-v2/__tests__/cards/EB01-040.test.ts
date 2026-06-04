/**
 * Per-card semantic test — EB01-040 Kyros (leader).
 *
 * Printed text (cards.json):
 *   "[Activate: Main] [Once Per Turn] You may turn 1 card from the top of
 *    your Life cards face-up: K.O. up to 1 of your opponent's Characters
 *    with a cost of 0."
 *
 * 5-axis: clause activate_main / cost flipLife:1 / action removal_ko /
 *   target opp_character costMax:0 / opt:true.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { CostPayer } from '../../effects/CostPayer.js';
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

function oppZeroCost(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['black'],
    cost: 0,
    power: 1000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

function seedLife(state: ReturnType<typeof buildState>['state'], n: number): void {
  for (let i = 0; i < n; i++) {
    const lid = `A-LIFE-${i}`;
    state.instances[lid] = {
      instanceId: lid,
      cardId: '__LIFE_DECK_CARD',
      controller: 'A',
      rested: false,
      summoningSick: false,
      attachedDon: [],
      attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    state.players.A.life.push(lid);
  }
}

describe('EB01-040 — Kyros (leader)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-040');
  if (eb === undefined) throw new Error('EB01-040 not in cards.json');
  if (eb.kind !== 'leader') throw new Error('EB01-040 should be a leader');
  const kyros = eb as LeaderCard;
  const clause = kyros.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-040 missing clause');

  it('clause shape: activate_main / flipLife:1 / removal_ko / opp_character costMax:0 / opt:true', () => {
    expect(clause.trigger).toBe('activate_main');
    expect(clause.cost!['flipLife']).toBe(1);
    expect(clause.action.kind).toBe('removal_ko');
    expect(clause.target!.kind).toBe('opp_character');
    expect((clause.target as { filter: { costMax: number } }).filter.costMax).toBe(0);
    expect(clause.opt).toBe(true);
  });

  it('canPay flipLife when life ≥ 1', () => {
    const { state, leaderInstA } = buildState({ leaderA: kyros });
    seedLife(state, 3);
    expect(
      CostPayer.canPay(
        state,
        { sourceInstanceId: leaderInstA.instanceId, controller: 'A' },
        clause.cost!,
      ),
    ).toBe(true);
  });

  it('canPay = false when life = 0 (cannot flip)', () => {
    const { state, leaderInstA } = buildState({ leaderA: kyros });
    // No life seeded.
    expect(state.players.A.life.length).toBe(0);
    expect(
      CostPayer.canPay(
        state,
        { sourceInstanceId: leaderInstA.instanceId, controller: 'A' },
        clause.cost!,
      ),
    ).toBe(false);
  });

  it('does NOT KO cost-1 opp char (filter costMax:0 boundary exclusive)', () => {
    const opp: CharacterCard = {
      id: 'TEST_OPP_C1',
      name: 'opp1',
      kind: 'character',
      colors: ['black'],
      cost: 1,
      power: 1000,
      counterValue: 1000,
      traits: [],
      keywords: [],
      effectTags: [],
    };
    const { state, leaderInstA, fieldB } = buildState({ leaderA: kyros, charsB: [opp] });
    seedLife(state, 3);
    const oppId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: leaderInstA.instanceId, controller: 'A' },
      'activate_main',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(true);
  });

  it('OPT: second activate_main same turn does NOT fire', () => {
    const opp1 = oppZeroCost('TEST_OPP_OPT1');
    const opp2 = oppZeroCost('TEST_OPP_OPT2');
    const { state, leaderInstA, fieldB } = buildState({
      leaderA: kyros,
      charsB: [opp1, opp2],
    });
    seedLife(state, 3);
    const opp1Id = fieldB[0]!.instanceId;
    const opp2Id = fieldB[1]!.instanceId;
    const once = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: leaderInstA.instanceId, controller: 'A' },
      'activate_main',
    );
    // First fire: at most one cost-0 opp char KOed.
    const opp1Gone = !once.players.B.field.some((i) => i.instanceId === opp1Id);
    const opp2Gone = !once.players.B.field.some((i) => i.instanceId === opp2Id);
    const survivorsAfterFirst = once.players.B.field.length;
    expect(opp1Gone || opp2Gone).toBe(true);
    // Second activate_main — OPT should suppress.
    const twice = EffectDispatcher.dispatch(
      once,
      { sourceInstanceId: leaderInstA.instanceId, controller: 'A' },
      'activate_main',
    );
    expect(twice.players.B.field.length).toBe(survivorsAfterFirst);
  });

  it('KOs a cost-0 opp char + flips a life card face-up', () => {
    const opp = oppZeroCost('TEST_OPP_C0');
    const { state, leaderInstA, fieldB } = buildState({ leaderA: kyros, charsB: [opp] });
    seedLife(state, 3);
    const oppId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: leaderInstA.instanceId, controller: 'A' },
      'activate_main',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(false);
    // Some life entry should be face-up after flipLife.
    expect(Object.keys(next.players.A.lifeFaceUp ?? {}).length).toBeGreaterThan(0);
  });
});
