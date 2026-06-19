/**
 * F-14a — ACTIVATE_MAIN is offered only when at least one [Activate: Main]
 * clause is actually viable (condition true + opt unused + cost payable).
 * Generic legality fix (no card IDs). See rules/legality.ts hasViableActivateMainClause.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { CharacterCard, LeaderCard, StageCard } from '../cards/Card.js';
import { getLegalActions } from '../rules/legality.js';
import { applyAction } from '../reducers/applyAction.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';
import { makeOptKey } from '../state/derived/opt.js';
import { buildState, makeInst } from './cards/_fixtures.js';

const LA: LeaderCard = {
  id: '__F14A_LA', name: 'F14a LA', kind: 'leader', colors: ['red'],
  cost: null, power: 5000, counterValue: null, traits: [], keywords: [], effectTags: [], life: 5,
};
const LB: LeaderCard = { ...LA, id: '__F14A_LB' };
const VAN: CharacterCard = {
  id: '__F14A_VAN', name: 'F14a Vanilla', kind: 'character', colors: ['red'],
  cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
};

// synthetic activate_main character with the given clauses
function amChar(id: string, clauses: unknown[]): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost: 3, power: 5000, counterValue: 1000,
    traits: [], keywords: ['activate_main'], effectTags: [],
    effectSpecV2: { schemaVersion: 2, verified: 'human-reviewed', clauses, continuous: [], replacements: [] } as never,
  };
}
const DRAW = { kind: 'draw', magnitude: 1 };

beforeAll(() => { registerAllReducers(); registerAllHandlers(); });

function offered(state: ReturnType<typeof buildState>['state'], instId: string): boolean {
  return getLegalActions(state, 'A').some((a) => a.type === 'ACTIVATE_MAIN' && (a as { instanceId?: string }).instanceId === instId);
}
function setup(card: CharacterCard, opts?: { don?: number; hand?: CharacterCard[] }) {
  const built = buildState({ leaderA: LA, leaderB: LB, charsA: [card], handA: opts?.hand ?? [], donInCostA: opts?.don ?? 10 });
  return { state: built.state, instId: built.state.players.A.field[0]!.instanceId };
}

describe('F-14a — ACTIVATE_MAIN cost/viability pre-check in legality', () => {
  it('1. unpayable DON cost → NOT offered', () => {
    const { state, instId } = setup(amChar('__F14A_DON', [{ trigger: 'activate_main', cost: { donCost: 2 }, action: DRAW, verified: 'human-reviewed' }]), { don: 0 });
    expect(offered(state, instId)).toBe(false);
  });

  it('2. payable DON cost → offered AND resolves', () => {
    const { state, instId } = setup(amChar('__F14A_DON2', [{ trigger: 'activate_main', cost: { donCost: 2 }, action: DRAW, verified: 'human-reviewed' }]), { don: 5 });
    expect(offered(state, instId)).toBe(true);
    const handBefore = state.players.A.hand.length;
    // deck card to draw
    const dk = makeInst(VAN.id, 'A'); state.cardLibrary[VAN.id] = VAN; state.instances[dk.instanceId] = dk; state.players.A.deck.push(dk.instanceId);
    const after = applyAction(state, 'A', { type: 'ACTIVATE_MAIN', instanceId: instId }, { checkInvariants: false }).state;
    expect(after.players.A.hand.length).toBe(handBefore + 1);    // drew 1
    expect(after.players.A.donRested.length).toBeGreaterThanOrEqual(2); // DON cost paid (rested)
  });

  it('3. unpayable hand cost (discardHand, empty hand) → NOT offered', () => {
    const { state, instId } = setup(amChar('__F14A_H', [{ trigger: 'activate_main', cost: { discardHand: 1 }, action: DRAW, verified: 'human-reviewed' }]), { hand: [] });
    expect(offered(state, instId)).toBe(false);
  });

  it('4. payable hand cost → offered', () => {
    const { state, instId } = setup(amChar('__F14A_H2', [{ trigger: 'activate_main', cost: { discardHand: 1 }, action: DRAW, verified: 'human-reviewed' }]), { hand: [VAN] });
    expect(offered(state, instId)).toBe(true);
  });

  it('5. no-cost activate_main → still offered', () => {
    const { state, instId } = setup(amChar('__F14A_NC', [{ trigger: 'activate_main', action: DRAW, verified: 'human-reviewed' }]));
    expect(offered(state, instId)).toBe(true);
  });

  it('6. multiple clauses (one unpayable + one payable) → offered', () => {
    const { state, instId } = setup(amChar('__F14A_MULTI', [
      { trigger: 'activate_main', cost: { discardHand: 1 }, action: DRAW, verified: 'human-reviewed' }, // unpayable (empty hand)
      { trigger: 'activate_main', action: DRAW, verified: 'human-reviewed' },                            // payable (no cost)
    ]), { hand: [] });
    expect(offered(state, instId)).toBe(true);
  });

  it('7. once-per-turn already used, no other viable clause → NOT offered', () => {
    const { state, instId } = setup(amChar('__F14A_OPT', [{ trigger: 'activate_main', opt: true, action: DRAW, verified: 'human-reviewed' }]));
    state.instances[instId]!.perTurn.effectsUsed.push(makeOptKey('opt', 'activate_main', 0));
    expect(offered(state, instId)).toBe(false);
  });

  it('8. stage activate_main with payable cost → offered', () => {
    const stage: StageCard = {
      id: '__F14A_STG', name: 'F14a Stage', kind: 'stage', colors: ['red'], cost: 2, traits: [], keywords: ['activate_main'], effectTags: [],
      effectSpecV2: { schemaVersion: 2, verified: 'human-reviewed', clauses: [{ trigger: 'activate_main', cost: { donCost: 1 }, action: DRAW, verified: 'human-reviewed' }], continuous: [], replacements: [] } as never,
    };
    const built = buildState({ leaderA: LA, leaderB: LB, donInCostA: 5 });
    const s = built.state;
    s.cardLibrary[stage.id] = stage;
    const inst = makeInst(stage.id, 'A'); s.instances[inst.instanceId] = inst; s.players.A.stage = inst;
    expect(offered(s, inst.instanceId)).toBe(true);
    // and NOT offered with 0 DON
    s.players.A.donCostArea = [];
    expect(offered(s, inst.instanceId)).toBe(false);
  });
});
