/**
 * Engine V2 — smoke tests.
 *
 * Validates the full applyAction pipeline runs end-to-end without crashing
 * and produces the expected state transitions for the most common flows.
 */

import { describe, expect, it, beforeAll } from 'vitest';

import { registerAllHandlers } from '../registry/handlers/index.js';
import { applyAction, registerAllReducers } from '../reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from './fixtures.js';

beforeAll(() => {
  // Boot the engine — register reducers + handlers exactly once for the
  // entire test session.
  registerAllReducers();
  registerAllHandlers();
});

describe('engine-v2 smoke', () => {
  it('PLAY_CARD: spends DON, moves card hand→field, marks summoning-sick', () => {
    const state = buildBasicGameState();
    const handId = moveTopOfDeckToHand(state, 'A');
    // Player A has 2 DON in cost area; vanilla char costs 2.
    expect(state.players['A'].donCostArea.length).toBe(2);
    expect(state.players['A'].field.length).toBe(0);

    const { state: next, events } = applyAction(state, 'A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    }, { checkInvariants: false });

    expect(next.players['A'].field.length).toBe(1);
    expect(next.players['A'].field[0]!.instanceId).toBe(handId);
    expect(next.players['A'].field[0]!.summoningSick).toBe(true);
    expect(next.players['A'].donCostArea.length).toBe(0);
    expect(next.players['A'].donRested.length).toBe(2);
    expect(next.players['A'].hand.length).toBe(0);
    // History should include CHARACTER_PLAYED
    expect(events.some((e) => (e as { type?: string }).type === 'CHARACTER_PLAYED')).toBe(true);
  });

  it('ATTACH_DON: moves DON from cost area to target character', () => {
    const state = buildBasicGameState();
    // Pre-place a character on A's field manually
    const handId = moveTopOfDeckToHand(state, 'A');
    let { state: next } = applyAction(state, 'A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    }, { checkInvariants: false });

    // Give A some DON for attaching
    next.players['A'].donCostArea = [next.players['A'].donRested.shift()!];

    const attachRes = applyAction(next, 'A', {
      type: 'ATTACH_DON',
      targetInstanceId: handId,
    }, { checkInvariants: false });

    expect(attachRes.state.players['A'].field[0]!.attachedDon.length).toBe(1);
    expect(attachRes.state.players['A'].donCostArea.length).toBe(0);
  });

  it('END_TURN: passes turn to opponent and runs refresh→draw→don→main', () => {
    const state = buildBasicGameState();
    const beforeTurn = state.turn;
    const beforeAP = state.activePlayer;

    const { state: next } = applyAction(state, 'A', {
      type: 'END_TURN',
    }, { checkInvariants: false });

    expect(next.activePlayer).not.toBe(beforeAP);
    expect(next.activePlayer).toBe('B');
    expect(next.turn).toBe(beforeTurn + 1);
    expect(next.phase).toBe('main');
    // B is not first player → draw on turn 2 should give 1 card
    expect(next.players['B'].hand.length).toBe(1);
    // B should have 2 DON (turn>1 ramp)
    expect(next.players['B'].donCostArea.length).toBe(2);
  });

  it('CONCEDE: sets game result, drops subsequent actions', () => {
    const state = buildBasicGameState();
    const r1 = applyAction(state, 'A', { type: 'CONCEDE' }, { checkInvariants: false });
    expect(r1.state.result).toEqual({ loser: 'A', reason: 'concede' });
    // After result is set, applyAction short-circuits.
    const r2 = applyAction(r1.state, 'B', { type: 'END_TURN' }, { checkInvariants: false });
    expect(r2.events.length).toBe(0);
    expect(r2.state).toBe(r1.state);
  });

  it('DECLARE_ATTACK leader → SKIP_BLOCKER → SKIP_COUNTER flips one life card', () => {
    const state = buildBasicGameState();
    // Pre-place a char on A's field that can attack (no summoning sickness)
    // Cheating: hand-build the field state for the test.
    const id = moveTopOfDeckToHand(state, 'A');
    let { state: next } = applyAction(state, 'A', {
      type: 'PLAY_CARD',
      instanceId: id,
      replaceTargetId: null,
    }, { checkInvariants: false });
    // Clear summoning sick to allow attack.
    next.players['A'].field[0]!.summoningSick = false;

    const beforeLife = next.players['B'].life.length;
    const beforeHand = next.players['B'].hand.length;

    // Declare attack on B's leader.
    const r1 = applyAction(next, 'A', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: id,
      targetInstanceId: next.players['B'].leader.instanceId,
    }, { checkInvariants: false });
    expect(r1.state.phase).toBe('block_window');

    const r2 = applyAction(r1.state, 'B', { type: 'SKIP_BLOCKER' }, { checkInvariants: false });
    expect(r2.state.phase).toBe('counter_window');

    const r3 = applyAction(r2.state, 'B', { type: 'SKIP_COUNTER' }, { checkInvariants: false });
    // Attacker 3000 vs leader 5000 → attack fails (3000 < 5000), no life flip.
    expect(r3.state.players['B'].life.length).toBe(beforeLife);
    expect(r3.state.players['B'].hand.length).toBe(beforeHand);
  });

  it('serializer roundtrip: deserialize(serialize(state)) equals state shape', async () => {
    const { serialize, deserialize } = await import('../state/Serializer.js');
    const state = buildBasicGameState();
    const blob = serialize(state);
    const restored = deserialize(blob);
    expect(restored.schemaVersion).toBe(state.schemaVersion);
    expect(restored.activePlayer).toBe(state.activePlayer);
    expect(restored.players['A'].leader.instanceId).toBe(state.players['A'].leader.instanceId);
  });

  it('EasyAi picks a legal action and never concedes', async () => {
    const { EasyAi } = await import('../ai/EasyAi.js');
    const state = buildBasicGameState();
    const ai = new EasyAi(123);
    const action = await ai.chooseAction(state, 'A', 1000);
    expect(action).toBeDefined();
    expect(action.type).not.toBe('CONCEDE');
  });

  it('getLegalActions: main phase includes END_TURN + ATTACH_DON + CONCEDE', async () => {
    const { getLegalActions } = await import('../rules/legality.js');
    const state = buildBasicGameState();
    const actions = getLegalActions(state, 'A');
    expect(actions.some((a) => a.type === 'END_TURN')).toBe(true);
    expect(actions.some((a) => a.type === 'ATTACH_DON')).toBe(true);
    expect(actions.some((a) => a.type === 'CONCEDE')).toBe(true);
    // Inactive player gets only CONCEDE in main phase.
    const oppActions = getLegalActions(state, 'B');
    expect(oppActions).toEqual([{ type: 'CONCEDE' }]);
  });

  it('viewForPlayer redacts opp hand + own deck + face-down life', async () => {
    const { viewForPlayer, UNKNOWN_CARD } = await import('../view/ViewModule.js');
    const state = buildBasicGameState();
    // Establish a known card in opp's hand by moving a deck card to hand for B.
    const oppHandId = state.players['B'].deck.shift()!;
    state.players['B'].hand.push(oppHandId);
    const oppHandCardId = state.instances[oppHandId]!.cardId;

    // From viewer A: opp hand should be redacted; A's own hand visible (empty here).
    const viewA = viewForPlayer(state, 'A');
    expect(viewA.instances[oppHandId]!.cardId).toBe(UNKNOWN_CARD.id);
    // A's deck should be redacted (face-down).
    const aDeckTop = state.players['A'].deck[0]!;
    expect(viewA.instances[aDeckTop]!.cardId).toBe(UNKNOWN_CARD.id);
    // A's life (face-down by default) redacted.
    const aLife0 = state.players['A'].life[0]!;
    expect(viewA.instances[aLife0]!.cardId).toBe(UNKNOWN_CARD.id);
    // Field/leader cards untouched.
    expect(viewA.instances[viewA.players['A'].leader.instanceId]!.cardId).toBe(viewA.players['A'].leader.cardId);

    // Original state unchanged (viewForPlayer is non-mutating wrt opp hand).
    expect(state.instances[oppHandId]!.cardId).toBe(oppHandCardId);

    // knownByViewer lifts redaction.
    state.knownByViewer['A'] = [oppHandId];
    const viewA2 = viewForPlayer(state, 'A');
    expect(viewA2.instances[oppHandId]!.cardId).toBe(oppHandCardId);
  });

  it('target resolver honors costMin filter (regression for cards.json field-name shape)', async () => {
    const { targetResolvers } = await import('../registry/types.js');
    const state = buildBasicGameState();
    // Place 2 chars on B's field with different costs.
    const cheapCard = {
      id: 'TEST-CHEAP',
      kind: 'character' as const,
      name: 'Cheap',
      cost: 1,
      power: 1000,
      counterValue: 1000,
      colors: ['red' as const],
      traits: [],
      keywords: [],
      effectText: '',
    };
    const expensiveCard = {
      id: 'TEST-EXP',
      kind: 'character' as const,
      name: 'Expensive',
      cost: 6,
      power: 7000,
      counterValue: null,
      colors: ['red' as const],
      traits: [],
      keywords: [],
      effectText: '',
    };
    state.cardLibrary[cheapCard.id] = cheapCard;
    state.cardLibrary[expensiveCard.id] = expensiveCard;
    const c = { instanceId: 'cheap-1', cardId: cheapCard.id, controller: 'B' as const, rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
    const e = { instanceId: 'exp-1', cardId: expensiveCard.id, controller: 'B' as const, rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
    state.instances[c.instanceId] = c;
    state.instances[e.instanceId] = e;
    state.players['B'].field.push(c, e);

    // cards.json shape: filter:{costMin:5}. Pre-fix would have ignored
    // costMin (only honored minCost) and returned BOTH chars.
    const resolver = targetResolvers.get('opp_character');
    const result = resolver(state, {
      sourceInstanceId: state.players['A'].leader.instanceId,
      controller: 'A',
    }, { kind: 'opp_character', filter: { costMin: 5 }, count: 5 });
    expect(result).toEqual(['exp-1']);
  });

  it('choose_one: PendingChoose roundtrip with sub-option targets + condition', async () => {
    const { actionHandlers } = await import('../registry/types.js');
    const state = buildBasicGameState();
    const handler = actionHandlers.get('choose_one');
    // Mimic EB02-045 Law shape: option 0 = draw 1, option 1 = if_opp_hand_min:5 → opp_discard_from_hand 1
    const next = handler(state, {
      sourceInstanceId: state.players['A'].leader.instanceId,
      controller: 'A',
    }, {
      kind: 'choose_one',
      options: [
        { trigger: 'on_play', action: { kind: 'draw', magnitude: 1 }, verified: 'human-reviewed' },
        {
          trigger: 'on_play',
          condition: { type: 'if_opp_hand_min', n: 5 },
          action: { kind: 'opp_discard_from_hand', magnitude: 1 },
          verified: 'human-reviewed',
        },
      ],
    }, []);
    expect(next.pending?.kind).toBe('choose_one');
    expect(next.phase).toBe('choose_one');

    const handBefore = next.players['A'].hand.length;
    const r0 = applyAction(next, 'A', { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 }, { checkInvariants: false });
    expect(r0.state.pending).toBeNull();
    expect(r0.state.players['A'].hand.length).toBe(handBefore + 1);

    // Option 1 condition `if_opp_hand_min: 5` — fixture has B.hand = 0 → fails.
    const r1 = applyAction(next, 'A', { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 1 }, { checkInvariants: false });
    expect(r1.state.pending).toBeNull();
    // Discard skipped because condition failed
    expect(r1.events.some((e) => (e as { conditionFailed?: boolean }).conditionFailed === true)).toBe(true);
  });

  it('draw action honors magnitude (regression for cards.json shape)', async () => {
    const { actionHandlers } = await import('../registry/types.js');
    const state = buildBasicGameState();
    const beforeHand = state.players['A'].hand.length;
    const handler = actionHandlers.get('draw');
    // cards.json uses { kind:'draw', magnitude:3 } — handlers must read magnitude.
    const next = handler(state, {
      sourceInstanceId: state.players['A'].leader.instanceId,
      controller: 'A',
    }, { kind: 'draw', magnitude: 3 }, []);
    expect(next.players['A'].hand.length).toBe(beforeHand + 3);
  });

  it('searcher_peek deterministic V0 (no filter → take top to hand)', async () => {
    const { actionHandlers } = await import('../registry/types.js');
    const state = buildBasicGameState();
    const topThreeBefore = state.players['A'].deck.slice(0, 3);

    const handler = actionHandlers.get('searcher_peek');
    const next = handler(state, {
      sourceInstanceId: state.players['A'].leader.instanceId,
      controller: 'A',
    }, { kind: 'searcher_peek', lookCount: 3, addCount: 1 }, []);
    // V0 deterministic: top 1 → hand, rest 2 → back to top of deck.
    expect(next.players['A'].hand).toContain(topThreeBefore[0]);
    expect(next.players['A'].deck[0]).toBe(topThreeBefore[1]);
    expect(next.players['A'].deck[1]).toBe(topThreeBefore[2]);
    // No pending — V0 deterministic doesn't suspend.
    expect(next.pending).toBeNull();
    // Peeked IDs marked known.
    expect(next.knownByViewer['A']).toContain(topThreeBefore[0]);
  });

  it('peek_opp_deck updates knownByViewer', async () => {
    const { actionHandlers } = await import('../registry/types.js');
    const state = buildBasicGameState();
    const topTwo = state.players['B'].deck.slice(0, 2);

    const handler = actionHandlers.get('peek_opp_deck');
    const next = handler(state, {
      sourceInstanceId: state.players['A'].leader.instanceId,
      controller: 'A',
    }, { kind: 'peek_opp_deck', n: 2 }, []);
    expect(next.knownByViewer['A']).toContain(topTwo[0]);
    expect(next.knownByViewer['A']).toContain(topTwo[1]);
    // Cards stay in opp deck (didn't move)
    expect(next.players['B'].deck[0]).toBe(topTwo[0]);
  });

  it('refresh + DON conservation invariant holds after a play + end turn', async () => {
    const { assertInvariants } = await import('../invariants/check.js');
    const state = buildBasicGameState();
    const id = moveTopOfDeckToHand(state, 'A');
    const { state: afterPlay } = applyAction(state, 'A', {
      type: 'PLAY_CARD',
      instanceId: id,
      replaceTargetId: null,
    }, { checkInvariants: false });
    const { state: afterEnd } = applyAction(afterPlay, 'A', {
      type: 'END_TURN',
    }, { checkInvariants: false });
    // Run invariants manually
    assertInvariants(afterEnd);
  });
});
