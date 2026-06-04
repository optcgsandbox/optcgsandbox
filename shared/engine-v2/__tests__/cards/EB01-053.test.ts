/**
 * Per-card semantic test — EB01-053 Gastino (character).
 * "[On Play] Place up to 1 of your opponent's Characters with a cost of 3
 *  or less at the top or bottom of your opponent's Life cards face-up."
 * Spec: on_play / add_to_opp_life_top faceUp:true position:bottom /
 *   target opp_character costMax:3.
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
  id: 'TEST_L_EB053', name: 'L', kind: 'leader', colors: ['yellow'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function opp(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['yellow'], cost, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB01-053 — Gastino', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-053');
  if (eb === undefined || eb.kind !== 'character') throw new Error('EB01-053 invalid');
  const gast = eb as CharacterCard;
  const clause = gast.effectSpecV2!.clauses![0]!;

  it('spec shape: on_play / add_to_opp_life_top faceUp:true position:controller_choice from:target / opp_character costMax:3 (P-LIFE-POSITION: controller picks top or bottom at resolution time)', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('add_to_opp_life_top');
    const a = clause.action as { faceUp: boolean; position: string; from: string };
    expect(a.faceUp).toBe(true);
    expect(a.position).toBe('controller_choice');
    expect(a.from).toBe('target');
    expect((clause.target as { filter: { costMax: number } }).filter.costMax).toBe(3);
  });

  it('cost-3 opp char gets suspended into PendingChoose between top/bottom; cost-4 opp char unaffected (P-LIFE-POSITION)', () => {
    const o3 = opp('TEST_OPP_C3_53', 3);
    const o4 = opp('TEST_OPP_C4_53', 4);
    const { state, fieldA, fieldB } = buildState({
      leaderA: L, charsA: [gast], charsB: [o3, o4],
    });
    const o3Id = fieldB[0]!.instanceId;
    const o4Id = fieldB[1]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    // P-LIFE-POSITION: dispatch suspends into PendingChoose with 2 options
    // (top vs bottom). o3 remains on field until the controller resolves the
    // choice. o4 stays unaffected.
    expect(next.pending).not.toBeNull();
    expect((next.pending as { kind: string }).kind).toBe('choose_one');
    expect(next.players.B.field.some((i) => i.instanceId === o4Id)).toBe(true);
    void o3Id;
  });
});
