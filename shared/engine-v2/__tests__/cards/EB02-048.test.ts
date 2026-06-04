/**
 * Per-card semantic test — EB02-048 Brook (character).
 * "[On Play] Add up to 1 [Laboon] from your trash to your hand.
 *  [On K.O.] Play up to 1 [Laboon] with a cost of 4 or less from your hand."
 * Spec: 2 clauses:
 *   1) on_play / recursion magnitude:1 filter{nameIs:Laboon}
 *   2) on_ko / play_for_free from:hand filter{nameIs:Laboon, costMax:4}
 *
 * Engine gap re-ref EB01-013: both `recursion` (actions2.ts:72-86) and
 * `play_for_free` read `targets` from the clause-target field. Neither
 * clause carries a `target`, so both fire as no-ops. Positive cases use
 * it.fails.
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
  id: 'TEST_L_EB02048', name: 'L', kind: 'leader', colors: ['black'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function laboon(id: string, cost: number = 4): CharacterCard {
  return {
    id, name: 'Laboon', kind: 'character', colors: ['black'], cost, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

function notLaboon(id: string): CharacterCard {
  return {
    id, name: 'NotLaboon', kind: 'character', colors: ['black'], cost: 4, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-048 — Brook', () => {
  const c = loadCards().find((x) => x.id === 'EB02-048');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-048 invalid');
  const br = c as CharacterCard;
  const clauses = br.effectSpecV2!.clauses!;

  it('shape: 2 clauses [on_play recursion 1 Laboon, on_ko play_for_free hand Laboon costMax:4]', () => {
    expect(clauses).toHaveLength(2);
    expect(clauses[0]!.trigger).toBe('on_play');
    expect(clauses[0]!.action.kind).toBe('recursion');
    expect((clauses[0]!.action as { magnitude: number; filter: { nameIs: string } }).magnitude).toBe(1);
    expect((clauses[0]!.action as { magnitude: number; filter: { nameIs: string } }).filter.nameIs).toBe('Laboon');
    expect(clauses[1]!.trigger).toBe('on_ko');
    expect(clauses[1]!.action.kind).toBe('play_for_free');
    const a1 = clauses[1]!.action as { from: string; filter: { nameIs: string; costMax: number } };
    expect(a1.from).toBe('hand');
    expect(a1.filter.nameIs).toBe('Laboon');
    expect(a1.filter.costMax).toBe(4);
  });

  it(
    'on_play: Laboon in trash → moved to hand (closes cluster-E engine gap; recursion trash-scan now honors action.filter when clause-target is omitted)',
    () => {
      const lb = laboon('TEST_LABOON_TRASH_E48', 1);
      const { state, fieldA } = buildState({ leaderA: L, charsA: [br] });
      state.cardLibrary[lb.id] = lb;
      const lbInst = makeInst(lb.id, 'A');
      state.instances[lbInst.instanceId] = lbInst;
      state.players.A.trash.push(lbInst.instanceId);
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
      );
      expect(next.players.A.hand).toContain(lbInst.instanceId);
    },
  );

  it('on_play: non-Laboon in trash → NOT moved (nameIs filter)', () => {
    const other = notLaboon('TEST_NOT_LABOON_E48');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [br] });
    state.cardLibrary[other.id] = other;
    const otherInst = makeInst(other.id, 'A');
    state.instances[otherInst.instanceId] = otherInst;
    state.players.A.trash.push(otherInst.instanceId);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand).not.toContain(otherInst.instanceId);
    expect(next.players.A.trash).toContain(otherInst.instanceId);
  });

  it('on_ko: cost-5 Laboon in hand → filter exclude (costMax)', () => {
    const bigLb = laboon('TEST_BIG_LABOON_E48', 5);
    const { state, fieldA, handAInstances } = buildState({
      leaderA: L, charsA: [br], handA: [bigLb],
    });
    const handId = handAInstances[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_ko',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(handId);
    expect(next.players.A.hand).toContain(handId);
  });

  it(
    'on_ko: cost-4 Laboon in hand → played onto field',
    () => {
      const lb = laboon('TEST_HAND_LABOON_E48', 4);
      const { state, fieldA, handAInstances } = buildState({
        leaderA: L, charsA: [br], handA: [lb],
      });
      const handId = handAInstances[0]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_ko',
      );
      expect(next.players.A.field.map((i) => i.instanceId)).toContain(handId);
    },
  );
});
