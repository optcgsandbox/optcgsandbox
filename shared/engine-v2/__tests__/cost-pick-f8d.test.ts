/**
 * F-8D — player-choice COST payments (generic cost picker).
 *
 * "You may place 1 card from your hand at the bottom of your deck: draw 1"
 * must let the HUMAN pick WHICH card pays — never auto-pick from the hand
 * head. Flow: effect_offer (Use Effect) → attack_target_pick with costPick
 * (choose the payment) → pay with exactly the chosen cards → resolve →
 * clause tail. Exact counts enforced (empty / partial / foreign picks
 * rejected). AI / simulation keep the V0 deterministic head-pick.
 * All cards synthetic; derivation is purely cost-shape metadata.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { CharacterCard, EventCard, LeaderCard } from '../cards/Card.js';
import { EffectDispatcher } from '../effects/EffectDispatcher.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';
import { applyAction } from '../reducers/applyAction.js';
import type { GameState } from '../state/types.js';

import { buildState, makeInst } from './cards/_fixtures.js';

const LEADER_A: LeaderCard = {
  id: '__F8DC_LA', name: 'F8DC Leader A', kind: 'leader', colors: ['red'],
  cost: null, power: 5000, counterValue: null, traits: [], keywords: [],
  effectTags: [], life: 5,
};
const LEADER_B: LeaderCard = { ...LEADER_A, id: '__F8DC_LB', name: 'F8DC Leader B' };
const VAN = (id: string): CharacterCard => ({
  id, name: id, kind: 'character', colors: ['red'], cost: 2, power: 3000,
  counterValue: 1000, traits: [], keywords: [], effectTags: [],
});

/** Gordon-shaped synthetic: "You may place 1 card from your hand at the
 *  bottom of your deck: draw 1 card." */
const GORDON_SHAPE: EventCard = {
  id: '__F8DC_BOTTOM', name: 'F8DC BottomDecker', kind: 'event', colors: ['red'],
  cost: 1, power: null, counterValue: null, traits: [], keywords: [], effectTags: [],
  effectSpecV2: {
    schemaVersion: 2,
    clauses: [
      { trigger: 'on_play', cost: { bottomOfDeckFromHand: 1 }, action: { kind: 'draw', magnitude: 1 }, verified: 'human-reviewed' },
    ],
    continuous: [],
    replacements: [],
  },
} as unknown as EventCard;

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

function boot(human: boolean, handCount = 3, deckCount = 3) {
  const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B });
  const s = built.state;
  s.activePlayer = 'A';
  if (human) s.humanControllers = ['A'];
  s.cardLibrary[GORDON_SHAPE.id] = GORDON_SHAPE;
  const src = makeInst(GORDON_SHAPE.id, 'A');
  s.instances[src.instanceId] = src;
  s.cardLibrary['__F8DC_VAN'] = VAN('__F8DC_VAN');
  for (let i = 0; i < handCount; i++) {
    const inst = makeInst('__F8DC_VAN', 'A');
    s.instances[inst.instanceId] = inst;
    s.players.A.hand.push(inst.instanceId);
  }
  for (let i = 0; i < deckCount; i++) {
    const inst = makeInst('__F8DC_VAN', 'A');
    s.instances[inst.instanceId] = inst;
    s.players.A.deck.push(inst.instanceId);
  }
  return { built, s, src };
}

function dispatchOnPlay(s: GameState, srcId: string): GameState {
  return EffectDispatcher.dispatch(s, { sourceInstanceId: srcId, controller: 'A' }, 'on_play');
}

describe('F-8D — player-choice cost payments (cost picker)', () => {
  it('Use Effect → suspends into a COST picker BEFORE paying; candidates = whole hand; exact count', () => {
    const { s, src } = boot(true);
    const handBefore = [...s.players.A.hand];
    let st = dispatchOnPlay(s, src.instanceId);
    expect(st.pending?.kind).toBe('effect_offer');
    st = applyAction(st, 'A', { type: 'RESOLVE_EFFECT_OFFER', accept: true }, { checkInvariants: false }).state;
    expect(st.pending?.kind).toBe('attack_target_pick');
    const pt = st.pending?.kind === 'attack_target_pick' ? st.pending.pendingTargetPick : null;
    expect(pt?.costPick?.costKey).toBe('bottomOfDeckFromHand');
    expect(pt?.exactCount).toBe(true);
    expect(pt?.mayChooseNone).toBe(false);
    expect(pt?.pickLimit).toBe(1);
    expect([...(pt?.candidateIds ?? [])]).toEqual(handBefore);
    // NOTHING paid yet — hand intact, deck intact.
    expect(st.players.A.hand.length).toBe(handBefore.length);
    expect(st.players.A.deck.length).toBe(3);
  });

  it('rejects empty, over-limit, and non-candidate picks (state unchanged)', () => {
    const { s, src } = boot(true);
    let st = dispatchOnPlay(s, src.instanceId);
    st = applyAction(st, 'A', { type: 'RESOLVE_EFFECT_OFFER', accept: true }, { checkInvariants: false }).state;
    const before = structuredClone(st);
    // Empty pick — exact count means no skipping the payment.
    let r = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: null }, { checkInvariants: false }).state;
    expect(r.pending?.kind).toBe('attack_target_pick');
    expect(r.players.A.hand.length).toBe(before.players.A.hand.length);
    // Over-limit pick.
    const hand = st.players.A.hand;
    r = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: hand[0]!, pickedIds: [hand[0]!, hand[1]!] }, { checkInvariants: false }).state;
    expect(r.pending?.kind).toBe('attack_target_pick');
    // Foreign id.
    r = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: '__not_a_candidate' }, { checkInvariants: false }).state;
    expect(r.pending?.kind).toBe('attack_target_pick');
  });

  it('Gordon-shaped flow: pick → EXACTLY that card goes to the deck BOTTOM → draw resolves', () => {
    const { s, src } = boot(true);
    const chosen = s.players.A.hand[2]!; // NOT the head — proves no auto-pick
    const deckTop = s.players.A.deck[0]!;
    let st = dispatchOnPlay(s, src.instanceId);
    st = applyAction(st, 'A', { type: 'RESOLVE_EFFECT_OFFER', accept: true }, { checkInvariants: false }).state;
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: chosen }, { checkInvariants: false }).state;
    expect(st.pending).toBeNull();
    expect(st.phase).toBe('main');
    // The chosen card — and only it — left the hand for the deck bottom.
    expect(st.players.A.hand.includes(chosen)).toBe(false);
    expect(st.players.A.deck[st.players.A.deck.length - 1]).toBe(chosen);
    // Draw happened: deck 3 +1 (payment) −1 (draw) = 3; drawn card = old top.
    expect(st.players.A.deck.length).toBe(3);
    expect(st.players.A.hand.includes(deckTop)).toBe(true);
    // Net hand: 3 −1 payment +1 draw = 3.
    expect(st.players.A.hand.length).toBe(3);
    const picked = (st.history as Array<{ type: string }>).filter((h) => h.type === 'COST_PICKED');
    expect(picked.length).toBe(1);
  });

  it('AI / sim seat: NO picker — V0 deterministic head-pick payment, byte-identical flow', () => {
    const { s, src } = boot(false);
    const handHead = s.players.A.hand[0]!;
    const st = dispatchOnPlay(s, src.instanceId);
    expect(st.pending).toBeNull();
    expect(st.players.A.deck[st.players.A.deck.length - 1]).toBe(handHead);
  });

  it('no choice exists (hand size == required count) → auto-pays without a picker', () => {
    const { s, src } = boot(true, 1);
    let st = dispatchOnPlay(s, src.instanceId);
    st = applyAction(st, 'A', { type: 'RESOLVE_EFFECT_OFFER', accept: true }, { checkInvariants: false }).state;
    expect(st.pending).toBeNull();
    expect(st.players.A.hand.length).toBe(1); // paid 1, drew 1
  });

  it('activate_main choice costs picker-suspend too (no offer — activation was the choice)', () => {
    const built = buildState({
      leaderA: LEADER_A,
      leaderB: LEADER_B,
      charsA: [VAN('__F8DC_C1'), VAN('__F8DC_C2')],
    });
    const s = built.state;
    s.activePlayer = 'A';
    s.humanControllers = ['A'];
    const ACT: CharacterCard = {
      ...VAN('__F8DC_ACT'),
      effectSpecV2: {
        schemaVersion: 2,
        clauses: [
          { trigger: 'activate_main', cost: { restOwnCharFilter: { count: 1 } }, action: { kind: 'draw', magnitude: 1 }, verified: 'human-reviewed' },
        ],
        continuous: [],
        replacements: [],
      },
    } as unknown as CharacterCard;
    s.cardLibrary[ACT.id] = ACT;
    const inst = makeInst(ACT.id, 'A');
    s.instances[inst.instanceId] = inst;
    s.players.A.field.push(inst);
    // deck fodder for the draw
    const d = makeInst('__F8DC_C1', 'A');
    s.instances[d.instanceId] = d;
    s.players.A.deck.push(d.instanceId);

    let st = EffectDispatcher.dispatch(s, { sourceInstanceId: inst.instanceId, controller: 'A' }, 'activate_main');
    expect(st.pending?.kind).toBe('attack_target_pick');
    const pt = st.pending?.kind === 'attack_target_pick' ? st.pending.pendingTargetPick : null;
    expect(pt?.costPick?.costKey).toBe('restOwnCharFilter');
    // Candidates: ALL unrested chars (incl. the source — it matches the filter).
    const second = built.fieldA[1]!.instanceId;
    expect(pt?.candidateIds.includes(second)).toBe(true);
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: second }, { checkInvariants: false }).state;
    expect(st.pending).toBeNull();
    expect(st.instances[second]!.rested, 'picked char rested').toBe(true);
    expect(built.fieldA[0] !== undefined && st.instances[built.fieldA[0].instanceId]!.rested, 'other char untouched').toBe(false);
  });

  it('multiple choice keys on one cost → sequential pickers; later candidates exclude earlier picks', () => {
    const { s, src } = boot(true, 4, 3);
    const DOUBLE: EventCard = {
      ...GORDON_SHAPE,
      id: '__F8DC_DOUBLE',
      name: 'F8DC Double',
      effectSpecV2: {
        schemaVersion: 2,
        clauses: [
          {
            trigger: 'on_play',
            cost: { discardHand: 1, bottomOfDeckFromHand: 1 },
            action: { kind: 'draw', magnitude: 1 },
            verified: 'human-reviewed',
          },
        ],
        continuous: [],
        replacements: [],
      },
    } as unknown as EventCard;
    s.cardLibrary[DOUBLE.id] = DOUBLE;
    const src2 = makeInst(DOUBLE.id, 'A');
    s.instances[src2.instanceId] = src2;

    let st = dispatchOnPlay(s, src2.instanceId);
    st = applyAction(st, 'A', { type: 'RESOLVE_EFFECT_OFFER', accept: true }, { checkInvariants: false }).state;
    // Picker 1: discardHand.
    let pt = st.pending?.kind === 'attack_target_pick' ? st.pending.pendingTargetPick : null;
    expect(pt?.costPick?.costKey).toBe('discardHand');
    const discardPick = st.players.A.hand[1]!;
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: discardPick }, { checkInvariants: false }).state;
    // Picker 2: bottomOfDeckFromHand — the discard pick is NOT a candidate.
    pt = st.pending?.kind === 'attack_target_pick' ? st.pending.pendingTargetPick : null;
    expect(pt?.costPick?.costKey).toBe('bottomOfDeckFromHand');
    expect(pt?.candidateIds.includes(discardPick)).toBe(false);
    const bottomPick = st.players.A.hand[3]!;
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: bottomPick }, { checkInvariants: false }).state;
    expect(st.pending).toBeNull();
    expect(st.players.A.trash.includes(discardPick)).toBe(true);
    expect(st.players.A.deck[st.players.A.deck.length - 1]).toBe(bottomPick);
    // hand: 4 −2 payments +1 draw = 3.
    expect(st.players.A.hand.length).toBe(3);
  });

  it('discardHandFilter picker candidates honor the printed filter', () => {
    const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B });
    const s = built.state;
    s.activePlayer = 'A';
    s.humanControllers = ['A'];
    const TRAITED: CharacterCard = { ...VAN('__F8DC_TRAIT'), traits: ['Animal'] };
    s.cardLibrary['__F8DC_TRAIT'] = TRAITED;
    s.cardLibrary['__F8DC_PLAIN'] = VAN('__F8DC_PLAIN');
    const traited = [makeInst('__F8DC_TRAIT', 'A'), makeInst('__F8DC_TRAIT', 'A')];
    const plain = makeInst('__F8DC_PLAIN', 'A');
    for (const i of [...traited, plain]) {
      s.instances[i.instanceId] = i;
      s.players.A.hand.push(i.instanceId);
    }
    const FILTERED: EventCard = {
      ...GORDON_SHAPE,
      id: '__F8DC_FILT',
      name: 'F8DC Filtered',
      effectSpecV2: {
        schemaVersion: 2,
        clauses: [
          {
            trigger: 'on_play',
            cost: { discardHandFilter: { count: 1, filter: { trait: 'Animal' } } },
            action: { kind: 'draw', magnitude: 1 },
            verified: 'human-reviewed',
          },
        ],
        continuous: [],
        replacements: [],
      },
    } as unknown as EventCard;
    s.cardLibrary[FILTERED.id] = FILTERED;
    const src = makeInst(FILTERED.id, 'A');
    s.instances[src.instanceId] = src;
    const deckCard = makeInst('__F8DC_PLAIN', 'A');
    s.instances[deckCard.instanceId] = deckCard;
    s.players.A.deck.push(deckCard.instanceId);

    let st = dispatchOnPlay(s, src.instanceId);
    st = applyAction(st, 'A', { type: 'RESOLVE_EFFECT_OFFER', accept: true }, { checkInvariants: false }).state;
    const pt = st.pending?.kind === 'attack_target_pick' ? st.pending.pendingTargetPick : null;
    expect(pt?.costPick?.costKey).toBe('discardHandFilter');
    expect([...(pt?.candidateIds ?? [])].sort()).toEqual(traited.map((t) => t.instanceId).sort());
    expect(pt?.candidateIds.includes(plain.instanceId)).toBe(false);
    const pick = traited[1]!.instanceId;
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: pick }, { checkInvariants: false }).state;
    expect(st.pending).toBeNull();
    expect(st.players.A.trash.includes(pick)).toBe(true);
  });

  it('cost picker chains INTO the target picker (pay first, then choose the action target)', () => {
    const built = buildState({
      leaderA: LEADER_A,
      leaderB: LEADER_B,
      charsB: [VAN('__F8DC_OPP1'), VAN('__F8DC_OPP2')],
    });
    const s = built.state;
    s.activePlayer = 'A';
    s.humanControllers = ['A'];
    s.cardLibrary['__F8DC_VAN'] = VAN('__F8DC_VAN');
    for (let i = 0; i < 2; i++) {
      const inst = makeInst('__F8DC_VAN', 'A');
      s.instances[inst.instanceId] = inst;
      s.players.A.hand.push(inst.instanceId);
    }
    const COMBO: EventCard = {
      ...GORDON_SHAPE,
      id: '__F8DC_COMBO',
      name: 'F8DC Combo',
      effectSpecV2: {
        schemaVersion: 2,
        clauses: [
          {
            trigger: 'on_play',
            cost: { discardHand: 1 },
            action: { kind: 'power_buff', magnitude: -2000, duration: 'this_turn' },
            target: { kind: 'opp_character' },
            verified: 'human-reviewed',
          },
        ],
        continuous: [],
        replacements: [],
      },
    } as unknown as EventCard;
    s.cardLibrary[COMBO.id] = COMBO;
    const src = makeInst(COMBO.id, 'A');
    s.instances[src.instanceId] = src;

    let st = dispatchOnPlay(s, src.instanceId);
    st = applyAction(st, 'A', { type: 'RESOLVE_EFFECT_OFFER', accept: true }, { checkInvariants: false }).state;
    // First: PAY (cost picker)...
    let pt = st.pending?.kind === 'attack_target_pick' ? st.pending.pendingTargetPick : null;
    expect(pt?.costPick?.costKey).toBe('discardHand');
    const pay = st.players.A.hand[1]!;
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: pay }, { checkInvariants: false }).state;
    // ...then: CHOOSE the action target (normal target picker, cost already paid).
    pt = st.pending?.kind === 'attack_target_pick' ? st.pending.pendingTargetPick : null;
    expect(pt?.costPick).toBeUndefined();
    expect(pt?.paidCost).toBe(true);
    expect(st.players.A.trash.includes(pay), 'cost paid before target pick').toBe(true);
    const target = built.fieldB[0]!.instanceId;
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: target }, { checkInvariants: false }).state;
    expect(st.pending).toBeNull();
  });
});
