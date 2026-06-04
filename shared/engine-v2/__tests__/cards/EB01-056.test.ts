/**
 * Per-card semantic test — EB01-056 Charlotte Flampe (character).
 * "[On Play] You may add 1 card from the top or bottom of your Life cards
 *  to your hand: Draw 1 card."
 * Spec: on_play / cost lifeToHand:1 / action draw 1.
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
  id: 'TEST_L_EB056', name: 'L', kind: 'leader', colors: ['yellow'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function filler(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['yellow'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB01-056 — Charlotte Flampe', () => {
  const c = loadCards().find((x) => x.id === 'EB01-056');
  if (c === undefined || c.kind !== 'character') throw new Error('EB01-056 invalid');
  const fl = c as CharacterCard;
  const clause = fl.effectSpecV2!.clauses![0]!;

  it('shape: on_play / lifeToHand:1 / draw 1', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.cost!['lifeToHand']).toBe(1);
    expect(clause.action.kind).toBe('draw');
    expect((clause.action as { magnitude: number }).magnitude).toBe(1);
  });

  it('cost unpayable when life=0 (action does not fire)', () => {
    const d = filler('TEST_D_56_NO_LIFE');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [fl] });
    state.cardLibrary[d.id] = d;
    const dInst = makeInst(d.id, 'A');
    state.instances[dInst.instanceId] = dInst;
    state.players.A.deck.push(dInst.instanceId);
    // No life seeded.
    expect(state.players.A.life.length).toBe(0);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore);
  });

  it('moves 1 life→hand (cost) + draws 1 (action) → net hand +2', () => {
    const d = filler('TEST_D_56');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [fl] });
    state.cardLibrary[d.id] = d;
    const dInst = makeInst(d.id, 'A');
    state.instances[dInst.instanceId] = dInst;
    state.players.A.deck.push(dInst.instanceId);
    // Seed 1 life entry.
    const lid = 'A-LIFE-56-0';
    state.instances[lid] = makeInst('__VANILLA', 'A');
    state.instances[lid].instanceId = lid;
    state.players.A.life.push(lid);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore + 2);
  });
});
