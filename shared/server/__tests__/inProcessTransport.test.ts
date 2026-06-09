/**
 * InProcessTransport — Phase F-5a.
 *
 * Validates the synchronous, in-memory adapter around `MatchRoom`. The
 * adapter exists to exercise the F-4b protocol with two simulated
 * clients without any networking, so these tests focus on inbox routing,
 * defensive copies, and end-to-end message flow — not engine semantics.
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
import { InProcessTransport } from '../transport/InProcessTransport.js';
import type { ServerMessage } from '../transport/protocol.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

const A_CLIENT = 'A-socket';
const B_CLIENT = 'B-socket';

function build(): {
  transport: InProcessTransport;
  room: MatchRoom;
  session: MatchSession;
  handIdA: string;
} {
  const initial = buildBasicGameState();
  initial.turn = 3; // bypass turn-1 attack restriction for downstream tests
  const handIdA = moveTopOfDeckToHand(initial, 'A');
  const session = new MatchSession(initial);
  const room = new MatchRoom(session);
  const transport = new InProcessTransport(room);
  return { transport, room, session, handIdA };
}

function typesOf(messages: ReadonlyArray<ServerMessage>): string[] {
  return messages.map((m) => m.type);
}

// ─────────────────────────────────────────────────────────────────────
// connect / opponent_joined
// ─────────────────────────────────────────────────────────────────────

describe('InProcessTransport — connect + opponent_joined routing', () => {
  it('A connects and receives joined in both return value and inbox', () => {
    const { transport } = build();
    const out = transport.connect(A_CLIENT, 'A');
    expect(typesOf(out)).toEqual(['joined']);
    // Inbox sees the same message (until drained).
    expect(typesOf(transport.inbox(A_CLIENT))).toEqual(['joined']);
  });

  it("B connecting after A delivers opponent_joined to A's inbox (not return)", () => {
    const { transport } = build();
    transport.connect(A_CLIENT, 'A');
    transport.drain(A_CLIENT); // clear A's inbox of the earlier joined

    const out = transport.connect(B_CLIENT, 'B');
    // B's own return contains only `joined`; the opponent_joined is a
    // broadcast routed into A's inbox, not B's return.
    expect(typesOf(out)).toEqual(['joined']);

    expect(typesOf(transport.inbox(A_CLIENT))).toEqual(['opponent_joined']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// request_snapshot
// ─────────────────────────────────────────────────────────────────────

describe('InProcessTransport — request_snapshot', () => {
  it('A receives a snapshot projected for viewer A', () => {
    const { transport } = build();
    transport.connect(A_CLIENT, 'A');
    transport.drain(A_CLIENT);

    const out = transport.send(A_CLIENT, { type: 'request_snapshot' });
    expect(out.length).toBe(1);
    const msg = out[0]!;
    expect(msg.type).toBe('snapshot');
    if (msg.type === 'snapshot') expect(msg.state.viewer).toBe('A');
  });
});

// ─────────────────────────────────────────────────────────────────────
// submit_action — accept path
// ─────────────────────────────────────────────────────────────────────

describe('InProcessTransport — submit_action', () => {
  let transport: InProcessTransport;
  let room: MatchRoom;
  let session: MatchSession;
  let handIdA: string;

  beforeEach(() => {
    ({ transport, room, session, handIdA } = build());
    transport.connect(A_CLIENT, 'A');
    transport.connect(B_CLIENT, 'B');
    transport.drain(A_CLIENT);
    transport.drain(B_CLIENT);
  });

  it('A submits a legal action: A receives action_accepted, B receives snapshot, serverSeq bumps', () => {
    const before = session.getStateHash();
    const out = transport.send(A_CLIENT, {
      type: 'submit_action',
      action: { type: 'PLAY_CARD', instanceId: handIdA, replaceTargetId: null },
      clientSeq: 1,
    });
    expect(typesOf(out)).toEqual(['action_accepted']);

    const a0 = out[0]!;
    if (a0.type === 'action_accepted') {
      expect(a0.clientSeq).toBe(1);
      expect(a0.serverSeq).toBe(1);
      expect(a0.hash).not.toBe(before);
      expect(a0.state.viewer).toBe('A');
    }

    // B's inbox should now have ONE broadcast snapshot projected for B.
    const bInbox = transport.inbox(B_CLIENT);
    expect(typesOf(bInbox)).toEqual(['snapshot']);
    const bMsg = bInbox[0]!;
    if (bMsg.type === 'snapshot') {
      expect(bMsg.state.viewer).toBe('B');
      expect(bMsg.serverSeq).toBe(1);
    }

    expect(room.getServerSeq()).toBe(1);
  });

  it('illegal action: sender gets action_rejected, opponent inbox stays empty, hash + serverSeq unchanged', () => {
    const hashBefore = session.getStateHash();
    // B sending an END_TURN while A's turn — illegal.
    const out = transport.send(B_CLIENT, {
      type: 'submit_action',
      action: { type: 'END_TURN' },
      clientSeq: 1,
    });
    expect(typesOf(out)).toEqual(['action_rejected']);

    expect(transport.inbox(A_CLIENT).length).toBe(0);
    expect(room.getServerSeq()).toBe(0);
    expect(session.getStateHash()).toBe(hashBefore);
  });

  it('duplicate clientSeq is rejected per MatchRoom policy (duplicate_client_seq)', () => {
    transport.send(A_CLIENT, {
      type: 'submit_action',
      action: { type: 'PLAY_CARD', instanceId: handIdA, replaceTargetId: null },
      clientSeq: 1,
    });
    transport.drain(A_CLIENT);

    const out = transport.send(A_CLIENT, {
      type: 'submit_action',
      action: { type: 'END_TURN' },
      clientSeq: 1, // dup
    });
    expect(typesOf(out)).toEqual(['action_rejected']);
    const r0 = out[0]!;
    if (r0.type === 'action_rejected') {
      expect(r0.reason).toBe('duplicate_client_seq');
    }
  });

  it('unknown client send still flows through MatchRoom and lands an error in their inbox', () => {
    // Note: we never `connect`'d this id; the adapter still ensures an
    // inbox exists so the error message has a place to live.
    const out = transport.send('ghost', {
      type: 'submit_action',
      action: { type: 'END_TURN' },
      clientSeq: 1,
    });
    expect(typesOf(out)).toEqual(['error']);
    const e = out[0]!;
    if (e.type === 'error') expect(e.reason).toBe('unknown_client');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Hidden-info projection
// ─────────────────────────────────────────────────────────────────────

describe('InProcessTransport — hidden info routing', () => {
  it('A inbox never carries identifiable B hand/deck content', () => {
    const initial = buildBasicGameState();
    initial.turn = 3;
    const bHandId = moveTopOfDeckToHand(initial, 'B');
    const session = new MatchSession(initial);
    const room = new MatchRoom(session);
    const t = new InProcessTransport(room);

    t.connect(A_CLIENT, 'A');
    t.send(A_CLIENT, { type: 'request_snapshot' });

    const messages = t.drain(A_CLIENT);
    for (const m of messages) {
      if (m.type === 'joined' || m.type === 'snapshot') {
        expect(m.state.players['B'].handHidden).toBe(true);
        expect(m.state.players['B'].deckHidden).toBe(true);
        expect(m.state.players['B'].hand).not.toContain(bHandId);
        expect(m.state.instances[bHandId]).toBeUndefined();
      }
    }
  });

  it('B inbox never carries identifiable A hand/deck content', () => {
    const initial = buildBasicGameState();
    initial.turn = 3;
    const aHandId = moveTopOfDeckToHand(initial, 'A');
    const session = new MatchSession(initial);
    const room = new MatchRoom(session);
    const t = new InProcessTransport(room);

    t.connect(B_CLIENT, 'B');
    t.send(B_CLIENT, { type: 'request_snapshot' });

    const messages = t.drain(B_CLIENT);
    for (const m of messages) {
      if (m.type === 'joined' || m.type === 'snapshot') {
        expect(m.state.players['A'].handHidden).toBe(true);
        expect(m.state.players['A'].deckHidden).toBe(true);
        expect(m.state.players['A'].hand).not.toContain(aHandId);
        expect(m.state.instances[aHandId]).toBeUndefined();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// leave / reconnect
// ─────────────────────────────────────────────────────────────────────

describe('InProcessTransport — leave + reconnect', () => {
  it('leaving client receives no extra messages; opponent receives opponent_left', () => {
    const { transport } = build();
    transport.connect(A_CLIENT, 'A');
    transport.connect(B_CLIENT, 'B');
    transport.drain(A_CLIENT);
    transport.drain(B_CLIENT);

    const out = transport.send(A_CLIENT, { type: 'leave' });
    expect(out.length).toBe(0); // no toClient response from MatchRoom.leave

    const bMessages = transport.inbox(B_CLIENT);
    expect(typesOf(bMessages)).toEqual(['opponent_left']);
    const ev = bMessages[0]!;
    if (ev.type === 'opponent_left') expect(ev.player).toBe('A');
  });

  it('same clientId reconnecting same seat re-receives joined', () => {
    const { transport } = build();
    transport.connect(A_CLIENT, 'A');
    transport.drain(A_CLIENT);

    const out = transport.connect(A_CLIENT, 'A'); // reconnect
    expect(typesOf(out)).toEqual(['joined']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// inbox/drain defensive copies
// ─────────────────────────────────────────────────────────────────────

describe('InProcessTransport — defensive copies', () => {
  it('mutating the drain() result does not affect stored inbox', () => {
    const { transport } = build();
    transport.connect(A_CLIENT, 'A');

    const first = transport.drain(A_CLIENT);
    expect(first.length).toBeGreaterThan(0);
    // Tamper with returned array.
    first.length = 0;
    (first as ServerMessage[]).push({ type: 'error', reason: 'forged' });

    // Inbox should be empty (it was drained), independent of mutations.
    expect(transport.inbox(A_CLIENT).length).toBe(0);

    // A subsequent connect re-populates fresh — make sure we didn't poison.
    transport.send(A_CLIENT, { type: 'request_snapshot' });
    const inbox = transport.inbox(A_CLIENT);
    expect(typesOf(inbox)).toEqual(['snapshot']);
    expect(inbox.every((m) => m.type !== 'error')).toBe(true);
  });

  it('mutating the inbox() result does not affect stored inbox', () => {
    const { transport } = build();
    transport.connect(A_CLIENT, 'A');
    const snapshot = transport.inbox(A_CLIENT) as ServerMessage[];
    expect(snapshot.length).toBe(1);
    snapshot.length = 0; // mutate the returned copy

    // Stored inbox should still contain the joined.
    expect(transport.inbox(A_CLIENT).length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Scripted mini-flow
// ─────────────────────────────────────────────────────────────────────

describe('InProcessTransport — scripted two-client mini-flow', () => {
  it('A connect → B connect → A action → B rejected → both snapshot, hashes consistent', () => {
    const { transport, room, session, handIdA } = build();

    transport.connect(A_CLIENT, 'A');
    transport.connect(B_CLIENT, 'B');
    transport.drain(A_CLIENT);
    transport.drain(B_CLIENT);

    // A plays a card — accepted.
    const aOut = transport.send(A_CLIENT, {
      type: 'submit_action',
      action: { type: 'PLAY_CARD', instanceId: handIdA, replaceTargetId: null },
      clientSeq: 1,
    });
    expect(typesOf(aOut)).toEqual(['action_accepted']);

    // B tries an END_TURN — rejected (A's turn).
    const bOut = transport.send(B_CLIENT, {
      type: 'submit_action',
      action: { type: 'END_TURN' },
      clientSeq: 1,
    });
    expect(typesOf(bOut)).toEqual(['action_rejected']);

    // Both request snapshot — hashes must match each other AND the session.
    const sessionHash = session.getStateHash();
    transport.drain(A_CLIENT);
    transport.drain(B_CLIENT);

    transport.send(A_CLIENT, { type: 'request_snapshot' });
    transport.send(B_CLIENT, { type: 'request_snapshot' });

    const aSnap = transport.drain(A_CLIENT);
    const bSnap = transport.drain(B_CLIENT);
    expect(aSnap.length).toBe(1);
    expect(bSnap.length).toBe(1);

    const aHash = aSnap[0]!.type === 'snapshot' ? aSnap[0]!.hash : null;
    const bHash = bSnap[0]!.type === 'snapshot' ? bSnap[0]!.hash : null;

    expect(aHash).toBe(sessionHash);
    expect(bHash).toBe(sessionHash);
    expect(room.getServerSeq()).toBe(1);
  });
});
