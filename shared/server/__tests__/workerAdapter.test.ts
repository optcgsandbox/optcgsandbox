/**
 * WorkerRoomAdapter — Phase F-5b v0.2.
 *
 * Drives the adapter logic that the Cloudflare Durable Object delegates to.
 * We do NOT spin up a real DO here — the adapter is runtime-agnostic by
 * design. The mocked `SocketSink` collects outbound `ServerMessage`s
 * per-clientId so we can assert routing + projection + clientId-spoof
 * defense without any Cloudflare runtime.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from '../../engine-v2/__tests__/fixtures.js';
import { MatchSession } from '../MatchSession.js';
import { serializeReplay } from '../serialize.js';
import { MatchRoom } from '../transport/MatchRoom.js';
import {
  WorkerRoomAdapter,
  type SocketSink,
} from '../transport/WorkerRoomAdapter.js';
import type { ServerMessage } from '../transport/protocol.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

class CollectingSink implements SocketSink {
  private readonly buckets = new Map<string, ServerMessage[]>();
  sendTo(clientId: string, message: ServerMessage): void {
    let bucket = this.buckets.get(clientId);
    if (bucket === undefined) {
      bucket = [];
      this.buckets.set(clientId, bucket);
    }
    bucket.push(message);
  }
  drain(clientId: string): ServerMessage[] {
    const bucket = this.buckets.get(clientId);
    if (bucket === undefined) return [];
    const out = bucket.slice();
    bucket.length = 0;
    return out;
  }
  inbox(clientId: string): ReadonlyArray<ServerMessage> {
    return this.buckets.get(clientId)?.slice() ?? [];
  }
}

function build(): {
  adapter: WorkerRoomAdapter;
  room: MatchRoom;
  session: MatchSession;
  sink: CollectingSink;
  handIdA: string;
} {
  const initial = buildBasicGameState();
  initial.turn = 3;
  const handIdA = moveTopOfDeckToHand(initial, 'A');
  const session = new MatchSession(initial);
  const room = new MatchRoom(session);
  const sink = new CollectingSink();
  const adapter = new WorkerRoomAdapter(room, sink);
  return { adapter, room, session, sink, handIdA };
}

const A = 'alice';
const B = 'bob';

// ─────────────────────────────────────────────────────────────────────
// 1–2. join + opponent_joined
// ─────────────────────────────────────────────────────────────────────

describe('WorkerRoomAdapter — join routing', () => {
  it('connectClient(A) sends joined to A', () => {
    const { adapter, sink } = build();
    adapter.connectClient(A, 'A');
    const aInbox = sink.drain(A);
    expect(aInbox.map((m) => m.type)).toEqual(['joined']);
  });

  it('connectClient(B) after A delivers opponent_joined to A', () => {
    const { adapter, sink } = build();
    adapter.connectClient(A, 'A');
    sink.drain(A);
    adapter.connectClient(B, 'B');
    expect(sink.drain(A).map((m) => m.type)).toEqual(['opponent_joined']);
    expect(sink.drain(B).map((m) => m.type)).toEqual(['joined']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. request_snapshot
// ─────────────────────────────────────────────────────────────────────

describe('WorkerRoomAdapter — frame-driven request_snapshot', () => {
  it('returns a snapshot projected for the requester', () => {
    const { adapter, sink } = build();
    adapter.connectClient(A, 'A');
    sink.drain(A);
    adapter.handleFrame(A, JSON.stringify({ type: 'request_snapshot', clientId: A }));
    const inbox = sink.drain(A);
    expect(inbox.length).toBe(1);
    expect(inbox[0]!.type).toBe('snapshot');
    if (inbox[0]!.type === 'snapshot') expect(inbox[0]!.state.viewer).toBe('A');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4–5. submit_action (accept + reject)
// ─────────────────────────────────────────────────────────────────────

describe('WorkerRoomAdapter — submit_action', () => {
  let adapter: WorkerRoomAdapter;
  let sink: CollectingSink;
  let session: MatchSession;
  let room: MatchRoom;
  let handIdA: string;

  beforeEach(() => {
    ({ adapter, sink, session, room, handIdA } = build());
    adapter.connectClient(A, 'A');
    adapter.connectClient(B, 'B');
    sink.drain(A);
    sink.drain(B);
  });

  it('legal action: A gets action_accepted, B gets snapshot broadcast, serverSeq bumps', () => {
    const beforeHash = session.getStateHash();
    const result = adapter.handleFrame(
      A,
      JSON.stringify({
        type: 'submit_action',
        clientId: A,
        clientSeq: 1,
        action: { type: 'PLAY_CARD', instanceId: handIdA, replaceTargetId: null },
      }),
    );
    expect(result.accepted).toBe(true);
    expect(result.serverSeq).toBe(1);

    const aInbox = sink.drain(A);
    const bInbox = sink.drain(B);
    expect(aInbox.map((m) => m.type)).toEqual(['action_accepted']);
    expect(bInbox.map((m) => m.type)).toEqual(['snapshot']);
    expect(session.getStateHash()).not.toBe(beforeHash);
    expect(room.getServerSeq()).toBe(1);
  });

  it('illegal action: A gets action_rejected, B sees nothing, state/hash unchanged', () => {
    const beforeHash = session.getStateHash();
    const result = adapter.handleFrame(
      B, // B sends END_TURN on A's turn
      JSON.stringify({
        type: 'submit_action',
        clientId: B,
        clientSeq: 1,
        action: { type: 'END_TURN' },
      }),
    );
    expect(result.accepted).toBe(false);

    expect(sink.drain(B).map((m) => m.type)).toEqual(['action_rejected']);
    expect(sink.drain(A).map((m) => m.type)).toEqual([]);
    expect(session.getStateHash()).toBe(beforeHash);
    expect(room.getServerSeq()).toBe(0);
  });

  it('duplicate clientSeq returns action_rejected with duplicate_client_seq', () => {
    adapter.handleFrame(
      A,
      JSON.stringify({
        type: 'submit_action',
        clientId: A,
        clientSeq: 1,
        action: { type: 'PLAY_CARD', instanceId: handIdA, replaceTargetId: null },
      }),
    );
    sink.drain(A);
    sink.drain(B);

    adapter.handleFrame(
      A,
      JSON.stringify({
        type: 'submit_action',
        clientId: A,
        clientSeq: 1, // dup
        action: { type: 'END_TURN' },
      }),
    );
    const aInbox = sink.drain(A);
    expect(aInbox.length).toBe(1);
    const m = aInbox[0]!;
    if (m.type === 'action_rejected') expect(m.reason).toBe('duplicate_client_seq');
    else throw new Error('expected action_rejected');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. clientId-spoof defense
// ─────────────────────────────────────────────────────────────────────

describe('WorkerRoomAdapter — trust boundary: clientId is overwritten', () => {
  it('payload clientId is ignored; trusted clientId from socket wins', () => {
    const { adapter, sink, handIdA } = build();
    adapter.connectClient(A, 'A');
    adapter.connectClient(B, 'B');
    sink.drain(A);
    sink.drain(B);

    // B's socket tries to act AS A (forged payload clientId).
    adapter.handleFrame(
      B,
      JSON.stringify({
        type: 'submit_action',
        clientId: A, // spoof attempt — adapter overwrites with trusted B
        clientSeq: 1,
        action: { type: 'PLAY_CARD', instanceId: handIdA, replaceTargetId: null },
      }),
    );
    // Trusted clientId is B, B is on the wrong turn → action_rejected
    // goes to B (not A). A's inbox sees nothing.
    expect(sink.drain(B).map((m) => m.type)).toEqual(['action_rejected']);
    expect(sink.drain(A).map((m) => m.type)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. hidden-info projection
// ─────────────────────────────────────────────────────────────────────

describe('WorkerRoomAdapter — hidden-info projection', () => {
  it('A never sees B hand/deck identifiable content in any outbound frame', () => {
    const initial = buildBasicGameState();
    initial.turn = 3;
    const bHandId = moveTopOfDeckToHand(initial, 'B');
    const session = new MatchSession(initial);
    const room = new MatchRoom(session);
    const sink = new CollectingSink();
    const adapter = new WorkerRoomAdapter(room, sink);

    adapter.connectClient(A, 'A');
    adapter.handleFrame(A, JSON.stringify({ type: 'request_snapshot', clientId: A }));

    for (const m of sink.drain(A)) {
      if (m.type === 'joined' || m.type === 'snapshot') {
        expect(m.state.players['B'].handHidden).toBe(true);
        expect(m.state.players['B'].deckHidden).toBe(true);
        expect(m.state.players['B'].hand).not.toContain(bHandId);
        expect(m.state.instances[bHandId]).toBeUndefined();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. malformed frame
// ─────────────────────────────────────────────────────────────────────

describe('WorkerRoomAdapter — malformed frame handling', () => {
  it('garbage JSON returns error to sender, no state mutation', () => {
    const { adapter, sink, session } = build();
    adapter.connectClient(A, 'A');
    sink.drain(A);

    const beforeHash = session.getStateHash();
    const result = adapter.handleFrame(A, '{ not json');
    expect(result.accepted).toBe(false);

    const inbox = sink.drain(A);
    expect(inbox.length).toBe(1);
    if (inbox[0]!.type === 'error') {
      expect(inbox[0]!.reason).toMatch(/^bad_frame:/);
    } else {
      throw new Error('expected error');
    }
    expect(session.getStateHash()).toBe(beforeHash);
  });

  it('unknown message type returns error', () => {
    const { adapter, sink } = build();
    adapter.connectClient(A, 'A');
    sink.drain(A);
    adapter.handleFrame(A, JSON.stringify({ type: 'evolve_pokemon', clientId: A }));
    const inbox = sink.drain(A);
    expect(inbox.length).toBe(1);
    if (inbox[0]!.type === 'error') {
      expect(inbox[0]!.reason).toMatch(/unknown_message_type/);
    } else {
      throw new Error('expected error');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9. leave routes opponent_left
// ─────────────────────────────────────────────────────────────────────

describe('WorkerRoomAdapter — disconnect', () => {
  it('disconnectClient sends opponent_left to peer', () => {
    const { adapter, sink } = build();
    adapter.connectClient(A, 'A');
    adapter.connectClient(B, 'B');
    sink.drain(A);
    sink.drain(B);

    adapter.disconnectClient(A);
    const bInbox = sink.drain(B);
    expect(bInbox.map((m) => m.type)).toEqual(['opponent_left']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 10. Replay size measurement (informational; F-5b deferral signal)
// ─────────────────────────────────────────────────────────────────────

describe('WorkerRoomAdapter — replay size sanity (informational)', () => {
  it('measures serialized replay byte size after one accepted action', () => {
    const { adapter, sink, session, handIdA } = build();
    adapter.connectClient(A, 'A');
    adapter.connectClient(B, 'B');
    sink.drain(A);
    sink.drain(B);

    adapter.handleFrame(
      A,
      JSON.stringify({
        type: 'submit_action',
        clientId: A,
        clientSeq: 1,
        action: { type: 'PLAY_CARD', instanceId: handIdA, replaceTargetId: null },
      }),
    );

    const replay = serializeReplay(session);
    const bytes = JSON.stringify(replay).length;
    // Sanity bounds. Lower bound — must not be near-empty (means we
    // didn't actually capture state). Upper bound — flag if we drift
    // toward the DO 128 KiB per-key cap before F-5b.2 lands.
    expect(bytes).toBeGreaterThan(1_000);
    expect(bytes).toBeLessThan(100_000);
  });
});
