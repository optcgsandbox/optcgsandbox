/**
 * Per-card semantic test — EB01-031 Kalifa (character).
 *
 * Printed text (cards.json):
 *   "[On Play] DON!! −1 (You may return the specified number of DON!! cards
 *    from your field to your DON!! deck.): If your Leader has the {Water
 *    Seven} type, add up to 2 Character cards with a cost of 4 or less from
 *    your trash to your hand."
 *
 * 5-axis: clause on_play, condition if_leader_has_trait Water Seven,
 *   cost donCostReturnToDeck:1, action recursion magnitude:2 filter{costMax:4,
 *   kind:'character'}. NO clause-level target — see engine gap below.
 *
 * Engine gaps (logged):
 *   1) recursion action handler iterates `targets` passed by the dispatcher
 *      but the dispatcher resolves them from `clause.target`. The Kalifa
 *      spec carries the filter ON THE ACTION (action.filter) and has no
 *      clause.target — recursion receives [] and does nothing.
 *   2) Even with `clause.target: {kind:'own_trash_card', filter:{...}, count:2}`,
 *      the resolver `ownTrashCard` returns at most one instance (targets.ts:148)
 *      regardless of `target.count`.
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

const W7_LEADER: LeaderCard = {
  id: 'TEST_W7_LEADER',
  name: 'TEST',
  kind: 'leader',
  colors: ['purple'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Water Seven'],
  keywords: [],
  effectTags: [],
};

function trashChar(id: string, cost: number): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['purple'],
    cost,
    power: 3000,
    counterValue: 1000,
    traits: ['Water Seven'],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-031 — Kalifa (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-031');
  if (eb === undefined) throw new Error('EB01-031 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-031 should be a character');
  const kalifa = eb as CharacterCard;
  const clause = kalifa.effectSpecV2?.clauses?.[0];
  if (clause === undefined || clause.cost === undefined) throw new Error('EB01-031 missing clause/cost');

  it('clause shape: on_play / Water Seven / donCostReturnToDeck:1 / recursion 2 filter{costMax:4, kind:character}', () => {
    expect(clause.trigger).toBe('on_play');
    expect((clause.condition as { trait: string }).trait).toBe('Water Seven');
    expect(clause.cost!['donCostReturnToDeck']).toBe(1);
    expect(clause.action.kind).toBe('recursion');
    expect((clause.action as { magnitude: number }).magnitude).toBe(2);
    const action = clause.action as { filter: { costMax: number; kind: string } };
    expect(action.filter.costMax).toBe(4);
    expect(action.filter.kind).toBe('character');
  });

  it('cost canPay = true with ≥1 active DON in cost area', () => {
    const { state, fieldA } = buildState({ leaderA: W7_LEADER, charsA: [kalifa] });
    expect(
      CostPayer.canPay(state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, clause.cost!),
    ).toBe(true);
  });

  it('cost canPay = false with 0 DON in cost area', () => {
    const { state, fieldA } = buildState({ leaderA: W7_LEADER, charsA: [kalifa], donInCostA: 0 });
    expect(
      CostPayer.canPay(state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, clause.cost!),
    ).toBe(false);
  });

  it('non-Water Seven leader: dispatch does not fire (condition false → no trash drain)', () => {
    const nonW7Leader: LeaderCard = { ...W7_LEADER, id: 'TEST_NONW7', traits: ['Other'] };
    const tc1 = trashChar('TEST_TC_NONW7_1', 3);
    const { state, fieldA } = buildState({ leaderA: nonW7Leader, charsA: [kalifa] });
    state.cardLibrary[tc1.id] = tc1;
    const inst = makeInst(tc1.id, 'A');
    state.instances[inst.instanceId] = inst;
    state.players.A.trash.push(inst.instanceId);
    const trashBefore = state.players.A.trash.length;
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_play',
    );
    expect(next.players.A.trash.length).toBe(trashBefore);
    expect(next.players.A.hand.length).toBe(handBefore);
  });

  it(
    'pulls up to 2 cost-≤4 Water Seven chars from trash to hand (closes cluster-E engine gap; recursion now scans own trash via action.filter + magnitude cap when clause-target is omitted)',
    () => {
      const tc1 = trashChar('TEST_TC_1', 3);
      const tc2 = trashChar('TEST_TC_2', 4);
      const { state, fieldA } = buildState({ leaderA: W7_LEADER, charsA: [kalifa] });
      for (const c of [tc1, tc2]) {
        state.cardLibrary[c.id] = c;
        const inst = makeInst(c.id, 'A');
        state.instances[inst.instanceId] = inst;
        state.players.A.trash.push(inst.instanceId);
      }
      const trashBefore = state.players.A.trash.length;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
        'on_play',
      );
      expect(next.players.A.trash.length).toBe(trashBefore - 2);
      expect(next.players.A.hand.length).toBe(2);
    },
  );
});
