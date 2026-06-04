/**
 * Per-card semantic test — OP01-009 Carrot ([Trigger] Play this card).
 *
 * Printed text: "[Trigger] Play this card."
 *
 * Engine wiring:
 *   - Damage→life→PendingTrigger emission already in attackFlow.ts:467-489.
 *   - RESOLVE_TRIGGER reducer dispatches the life card's `trigger` clause.
 *   - This card uses `play_self_from_life` action — the source instance
 *     leaves the life zone and enters its controller's field.
 *
 * Test asserts:
 *   1. Spec uses trigger:"trigger" + action:play_self_from_life.
 *   2. Direct dispatch of `trigger` on a life-zone source instance moves
 *      it to field (covers the action handler behavior in isolation).
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

const L: LeaderCard = {
  id: 'TEST_LEADER_OP01_009', name: 'TEST', kind: 'leader',
  colors: ['red'], cost: null, power: 5000, life: 5, counterValue: null,
  traits: [], keywords: [], effectTags: [],
};

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

describe('OP01-009 — Carrot ([Trigger] Play this card)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'OP01-009');
  if (eb === undefined || eb.kind !== 'character') throw new Error('OP01-009 invalid');
  const carrot = eb as CharacterCard;
  const clause = carrot.effectSpecV2!.clauses![0]!;

  it('spec shape: trigger:"trigger" + action:play_self_from_life', () => {
    expect(clause.trigger).toBe('trigger');
    expect(clause.action.kind).toBe('play_self_from_life');
  });

  it('dispatch trigger on a Carrot in life zone moves it to field', () => {
    const { state } = buildState({ leaderA: L });
    // Inject Carrot card library + a Carrot instance into A's life zone.
    state.cardLibrary[carrot.id] = carrot;
    const carrotInst = makeInst(carrot.id, 'A');
    state.instances[carrotInst.instanceId] = carrotInst;
    state.players.A.life.push(carrotInst.instanceId);

    const fieldBefore = state.players.A.field.length;
    const lifeBefore = state.players.A.life.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: carrotInst.instanceId, controller: 'A' },
      'trigger',
    );
    // Carrot moves life → field
    expect(next.players.A.life).not.toContain(carrotInst.instanceId);
    expect(next.players.A.field.some((i) => i.instanceId === carrotInst.instanceId)).toBe(true);
    expect(next.players.A.field.length).toBe(fieldBefore + 1);
    expect(next.players.A.life.length).toBe(lifeBefore - 1);
  });
});
