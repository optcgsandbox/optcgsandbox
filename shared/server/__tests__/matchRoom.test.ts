/**
 * MatchRoom — transport-agnostic protocol tests. Phase F-4b.
 *
 * Validates the message handlers in isolation from any real transport.
 * No sockets, no servers, no async I/O.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from '../../engine-v2/__tests__/fixtures.js';
import { MatchSession } from '../MatchSession.js';
import { MatchRoom } from '../transport/MatchRoom.js';
import type {
  ClientMessage,
  MatchRoomDispatch,
  ServerMessage,
} from '../transport/protocol.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

const A_CLIENT = 'client-A';
const B_CLIENT = 'client-B';

function build(): { room: MatchRoom; session: MatchSession; handId: string } {
  const initial = buildBasicGameState();
  // Bump past turn-1 attack restriction so DECLARE_ATTACK can be reached
  // by tests later if needed.
  initial.turn = 3;
  const handId = moveTopOfDeckToHand(initial, 'A');
  const session = new MatchSession(initial);
  const room = new MatchRoom(session);
  return { room, session, handId };
}

function expectOne(dispatch: MatchRoomDispatch, type: ServerMessage['type']): ServerMessage {
  expect(dispatch.toClient.length).toBe(1);
  expect(dispatch.toClient[0]!.type).toBe(type);
  return dispatch.toClient[0]!;
}

function findBroadcast(
  dispatch: MatchRoomDispatch,
  clientId: string,
): ServerMessage | undefined {
  return dispatch.broadcasts.find((b) => b.clientId === clientId)?.message;
}

// ─────────────────────────────────────────────────────────────────────
// join / opponent_joined
// ─────────────────────────────────────────────────────────────────────

describe('MatchRoom — join', () => {
  it('A joins and receives joined with projected state', () => {
    const { room } = build();
    const res = room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    const msg = expectOne(res, 'joined');
    if (msg.type !== 'joined') throw new Error('unreachable');
    expect(msg.player).toBe('A');
    expect(msg.state.viewer).toBe('A');
    expect(typeof msg.hash).toBe('string');
    expect(msg.lastSeq).toBe(0);
    expect(res.broadcasts.length).toBe(0);
  });

  it('B joining after A delivers opponent_joined to A', () => {
    const { room } = build();
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    const res = room.handleMessage({ type: 'join', player: 'B', clientId: B_CLIENT });

    expectOne(res, 'joined');
    const broadcast = findBroadcast(res, A_CLIENT);
    expect(broadcast).toBeDefined();
    expect(broadcast!.type).toBe('opponent_joined');
    if (broadcast!.type === 'opponent_joined') {
      expect(broadcast!.player).toBe('B');
    }
  });

  it('seat collision: a different clientId joining a taken seat is rejected', () => {
    const { room } = build();
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });

    const res = room.handleMessage({
      type: 'join',
      player: 'A',
      clientId: 'imposter',
    });
    const err = expectOne(res, 'error');
    if (err.type === 'error') expect(err.reason).toBe('seat_occupied');
  });

  it('same clientId re-joining same seat is a no-op reconnect (sends joined again)', () => {
    const { room } = build();
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    const res = room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    expectOne(res, 'joined');
    expect(res.broadcasts.length).toBe(0);
  });

  it('same clientId trying to swap seats is rejected', () => {
    const { room } = build();
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    const res = room.handleMessage({ type: 'join', player: 'B', clientId: A_CLIENT });
    const err = expectOne(res, 'error');
    if (err.type === 'error') expect(err.reason).toMatch(/already_seated_as/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// submit_action
// ─────────────────────────────────────────────────────────────────────

describe('MatchRoom — submit_action', () => {
  let room: MatchRoom;
  let session: MatchSession;
  let handId: string;

  beforeEach(() => {
    ({ room, session, handId } = build());
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    room.handleMessage({ type: 'join', player: 'B', clientId: B_CLIENT });
  });

  it('unknown client submitting an action receives error unknown_client', () => {
    const res = room.handleMessage({
      type: 'submit_action',
      clientId: 'ghost',
      action: { type: 'END_TURN' },
      clientSeq: 1,
    });
    const err = expectOne(res, 'error');
    if (err.type === 'error') expect(err.reason).toBe('unknown_client');
    // Server seq unchanged.
    expect(room.getServerSeq()).toBe(0);
  });

  it('accepted action: action_accepted to sender + snapshot broadcast to opponent', () => {
    const beforeHash = session.getStateHash();
    const res = room.handleMessage({
      type: 'submit_action',
      clientId: A_CLIENT,
      action: { type: 'PLAY_CARD', instanceId: handId, replaceTargetId: null },
      clientSeq: 1,
    });

    const accepted = expectOne(res, 'action_accepted');
    if (accepted.type !== 'action_accepted') throw new Error('unreachable');
    expect(accepted.clientSeq).toBe(1);
    expect(accepted.serverSeq).toBe(1);
    expect(accepted.hash).not.toBe(beforeHash);
    expect(accepted.state.viewer).toBe('A');

    const broadcast = findBroadcast(res, B_CLIENT);
    expect(broadcast).toBeDefined();
    expect(broadcast!.type).toBe('snapshot');
    if (broadcast!.type === 'snapshot') {
      expect(broadcast!.state.viewer).toBe('B');
      expect(broadcast!.hash).toBe(accepted.hash);
      expect(broadcast!.serverSeq).toBe(1);
    }
  });

  it('illegal action: action_rejected, no state mutation, no serverSeq bump', () => {
    const beforeHash = session.getStateHash();
    const res = room.handleMessage({
      type: 'submit_action',
      clientId: B_CLIENT, // B's turn it is NOT
      action: { type: 'END_TURN' },
      clientSeq: 1,
    });
    const rej = expectOne(res, 'action_rejected');
    if (rej.type !== 'action_rejected') throw new Error('unreachable');
    expect(rej.clientSeq).toBe(1);
    expect(rej.hash).toBe(beforeHash);
    expect(res.broadcasts.length).toBe(0);
    expect(room.getServerSeq()).toBe(0);
    expect(session.getStateHash()).toBe(beforeHash);
  });

  it('duplicate clientSeq is REJECTED with reason duplicate_client_seq', () => {
    room.handleMessage({
      type: 'submit_action',
      clientId: A_CLIENT,
      action: { type: 'PLAY_CARD', instanceId: handId, replaceTargetId: null },
      clientSeq: 1,
    });
    const dup = room.handleMessage({
      type: 'submit_action',
      clientId: A_CLIENT,
      action: { type: 'END_TURN' },
      clientSeq: 1, // same as before
    });
    const rej = expectOne(dup, 'action_rejected');
    if (rej.type !== 'action_rejected') throw new Error('unreachable');
    expect(rej.reason).toBe('duplicate_client_seq');
    // Server seq did not advance past the first accepted action.
    expect(room.getServerSeq()).toBe(1);
  });

  it('non-monotonic (lower) clientSeq is also rejected as duplicate', () => {
    room.handleMessage({
      type: 'submit_action',
      clientId: A_CLIENT,
      action: { type: 'PLAY_CARD', instanceId: handId, replaceTargetId: null },
      clientSeq: 5,
    });
    const stale = room.handleMessage({
      type: 'submit_action',
      clientId: A_CLIENT,
      action: { type: 'END_TURN' },
      clientSeq: 3,
    });
    const rej = expectOne(stale, 'action_rejected');
    if (rej.type === 'action_rejected') {
      expect(rej.reason).toBe('duplicate_client_seq');
    }
  });

  it('serverSeq increments only on accepted actions', () => {
    expect(room.getServerSeq()).toBe(0);

    // Illegal — no bump.
    room.handleMessage({
      type: 'submit_action',
      clientId: B_CLIENT,
      action: { type: 'END_TURN' },
      clientSeq: 1,
    });
    expect(room.getServerSeq()).toBe(0);

    // Legal — bump to 1.
    room.handleMessage({
      type: 'submit_action',
      clientId: A_CLIENT,
      action: { type: 'PLAY_CARD', instanceId: handId, replaceTargetId: null },
      clientSeq: 1,
    });
    expect(room.getServerSeq()).toBe(1);

    // Legal — bump to 2.
    room.handleMessage({
      type: 'submit_action',
      clientId: A_CLIENT,
      action: { type: 'END_TURN' },
      clientSeq: 2,
    });
    expect(room.getServerSeq()).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// request_snapshot + projection
// ─────────────────────────────────────────────────────────────────────

describe('MatchRoom — snapshots + hidden-info projection', () => {
  it('request_snapshot returns the requester-projected state', () => {
    const { room } = build();
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    room.handleMessage({ type: 'join', player: 'B', clientId: B_CLIENT });

    const aSnap = room.handleMessage({ type: 'request_snapshot', clientId: A_CLIENT });
    const bSnap = room.handleMessage({ type: 'request_snapshot', clientId: B_CLIENT });

    const aMsg = expectOne(aSnap, 'snapshot');
    const bMsg = expectOne(bSnap, 'snapshot');
    if (aMsg.type === 'snapshot') expect(aMsg.state.viewer).toBe('A');
    if (bMsg.type === 'snapshot') expect(bMsg.state.viewer).toBe('B');
  });

  it('A never sees B hand/deck identifiable content', () => {
    const initial = buildBasicGameState();
    initial.turn = 3;
    // Stash a known card in B's hand.
    const bHandId = moveTopOfDeckToHand(initial, 'B');
    const session = new MatchSession(initial);
    const room = new MatchRoom(session);
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });

    const snap = room.handleMessage({ type: 'request_snapshot', clientId: A_CLIENT });
    const msg = expectOne(snap, 'snapshot');
    if (msg.type !== 'snapshot') throw new Error('unreachable');
    // B's hand opaque.
    expect(msg.state.players['B'].handHidden).toBe(true);
    expect(msg.state.players['B'].hand).not.toContain(bHandId);
    expect(msg.state.instances[bHandId]).toBeUndefined();
    // B's deck opaque.
    expect(msg.state.players['B'].deckHidden).toBe(true);
  });

  it('B never sees A hand/deck identifiable content', () => {
    const initial = buildBasicGameState();
    initial.turn = 3;
    const aHandId = moveTopOfDeckToHand(initial, 'A');
    const session = new MatchSession(initial);
    const room = new MatchRoom(session);
    room.handleMessage({ type: 'join', player: 'B', clientId: B_CLIENT });

    const snap = room.handleMessage({ type: 'request_snapshot', clientId: B_CLIENT });
    const msg = expectOne(snap, 'snapshot');
    if (msg.type !== 'snapshot') throw new Error('unreachable');
    expect(msg.state.players['A'].handHidden).toBe(true);
    expect(msg.state.players['A'].hand).not.toContain(aHandId);
    expect(msg.state.instances[aHandId]).toBeUndefined();
    expect(msg.state.players['A'].deckHidden).toBe(true);
  });

  it('unknown client requesting a snapshot is rejected', () => {
    const { room } = build();
    const res = room.handleMessage({ type: 'request_snapshot', clientId: 'ghost' });
    const err = expectOne(res, 'error');
    if (err.type === 'error') expect(err.reason).toBe('unknown_client');
  });
});

// ─────────────────────────────────────────────────────────────────────
// leave / reconnect
// ─────────────────────────────────────────────────────────────────────

describe('MatchRoom — leave + reconnect', () => {
  it('leave broadcasts opponent_left to the other client', () => {
    const { room } = build();
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    room.handleMessage({ type: 'join', player: 'B', clientId: B_CLIENT });

    const res = room.handleMessage({ type: 'leave', clientId: A_CLIENT });
    expect(res.toClient.length).toBe(0);
    const broadcast = findBroadcast(res, B_CLIENT);
    expect(broadcast).toBeDefined();
    expect(broadcast!.type).toBe('opponent_left');
    if (broadcast!.type === 'opponent_left') expect(broadcast!.player).toBe('A');
  });

  it('leave of an unknown client returns error unknown_client', () => {
    const { room } = build();
    const res = room.handleMessage({ type: 'leave', clientId: 'ghost' });
    const err = expectOne(res, 'error');
    if (err.type === 'error') expect(err.reason).toBe('unknown_client');
  });

  it('after leave, the seat can be reclaimed by a different clientId', () => {
    const { room } = build();
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    room.handleMessage({ type: 'leave', clientId: A_CLIENT });
    const res = room.handleMessage({ type: 'join', player: 'A', clientId: 'A-reconnect-2' });
    expectOne(res, 'joined');
    expect(room.getSeatedClient('A')).toBe('A-reconnect-2');
  });

  it('same clientId reconnecting (no leave) re-receives joined; opponent NOT re-notified', () => {
    const { room } = build();
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    room.handleMessage({ type: 'join', player: 'B', clientId: B_CLIENT });
    const res = room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    expectOne(res, 'joined');
    // B should NOT see a second opponent_joined.
    expect(findBroadcast(res, B_CLIENT)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Exhaustiveness sanity
// ─────────────────────────────────────────────────────────────────────

describe('MatchRoom — protocol exhaustiveness', () => {
  it('unknown message types produce error without throwing', () => {
    const { room } = build();
    const res = room.handleMessage({
      type: 'NOT_A_REAL_TYPE',
    } as unknown as ClientMessage);
    const err = expectOne(res, 'error');
    if (err.type === 'error') expect(err.reason).toMatch(/unknown_message_type/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// F-7e: server-authoritative legalActions in state-bearing messages
// ─────────────────────────────────────────────────────────────────────

describe('MatchRoom — F-7e legalActions surfacing', () => {
  it('joined carries legalActions for the joining viewer', () => {
    const { room } = build();
    const dispatch = room.handleMessage({
      type: 'join',
      player: 'A',
      clientId: A_CLIENT,
    });
    const msg = expectOne(dispatch, 'joined');
    if (msg.type !== 'joined') throw new Error('unreachable');
    expect(Array.isArray(msg.legalActions)).toBe(true);
    // A has CONCEDE + END_TURN + ATTACH_DON candidates at minimum at
    // turn 3 main phase — verified via the smoke pattern below.
    expect(msg.legalActions.length).toBeGreaterThan(0);
    // Engine V2 always includes CONCEDE in the legality enumeration.
    expect(msg.legalActions.some((a) => a.type === 'CONCEDE')).toBe(true);
  });

  it('snapshot carries legalActions for the requester', () => {
    const { room } = build();
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    const res = room.handleMessage({
      type: 'request_snapshot',
      clientId: A_CLIENT,
    });
    const msg = expectOne(res, 'snapshot');
    if (msg.type === 'snapshot') {
      expect(Array.isArray(msg.legalActions)).toBe(true);
      expect(msg.legalActions.length).toBeGreaterThan(0);
    }
  });

  it('action_accepted carries POST-action legalActions for the sender', () => {
    const { room, handId } = build();
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    room.handleMessage({ type: 'join', player: 'B', clientId: B_CLIENT });
    const res = room.handleMessage({
      type: 'submit_action',
      clientId: A_CLIENT,
      action: { type: 'PLAY_CARD', instanceId: handId, replaceTargetId: null },
      clientSeq: 1,
    });
    const accepted = res.toClient[0]!;
    if (accepted.type !== 'action_accepted') throw new Error('expected action_accepted');
    expect(Array.isArray(accepted.legalActions)).toBe(true);
    // After playing a card, ATTACH_DON gains a new target — the new field
    // character. We don't pin the exact count but assert non-emptiness.
    expect(accepted.legalActions.length).toBeGreaterThan(0);
  });

  it('snapshot broadcast to opponent carries opponent-specific legalActions', () => {
    const { room, handId } = build();
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    room.handleMessage({ type: 'join', player: 'B', clientId: B_CLIENT });
    const res = room.handleMessage({
      type: 'submit_action',
      clientId: A_CLIENT,
      action: { type: 'PLAY_CARD', instanceId: handId, replaceTargetId: null },
      clientSeq: 1,
    });
    const broadcast = findBroadcast(res, B_CLIENT);
    if (!broadcast || broadcast.type !== 'snapshot') {
      throw new Error('expected snapshot broadcast to B');
    }
    expect(Array.isArray(broadcast.legalActions)).toBe(true);
    // B is the inactive player → only CONCEDE.
    expect(broadcast.legalActions.map((a) => a.type)).toEqual(['CONCEDE']);
  });

  it('action_rejected carries CURRENT legalActions and does not bump serverSeq', () => {
    const { room } = build();
    room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    room.handleMessage({ type: 'join', player: 'B', clientId: B_CLIENT });

    expect(room.getServerSeq()).toBe(0);
    // B is the inactive player; END_TURN is illegal for them.
    const res = room.handleMessage({
      type: 'submit_action',
      clientId: B_CLIENT,
      action: { type: 'END_TURN' },
      clientSeq: 1,
    });
    const rej = res.toClient[0]!;
    if (rej.type !== 'action_rejected') throw new Error('expected action_rejected');
    expect(Array.isArray(rej.legalActions)).toBe(true);
    // B's legal actions outside their turn: only CONCEDE.
    expect(rej.legalActions.map((a) => a.type)).toEqual(['CONCEDE']);
    expect(room.getServerSeq()).toBe(0);
  });

  it('A and B receive DIFFERENT legalActions reflecting per-viewer projection', () => {
    const { room } = build();
    const aJoin = room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    const bJoin = room.handleMessage({ type: 'join', player: 'B', clientId: B_CLIENT });
    const a = aJoin.toClient[0]!;
    const b = bJoin.toClient[0]!;
    if (a.type !== 'joined' || b.type !== 'joined') throw new Error('unreachable');

    // A is the active player at turn 3 main phase → many actions
    // (CONCEDE + END_TURN + ATTACH_DON candidates).
    expect(a.legalActions.length).toBeGreaterThan(1);
    // B is inactive → only CONCEDE.
    expect(b.legalActions.map((x) => x.type)).toEqual(['CONCEDE']);
  });
});

describe('MatchRoom — F-7e hidden-info safety in legalActions', () => {
  it("A's legalActions never reference any instanceId in B's hand", () => {
    const initial = buildBasicGameState();
    initial.turn = 3;
    // Move some cards into B's hand.
    const bHand1 = moveTopOfDeckToHand(initial, 'B');
    const bHand2 = moveTopOfDeckToHand(initial, 'B');
    const session = new MatchSession(initial);
    const room = new MatchRoom(session);
    const aJoin = room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    const msg = aJoin.toClient[0]!;
    if (msg.type !== 'joined') throw new Error('unreachable');

    const bHandIds = new Set([bHand1, bHand2]);
    const serialized = JSON.stringify(msg.legalActions);
    for (const id of bHandIds) {
      expect(serialized.includes(id)).toBe(false);
    }
  });

  it("B's legalActions never reference any instanceId in A's hand", () => {
    const initial = buildBasicGameState();
    initial.turn = 3;
    const aHand1 = moveTopOfDeckToHand(initial, 'A');
    const aHand2 = moveTopOfDeckToHand(initial, 'A');
    const session = new MatchSession(initial);
    const room = new MatchRoom(session);
    const bJoin = room.handleMessage({ type: 'join', player: 'B', clientId: B_CLIENT });
    const msg = bJoin.toClient[0]!;
    if (msg.type !== 'joined') throw new Error('unreachable');

    const aHandIds = new Set([aHand1, aHand2]);
    const serialized = JSON.stringify(msg.legalActions);
    for (const id of aHandIds) {
      expect(serialized.includes(id)).toBe(false);
    }
  });

  it("A's legalActions never reference any instanceId in B's deck", () => {
    const initial = buildBasicGameState();
    initial.turn = 3;
    const bDeckIds = [...initial.players['B'].deck];
    const session = new MatchSession(initial);
    const room = new MatchRoom(session);
    const aJoin = room.handleMessage({ type: 'join', player: 'A', clientId: A_CLIENT });
    const msg = aJoin.toClient[0]!;
    if (msg.type !== 'joined') throw new Error('unreachable');

    const serialized = JSON.stringify(msg.legalActions);
    for (const id of bDeckIds) {
      expect(serialized.includes(id)).toBe(false);
    }
  });
});
