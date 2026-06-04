/**
 * Per-card semantic test — EB02-003 Tony Tony.Chopper (character).
 * "[DON!! x2] [Opponent's Turn] This Character gains +2000 power.
 *  [On Play] If your Leader has the {Straw Hat Crew} type, give up to 1
 *   rested DON!! card to your Leader or 1 of your Characters."
 * Spec:
 *  • Continuous: AND(if_attached_don_min:2, is_opp_turn) / self_power_buff +2000.
 *  • Clause on_play / if_leader_has_trait Straw Hat Crew /
 *      give_don_to_target magnitude:1 rested:true / your_leader_or_character.
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

const SH_LEADER: LeaderCard = {
  id: 'TEST_SH_LEADER', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
};

describe('EB02-003 — Tony Tony.Chopper', () => {
  const c = loadCards().find((x) => x.id === 'EB02-003');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-003 invalid');
  const chop = c as CharacterCard;
  const clause = chop.effectSpecV2!.clauses![0]!;
  const cont = chop.effectSpecV2!.continuous![0]!;

  it('clause shape: on_play / Straw Hat / give_don_to_target 1 rested / your_leader_or_character', () => {
    expect(clause.trigger).toBe('on_play');
    expect((clause.condition as { trait: string }).trait).toBe('Straw Hat Crew');
    expect(clause.action.kind).toBe('give_don_to_target');
    expect((clause.action as { magnitude: number; rested: boolean }).magnitude).toBe(1);
    expect((clause.action as { magnitude: number; rested: boolean }).rested).toBe(true);
    expect(clause.target!.kind).toBe('your_leader_or_character');
  });

  it('continuous shape: AND(don≥2, opp_turn) / self_power_buff +2000', () => {
    const cond = cont.condition as { type: string; conditions: ReadonlyArray<{ type: string }> };
    expect(cond.type).toBe('and');
    expect(cond.conditions.map((c) => c.type)).toEqual(['if_attached_don_min', 'is_opp_turn']);
    expect(cont.action.kind).toBe('self_power_buff');
    expect((cont.action as { magnitude: number }).magnitude).toBe(2000);
  });

  it('on_play with SH leader: gives 1 rested DON to leader (your_leader_or_character first match)', () => {
    const { state, fieldA, leaderInstA } = buildState({ leaderA: SH_LEADER, charsA: [chop] });
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    // Leader should now have 1 rested DON attached.
    expect(next.instances[leaderInstA.instanceId]!.attachedDonRested?.length ?? 0).toBe(1);
  });

  it('on_play with non-SH leader: condition false → no rested DON to leader', () => {
    const nonSH: LeaderCard = { ...SH_LEADER, id: 'TEST_NONSH_03', traits: ['Other'] };
    const { state, fieldA, leaderInstA } = buildState({ leaderA: nonSH, charsA: [chop] });
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.instances[leaderInstA.instanceId]!.attachedDonRested?.length ?? 0).toBe(0);
  });

  it('continuous +2000 when don≥2 attached AND opp turn', () => {
    const { state, fieldA } = buildState({ leaderA: SH_LEADER, charsA: [chop] });
    const chopId = fieldA[0]!.instanceId;
    state.instances[chopId]!.attachedDon = state.players.A.donCostArea.splice(0, 2);
    state.activePlayer = 'B';
    const next = ContinuousManager.refold(state);
    expect(next.instances[chopId]!.powerModifierContinuous).toBe(2000);
  });

  it('continuous: 1 DON attached + opp turn → no buff (don gate fails)', () => {
    const { state, fieldA } = buildState({ leaderA: SH_LEADER, charsA: [chop] });
    const chopId = fieldA[0]!.instanceId;
    state.instances[chopId]!.attachedDon = state.players.A.donCostArea.splice(0, 1);
    state.activePlayer = 'B';
    const next = ContinuousManager.refold(state);
    expect(next.instances[chopId]!.powerModifierContinuous ?? 0).toBe(0);
  });

  it('continuous: 2 DON attached + own turn → no buff (is_opp_turn fails)', () => {
    const { state, fieldA } = buildState({ leaderA: SH_LEADER, charsA: [chop] });
    const chopId = fieldA[0]!.instanceId;
    state.instances[chopId]!.attachedDon = state.players.A.donCostArea.splice(0, 2);
    // activePlayer stays 'A' (own turn).
    const next = ContinuousManager.refold(state);
    expect(next.instances[chopId]!.powerModifierContinuous ?? 0).toBe(0);
  });
});
