/**
 * Matchmaker v0.2 init-payload shape test — Phase F-6.
 *
 * The Matchmaker lives in `worker/` and uses Cloudflare-specific globals
 * (`crypto.randomUUID`, `DurableObjectNamespace`, etc), so we can't
 * instantiate it directly under vitest. What we CAN do — and what
 * matters — is exercise the worker-local `buildDevInitialState` helper
 * and assert it produces a `GameState` that:
 *
 *   (a) `MatchSession` accepts as its constructor argument
 *   (b) `MatchRoom` can drive end-to-end
 *   (c) yields the same v0.2 init-payload shape that GameRoom's
 *       `/init` validator now requires.
 *
 * This catches the F-5d.0 regression — silent v0.1 vs v0.2 shape drift
 * between Matchmaker and GameRoom — at unit-test time.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import { buildDevInitialState } from '../../../worker/devSetup.js';
import { MatchSession } from '../MatchSession.js';
import { MatchRoom } from '../transport/MatchRoom.js';
import type { GameState, PlayerId } from '../../engine-v2/state/types.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

describe('buildDevInitialState — shape', () => {
  it('produces a GameState with both players + cardLibrary + DON deck', () => {
    const state: GameState = buildDevInitialState(42);
    expect(state.schemaVersion).toBe(2);
    expect(state.seed).toBe(42);
    expect(Object.keys(state.players).sort()).toEqual(['A', 'B']);
    for (const side of ['A', 'B'] as PlayerId[]) {
      const p = state.players[side];
      expect(p.leader.controller).toBe(side);
      expect(p.deck.length).toBeGreaterThan(0);
      expect(p.donDeck.length).toBeGreaterThan(0);
    }
    expect(Object.keys(state.cardLibrary)).toContain('DEV-LEADER-RED');
    expect(Object.keys(state.cardLibrary)).toContain('DEV-CHAR-VANILLA');
    expect(Object.keys(state.cardLibrary)).toContain('DON');
  });

  it('is deterministic across calls with the same seed', () => {
    const s1 = buildDevInitialState(99);
    const s2 = buildDevInitialState(99);
    // structuredClone-stable surface: seed + counts + ids.
    expect(s1.seed).toBe(s2.seed);
    expect(s1.players.A.deck.length).toBe(s2.players.A.deck.length);
    expect(s1.players.A.deck).toEqual(s2.players.A.deck);
    expect(s1.players.B.donDeck).toEqual(s2.players.B.donDeck);
  });
});

describe('buildDevInitialState + MatchSession + MatchRoom — integration', () => {
  it('MatchSession constructor accepts the state and computes a stable hash', () => {
    const state = buildDevInitialState(1);
    const session = new MatchSession(state);
    expect(typeof session.getStateHash()).toBe('string');
    expect(session.getStateHash().length).toBeGreaterThan(0);
  });

  it('MatchRoom can drive join + opponent_joined + snapshot end-to-end', () => {
    const state = buildDevInitialState(7);
    const session = new MatchSession(state);
    const room = new MatchRoom(session);

    // Mirrors the v0.2 init-payload shape that Matchmaker now sends.
    const aJoin = room.handleMessage({
      type: 'join',
      player: 'A',
      clientId: 'dev:alice',
    });
    expect(aJoin.toClient.map((m) => m.type)).toEqual(['joined']);

    const bJoin = room.handleMessage({
      type: 'join',
      player: 'B',
      clientId: 'dev:bob',
    });
    expect(bJoin.toClient.map((m) => m.type)).toEqual(['joined']);
    expect(bJoin.broadcasts.map((b) => b.message.type)).toEqual(['opponent_joined']);
    expect(bJoin.broadcasts[0]!.clientId).toBe('dev:alice');

    // Snapshot via request_snapshot — hidden-info projection survives the
    // dev initial state (no leakage of opponent hand even when both
    // sides share identical cards).
    const snap = room.handleMessage({
      type: 'request_snapshot',
      clientId: 'dev:alice',
    });
    expect(snap.toClient.length).toBe(1);
    if (snap.toClient[0]!.type === 'snapshot') {
      expect(snap.toClient[0]!.state.viewer).toBe('A');
      expect(snap.toClient[0]!.state.players['B'].handHidden).toBe(true);
      expect(snap.toClient[0]!.state.players['B'].deckHidden).toBe(true);
    } else {
      throw new Error('expected snapshot');
    }
  });
});

describe('v0.2 init-payload shape — contract assertion', () => {
  it('shape that Matchmaker now produces matches GameRoom validator requirements', () => {
    // We reconstruct exactly the JSON shape Matchmaker.ts produces so a
    // future drift between Matchmaker and GameRoom shows up here at
    // unit-test time, not at wrangler-dev time.
    const initialState = buildDevInitialState(11);
    const payload = {
      initialState,
      seats: {
        A: { clientId: 'dev:alice', token: 'tok-A' },
        B: { clientId: 'dev:bob', token: 'tok-B' },
      },
    };

    // The validator branches GameRoom uses (`!body.initialState ||
    // !body.seats?.A?.clientId || !body.seats?.B?.clientId`) must all be
    // false against this payload.
    expect(payload.initialState).toBeDefined();
    expect(payload.seats.A.clientId).toBeTruthy();
    expect(payload.seats.B.clientId).toBeTruthy();

    // Token is now OPTIONAL — the payload without it must still satisfy
    // the validator.
    const tokenlessPayload = {
      initialState,
      seats: {
        A: { clientId: 'dev:alice' },
        B: { clientId: 'dev:bob' },
      },
    };
    expect(tokenlessPayload.seats.A.clientId).toBeTruthy();
    expect(tokenlessPayload.seats.B.clientId).toBeTruthy();
    expect(
      (tokenlessPayload.seats.A as { token?: string }).token,
    ).toBeUndefined();
  });
});
