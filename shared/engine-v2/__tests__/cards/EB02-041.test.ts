/**
 * Per-card semantic test — EB02-041 Merry Go (stage).
 * "[On Play] If your Leader has the {Straw Hat Crew} type, draw 1 card.
 *  [Activate: Main] You may rest this Stage: If the number of DON!! cards
 *  on your field is equal to or less than the number on your opponent's
 *  field, up to 1 of your {Straw Hat Crew} type Characters gains +2 cost
 *  until the end of your opponent's next turn."
 * Spec: 2 clauses:
 *   1) on_play / if_leader_has_trait SH / draw 1
 *   2) activate_main / if_own_don_le_opp / restSelf / give_cost_buff +2 opp_next_turn / your_character SH
 *
 * SPEC FIX applied (BUGS_FOUND.md EB02-041): clause 2 was
 *   `removal_cost_reduce magnitude:-2` (engine clamps to negative → cost
 *   DOWN). Corrected to `give_cost_buff magnitude:2` so cost goes UP +2 as
 *   printed.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard, StageCard } from '../../cards/Card.js';
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

const SH_LEADER: LeaderCard = {
  id: 'TEST_SH_L_E41', name: 'L', kind: 'leader', colors: ['purple'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
};

const NON_SH_LEADER: LeaderCard = {
  id: 'TEST_NON_SH_L_E41', name: 'L', kind: 'leader', colors: ['purple'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: ['Other'], keywords: [], effectTags: [],
};

function shChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['purple'], cost: 3, power: 3000,
    counterValue: 1000, traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
  };
}

function nonSh(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['purple'], cost: 3, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-041 — Merry Go', () => {
  const c = loadCards().find((x) => x.id === 'EB02-041');
  if (c === undefined || c.kind !== 'stage') throw new Error('EB02-041 invalid');
  const mg = c as StageCard;
  const clauses = mg.effectSpecV2!.clauses!;

  function placeStage(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[mg.id] = mg;
    const inst = makeInst(mg.id, 'A');
    state.instances[inst.instanceId] = inst;
    state.players.A.stage = inst;
    return inst.instanceId;
  }

  it('shape: 2 clauses [on_play/SH/draw 1, activate_main/own_don_le_opp/restSelf/give_cost_buff +2 opp_next_turn/your_character SH]', () => {
    expect(clauses).toHaveLength(2);
    expect(clauses[0]!.trigger).toBe('on_play');
    expect((clauses[0]!.condition as { type: string; trait: string }).type).toBe('if_leader_has_trait');
    expect((clauses[0]!.condition as { type: string; trait: string }).trait).toBe('Straw Hat Crew');
    expect(clauses[0]!.action.kind).toBe('draw');
    expect((clauses[0]!.action as { magnitude: number }).magnitude).toBe(1);
    expect(clauses[1]!.trigger).toBe('activate_main');
    expect((clauses[1]!.condition as { type: string }).type).toBe('if_own_don_le_opp');
    expect(clauses[1]!.cost!['restSelf']).toBe(true);
    expect(clauses[1]!.action.kind).toBe('give_cost_buff');
    expect((clauses[1]!.action as { magnitude: number; duration: string }).magnitude).toBe(2);
    expect((clauses[1]!.action as { magnitude: number; duration: string }).duration).toBe('opp_next_turn');
    expect((clauses[1]!.target as { kind: string; filter: { trait: string } }).kind).toBe('your_character');
    expect((clauses[1]!.target as { kind: string; filter: { trait: string } }).filter.trait).toBe('Straw Hat Crew');
  });

  it('on_play: SH leader → draws 1', () => {
    const card = nonSh('TEST_DRAW_E41');
    const { state, handAInstances: _hi } = buildState({ leaderA: SH_LEADER, handA: [] });
    void _hi;
    state.cardLibrary[card.id] = card;
    const drawInst = makeInst(card.id, 'A');
    state.instances[drawInst.instanceId] = drawInst;
    state.players.A.deck.push(drawInst.instanceId);
    const stageId = placeStage(state);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: stageId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore + 1);
  });

  it('on_play: non-SH leader → no draw', () => {
    const card = nonSh('TEST_NO_DRAW_E41');
    const { state } = buildState({ leaderA: NON_SH_LEADER });
    state.cardLibrary[card.id] = card;
    const drawInst = makeInst(card.id, 'A');
    state.instances[drawInst.instanceId] = drawInst;
    state.players.A.deck.push(drawInst.instanceId);
    const stageId = placeStage(state);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: stageId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore);
  });

  it('activate_main: DON ≤ opp + SH char → +2 cost buff on SH char + stage rested', () => {
    const ally = shChar('TEST_SH_E41');
    const { state, fieldA } = buildState({
      leaderA: SH_LEADER, charsA: [ally], donInCostA: 5, donInCostB: 10,
    });
    const stageId = placeStage(state);
    const allyId = fieldA[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: stageId, controller: 'A' }, 'activate_main',
    );
    expect(next.players.A.stage?.rested).toBe(true);
    // Cost modifier applied as +2 (not -2).
    expect(next.instances[allyId]!.costModifierOneShot ?? 0).toBe(2);
  });

  it('activate_main: DON > opp → condition fail (no buff, no rest)', () => {
    const ally = shChar('TEST_NB_SH_E41');
    const { state, fieldA } = buildState({
      leaderA: SH_LEADER, charsA: [ally], donInCostA: 10, donInCostB: 5,
    });
    const stageId = placeStage(state);
    const allyId = fieldA[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: stageId, controller: 'A' }, 'activate_main',
    );
    expect(next.players.A.stage?.rested).toBe(false);
    expect(next.instances[allyId]!.costModifierOneShot ?? 0).toBe(0);
  });

  it('activate_main: DON ≤ opp + non-SH ally on field → filter exclude (no buff on non-SH)', () => {
    const other = nonSh('TEST_OTHER_E41');
    const { state, fieldA } = buildState({
      leaderA: SH_LEADER, charsA: [other], donInCostA: 5, donInCostB: 10,
    });
    const stageId = placeStage(state);
    const otherId = fieldA[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: stageId, controller: 'A' }, 'activate_main',
    );
    expect(next.instances[otherId]!.costModifierOneShot ?? 0).toBe(0);
  });
});
