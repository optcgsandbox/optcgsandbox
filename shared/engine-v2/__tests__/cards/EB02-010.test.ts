/**
 * Per-card semantic test — EB02-010 Monkey.D.Luffy (leader).
 * "[Activate: Main] [Once Per Turn] DON!! −2: If the only Characters on
 *  your field are {Straw Hat Crew} type Characters, set up to 2 of your
 *  DON!! cards as active. Then, this Leader gains +1000 power until the
 *  end of your opponent's next turn."
 * Spec: activate_main / opt:true / donCost:2 / if_only_chars_with_trait SH /
 *   sequence [set_active_don magnitude:2, power_buff +1000 opp_next_turn] /
 *   target your_leader.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, LeaderCard } from '../../cards/Card.js';
import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';

import type { CharacterCard } from '../../cards/Card.js';
import { buildState } from './_fixtures.js';

function shChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost: 2, power: 3000,
    counterValue: 1000, traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
  };
}

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

describe('EB02-010 — Monkey.D.Luffy (leader)', () => {
  const c = loadCards().find((x) => x.id === 'EB02-010');
  if (c === undefined || c.kind !== 'leader') throw new Error('EB02-010 invalid');
  const luffy = c as LeaderCard;
  const clause = luffy.effectSpecV2!.clauses![0]!;

  it('shape: activate_main opt / donCost:2 / if_only_chars_with_trait SH / sequence [set_active_don 2, power_buff +1000 opp_next_turn] / your_leader', () => {
    expect(clause.trigger).toBe('activate_main');
    expect(clause.opt).toBe(true);
    expect(clause.cost!['donCost']).toBe(2);
    expect((clause.condition as { trait: string }).trait).toBe('Straw Hat Crew');
    expect(clause.action.kind).toBe('sequence');
    const seq = clause.action as { actions: ReadonlyArray<{ kind: string; magnitude?: number; duration?: string }> };
    expect(seq.actions[0]!.kind).toBe('set_active_don');
    expect(seq.actions[0]!.magnitude).toBe(2);
    expect(seq.actions[1]!.kind).toBe('power_buff');
    expect(seq.actions[1]!.magnitude).toBe(1000);
    expect(seq.actions[1]!.duration).toBe('opp_next_turn');
    expect(clause.target!.kind).toBe('your_leader');
  });

  it('with only SH char on field: pays 2 DON, sets 2 active DON, +1000 leader', () => {
    const sh = shChar('TEST_SH_ALLY_10');
    const { state, leaderInstA } = buildState({ leaderA: luffy, charsA: [sh] });
    // Pre-rest 2 DON in donRested so set_active_don has something to flip.
    const restedToTransfer = state.players.A.donCostArea.splice(0, 2);
    for (const id of restedToTransfer) {
      state.instances[id]!.rested = true;
      state.players.A.donRested.push(id);
    }
    const beforeActive = state.players.A.donCostArea.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: leaderInstA.instanceId, controller: 'A' }, 'activate_main',
    );
    // Net DON in cost area: -2 (pay) +2 (set_active_don) = unchanged.
    expect(next.players.A.donCostArea.length).toBe(beforeActive);
    // Leader gets power buff.
    expect(next.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0).toBe(1000);
  });

  it('with NON-SH char on field: condition false → no DON paid, no buff', () => {
    const nonSH: CharacterCard = {
      id: 'TEST_NON_SH_10',
      name: 'NonSH',
      kind: 'character',
      colors: ['red'],
      cost: 2,
      power: 3000,
      counterValue: 1000,
      traits: ['Other'],
      keywords: [],
      effectTags: [],
    };
    const { state, leaderInstA } = buildState({ leaderA: luffy, charsA: [nonSH] });
    const beforeActive = state.players.A.donCostArea.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: leaderInstA.instanceId, controller: 'A' }, 'activate_main',
    );
    expect(next.players.A.donCostArea.length).toBe(beforeActive);
    expect(next.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0).toBe(0);
  });

  it('OPT: second activate_main same turn does NOT fire', () => {
    const sh = shChar('TEST_SH_ALLY_OPT_10');
    const { state, leaderInstA } = buildState({ leaderA: luffy, charsA: [sh] });
    // Pre-rest 4 DON so two activations could in principle both have DON to flip.
    const restedToTransfer = state.players.A.donCostArea.splice(0, 4);
    for (const id of restedToTransfer) {
      state.instances[id]!.rested = true;
      state.players.A.donRested.push(id);
    }
    const once = EffectDispatcher.dispatch(
      state, { sourceInstanceId: leaderInstA.instanceId, controller: 'A' }, 'activate_main',
    );
    const buffAfterOnce = once.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0;
    const twice = EffectDispatcher.dispatch(
      once, { sourceInstanceId: leaderInstA.instanceId, controller: 'A' }, 'activate_main',
    );
    // Power buff did NOT stack (OPT suppressed second fire).
    expect(twice.instances[leaderInstA.instanceId]!.powerModifierOneShot ?? 0).toBe(buffAfterOnce);
  });
});
