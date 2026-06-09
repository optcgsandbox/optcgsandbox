/**
 * MatchSession — legality validation.
 *
 * Every action is checked against `getLegalActions(state, player)` BEFORE
 * `applyAction` runs. Illegal actions must be rejected with a reason, must
 * NOT mutate state, and must NOT append to the action log.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from '../../engine-v2/__tests__/fixtures.js';
import { MatchSession } from '../MatchSession.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

describe('MatchSession — legality', () => {
  it('rejects an action on the wrong turn with not_your_turn', () => {
    const session = new MatchSession(buildBasicGameState());
    // Player A is active. B trying to ATTACH_DON is not_your_turn.
    const result = session.applyPlayerAction('B', {
      type: 'ATTACH_DON',
      targetInstanceId:
        session.getAuthoritativeState().players['B'].leader.instanceId,
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toBe('not_your_turn');
    }
  });

  it('rejects PLAY_CARD when the instance is not in the hand', () => {
    const session = new MatchSession(buildBasicGameState());
    const result = session.applyPlayerAction('A', {
      type: 'PLAY_CARD',
      instanceId: 'definitely-not-a-real-instance-id',
      replaceTargetId: null,
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toBe('not_in_legal_actions');
    }
  });

  it('does NOT mutate state or log on rejection', () => {
    const session = new MatchSession(buildBasicGameState());
    const hashBefore = session.getStateHash();
    const logBefore = session.getActionLog().length;

    session.applyPlayerAction('B', { type: 'END_TURN' });

    expect(session.getStateHash()).toBe(hashBefore);
    expect(session.getActionLog().length).toBe(logBefore);
  });

  it('CONCEDE is always legal for either player', () => {
    const session = new MatchSession(buildBasicGameState());
    const r1 = session.validateLegalAction('A', { type: 'CONCEDE' });
    const r2 = session.validateLegalAction('B', { type: 'CONCEDE' });
    expect(r1.legal).toBe(true);
    expect(r2.legal).toBe(true);
  });

  it('rejects actions after match has concluded', () => {
    const session = new MatchSession(buildBasicGameState());
    const conc = session.applyPlayerAction('A', { type: 'CONCEDE' });
    expect(conc.accepted).toBe(true);

    const after = session.applyPlayerAction('B', { type: 'END_TURN' });
    expect(after.accepted).toBe(false);
    if (!after.accepted) {
      expect(after.reason).toBe('match_already_concluded');
    }
  });

  it('surfaces a pending-window reason when an attack window is open', () => {
    // Get the engine into block_window via a real attack sequence.
    const initial = buildBasicGameState();
    // CR §6-5-6-1: first player can't attack on turn 1. Bump to turn 3 so
    // A has full attack legality.
    initial.turn = 3;
    const handId = moveTopOfDeckToHand(initial, 'A');
    const session = new MatchSession(initial);
    session.applyPlayerAction('A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    });
    // Force the character off summoning-sick so it can attack. We must mutate
    // the authoritative state for setup — this is fine in tests but never in
    // production code.
    session.getAuthoritativeState().players['A'].field[0]!.summoningSick = false;
    const declare = session.applyPlayerAction('A', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: handId,
      targetInstanceId:
        session.getAuthoritativeState().players['B'].leader.instanceId,
    });
    expect(declare.accepted).toBe(true);
    expect(session.getAuthoritativeState().phase).toBe('block_window');
    expect(session.getAuthoritativeState().pending?.kind).toBe('attack');

    // Trying to END_TURN while a pending attack window is open is rejected.
    const endTurn = session.applyPlayerAction('A', { type: 'END_TURN' });
    expect(endTurn.accepted).toBe(false);
    if (!endTurn.accepted) {
      expect(endTurn.reason).toBe('pending_attack_requires_response');
    }
  });

  it('opponent can dispatch SKIP_BLOCKER during attack window', () => {
    const initial = buildBasicGameState();
    initial.turn = 3;
    const handId = moveTopOfDeckToHand(initial, 'A');
    const session = new MatchSession(initial);
    session.applyPlayerAction('A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    });
    session.getAuthoritativeState().players['A'].field[0]!.summoningSick = false;
    session.applyPlayerAction('A', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: handId,
      targetInstanceId:
        session.getAuthoritativeState().players['B'].leader.instanceId,
    });

    // B is not the active player but can pass the block window.
    const skip = session.applyPlayerAction('B', { type: 'SKIP_BLOCKER' });
    expect(skip.accepted).toBe(true);
  });
});
