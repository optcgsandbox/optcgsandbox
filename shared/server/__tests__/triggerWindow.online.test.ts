/**
 * F-7k BUG-004 — Server-side trigger-window flow through MatchSession.
 *
 * Proves the engine's damage → life-flip → trigger_window → RESOLVE_TRIGGER
 * path works through the SAME server entry-point the online lobby uses.
 *
 * Deterministic fixture: B's top life card is set to OP01-009 Carrot,
 * the only corpus character with a `trigger: 'trigger'` clause
 * (`play_self_from_life`). A's leader attacks B's leader. After
 * SKIP_BLOCKER + SKIP_COUNTER, damage resolves; B's top life flips to
 * hand; engine opens phase='trigger_window'.
 *
 * The spec covers BOTH RESOLVE_TRIGGER variants (activate=true and
 * activate=false). After resolution, phase returns to 'main' and the
 * game is still live (B still has >0 life).
 *
 * This test runs in pure node — no wrangler, no Playwright. It pins the
 * server-authoritative state machine through the trigger window so any
 * regression in the engine's trigger handling fires here before the
 * Playwright spec ever runs.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import {
  buildBasicGameState,
} from '../../engine-v2/__tests__/fixtures.js';
import { getLegalActions } from '../../engine-v2/rules/legality.js';
import type { GameState, PlayerId } from '../../engine-v2/state/types.js';
import type { Action } from '../../engine-v2/protocol/actions.js';
import type { Card } from '../../engine-v2/state/types.js';
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

/**
 * Build a fixture identical to `buildBasicGameState` but with:
 *   - state.turn = 3 (so neither first-player handicap blocks attack)
 *   - state.activePlayer = 'A', firstPlayer = 'A'
 *   - B's top life = OP01-009 Carrot (a trigger card)
 *   - B's leader is rested OR active — defaults work because we attack the
 *     leader (always a valid target regardless of rested state).
 *   - OP01-009 added to cardLibrary so the engine can resolve its trigger.
 */
function buildTriggerLifeFixture(): GameState {
  const state = buildBasicGameState();
  state.turn = 3;
  state.activePlayer = 'A';

  // Add OP01-009 Carrot to library + instances.
  const carrot = getCorpusCard('OP01-009');
  state.cardLibrary[carrot.id] = carrot;
  const carrotInst = {
    instanceId: 'carrot-life-B',
    cardId: carrot.id,
    controller: 'B' as PlayerId,
    rested: false,
    summoningSick: false,
    attachedDon: [] as string[],
    attachedDonRested: [] as string[],
    perTurn: { hasAttacked: false, effectsUsed: [] as string[] },
  };
  state.instances[carrotInst.instanceId] = carrotInst as unknown as GameState['instances'][string];

  // Replace B's top life card with Carrot.
  // (Old top life card stays in instances harmlessly; engine only walks
  // pl.life for life ordering.)
  const oldTop = state.players.B.life[0];
  state.players.B.life[0] = carrotInst.instanceId;
  // Also keep old top in instances to satisfy instance-stable invariant
  // (it now exists only in instances, no zone references it). To keep
  // the invariant happy, push it to B's trash.
  if (oldTop !== undefined) state.players.B.trash.push(oldTop);

  // Sanity: phase main, pending null.
  state.phase = 'main';
  state.pending = null;
  return state;
}

describe('F-7k BUG-004 — online trigger window via MatchSession', () => {
  it('damage → life-flip with trigger card opens trigger_window; B sees RESOLVE_TRIGGER', () => {
    const session = new MatchSession(buildTriggerLifeFixture());

    // A's legalActions on turn 3 must include DECLARE_ATTACK on B's leader.
    const aLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    const attack = aLegal.find(
      (a): a is Extract<Action, { type: 'DECLARE_ATTACK' }> =>
        a.type === 'DECLARE_ATTACK',
    );
    expect(attack).toBeDefined();

    // Apply DECLARE_ATTACK.
    const r1 = session.applyPlayerAction('A', attack!);
    expect(r1.accepted).toBe(true);
    expect(session.getAuthoritativeState().phase).toBe('block_window');

    // B SKIP_BLOCKER.
    const r2 = session.applyPlayerAction('B', { type: 'SKIP_BLOCKER' });
    expect(r2.accepted).toBe(true);
    // Some attacks resolve directly into damage without counter_window;
    // others open counter_window. Either is correct depending on engine.
    const phaseAfterSkipBlocker = session.getAuthoritativeState().phase;
    expect(['counter_window', 'damage_resolution', 'trigger_window', 'main']).toContain(
      phaseAfterSkipBlocker,
    );

    // B SKIP_COUNTER if counter_window opened.
    if (phaseAfterSkipBlocker === 'counter_window') {
      const r3 = session.applyPlayerAction('B', { type: 'SKIP_COUNTER' });
      expect(r3.accepted).toBe(true);
    }

    // After counter resolves, engine should hit trigger_window because
    // B's top life is OP01-009 Carrot (a trigger card).
    const phaseFinal = session.getAuthoritativeState().phase;
    expect(phaseFinal).toBe('trigger_window');

    // Pending must reference Carrot's life instanceId + B as controller.
    const pending = session.getAuthoritativeState().pending;
    expect(pending).toBeDefined();
    expect(pending?.kind).toBe('trigger');
    if (pending?.kind === 'trigger') {
      expect(pending.pendingTrigger.controller).toBe('B');
      expect(pending.pendingTrigger.lifeCardInstanceId).toBe('carrot-life-B');
    }

    // B's legalActions in trigger_window must include both RESOLVE_TRIGGER
    // variants per `shared/engine-v2/rules/legality.ts:68-76`.
    const bLegal = getLegalActions(session.getAuthoritativeState(), 'B');
    const trigActivate = bLegal.find(
      (a) =>
        a.type === 'RESOLVE_TRIGGER' &&
        (a as { activate?: boolean }).activate === true,
    );
    const trigDecline = bLegal.find(
      (a) =>
        a.type === 'RESOLVE_TRIGGER' &&
        (a as { activate?: boolean }).activate === false,
    );
    expect(trigActivate).toBeDefined();
    expect(trigDecline).toBeDefined();

    // A's legalActions in trigger_window must be [CONCEDE] only
    // (active player is A but trigger controller is B).
    const aTrigLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    expect(aTrigLegal.map((a) => a.type)).toEqual(['CONCEDE']);
  });

  it('RESOLVE_TRIGGER (activate=false) — Carrot declines; phase returns to main; game live', () => {
    const session = new MatchSession(buildTriggerLifeFixture());

    const aLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    const attack = aLegal.find(
      (a): a is Extract<Action, { type: 'DECLARE_ATTACK' }> =>
        a.type === 'DECLARE_ATTACK',
    );
    session.applyPlayerAction('A', attack!);
    session.applyPlayerAction('B', { type: 'SKIP_BLOCKER' });
    if (session.getAuthoritativeState().phase === 'counter_window') {
      session.applyPlayerAction('B', { type: 'SKIP_COUNTER' });
    }
    expect(session.getAuthoritativeState().phase).toBe('trigger_window');

    // B declines the trigger.
    const res = session.applyPlayerAction('B', {
      type: 'RESOLVE_TRIGGER',
      targetInstanceId: null,
      activate: false,
    });
    expect(res.accepted).toBe(true);

    // Engine should land back at main with A active.
    expect(session.getAuthoritativeState().phase).toBe('main');
    expect(session.getAuthoritativeState().activePlayer).toBe('A');
    // Game still live (Carrot was 1 of B's 5 life; B still has 4).
    expect(session.getAuthoritativeState().result).toBeNull();
    // The flipped life card landed in B's hand (Carrot declines).
    const bHand = session.getAuthoritativeState().players.B.hand;
    expect(bHand).toContain('carrot-life-B');
  });

  it('RESOLVE_TRIGGER (activate=true) — Carrot plays self from life onto B field', () => {
    const session = new MatchSession(buildTriggerLifeFixture());

    const aLegal = getLegalActions(session.getAuthoritativeState(), 'A');
    const attack = aLegal.find(
      (a): a is Extract<Action, { type: 'DECLARE_ATTACK' }> =>
        a.type === 'DECLARE_ATTACK',
    );
    session.applyPlayerAction('A', attack!);
    session.applyPlayerAction('B', { type: 'SKIP_BLOCKER' });
    if (session.getAuthoritativeState().phase === 'counter_window') {
      session.applyPlayerAction('B', { type: 'SKIP_COUNTER' });
    }
    expect(session.getAuthoritativeState().phase).toBe('trigger_window');

    const bFieldBefore = session.getAuthoritativeState().players.B.field.length;
    const res = session.applyPlayerAction('B', {
      type: 'RESOLVE_TRIGGER',
      targetInstanceId: null,
      activate: true,
    });
    expect(res.accepted).toBe(true);

    // Phase returns to main (no further pending).
    expect(session.getAuthoritativeState().phase).toBe('main');
    expect(session.getAuthoritativeState().result).toBeNull();

    // Carrot's `play_self_from_life` action should have placed Carrot
    // on B's field. Field grew by 1.
    const bFieldAfter = session.getAuthoritativeState().players.B.field.length;
    expect(bFieldAfter).toBe(bFieldBefore + 1);
    // Carrot is on B's field.
    expect(
      session.getAuthoritativeState().players.B.field.some(
        (c) => c.instanceId === 'carrot-life-B',
      ),
    ).toBe(true);
  });
});
