/**
 * F-7k BUG-008 — Server-side hand-size discard prompt via MatchSession.
 *
 * CR §6-5-7 (enforced at `shared/engine-v2/phases/PhaseScheduler.ts:331-348`):
 * when an active player ends their turn with hand > 10, the engine
 * suspends on `phase='discard_choice'` and `pending.kind='discard'`
 * BEFORE flipping `activePlayer`. The player must drain the discard
 * window via repeated `RESOLVE_DISCARD` clicks (one per card to discard
 * down to 10) before the turn fully ends.
 *
 * This test pins the path through `MatchSession.applyPlayerAction` —
 * the exact entry point `shared/server/transport/MatchRoom.handleSubmitAction`
 * uses for the live online lobby — so any regression in the discard
 * window fires here before the browser ever sees it.
 *
 * Scenarios:
 *   1. END_TURN with hand>10 opens discard_choice + pending.discard.
 *   2. Player's legalActions during discard_choice expose RESOLVE_DISCARD
 *      with one pickedId per hand card + a null pickedId option.
 *   3. RESOLVE_DISCARD click moves the picked instanceId from hand → trash.
 *   4. Drain to hand=10 exits the window and flips activePlayer + advances
 *      to the new active player's main phase.
 *   5. Opponent sees only [CONCEDE] during the active player's discard
 *      window (correct hidden-info contract per
 *      `shared/engine-v2/rules/legality.ts:91-103`).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import { buildBasicGameState } from '../../engine-v2/__tests__/fixtures.js';
import { getLegalActions } from '../../engine-v2/rules/legality.js';
import type { GameState, PlayerId, CardInstance } from '../../engine-v2/state/types.js';
import { MatchSession } from '../MatchSession.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

function makeInst(
  cardId: string,
  controller: PlayerId,
  suffix: string,
): CardInstance {
  return {
    instanceId: `${controller}-${cardId}-${suffix}`,
    cardId,
    controller,
    rested: false,
    summoningSick: false,
    attachedDon: [],
    attachedDonRested: [],
    perTurn: { hasAttacked: false, effectsUsed: [] },
  } as unknown as CardInstance;
}

/**
 * Fixture: A's turn (turn=3 to avoid first-player handicap) with A.hand
 * populated to 12 cards. END_TURN from A will trip the >10 discard rule.
 */
function buildOverHandFixture(): GameState {
  const state = buildBasicGameState();
  state.turn = 3;
  state.activePlayer = 'A';
  state.phase = 'main';
  state.pending = null;
  // Pad A's hand to 12 cards (12 vanilla instances added to instances + hand).
  for (let i = 0; i < 12; i += 1) {
    const inst = makeInst('TEST-CHAR-VANILLA', 'A', `pad-${i}`);
    state.instances[inst.instanceId] = inst;
    state.players.A.hand.push(inst.instanceId);
  }
  return state;
}

describe('F-7k BUG-008 — online hand-size discard prompt via MatchSession', () => {
  it('Scenario 1 — END_TURN with hand>10 opens discard_choice + pending.discard', () => {
    const session = new MatchSession(buildOverHandFixture());

    const res = session.applyPlayerAction('A', { type: 'END_TURN' });
    expect(res.accepted).toBe(true);

    const post = session.getAuthoritativeState();
    expect(post.phase).toBe('discard_choice');
    expect(post.activePlayer).toBe('A');
    expect(post.pending).not.toBeNull();
    if (post.pending?.kind === 'discard') {
      expect(post.pending.pendingDiscard.controller).toBe('A');
      expect(post.pending.pendingDiscard.count).toBe(2);
      expect(post.pending.pendingDiscard.resumePhase).toBe('end');
    } else {
      throw new Error(`expected pending.kind=discard, got ${post.pending?.kind}`);
    }
  });

  it('Scenario 2 — A legalActions during discard_choice = RESOLVE_DISCARD × hand + null + CONCEDE', () => {
    const session = new MatchSession(buildOverHandFixture());
    session.applyPlayerAction('A', { type: 'END_TURN' });
    const legal = getLegalActions(session.getAuthoritativeState(), 'A');
    const discards = legal.filter((a) => a.type === 'RESOLVE_DISCARD');
    // 12 hand cards + 1 null pickedId option = 13 RESOLVE_DISCARD entries.
    expect(discards.length).toBe(13);
    expect(legal.find((a) => a.type === 'CONCEDE')).toBeDefined();
    // No other action types during this window.
    const otherTypes = legal.filter(
      (a) => a.type !== 'RESOLVE_DISCARD' && a.type !== 'CONCEDE',
    );
    expect(otherTypes).toEqual([]);
  });

  it('Scenario 3 — B legalActions during A discard_choice = [CONCEDE] only (hidden-info contract)', () => {
    const session = new MatchSession(buildOverHandFixture());
    session.applyPlayerAction('A', { type: 'END_TURN' });
    const bLegal = getLegalActions(session.getAuthoritativeState(), 'B');
    expect(bLegal.map((a) => a.type)).toEqual(['CONCEDE']);
  });

  it('Scenario 4 — RESOLVE_DISCARD click moves picked instanceId from hand → trash', () => {
    const session = new MatchSession(buildOverHandFixture());
    session.applyPlayerAction('A', { type: 'END_TURN' });

    const preLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    const firstDiscard = preLegal.find(
      (a) =>
        a.type === 'RESOLVE_DISCARD' &&
        (a as { pickedId?: string | null }).pickedId !== null,
    );
    expect(firstDiscard).toBeDefined();
    const pickedId = (firstDiscard as { pickedId: string }).pickedId;
    expect(session.getAuthoritativeState().players.A.hand).toContain(pickedId);

    const res = session.applyPlayerAction('A', firstDiscard!);
    expect(res.accepted).toBe(true);

    const post = session.getAuthoritativeState();
    expect(post.players.A.hand).not.toContain(pickedId);
    expect(post.players.A.trash).toContain(pickedId);
  });

  it('Scenario 5 — drain to hand=10 exits discard_choice and flips active player', () => {
    const session = new MatchSession(buildOverHandFixture());
    session.applyPlayerAction('A', { type: 'END_TURN' });

    // Need 2 discards to land at hand=10.
    for (let i = 0; i < 2; i += 1) {
      const legal = getLegalActions(session.getAuthoritativeState(), 'A');
      const next = legal.find(
        (a) =>
          a.type === 'RESOLVE_DISCARD' &&
          (a as { pickedId?: string | null }).pickedId !== null,
      );
      expect(next).toBeDefined();
      expect(session.applyPlayerAction('A', next!).accepted).toBe(true);
    }

    const post = session.getAuthoritativeState();
    // After 2 discards: A.hand size = 10; pending cleared; phase advances;
    // activePlayer flips to B; turn-pipeline (BUG-001 fix) runs B's
    // refresh → draw → don → main.
    expect(post.players.A.hand.length).toBe(10);
    expect(post.pending).toBeNull();
    expect(post.activePlayer).toBe('B');
    expect(post.phase).toBe('main');
    expect(post.result).toBeNull();
  });
});
