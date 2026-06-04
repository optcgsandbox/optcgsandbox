/**
 * Per-card semantic test — EB01-033 Blueno (purple) (character).
 *
 * Printed text (cards.json):
 *   "[On Play] DON!! −1 ...: If your Leader has the {Water Seven} type,
 *    play up to 1 {Water Seven} type Character card with a cost of 5 other
 *    than [Blueno] from your hand or trash."
 *
 * 5-axis: clause on_play, condition if_leader_has_trait Water Seven,
 *   cost donCostReturnToDeck:1, action play_for_free from:'hand_or_trash'
 *   filter{trait, costMin:5, costMax:5, nameExcludes:'Blueno', kind:'character'}.
 *
 * Engine gap (re-ref EB01-013/EB01-020): play_for_free in this spec has no
 * clause-level target and the action's `from` does not source candidates by
 * itself — the action iterates `targets` which arrive empty. Logged.
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

const W7_LEADER: LeaderCard = {
  id: 'TEST_W7_LEADER_33',
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

function w7Cost5(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['purple'],
    cost: 5,
    power: 6000,
    counterValue: 1000,
    traits: ['Water Seven'],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-033 — Blueno (purple) (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-033');
  if (eb === undefined) throw new Error('EB01-033 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-033 should be a character');
  const blueno = eb as CharacterCard;
  const clause = blueno.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-033 missing clause');

  it('clause shape: on_play / Water Seven / donCostReturnToDeck:1 / play_for_free from hand_or_trash', () => {
    expect(clause.trigger).toBe('on_play');
    expect((clause.condition as { trait: string }).trait).toBe('Water Seven');
    expect(clause.cost!['donCostReturnToDeck']).toBe(1);
    expect(clause.action.kind).toBe('play_for_free');
    const action = clause.action as { from: string; filter: { trait: string; costMin: number; costMax: number; nameExcludes: string; kind: string } };
    expect(action.from).toBe('hand_or_trash');
    expect(action.filter.trait).toBe('Water Seven');
    expect(action.filter.costMin).toBe(5);
    expect(action.filter.costMax).toBe(5);
    expect(action.filter.nameExcludes).toBe('Blueno');
    expect(action.filter.kind).toBe('character');
  });

  it(
    'plays a Water Seven cost-5 non-Blueno char from hand',
    () => {
      const handCand = w7Cost5('TEST_W7_CAND_33');
      const { state, fieldA } = buildState({ leaderA: W7_LEADER, charsA: [blueno], handA: [handCand] });
      const candId = state.players.A.hand[0]!;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
        'on_play',
      );
      expect(next.players.A.field.some((i) => i.instanceId === candId)).toBe(true);
      expect(next.players.A.hand).not.toContain(candId);
    },
  );

  it('non-Water Seven leader: dispatch does not fire (condition gate negative)', () => {
    const nonW7Leader: LeaderCard = { ...W7_LEADER, id: 'TEST_NONW7_33', traits: ['Other'] };
    const handCand = w7Cost5('TEST_W7_CAND_NEG');
    const { state, fieldA } = buildState({ leaderA: nonW7Leader, charsA: [blueno], handA: [handCand] });
    const handBefore = state.players.A.hand.length;
    const donBefore = state.players.A.donCostArea.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_play',
    );
    // No DON returned (cost not paid), hand unchanged.
    expect(next.players.A.donCostArea.length).toBe(donBefore);
    expect(next.players.A.hand.length).toBe(handBefore);
  });
});
