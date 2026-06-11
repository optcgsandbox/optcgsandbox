/**
 * F8A-F4 — per-card regressions for the counter-event double-apply cleanup.
 *
 * Pins the post-fix behavior of representative cards from the 10-card
 * residual set (docs/F8_ENGINE_CORRECTNESS_TRIAGE.md Finding 4) through the
 * REAL counter window: DECLARE_ATTACK → SKIP_BLOCKER → PLAY_COUNTER.
 *
 *   - OP12-018 (simple duplicate + missing rider cost): base +2000 applies
 *     exactly ONCE (via counterEventBoost); the "rest 1 DON: −1000 all"
 *     rider now costs 1 DON and is skipped when no DON is available.
 *   - ST04-016 (cost-gated): counterEventBoost is gone; the +4000 applies
 *     only through the clause, paying DON!!−1 by RETURNING the DON to the
 *     DON deck (donCostReturnToDeck), not by resting it.
 *
 * Known F1 carve-out (NOT asserted here): OP01-118 / OP04-074 still carry
 * the per-clause duplicated cost (each clause pays its own DON!!−N) — that
 * is Finding 1 scope and intentionally untouched by F4.
 */

import { beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';

import type { Card, CharacterCard, LeaderCard } from '../cards/Card.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';
import { applyAction } from '../reducers/applyAction.js';
import type { GameState } from '../state/types.js';

import { buildState, makeInst, type BuiltState } from './cards/_fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const LEADER_A: LeaderCard = {
  id: '__F4_LA', name: 'F4 Leader A', kind: 'leader', colors: ['red'],
  cost: null, power: 5000, counterValue: null, traits: [], keywords: [],
  effectTags: [], life: 5,
};
const LEADER_B: LeaderCard = { ...LEADER_A, id: '__F4_LB', name: 'F4 Leader B' };
const B_CHAR: CharacterCard = {
  id: '__F4_BC', name: 'F4 B Char', kind: 'character', colors: ['red'],
  cost: 3, power: 4000, counterValue: 1000, traits: [], keywords: [],
  effectTags: [],
};

let cardsById: Record<string, Card>;

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
  const raw = readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf8');
  cardsById = {};
  for (const c of JSON.parse(raw) as Card[]) cardsById[(c as { id: string }).id] = c;
});

/** A attacks B's leader; B skips blocker; returns state inside counter_window
 *  with `counterCardId` in B's hand. */
function enterCounterWindow(counterCardId: string, donInCostB: number): {
  state: GameState;
  built: BuiltState;
  counterInstanceId: string;
} {
  const built = buildState({
    leaderA: LEADER_A,
    leaderB: LEADER_B,
    charsB: [B_CHAR],
    donInCostB,
  });
  const s = built.state;
  s.activePlayer = 'A';
  s.cardLibrary[counterCardId] = cardsById[counterCardId]!;
  const ce = makeInst(counterCardId, 'B');
  s.instances[ce.instanceId] = ce;
  s.players.B.hand.push(ce.instanceId);

  let st = applyAction(s, 'A', {
    type: 'DECLARE_ATTACK',
    attackerInstanceId: built.leaderInstA.instanceId,
    targetInstanceId: built.leaderInstB.instanceId,
  }, { checkInvariants: false }).state;
  st = applyAction(st, 'B', { type: 'SKIP_BLOCKER' }, { checkInvariants: false }).state;
  expect(st.phase).toBe('counter_window');
  return { state: st, built, counterInstanceId: ce.instanceId };
}

function pendingBoost(st: GameState): number {
  return st.pending?.kind === 'attack'
    ? (st.pending as { pendingAttack: { counterBoost: number } }).pendingAttack.counterBoost
    : -1;
}

describe('F8A-F4 — OP12-018 Color of the Supreme King Haki (was: simple duplicate + free rider)', () => {
  it('base +2000 applies exactly once, via counterEventBoost only', () => {
    const { state, counterInstanceId } = enterCounterWindow('OP12-018', 5);
    const st = applyAction(state, 'B', { type: 'PLAY_COUNTER', instanceId: counterInstanceId }, { checkInvariants: false }).state;

    expect(pendingBoost(st)).toBe(2000); // exactly once — was 2000 boost + 2000 clause
    // no second +2000 leaked onto B's character or leader
    expect(st.players.B.field[0]!.powerModifierThisBattle ?? 0).toBe(0);
    expect(st.players.B.leader.powerModifierThisBattle ?? 0).toBe(0);
  });

  it('rider now COSTS 1 DON: one DON rested, opp leader gets −1000 this turn', () => {
    const { state, counterInstanceId } = enterCounterWindow('OP12-018', 5);
    const donActiveBefore = state.players.B.donCostArea.length; // 5 (card cost is 0)
    const st = applyAction(state, 'B', { type: 'PLAY_COUNTER', instanceId: counterInstanceId }, { checkInvariants: false }).state;

    // donCost rests exactly 1 DON (active → rested pile)
    expect(st.players.B.donCostArea.length).toBe(donActiveBefore - 1);
    expect(st.players.B.donRested.length).toBe(1);
    // −1000 landed on the attacker's leader ('this_turn' → powerModifierOneShot)
    expect(st.players.A.leader.powerModifierOneShot ?? 0).toBe(-1000);
  });

  it('rider is SKIPPED when defender has no active DON (base boost still applies, nothing fires free)', () => {
    const { state, counterInstanceId } = enterCounterWindow('OP12-018', 0);
    const st = applyAction(state, 'B', { type: 'PLAY_COUNTER', instanceId: counterInstanceId }, { checkInvariants: false }).state;

    expect(pendingBoost(st)).toBe(2000); // base unaffected
    expect(st.players.A.leader.powerModifierOneShot ?? 0).toBe(0); // pre-fix: rider fired with no cost at all
    expect(st.players.B.donRested.length).toBe(0);
  });
});

describe('F8A-F4 — ST04-016 Blast Breath (was: cost-gated boost applied free)', () => {
  it('+4000 applies only via the costed clause; DON!!−1 RETURNS the DON to the DON deck', () => {
    const { state, counterInstanceId } = enterCounterWindow('ST04-016', 5);
    const pl = state.players.B;
    const donDeckBefore = pl.donDeck.length;
    const donActiveBefore = pl.donCostArea.length;
    const st = applyAction(state, 'B', { type: 'PLAY_COUNTER', instanceId: counterInstanceId }, { checkInvariants: false }).state;

    expect(pendingBoost(st)).toBe(0); // counterEventBoost is null now — no free +4000
    // clause buff landed once, on the defending side (V0 resolver picks the leader)
    expect(st.players.B.leader.powerModifierThisBattle ?? 0).toBe(4000);
    // card cost 1 (rested) + DON!!−1 (returned to DON deck)
    expect(st.players.B.donDeck.length).toBe(donDeckBefore + 1);
    expect(st.players.B.donCostArea.length).toBe(donActiveBefore - 2);
    expect(st.players.B.donRested.length).toBe(1); // the play cost, not the DON!!−1
  });

  it('with only the play cost payable (1 DON), the DON!!−1 clause cannot fire → no +4000', () => {
    const { state, counterInstanceId } = enterCounterWindow('ST04-016', 1);
    const st = applyAction(state, 'B', { type: 'PLAY_COUNTER', instanceId: counterInstanceId }, { checkInvariants: false }).state;

    expect(pendingBoost(st)).toBe(0);
    expect(st.players.B.leader.powerModifierThisBattle ?? 0).toBe(0); // clause cost unpayable
  });
});
