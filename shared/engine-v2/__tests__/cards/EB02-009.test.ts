/**
 * Per-card semantic test — EB02-009 Thousand Sunny (stage).
 * "[Activate: Main] You may rest this Stage: Give up to 1 of your currently
 *  given DON!! cards to 1 of your {Straw Hat Crew} type Characters."
 * Spec: activate_main / cost restSelf / transfer_attached_don magnitude:1
 *   fromKind:'any_own' / your_character filter{trait:Straw Hat Crew}.
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

const L: LeaderCard = {
  id: 'TEST_L_EB02009', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function shChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost: 3, power: 4000,
    counterValue: 1000, traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
  };
}

describe('EB02-009 — Thousand Sunny', () => {
  const c = loadCards().find((x) => x.id === 'EB02-009');
  if (c === undefined || c.kind !== 'stage') throw new Error('EB02-009 invalid');
  const sunny = c as StageCard;
  const clause = sunny.effectSpecV2!.clauses![0]!;

  it('shape: activate_main / restSelf / transfer_attached_don magnitude:1 fromKind:any_own / your_character SH', () => {
    expect(clause.trigger).toBe('activate_main');
    expect(clause.cost!['restSelf']).toBe(true);
    expect(clause.action.kind).toBe('transfer_attached_don');
    expect((clause.action as { magnitude: number; fromKind: string }).magnitude).toBe(1);
    expect((clause.action as { magnitude: number; fromKind: string }).fromKind).toBe('any_own');
    expect((clause.target as { filter: { trait: string } }).filter.trait).toBe('Straw Hat Crew');
  });

  it('rests Sunny stage + transfers a DON from leader→SH char', () => {
    const ally = shChar('TEST_SH_ALLY_09');
    const { state, fieldA, leaderInstA } = buildState({ leaderA: L, charsA: [ally] });
    // Place Sunny in A's stage and attach 1 DON to leader.
    state.cardLibrary[sunny.id] = sunny;
    const stageInst = makeInst(sunny.id, 'A');
    state.instances[stageInst.instanceId] = stageInst;
    state.players.A.stage = stageInst;
    state.instances[leaderInstA.instanceId]!.attachedDon = state.players.A.donCostArea.splice(0, 1);
    const allyId = fieldA[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: stageInst.instanceId, controller: 'A' }, 'activate_main',
    );
    expect(next.players.A.stage?.rested).toBe(true);
    expect(next.instances[allyId]!.attachedDon?.length ?? 0).toBe(1);
    // Leader's attachedDon drained.
    expect(next.instances[leaderInstA.instanceId]!.attachedDon.length).toBe(0);
  });

  it('does NOT transfer to a non-SH char (filter trait excludes)', () => {
    const nonSH: CharacterCard = {
      id: 'TEST_NON_SH_09',
      name: 'NonSH',
      kind: 'character',
      colors: ['red'],
      cost: 3,
      power: 4000,
      counterValue: 1000,
      traits: ['Other'],
      keywords: [],
      effectTags: [],
    };
    const { state, fieldA, leaderInstA } = buildState({ leaderA: L, charsA: [nonSH] });
    state.cardLibrary[sunny.id] = sunny;
    const stageInst = makeInst(sunny.id, 'A');
    state.instances[stageInst.instanceId] = stageInst;
    state.players.A.stage = stageInst;
    state.instances[leaderInstA.instanceId]!.attachedDon = state.players.A.donCostArea.splice(0, 1);
    const allyId = fieldA[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: stageInst.instanceId, controller: 'A' }, 'activate_main',
    );
    expect(next.instances[allyId]!.attachedDon?.length ?? 0).toBe(0);
  });

  it('cannot fire when Sunny is already rested (restSelf cost unpayable)', () => {
    const ally = shChar('TEST_SH_ALLY_RESTED');
    const { state, fieldA, leaderInstA } = buildState({ leaderA: L, charsA: [ally] });
    state.cardLibrary[sunny.id] = sunny;
    const stageInst = makeInst(sunny.id, 'A');
    state.instances[stageInst.instanceId] = stageInst;
    state.players.A.stage = stageInst;
    state.players.A.stage!.rested = true;
    state.instances[stageInst.instanceId]!.rested = true;
    state.instances[leaderInstA.instanceId]!.attachedDon = state.players.A.donCostArea.splice(0, 1);
    const allyId = fieldA[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: stageInst.instanceId, controller: 'A' }, 'activate_main',
    );
    expect(next.instances[allyId]!.attachedDon?.length ?? 0).toBe(0);
  });
});
