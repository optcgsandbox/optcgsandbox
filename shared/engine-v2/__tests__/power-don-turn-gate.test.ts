/**
 * F8A-F2 — attached-DON power bonus is owner's-turn-only.
 *
 * CR §6-5-5-2 (docs/optcg-sim/rules-reference.md:223): a Leader/Character
 * "gains +1000 power during your turn per attached DON". The bonus must NOT
 * apply while the opponent is the active player.
 *
 * Repro pedigree: docs/F8_ENGINE_CORRECTNESS_TRIAGE.md Finding 2 — before
 * the fix, a 5000 attacker into a 5000 defender leader holding 1 attached
 * DON read targetPower=6000 on the ATTACKER'S turn and the attack failed.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { CharacterCard, LeaderCard } from '../cards/Card.js';
import { effectivePower } from '../state/derived/power.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';
import { applyAction } from '../reducers/applyAction.js';

import { buildState, makeInst } from './cards/_fixtures.js';

const LEADER_A: LeaderCard = {
  id: '__F2_LA', name: 'F2 Leader A', kind: 'leader', colors: ['red'],
  cost: null, power: 5000, counterValue: null, traits: [], keywords: [],
  effectTags: [], life: 5,
};
const LEADER_B: LeaderCard = { ...LEADER_A, id: '__F2_LB', name: 'F2 Leader B' };
const CHAR_5K: CharacterCard = {
  id: '__F2_C5', name: 'F2 Char 5k', kind: 'character', colors: ['red'],
  cost: 4, power: 5000, counterValue: 1000, traits: [], keywords: [],
  effectTags: [],
};
const VANILLA: CharacterCard = { ...CHAR_5K, id: '__F2_VAN', name: 'F2 Vanilla', power: 3000 };

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

describe('F8A-F2 — attached DON +1000 is owner-turn-only (CR §6-5-5-2)', () => {
  it('owner turn: leader and character with 1 attached DON each read +1000', () => {
    const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B, charsA: [CHAR_5K] });
    const s = built.state;
    s.activePlayer = 'A';
    built.leaderInstA.attachedDon.push('don-f2-1');
    built.fieldA[0]!.attachedDon.push('don-f2-2');

    expect(effectivePower(s, built.leaderInstA)).toBe(6000);
    expect(effectivePower(s, built.fieldA[0]!)).toBe(6000);
  });

  it('owner turn: rested attached DON also counts (+1000 per DON either state)', () => {
    const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B });
    const s = built.state;
    s.activePlayer = 'A';
    built.leaderInstA.attachedDon.push('don-f2-a');
    built.leaderInstA.attachedDonRested.push('don-f2-b');

    expect(effectivePower(s, built.leaderInstA)).toBe(7000);
  });

  it("opponent turn: the same attached DON adds NOTHING to the defender's power", () => {
    const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B, charsB: [CHAR_5K] });
    const s = built.state;
    s.activePlayer = 'A'; // A is active; B's cards are defending

    const defLeader = built.leaderInstB;
    const defChar = built.fieldB[0]!;
    defLeader.attachedDon.push('don-f2-x');
    defChar.attachedDon.push('don-f2-y', 'don-f2-z');

    expect(effectivePower(s, defLeader)).toBe(5000);
    expect(effectivePower(s, defChar)).toBe(5000);
  });

  it('combat regression: 5000 attacker beats 5000 defender leader holding 1 attached DON (defender reads 5000, loses 1 life)', () => {
    const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B });
    const s = built.state;
    s.activePlayer = 'A';
    built.leaderInstB.attachedDon.push('don-f2-def');

    // Give B observable life (vanilla cards — no trigger clauses, so no
    // trigger-window suspension on the flip).
    s.cardLibrary[VANILLA.id] = VANILLA;
    for (let i = 0; i < 2; i++) {
      const li = makeInst(VANILLA.id, 'B');
      s.instances[li.instanceId] = li;
      s.players.B.life.push(li.instanceId);
    }
    const lifeBefore = s.players.B.life.length;

    let st = applyAction(s, 'A', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: built.leaderInstA.instanceId,
      targetInstanceId: built.leaderInstB.instanceId,
    }, { checkInvariants: false }).state;
    st = applyAction(st, 'B', { type: 'SKIP_BLOCKER' }, { checkInvariants: false }).state;
    st = applyAction(st, 'B', { type: 'SKIP_COUNTER' }, { checkInvariants: false }).state;

    const dmg = (st.history as Array<{ type: string; attackerPower?: number; targetPower?: number }>)
      .filter((h) => h.type === 'DAMAGE_RESOLVED')
      .pop();
    expect(dmg?.attackerPower).toBe(5000);
    expect(dmg?.targetPower).toBe(5000); // pre-fix this read 6000
    expect(st.players.B.life.length).toBe(lifeBefore - 1); // tie → attacker wins (CR §7-1-4-1)
  });

  it("combat: attacker's OWN attached DON still counts on their turn (6000 vs 5000 char is a KO)", () => {
    const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B, charsA: [CHAR_5K], charsB: [CHAR_5K] });
    const s = built.state;
    s.activePlayer = 'A';
    const atk = built.fieldA[0]!;
    const def = built.fieldB[0]!;
    atk.summoningSick = false;
    atk.attachedDon.push('don-f2-atk');
    def.rested = true; // chars are only attackable while rested

    let st = applyAction(s, 'A', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: atk.instanceId,
      targetInstanceId: def.instanceId,
    }, { checkInvariants: false }).state;
    st = applyAction(st, 'B', { type: 'SKIP_BLOCKER' }, { checkInvariants: false }).state;
    st = applyAction(st, 'B', { type: 'SKIP_COUNTER' }, { checkInvariants: false }).state;

    expect(st.players.B.field.some((c) => c.instanceId === def.instanceId)).toBe(false); // KO'd
    expect(st.players.B.trash).toContain(def.instanceId);
  });
});
