/**
 * F-7k BUG-005 — Server-side DECLARE_BLOCKER + PLAY_COUNTER click
 * outcomes via MatchSession.
 *
 * Proves the engine's full combat sub-window flow works through the SAME
 * server entry-point the online lobby uses:
 *   - `MatchSession.applyPlayerAction` (called by
 *     `shared/server/transport/MatchRoom.handleSubmitAction`).
 *
 * Fixtures:
 *   - B has a `blocker`-keyword character on field (EB01-006 Tony Tony.
 *     Chopper, 4000 power, counterValue 1000).
 *   - B has a non-event counter card in hand (EB01-005 Doma,
 *     counterValue 1000) — no DON cost path.
 *
 * Scenarios covered:
 *   1. DECLARE_BLOCKER click — attack redirects onto Chopper; Chopper
 *      rested; phase advances to counter_window; SKIP_COUNTER →
 *      damage resolution → Chopper KO'd (A 5000 >= Chopper 4000).
 *   2. DECLARE_BLOCKER + PLAY_COUNTER click — Chopper rested; counter
 *      +1000 stacked; SKIP_COUNTER → damage resolution → A 5000 <
 *      Chopper 4000+1000=5000? Actually >= → KO. Use Off-White +4000
 *      via a counter event held by B with sufficient DON, OR stack two
 *      non-event counters totalling +1000+ on Chopper to exceed 5000.
 *      Cleaner: stack DOUBLE Doma → +2000 → Chopper 6000 vs A 5000 →
 *      attack fails; Chopper rested but alive.
 *   3. SKIP_BLOCKER + PLAY_COUNTER click on leader — counter +1000
 *      stacks on leader's defense; SKIP_COUNTER → A 5000 < leader
 *      5000+1000=6000 → attack fails; no life flip.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import { buildBasicGameState } from '../../engine-v2/__tests__/fixtures.js';
import { getLegalActions } from '../../engine-v2/rules/legality.js';
import type { GameState, PlayerId, CardInstance, Card } from '../../engine-v2/state/types.js';
import type { Action } from '../../engine-v2/protocol/actions.js';
import { MatchSession } from '../MatchSession.js';

import corpus from '../../data/cards.json' with { type: 'json' };

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

function getCorpusCard(id: string): Card {
  const list = corpus as unknown as Array<{ id: string }>;
  const card = list.find((c) => c.id === id);
  if (card === undefined) throw new Error(`corpus card not found: ${id}`);
  return card as unknown as Card;
}

function makeInst(cardId: string, controller: PlayerId, suffix: string): CardInstance {
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
 * Build a state at A's turn 3 main phase:
 *   - A's leader active, can attack (turn 3 > first-player handicap).
 *   - B has Chopper (blocker, 4000 power, counterValue 1000) on field, not rested.
 *   - B has TWO Doma (counterValue 1000) in hand for stacking counters.
 *   - Both leaders TEST_LEADER_RED (power 5000).
 */
function buildBlockerCounterFixture(opts: {
  blockerOnField: boolean;
  counterInHand: boolean;
  doubleCounter?: boolean;
}): GameState {
  const state = buildBasicGameState();
  state.turn = 3;
  state.activePlayer = 'A';
  state.phase = 'main';
  state.pending = null;

  const chopper = getCorpusCard('EB01-006');
  const doma = getCorpusCard('EB01-005');
  state.cardLibrary[chopper.id] = chopper;
  state.cardLibrary[doma.id] = doma;

  if (opts.blockerOnField) {
    const chopperInst = makeInst(chopper.id, 'B', 'field');
    state.instances[chopperInst.instanceId] = chopperInst;
    state.players.B.field.push(chopperInst);
  }

  if (opts.counterInHand) {
    const doma1 = makeInst(doma.id, 'B', 'hand-1');
    state.instances[doma1.instanceId] = doma1;
    state.players.B.hand.push(doma1.instanceId);

    if (opts.doubleCounter === true) {
      const doma2 = makeInst(doma.id, 'B', 'hand-2');
      state.instances[doma2.instanceId] = doma2;
      state.players.B.hand.push(doma2.instanceId);
    }
  }

  return state;
}

describe('F-7k BUG-005 — online DECLARE_BLOCKER + PLAY_COUNTER via MatchSession', () => {
  it('DECLARE_BLOCKER click — attack redirects onto blocker; phase → counter_window; blocker rested', () => {
    const session = new MatchSession(
      buildBlockerCounterFixture({ blockerOnField: true, counterInHand: false }),
    );

    const aLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    const attack = aLegal.find(
      (a): a is Extract<Action, { type: 'DECLARE_ATTACK' }> =>
        a.type === 'DECLARE_ATTACK',
    );
    expect(attack).toBeDefined();
    expect(session.applyPlayerAction('A', attack!).accepted).toBe(true);
    expect(session.getAuthoritativeState().phase).toBe('block_window');

    // B's legalActions in block_window must include DECLARE_BLOCKER for
    // the Chopper on field (per shared/engine-v2/rules/legality.ts:131-134
    // + blockerActions:251-265).
    const bLegal = getLegalActions(session.getAuthoritativeState(), 'B');
    const block = bLegal.find(
      (a): a is Extract<Action, { type: 'DECLARE_BLOCKER' }> =>
        a.type === 'DECLARE_BLOCKER',
    );
    expect(block).toBeDefined();
    expect(block!.blockerInstanceId).toBe('B-EB01-006-field');

    // Click the DECLARE_BLOCKER.
    const r = session.applyPlayerAction('B', block!);
    expect(r.accepted).toBe(true);

    // Engine effects:
    //   - phase advances to counter_window
    //   - pendingAttack.targetInstanceId redirected onto Chopper
    //   - Chopper is rested
    const post = session.getAuthoritativeState();
    expect(post.phase).toBe('counter_window');
    if (post.pending?.kind === 'attack') {
      expect(post.pending.pendingAttack.targetInstanceId).toBe(
        'B-EB01-006-field',
      );
    } else {
      throw new Error(`expected pending.kind=attack, got ${post.pending?.kind}`);
    }
    const chopperOnField = post.players.B.field.find(
      (c) => c.instanceId === 'B-EB01-006-field',
    );
    expect(chopperOnField?.rested).toBe(true);
  });

  it('DECLARE_BLOCKER + SKIP_COUNTER → Chopper KO (5000 ≥ 4000)', () => {
    const session = new MatchSession(
      buildBlockerCounterFixture({ blockerOnField: true, counterInHand: false }),
    );

    const aLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    session.applyPlayerAction(
      'A',
      aLegal.find((a) => a.type === 'DECLARE_ATTACK')!,
    );
    const bLegal = getLegalActions(session.getAuthoritativeState(), 'B');
    session.applyPlayerAction(
      'B',
      bLegal.find((a) => a.type === 'DECLARE_BLOCKER')!,
    );

    expect(
      session.applyPlayerAction('B', { type: 'SKIP_COUNTER' }).accepted,
    ).toBe(true);

    // Chopper (4000) loses to A's leader (5000). KO → Chopper goes to trash.
    const post = session.getAuthoritativeState();
    expect(post.phase).toBe('main');
    expect(post.activePlayer).toBe('A');
    expect(post.result).toBeNull();

    // Chopper is no longer on B's field.
    expect(
      post.players.B.field.find((c) => c.instanceId === 'B-EB01-006-field'),
    ).toBeUndefined();
    // Chopper is in B's trash.
    expect(post.players.B.trash).toContain('B-EB01-006-field');
  });

  it('SKIP_BLOCKER + PLAY_COUNTER (Doma +1000) + SKIP_COUNTER → leader survives (A 5000 < leader 6000)', () => {
    const session = new MatchSession(
      buildBlockerCounterFixture({ blockerOnField: false, counterInHand: true }),
    );

    const aLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    session.applyPlayerAction(
      'A',
      aLegal.find((a) => a.type === 'DECLARE_ATTACK')!,
    );

    expect(
      session.applyPlayerAction('B', { type: 'SKIP_BLOCKER' }).accepted,
    ).toBe(true);
    expect(session.getAuthoritativeState().phase).toBe('counter_window');

    // B's legalActions must include PLAY_COUNTER with Doma.
    const bCounterLegal = getLegalActions(session.getAuthoritativeState(), 'B');
    const playCtr = bCounterLegal.find(
      (a): a is Extract<Action, { type: 'PLAY_COUNTER' }> =>
        a.type === 'PLAY_COUNTER' &&
        (a as { instanceId?: string }).instanceId === 'B-EB01-005-hand-1',
    );
    expect(playCtr).toBeDefined();

    // Click PLAY_COUNTER.
    const r = session.applyPlayerAction('B', playCtr!);
    expect(r.accepted).toBe(true);

    // counterBoost on the pending attack is now 1000.
    const post1 = session.getAuthoritativeState();
    if (post1.pending?.kind === 'attack') {
      expect(post1.pending.pendingAttack.counterBoost).toBe(1000);
    } else {
      throw new Error('expected pending.kind=attack still active');
    }
    // Doma moved from hand to trash.
    expect(post1.players.B.hand).not.toContain('B-EB01-005-hand-1');
    expect(post1.players.B.trash).toContain('B-EB01-005-hand-1');

    // SKIP_COUNTER → damage resolution.
    expect(
      session.applyPlayerAction('B', { type: 'SKIP_COUNTER' }).accepted,
    ).toBe(true);

    // A's leader 5000 < B's leader 5000+1000=6000 → attack fails.
    // No life flipped from B. Phase returns to main.
    const post2 = session.getAuthoritativeState();
    expect(post2.phase).toBe('main');
    expect(post2.activePlayer).toBe('A');
    expect(post2.players.B.life.length).toBe(5); // life intact
    expect(post2.result).toBeNull();
  });

  it('DECLARE_BLOCKER + single PLAY_COUNTER (Doma +1000) + SKIP_COUNTER → Chopper KO (5000 ≥ 4000+1000)', () => {
    const session = new MatchSession(
      buildBlockerCounterFixture({ blockerOnField: true, counterInHand: true }),
    );

    const aLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    session.applyPlayerAction(
      'A',
      aLegal.find((a) => a.type === 'DECLARE_ATTACK')!,
    );
    const bBlockLegal = getLegalActions(session.getAuthoritativeState(), 'B');
    session.applyPlayerAction(
      'B',
      bBlockLegal.find((a) => a.type === 'DECLARE_BLOCKER')!,
    );

    const bCounterLegal = getLegalActions(session.getAuthoritativeState(), 'B');
    const playCtr = bCounterLegal.find((a) => a.type === 'PLAY_COUNTER');
    expect(playCtr).toBeDefined();
    expect(session.applyPlayerAction('B', playCtr!).accepted).toBe(true);

    expect(
      session.applyPlayerAction('B', { type: 'SKIP_COUNTER' }).accepted,
    ).toBe(true);

    // Power math: A leader 5000 vs Chopper 4000 + 1000 boost = 5000.
    // CR §7-2 says attack succeeds if attackerPower >= targetPower.
    // 5000 >= 5000 → succeeds → Chopper KO'd. The counter wasn't enough.
    const post = session.getAuthoritativeState();
    expect(post.phase).toBe('main');
    expect(post.players.B.trash).toContain('B-EB01-006-field');
  });

  it('DECLARE_BLOCKER + DOUBLE PLAY_COUNTER (+2000 total) → Chopper survives (5000 < 4000+2000)', () => {
    const session = new MatchSession(
      buildBlockerCounterFixture({
        blockerOnField: true,
        counterInHand: true,
        doubleCounter: true,
      }),
    );

    const aLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    session.applyPlayerAction(
      'A',
      aLegal.find((a) => a.type === 'DECLARE_ATTACK')!,
    );
    const bBlockLegal = getLegalActions(session.getAuthoritativeState(), 'B');
    session.applyPlayerAction(
      'B',
      bBlockLegal.find((a) => a.type === 'DECLARE_BLOCKER')!,
    );

    // First Doma.
    let bCounterLegal = getLegalActions(session.getAuthoritativeState(), 'B');
    let playCtr = bCounterLegal.find((a) => a.type === 'PLAY_COUNTER');
    expect(playCtr).toBeDefined();
    expect(session.applyPlayerAction('B', playCtr!).accepted).toBe(true);

    // Second Doma.
    bCounterLegal = getLegalActions(session.getAuthoritativeState(), 'B');
    playCtr = bCounterLegal.find((a) => a.type === 'PLAY_COUNTER');
    expect(playCtr).toBeDefined();
    expect(session.applyPlayerAction('B', playCtr!).accepted).toBe(true);

    // counterBoost should now be 2000.
    const mid = session.getAuthoritativeState();
    if (mid.pending?.kind === 'attack') {
      expect(mid.pending.pendingAttack.counterBoost).toBe(2000);
    }

    expect(
      session.applyPlayerAction('B', { type: 'SKIP_COUNTER' }).accepted,
    ).toBe(true);

    // Power: A 5000 vs Chopper 4000+2000=6000. 5000 < 6000 → attack fails.
    // Chopper rested but NOT KO'd. Still on field.
    const post = session.getAuthoritativeState();
    expect(post.phase).toBe('main');
    expect(
      post.players.B.field.find((c) => c.instanceId === 'B-EB01-006-field'),
    ).toBeDefined();
    expect(post.players.B.trash).not.toContain('B-EB01-006-field');
  });
});
