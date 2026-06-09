/**
 * Auth boundary — Phase F-5c.
 *
 * Validates the abstract auth seam BEFORE any real provider integration
 * lands. Drives the dev/test implementations (`StaticTokenAuthBinding`,
 * `StrictSeatAssignmentPolicy`, `AuthenticatedInProcessTransport`) end
 * to end and verifies that the seat-assignment + projection guarantees
 * survive routing through the auth wrapper.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from '../../engine-v2/__tests__/fixtures.js';
import { MatchSession } from '../MatchSession.js';
import { MatchRoom } from '../transport/MatchRoom.js';
import { InProcessTransport } from '../transport/InProcessTransport.js';
import {
  AuthenticatedInProcessTransport,
  StaticTokenAuthBinding,
  StrictSeatAssignmentPolicy,
  type AuthenticatedClient,
} from '../transport/auth.js';
import type { ServerMessage } from '../transport/protocol.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

const TOKEN_A = 'tok-A-aaaa';
const TOKEN_B = 'tok-B-bbbb';
const TOKEN_C = 'tok-C-cccc';

const CLIENT_A: AuthenticatedClient = {
  clientId: 'mock:alice',
  userId: 'alice',
  displayName: 'Alice',
};
const CLIENT_B: AuthenticatedClient = {
  clientId: 'mock:bob',
  userId: 'bob',
  displayName: 'Bob',
};
const CLIENT_C: AuthenticatedClient = {
  clientId: 'mock:charlie',
  userId: 'charlie',
};

function makeStack() {
  const initial = buildBasicGameState();
  initial.turn = 3;
  const handIdA = moveTopOfDeckToHand(initial, 'A');
  const session = new MatchSession(initial);
  const room = new MatchRoom(session);
  const transport = new InProcessTransport(room);
  const auth = new StaticTokenAuthBinding({
    [TOKEN_A]: CLIENT_A,
    [TOKEN_B]: CLIENT_B,
    [TOKEN_C]: CLIENT_C,
  });
  const policy = new StrictSeatAssignmentPolicy();
  const authed = new AuthenticatedInProcessTransport(auth, policy, transport);
  return { session, room, transport, auth, policy, authed, handIdA };
}

// ─────────────────────────────────────────────────────────────────────
// 1–3. StaticTokenAuthBinding
// ─────────────────────────────────────────────────────────────────────

describe('StaticTokenAuthBinding', () => {
  it('accepts a known token and returns the bound client', async () => {
    const auth = new StaticTokenAuthBinding({ [TOKEN_A]: CLIENT_A });
    const r = await auth.authenticate(TOKEN_A);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.client.clientId).toBe('mock:alice');
      expect(r.client.userId).toBe('alice');
      expect(r.client.displayName).toBe('Alice');
    }
  });

  it('rejects an unknown token with reason unknown_token', async () => {
    const auth = new StaticTokenAuthBinding({ [TOKEN_A]: CLIENT_A });
    const r = await auth.authenticate('not-a-real-token');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown_token');
  });

  it('returns a defensive copy: caller mutation does not affect future authenticates', async () => {
    const auth = new StaticTokenAuthBinding({ [TOKEN_A]: CLIENT_A });
    const r1 = await auth.authenticate(TOKEN_A);
    if (!r1.ok) throw new Error('first auth failed');
    // Tamper with the returned client.
    (r1.client as { clientId: string }).clientId = 'tampered';

    const r2 = await auth.authenticate(TOKEN_A);
    if (!r2.ok) throw new Error('second auth failed');
    expect(r2.client.clientId).toBe('mock:alice'); // pristine
  });

  it('snapshots the constructor input: editing the input record afterward does not affect the binding', async () => {
    const map: Record<string, AuthenticatedClient> = { [TOKEN_A]: CLIENT_A };
    const auth = new StaticTokenAuthBinding(map);
    delete map[TOKEN_A]; // tamper with the input
    const r = await auth.authenticate(TOKEN_A);
    expect(r.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4–7. StrictSeatAssignmentPolicy
// ─────────────────────────────────────────────────────────────────────

describe('StrictSeatAssignmentPolicy', () => {
  const policy = new StrictSeatAssignmentPolicy();

  it('allows a free requested seat', () => {
    const r = policy.assignSeat(CLIENT_A, 'A', { occupiedSeats: {} });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.player).toBe('A');
  });

  it('allows reconnect to the same seat by the same clientId', () => {
    const r = policy.assignSeat(CLIENT_A, 'A', {
      occupiedSeats: { A: CLIENT_A.clientId },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.player).toBe('A');
  });

  it('rejects requested seat already held by a different clientId', () => {
    const r = policy.assignSeat(CLIENT_B, 'A', {
      occupiedSeats: { A: CLIENT_A.clientId },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('seat_occupied');
  });

  it('rejects switching same clientId to the other seat when they hold one already', () => {
    // Alice is in seat A. She requests B. Reject.
    const r = policy.assignSeat(CLIENT_A, 'B', {
      occupiedSeats: { A: CLIENT_A.clientId },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('already_seated_as_A');
  });

  it('rejects switching same clientId to the other seat even when target is free', () => {
    // Same client is in A, B is free. Strict policy: no switching.
    const r = policy.assignSeat(CLIENT_A, 'B', {
      occupiedSeats: { A: CLIENT_A.clientId },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('already_seated_as_A');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8–12. AuthenticatedInProcessTransport
// ─────────────────────────────────────────────────────────────────────

describe('AuthenticatedInProcessTransport', () => {
  it('connects a valid token and the joining player receives joined', async () => {
    const { authed } = makeStack();
    const out = await authed.connectWithToken(TOKEN_A, 'A');
    expect(out.length).toBe(1);
    expect(out[0]!.type).toBe('joined');
    const inbox = authed.inboxForToken(TOKEN_A);
    expect(inbox.length).toBe(1);
    expect(inbox[0]!.type).toBe('joined');
  });

  it('rejects an invalid token with auth_failed', async () => {
    const { authed } = makeStack();
    const out = await authed.connectWithToken('not-a-token', 'A');
    expect(out.length).toBe(1);
    expect(out[0]!.type).toBe('error');
    if (out[0]!.type === 'error') expect(out[0]!.reason).toMatch(/^auth_failed:/);
  });

  it('prevents a different authenticated user from stealing an occupied seat', async () => {
    const { authed } = makeStack();
    const first = await authed.connectWithToken(TOKEN_A, 'A');
    expect(first[0]!.type).toBe('joined');

    // Different valid token requesting same seat → rejected by policy
    // BEFORE reaching the room.
    const stolen = await authed.connectWithToken(TOKEN_C, 'A');
    expect(stolen.length).toBe(1);
    expect(stolen[0]!.type).toBe('error');
    if (stolen[0]!.type === 'error') expect(stolen[0]!.reason).toBe('seat_occupied');
  });

  it('rejects same client trying to switch to the other seat after taking one', async () => {
    const { authed } = makeStack();
    await authed.connectWithToken(TOKEN_A, 'A');
    const swap = await authed.connectWithToken(TOKEN_A, 'B');
    expect(swap[0]!.type).toBe('error');
    if (swap[0]!.type === 'error') {
      expect(swap[0]!.reason).toBe('already_seated_as_A');
    }
  });

  it('allows reconnect with the same token to the same seat', async () => {
    const { authed } = makeStack();
    await authed.connectWithToken(TOKEN_A, 'A');
    // Drain the initial joined to make the reconnect's effect clear.
    authed.drainForToken(TOKEN_A);

    const again = await authed.connectWithToken(TOKEN_A, 'A');
    expect(again.length).toBe(1);
    expect(again[0]!.type).toBe('joined');
  });

  it('sendWithToken submits actions on behalf of the authenticated client', async () => {
    const { authed, transport, handIdA, session } = makeStack();
    await authed.connectWithToken(TOKEN_A, 'A');
    await authed.connectWithToken(TOKEN_B, 'B');
    authed.drainForToken(TOKEN_A);
    authed.drainForToken(TOKEN_B);

    const before = session.getStateHash();
    const out = await authed.sendWithToken(TOKEN_A, {
      type: 'submit_action',
      action: { type: 'PLAY_CARD', instanceId: handIdA, replaceTargetId: null },
      clientSeq: 1,
    });
    expect(out.length).toBe(1);
    expect(out[0]!.type).toBe('action_accepted');

    // Opponent inbox saw the broadcast snapshot, via Bob's token.
    const bobInbox = authed.inboxForToken(TOKEN_B);
    expect(bobInbox.map((m) => m.type)).toEqual(['snapshot']);

    // Direct transport seq matches.
    expect(transport.getServerSeq()).toBe(1);
    expect(session.getStateHash()).not.toBe(before);
  });

  it('sendWithToken with an authenticated-but-never-connected token routes through and gets unknown_client', async () => {
    const { authed } = makeStack();
    // TOKEN_C is valid but never connected.
    const out = await authed.sendWithToken(TOKEN_C, { type: 'request_snapshot' });
    expect(out.length).toBe(1);
    if (out[0]!.type === 'error') {
      expect(out[0]!.reason).toBe('unknown_client');
    }
  });

  it('sendWithToken with an unknown token surfaces auth_failed', async () => {
    const { authed } = makeStack();
    const out = await authed.sendWithToken('garbage-token', {
      type: 'request_snapshot',
    });
    expect(out[0]!.type).toBe('error');
    if (out[0]!.type === 'error') {
      expect(out[0]!.reason).toMatch(/^auth_failed:/);
    }
  });

  it('no hidden info leak: opponent hand/deck stay anonymized through the auth wrapper', async () => {
    const initial = buildBasicGameState();
    initial.turn = 3;
    const bHandId = moveTopOfDeckToHand(initial, 'B');
    const session = new MatchSession(initial);
    const room = new MatchRoom(session);
    const transport = new InProcessTransport(room);
    const auth = new StaticTokenAuthBinding({ [TOKEN_A]: CLIENT_A });
    const authed = new AuthenticatedInProcessTransport(
      auth,
      new StrictSeatAssignmentPolicy(),
      transport,
    );

    await authed.connectWithToken(TOKEN_A, 'A');
    await authed.sendWithToken(TOKEN_A, { type: 'request_snapshot' });

    const messages: ReadonlyArray<ServerMessage> = authed.drainForToken(TOKEN_A);
    for (const m of messages) {
      if (m.type === 'joined' || m.type === 'snapshot') {
        expect(m.state.players['B'].handHidden).toBe(true);
        expect(m.state.players['B'].deckHidden).toBe(true);
        expect(m.state.players['B'].hand).not.toContain(bHandId);
        expect(m.state.instances[bHandId]).toBeUndefined();
      }
    }
  });

  it('drainForToken / inboxForToken on a never-seen token return empty defensive copies', () => {
    const { authed } = makeStack();
    expect(authed.drainForToken('never-seen')).toEqual([]);
    expect(authed.inboxForToken('never-seen')).toEqual([]);
  });
});
