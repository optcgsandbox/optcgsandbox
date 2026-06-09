/**
 * F-7k BUG-006 — Server-side DECLARE_ATTACK on character + 0-life win
 * condition via MatchSession.
 *
 * Both scenarios verified through the SAME server entry-point the
 * online lobby uses (`MatchSession.applyPlayerAction`, called by
 * `shared/server/transport/MatchRoom.handleSubmitAction`).
 *
 * Scenarios:
 *
 *   A. Character attack — A has an active, non-summoning-sick char on
 *      field. B has a rested char on field (the only legal char target;
 *      active chars are protected per CR §6-5-7-2-1 implemented in
 *      `shared/engine-v2/rules/legality.ts:233-237`). A's char attacks
 *      B's char. After SKIP_BLOCKER + SKIP_COUNTER, the engine resolves
 *      damage: if attackerPower >= targetPower → KO.
 *
 *   B. 0-life win — B's life zone is empty. A attacks B's leader. The
 *      first damage flip calls `flipTopLifeToHand` which returns
 *      `top === undefined`, setting `state.result = { loser: 'B',
 *      reason: 'life_zero' }` (per attackFlow.ts:154-158). The match
 *      ends; subsequent actions on the same session are rejected with
 *      `match_already_concluded` (per MatchSession.ts:80-82).
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
 * Fixture: A's turn 3 main phase.
 *   - A has a 6000-power character on field, NOT summoning-sick, NOT rested
 *     (so it can attack).
 *   - B has a 3000-power character on field, RESTED (so it's a legal target).
 *   - Both leaders standard 5000-power red.
 */
function buildCharacterAttackFixture(): GameState {
  const state = buildBasicGameState();
  state.turn = 3;
  state.activePlayer = 'A';
  state.phase = 'main';
  state.pending = null;

  // A's attacker: EB01-006 Tony Tony.Chopper (4000 power). Actually pick
  // a higher-power char so KO is guaranteed. EB01-013 isn't necessarily
  // 6000. Let's use Chopper as A's attacker (4000) attacking B's 3000-
  // power char. Easier guarantee: stack DON on attacker via attachedDon
  // for +1000s. Cleaner: use OP06-054 Borsalino (4000 power, blocker).
  // Simplest: use TEST_CHAR_VANILLA (3000 power) as B's char, EB01-006
  // (Chopper 4000) as A's attacker.
  const chopper = getCorpusCard('EB01-006');
  state.cardLibrary[chopper.id] = chopper;

  const attacker = makeInst(chopper.id, 'A', 'attacker');
  attacker.summoningSick = false;
  attacker.rested = false;
  state.instances[attacker.instanceId] = attacker;
  state.players.A.field.push(attacker);

  // B's target: TEST_CHAR_VANILLA (3000 power). RESTED (legal target).
  const bTargetInst = makeInst('TEST-CHAR-VANILLA', 'B', 'target');
  bTargetInst.rested = true;
  state.instances[bTargetInst.instanceId] = bTargetInst;
  state.players.B.field.push(bTargetInst);

  return state;
}

/**
 * Fixture: A's turn 3, B's life zone is empty.
 *   - A's leader is active, can attack.
 *   - B's life array is [] (empty).
 *   - All other state preserved from buildBasicGameState.
 */
function buildZeroLifeWinFixture(): GameState {
  const state = buildBasicGameState();
  state.turn = 3;
  state.activePlayer = 'A';
  state.phase = 'main';
  state.pending = null;

  // Move B's life cards to trash so instances-stable invariant holds.
  for (const id of state.players.B.life) {
    state.players.B.trash.push(id);
  }
  state.players.B.life = [];
  state.players.B.lifeFaceUp = {};

  return state;
}

describe('F-7k BUG-006 — character attack + 0-life win via MatchSession', () => {
  it('Scenario A — DECLARE_ATTACK on rested opp character; SKIP_BLOCKER + SKIP_COUNTER → KO', () => {
    const session = new MatchSession(buildCharacterAttackFixture());

    // A's legalActions on turn 3 include a DECLARE_ATTACK targeting
    // B's rested character (not the leader — both are valid; pick the
    // character target).
    const aLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    const charAttack = aLegal.find(
      (a) =>
        a.type === 'DECLARE_ATTACK' &&
        (a as { targetInstanceId?: string }).targetInstanceId ===
          'B-TEST-CHAR-VANILLA-target',
    );
    expect(charAttack).toBeDefined();

    expect(session.applyPlayerAction('A', charAttack!).accepted).toBe(true);
    expect(session.getAuthoritativeState().phase).toBe('block_window');

    expect(
      session.applyPlayerAction('B', { type: 'SKIP_BLOCKER' }).accepted,
    ).toBe(true);
    // Engine may go directly to damage_resolution or open counter_window.
    if (session.getAuthoritativeState().phase === 'counter_window') {
      session.applyPlayerAction('B', { type: 'SKIP_COUNTER' });
    }

    // Damage resolution: A's Chopper 4000 vs B's vanilla 3000.
    // 4000 >= 3000 → vanilla KO'd → moves to B's trash; field shrinks.
    const post = session.getAuthoritativeState();
    expect(post.phase).toBe('main');
    expect(post.activePlayer).toBe('A');
    expect(post.result).toBeNull();
    expect(
      post.players.B.field.find((c) => c.instanceId === 'B-TEST-CHAR-VANILLA-target'),
    ).toBeUndefined();
    expect(post.players.B.trash).toContain('B-TEST-CHAR-VANILLA-target');
  });

  it('Scenario A.2 — character attack rejected when target is ACTIVE (not rested)', () => {
    const state = buildCharacterAttackFixture();
    // Flip B's target to active (not rested) — should NOT be a legal char target.
    const inst = state.players.B.field.find(
      (c) => c.instanceId === 'B-TEST-CHAR-VANILLA-target',
    );
    if (inst === undefined) throw new Error('missing target');
    inst.rested = false;

    const session = new MatchSession(state);
    const aLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    const charAttack = aLegal.find(
      (a) =>
        a.type === 'DECLARE_ATTACK' &&
        (a as { targetInstanceId?: string }).targetInstanceId ===
          'B-TEST-CHAR-VANILLA-target',
    );
    // Per `shared/engine-v2/rules/legality.ts:235-237`, active opp chars
    // are NOT enumerated as targets.
    expect(charAttack).toBeUndefined();
  });

  it('Scenario B — 0-life win condition: A attacks empty-life B leader → result.loser=B', () => {
    const session = new MatchSession(buildZeroLifeWinFixture());

    const aLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    const attack = aLegal.find(
      (a): a is Extract<Action, { type: 'DECLARE_ATTACK' }> =>
        a.type === 'DECLARE_ATTACK',
    );
    expect(attack).toBeDefined();
    expect(session.applyPlayerAction('A', attack!).accepted).toBe(true);

    expect(
      session.applyPlayerAction('B', { type: 'SKIP_BLOCKER' }).accepted,
    ).toBe(true);
    if (session.getAuthoritativeState().phase === 'counter_window') {
      session.applyPlayerAction('B', { type: 'SKIP_COUNTER' });
    }

    // 0-life loss must be set on resolveDamage → flipTopLifeToHand path
    // (attackFlow.ts:154-158: `result = { loser: 'B', reason: 'life_zero' }`).
    const post = session.getAuthoritativeState();
    expect(post.result).not.toBeNull();
    expect(post.result?.loser).toBe('B');
    expect(post.result?.reason).toBe('life_zero');
  });

  it('Scenario B.2 — actions after lethal damage are rejected with match_already_concluded', () => {
    const session = new MatchSession(buildZeroLifeWinFixture());

    const aLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    const attack = aLegal.find((a) => a.type === 'DECLARE_ATTACK');
    session.applyPlayerAction('A', attack!);
    session.applyPlayerAction('B', { type: 'SKIP_BLOCKER' });
    if (session.getAuthoritativeState().phase === 'counter_window') {
      session.applyPlayerAction('B', { type: 'SKIP_COUNTER' });
    }
    expect(session.getAuthoritativeState().result).not.toBeNull();

    // Any further action must be rejected with `match_already_concluded`
    // per MatchSession.ts:80-82.
    const reject = session.applyPlayerAction('A', { type: 'END_TURN' });
    expect(reject.accepted).toBe(false);
    if (!reject.accepted) {
      expect(reject.reason).toBe('match_already_concluded');
    }
  });

  it('Scenario B.3 — projection exposes match result to BOTH viewers', () => {
    const session = new MatchSession(buildZeroLifeWinFixture());
    const aLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    session.applyPlayerAction('A', aLegal.find((a) => a.type === 'DECLARE_ATTACK')!);
    session.applyPlayerAction('B', { type: 'SKIP_BLOCKER' });
    if (session.getAuthoritativeState().phase === 'counter_window') {
      session.applyPlayerAction('B', { type: 'SKIP_COUNTER' });
    }

    // Both viewers (A and B) project the same result (per
    // publicProjection.ts which copies `state.result` through).
    const aView = session.getPublicStateFor('A');
    const bView = session.getPublicStateFor('B');
    expect(aView.result).not.toBeNull();
    expect(bView.result).not.toBeNull();
    expect(aView.result).toEqual(bView.result);
    expect(aView.result?.loser).toBe('B');
    expect(aView.result?.reason).toBe('life_zero');
  });
});
