/**
 * F-8D addendum — optional vs mandatory effect semantics (engine).
 *
 * OPTIONAL-COSTED clauses ("You may pay <cost>: <effect>") now ASK before
 * paying on human seats: ask → pay → resolve. Decline pays NOTHING.
 * activate_main is exempt (activating was the player's explicit choice).
 * Mandatory pickers (target.mandatory flag) hide choose-none and reject
 * empty picks. AI / simulation keep the V0 auto-pay path — proven below.
 * All cards synthetic; derivation is purely metadata.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { CharacterCard, EventCard, LeaderCard } from '../cards/Card.js';
import { EffectDispatcher } from '../effects/EffectDispatcher.js';
import { effectivePower } from '../state/derived/power.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';
import { applyAction } from '../reducers/applyAction.js';

import { buildState, makeInst } from './cards/_fixtures.js';

const LEADER_A: LeaderCard = {
  id: '__F8DO_LA', name: 'F8DO Leader A', kind: 'leader', colors: ['red'],
  cost: null, power: 5000, counterValue: null, traits: [], keywords: [],
  effectTags: [], life: 5,
};
const LEADER_B: LeaderCard = { ...LEADER_A, id: '__F8DO_LB', name: 'F8DO Leader B' };
const VAN = (id: string): CharacterCard => ({
  id, name: id, kind: 'character', colors: ['red'], cost: 2, power: 3000,
  counterValue: 1000, traits: [], keywords: [], effectTags: [],
});

/** "You may trash 1 card from your hand: draw 1. Then draw 1." (two clauses:
 *  costed draw + free draw — proves decline still runs the tail). */
const OPTIONAL_COSTED: EventCard = {
  id: '__F8DO_OPT', name: 'F8DO Optional', kind: 'event', colors: ['red'],
  cost: 1, power: null, counterValue: null, traits: [], keywords: [], effectTags: [],
  effectSpecV2: {
    schemaVersion: 2,
    clauses: [
      { trigger: 'on_play', cost: { discardHand: 1 }, action: { kind: 'draw', magnitude: 1 }, verified: 'human-reviewed' },
      { trigger: 'on_play', action: { kind: 'draw', magnitude: 1 }, verified: 'human-reviewed' },
    ],
    continuous: [],
    replacements: [],
  },
} as unknown as EventCard;

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

function boot(human: boolean) {
  const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B });
  const s = built.state;
  s.activePlayer = 'A';
  if (human) s.humanControllers = ['A'];
  s.cardLibrary[OPTIONAL_COSTED.id] = OPTIONAL_COSTED;
  const src = makeInst(OPTIONAL_COSTED.id, 'A');
  s.instances[src.instanceId] = src;
  // hand fodder (cost) + deck fodder (draws)
  s.cardLibrary['__F8DO_VAN'] = VAN('__F8DO_VAN');
  for (const zone of ['hand', 'deck', 'deck', 'deck'] as const) {
    const i = makeInst('__F8DO_VAN', 'A');
    s.instances[i.instanceId] = i;
    if (zone === 'hand') s.players.A.hand.push(i.instanceId);
    else s.players.A.deck.push(i.instanceId);
  }
  return { built, s, src };
}

describe('F-8D addendum — optional-costed effect offer', () => {
  it('human seat: SUSPENDS into effect_offer BEFORE any cost is paid', () => {
    const { s, src } = boot(true);
    const handBefore = s.players.A.hand.length;
    const next = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'on_play');
    expect(next.pending?.kind).toBe('effect_offer');
    expect(next.phase).toBe('effect_offer');
    expect(next.players.A.hand.length, 'cost NOT paid yet').toBe(handBefore);
    expect(next.players.A.trash.length).toBe(0);
  });

  it('SKIP: pays nothing, emits EFFECT_DECLINED, and the TAIL clause still runs', () => {
    const { s, src } = boot(true);
    const handBefore = s.players.A.hand.length;
    let st = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'on_play');
    st = applyAction(st, 'A', { type: 'RESOLVE_EFFECT_OFFER', accept: false }, { checkInvariants: false }).state;
    expect(st.pending).toBeNull();
    expect(st.phase).toBe('main');
    expect(st.players.A.trash.length, 'no cost paid on skip').toBe(0);
    // hand: unchanged by clause 0 (declined), +1 from the free tail draw.
    expect(st.players.A.hand.length).toBe(handBefore + 1);
    const declined = (st.history as Array<{ type: string }>).filter((h) => h.type === 'EFFECT_DECLINED');
    expect(declined.length).toBe(1);
  });

  it('USE EFFECT: pays the cost exactly once, resolves, tail continues (net +2 cards, 1 trashed)', () => {
    const { s, src } = boot(true);
    const handBefore = s.players.A.hand.length;
    let st = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'on_play');
    st = applyAction(st, 'A', { type: 'RESOLVE_EFFECT_OFFER', accept: true }, { checkInvariants: false }).state;
    expect(st.pending).toBeNull();
    expect(st.players.A.trash.length, 'cost paid once').toBe(1);
    // hand: −1 cost, +1 costed draw, +1 tail draw = +1 net.
    expect(st.players.A.hand.length).toBe(handBefore + 1);
  });

  it('activate_main costed clauses do NOT offer (activation was the choice) — pays directly', () => {
    const { s } = boot(true);
    const ACT: CharacterCard = {
      ...VAN('__F8DO_ACT'),
      effectSpecV2: {
        schemaVersion: 2,
        clauses: [
          { trigger: 'activate_main', cost: { restSelf: true }, action: { kind: 'draw', magnitude: 1 }, verified: 'human-reviewed' },
        ],
        continuous: [],
        replacements: [],
      },
    } as unknown as CharacterCard;
    s.cardLibrary[ACT.id] = ACT;
    const inst = makeInst(ACT.id, 'A');
    s.instances[inst.instanceId] = inst;
    s.players.A.field.push(inst);
    const next = EffectDispatcher.dispatch(s, { sourceInstanceId: inst.instanceId, controller: 'A' }, 'activate_main');
    expect(next.pending, 'no offer for activate_main').toBeNull();
    expect(next.instances[inst.instanceId]!.rested, 'cost paid directly').toBe(true);
  });

  it('NON-human seat keeps V0 auto-pay (no offer, cost paid, effect resolved)', () => {
    const { s, src } = boot(false);
    const next = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'on_play');
    expect(next.pending).toBeNull();
    expect(next.players.A.trash.length).toBe(1); // auto-paid
  });

  it('unpayable optional cost → clause silently skipped (no offer), tail still runs', () => {
    const { s, src } = boot(true);
    s.players.A.hand = []; // can't pay discardHand
    const next = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'on_play');
    expect(next.pending).toBeNull();
    expect(next.players.A.hand.length, 'tail free draw still ran').toBe(1);
  });
});

describe('F-8D addendum — mandatory target semantics (target.mandatory flag)', () => {
  it('mandatory picker: mayChooseNone=false; empty pick REJECTED; real pick accepted', () => {
    const built = buildState({
      leaderA: LEADER_A,
      leaderB: LEADER_B,
      charsB: [VAN('__F8DO_OPP')],
    });
    const s = built.state;
    s.activePlayer = 'A';
    s.humanControllers = ['A'];
    const MAND: EventCard = {
      ...OPTIONAL_COSTED,
      id: '__F8DO_MAND',
      name: 'F8DO Mandatory',
      effectSpecV2: {
        schemaVersion: 2,
        clauses: [{
          trigger: 'on_play',
          action: { kind: 'power_buff', magnitude: -2000, duration: 'this_turn' },
          target: { kind: 'opp_character', mandatory: true },
          verified: 'human-reviewed',
        }],
        continuous: [],
        replacements: [],
      },
    } as unknown as EventCard;
    s.cardLibrary[MAND.id] = MAND;
    const src = makeInst(MAND.id, 'A');
    s.instances[src.instanceId] = src;

    let st = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'on_play');
    expect(st.pending?.kind).toBe('attack_target_pick');
    const pt = st.pending?.kind === 'attack_target_pick' ? st.pending.pendingTargetPick : null;
    expect(pt?.mayChooseNone, 'mandatory → no choose-none').toBe(false);

    // Empty pick rejected.
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: null }, { checkInvariants: false }).state;
    expect(st.pending?.kind, 'cannot skip a mandatory target').toBe('attack_target_pick');

    // Real pick resolves.
    const target = built.fieldB[0]!.instanceId;
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: target }, { checkInvariants: false }).state;
    expect(st.pending).toBeNull();
    expect(effectivePower(st, st.instances[target]!)).toBe(1000); // 3000 − 2000
  });
});
