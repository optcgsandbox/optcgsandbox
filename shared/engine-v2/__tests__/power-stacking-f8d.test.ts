/**
 * F-8D — generic power-modifier stacking verification.
 *
 * Owner question (manual playtest): "If Chopper gives +1000 and the leader
 * gives +1000, do they stack?" Rules answer: YES — temporary modifiers
 * stack additively. These tests prove the GENERIC engine behavior with
 * synthetic cards (no card-specific assertions):
 *
 *   1. 5000 base, +1000 +1000            → 7000
 *   2. 5000 base, +1000 −2000            → 4000
 *   3. 5000 base, 2 DON +1000 (own turn) → 8000
 *   4. 5000 base, 2 DON (opp turn)       → 5000  (F8A-F2 rule preserved)
 *   5. modifiers expire at end of turn
 *   6. combat resolution uses the stacked effective power
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { CharacterCard, LeaderCard } from '../cards/Card.js';
import type { EffectActionV2 } from '../spec/types.js';
import { effectivePower } from '../state/derived/power.js';
import { actionHandlers } from '../registry/types.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';
import { applyAction } from '../reducers/applyAction.js';

import { buildState } from './cards/_fixtures.js';

const LEADER_A: LeaderCard = {
  id: '__F8D_LA', name: 'F8D Leader A', kind: 'leader', colors: ['red'],
  cost: null, power: 5000, counterValue: null, traits: [], keywords: [],
  effectTags: [], life: 5,
};
const LEADER_B: LeaderCard = { ...LEADER_A, id: '__F8D_LB', name: 'F8D Leader B' };
const CHAR_5K: CharacterCard = {
  id: '__F8D_C5', name: 'F8D Char 5k', kind: 'character', colors: ['red'],
  cost: 4, power: 5000, counterValue: 1000, traits: [], keywords: [],
  effectTags: [],
};

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

function buff(state: ReturnType<typeof buildState>['state'], sourceId: string, targetId: string, magnitude: number): void {
  const action: EffectActionV2 = { kind: 'power_buff', magnitude, duration: 'this_turn' };
  actionHandlers.get('power_buff')(state, { sourceInstanceId: sourceId, controller: 'A' }, action, [targetId]);
}

describe('F-8D — temporary power modifiers stack additively (generic)', () => {
  it('+1000 from two different sources → +2000 total (5000 → 7000)', () => {
    const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B, charsA: [CHAR_5K] });
    const s = built.state;
    s.activePlayer = 'A';
    const target = built.fieldA[0]!;
    buff(s, built.leaderInstA.instanceId, target.instanceId, 1000);
    buff(s, built.leaderInstA.instanceId, target.instanceId, 1000);
    expect(effectivePower(s, target)).toBe(7000);
    // The instance bucket shows the aggregated total (what the badge reads).
    expect(target.powerModifierOneShot).toBe(2000);
  });

  it('buff + debuff net correctly (+1000 −2000 → 4000)', () => {
    const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B, charsA: [CHAR_5K] });
    const s = built.state;
    s.activePlayer = 'A';
    const target = built.fieldA[0]!;
    buff(s, built.leaderInstA.instanceId, target.instanceId, 1000);
    buff(s, built.leaderInstA.instanceId, target.instanceId, -2000);
    expect(effectivePower(s, target)).toBe(4000);
  });

  it('attached DON + temporary buff combine on the OWNER turn (5000 +2 DON +1000 → 8000)', () => {
    const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B, charsA: [CHAR_5K] });
    const s = built.state;
    s.activePlayer = 'A';
    const target = built.fieldA[0]!;
    target.attachedDon.push('f8d-don-1', 'f8d-don-2');
    buff(s, built.leaderInstA.instanceId, target.instanceId, 1000);
    expect(effectivePower(s, target)).toBe(8000);
  });

  it("attached DON adds NOTHING on the opponent's turn (F8A-F2 preserved); temp buffs still apply", () => {
    const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B, charsA: [CHAR_5K] });
    const s = built.state;
    s.activePlayer = 'B'; // opponent's turn
    const target = built.fieldA[0]!;
    target.attachedDon.push('f8d-don-1', 'f8d-don-2');
    expect(effectivePower(s, target)).toBe(5000);
    buff(s, built.leaderInstA.instanceId, target.instanceId, 1000);
    expect(effectivePower(s, target)).toBe(6000); // buff stacks; DON stays gated
  });

  it('this_turn modifiers expire at end of turn', () => {
    const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B, charsA: [CHAR_5K] });
    const s = built.state;
    s.activePlayer = 'A';
    const target = built.fieldA[0]!;
    buff(s, built.leaderInstA.instanceId, target.instanceId, 1000);
    buff(s, built.leaderInstA.instanceId, target.instanceId, 1000);
    expect(effectivePower(s, target)).toBe(7000);
    const ended = applyAction(s, 'A', { type: 'END_TURN' }, { checkInvariants: false }).state;
    const after = ended.instances[target.instanceId]!;
    expect(effectivePower(ended, after)).toBe(5000); // buffs gone
  });

  it('combat uses the stacked effective power (7000 attacker KOs a rested 6000)', () => {
    const built = buildState({
      leaderA: LEADER_A,
      leaderB: LEADER_B,
      charsA: [CHAR_5K],
      charsB: [{ ...CHAR_5K, id: '__F8D_C6', name: 'F8D Char 6k', power: 6000 }],
    });
    const s = built.state;
    s.activePlayer = 'A';
    const atk = built.fieldA[0]!;
    const def = built.fieldB[0]!;
    atk.summoningSick = false;
    def.rested = true;
    buff(s, built.leaderInstA.instanceId, atk.instanceId, 1000);
    buff(s, built.leaderInstA.instanceId, atk.instanceId, 1000);
    // seed defender deck/life irrelevant — char target
    let st = applyAction(s, 'A', {
      type: 'DECLARE_ATTACK', attackerInstanceId: atk.instanceId, targetInstanceId: def.instanceId,
    }, { checkInvariants: false }).state;
    st = applyAction(st, 'B', { type: 'SKIP_BLOCKER' }, { checkInvariants: false }).state;
    st = applyAction(st, 'B', { type: 'SKIP_COUNTER' }, { checkInvariants: false }).state;
    const dmg = (st.history as Array<{ type: string; attackerPower?: number }>).filter((h) => h.type === 'DAMAGE_RESOLVED').pop();
    expect(dmg?.attackerPower).toBe(7000); // 5000 + 1000 + 1000
    expect(st.players.B.trash).toContain(def.instanceId); // 7000 >= 6000 → KO
  });
});
