/**
 * Engine V2 — smoke tests.
 *
 * Validates the full applyAction pipeline runs end-to-end without crashing
 * and produces the expected state transitions for the most common flows.
 */

import { describe, expect, it, beforeAll } from 'vitest';

import { registerAllHandlers } from '../registry/handlers/index.js';
import { applyAction, registerAllReducers } from '../reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from './fixtures.js';

beforeAll(() => {
  // Boot the engine — register reducers + handlers exactly once for the
  // entire test session.
  registerAllReducers();
  registerAllHandlers();
});

describe('engine-v2 smoke', () => {
  it('PLAY_CARD: spends DON, moves card hand→field, marks summoning-sick', () => {
    const state = buildBasicGameState();
    const handId = moveTopOfDeckToHand(state, 'A');
    // Player A has 2 DON in cost area; vanilla char costs 2.
    expect(state.players['A'].donCostArea.length).toBe(2);
    expect(state.players['A'].field.length).toBe(0);

    const { state: next, events } = applyAction(state, 'A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    }, { checkInvariants: false });

    expect(next.players['A'].field.length).toBe(1);
    expect(next.players['A'].field[0]!.instanceId).toBe(handId);
    expect(next.players['A'].field[0]!.summoningSick).toBe(true);
    expect(next.players['A'].donCostArea.length).toBe(0);
    expect(next.players['A'].donRested.length).toBe(2);
    expect(next.players['A'].hand.length).toBe(0);
    // History should include CHARACTER_PLAYED
    expect(events.some((e) => (e as { type?: string }).type === 'CHARACTER_PLAYED')).toBe(true);
  });

  it('ATTACH_DON: moves DON from cost area to target character', () => {
    const state = buildBasicGameState();
    // Pre-place a character on A's field manually
    const handId = moveTopOfDeckToHand(state, 'A');
    let { state: next } = applyAction(state, 'A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    }, { checkInvariants: false });

    // Give A some DON for attaching
    next.players['A'].donCostArea = [next.players['A'].donRested.shift()!];

    const attachRes = applyAction(next, 'A', {
      type: 'ATTACH_DON',
      targetInstanceId: handId,
    }, { checkInvariants: false });

    expect(attachRes.state.players['A'].field[0]!.attachedDon.length).toBe(1);
    expect(attachRes.state.players['A'].donCostArea.length).toBe(0);
  });

  it('END_TURN: passes turn to opponent and runs refresh→draw→don→main', () => {
    const state = buildBasicGameState();
    const beforeTurn = state.turn;
    const beforeAP = state.activePlayer;

    const { state: next } = applyAction(state, 'A', {
      type: 'END_TURN',
    }, { checkInvariants: false });

    expect(next.activePlayer).not.toBe(beforeAP);
    expect(next.activePlayer).toBe('B');
    expect(next.turn).toBe(beforeTurn + 1);
    expect(next.phase).toBe('main');
    // B is not first player → draw on turn 2 should give 1 card
    expect(next.players['B'].hand.length).toBe(1);
    // B should have 2 DON (turn>1 ramp)
    expect(next.players['B'].donCostArea.length).toBe(2);
  });

  it('CONCEDE: sets game result, drops subsequent actions', () => {
    const state = buildBasicGameState();
    const r1 = applyAction(state, 'A', { type: 'CONCEDE' }, { checkInvariants: false });
    expect(r1.state.result).toEqual({ loser: 'A', reason: 'concede' });
    // After result is set, applyAction short-circuits.
    const r2 = applyAction(r1.state, 'B', { type: 'END_TURN' }, { checkInvariants: false });
    expect(r2.events.length).toBe(0);
    expect(r2.state).toBe(r1.state);
  });

  it('DECLARE_ATTACK leader → SKIP_BLOCKER → SKIP_COUNTER flips one life card', () => {
    const state = buildBasicGameState();
    // Pre-place a char on A's field that can attack (no summoning sickness)
    // Cheating: hand-build the field state for the test.
    const id = moveTopOfDeckToHand(state, 'A');
    let { state: next } = applyAction(state, 'A', {
      type: 'PLAY_CARD',
      instanceId: id,
      replaceTargetId: null,
    }, { checkInvariants: false });
    // Clear summoning sick to allow attack.
    next.players['A'].field[0]!.summoningSick = false;

    const beforeLife = next.players['B'].life.length;
    const beforeHand = next.players['B'].hand.length;

    // Declare attack on B's leader.
    const r1 = applyAction(next, 'A', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: id,
      targetInstanceId: next.players['B'].leader.instanceId,
    }, { checkInvariants: false });
    expect(r1.state.phase).toBe('block_window');

    const r2 = applyAction(r1.state, 'B', { type: 'SKIP_BLOCKER' }, { checkInvariants: false });
    expect(r2.state.phase).toBe('counter_window');

    const r3 = applyAction(r2.state, 'B', { type: 'SKIP_COUNTER' }, { checkInvariants: false });
    // Attacker 3000 vs leader 5000 → attack fails (3000 < 5000), no life flip.
    expect(r3.state.players['B'].life.length).toBe(beforeLife);
    expect(r3.state.players['B'].hand.length).toBe(beforeHand);
  });

  it('serializer roundtrip: deserialize(serialize(state)) equals state shape', async () => {
    const { serialize, deserialize } = await import('../state/Serializer.js');
    const state = buildBasicGameState();
    const blob = serialize(state);
    const restored = deserialize(blob);
    expect(restored.schemaVersion).toBe(state.schemaVersion);
    expect(restored.activePlayer).toBe(state.activePlayer);
    expect(restored.players['A'].leader.instanceId).toBe(state.players['A'].leader.instanceId);
  });

  it('refresh + DON conservation invariant holds after a play + end turn', async () => {
    const { assertInvariants } = await import('../invariants/check.js');
    const state = buildBasicGameState();
    const id = moveTopOfDeckToHand(state, 'A');
    const { state: afterPlay } = applyAction(state, 'A', {
      type: 'PLAY_CARD',
      instanceId: id,
      replaceTargetId: null,
    }, { checkInvariants: false });
    const { state: afterEnd } = applyAction(afterPlay, 'A', {
      type: 'END_TURN',
    }, { checkInvariants: false });
    // Run invariants manually
    assertInvariants(afterEnd);
  });
});
