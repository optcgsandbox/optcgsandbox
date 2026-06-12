/**
 * F-8D — generic target-picker engine tests.
 *
 * The dispatcher suspends choice-kind targeted clauses into
 * `attack_target_pick` for humanControllers seats, carrying the full
 * clause continuation (cost pre-paid). RESOLVE_TARGET_PICK validates and
 * runs the action on the picked targets. Non-human seats keep the V0
 * deterministic auto-resolve — proven by the same clause with the flag
 * absent. All cards here are synthetic; behavior derives purely from
 * effect metadata (target.kind families).
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
  id: '__F8DT_LA', name: 'F8DT Leader A', kind: 'leader', colors: ['red'],
  cost: null, power: 5000, counterValue: null, traits: [], keywords: [],
  effectTags: [], life: 5,
};
const LEADER_B: LeaderCard = { ...LEADER_A, id: '__F8DT_LB', name: 'F8DT Leader B' };
const OPP_CHAR = (id: string, power = 4000): CharacterCard => ({
  id, name: id, kind: 'character', colors: ['red'], cost: 3, power,
  counterValue: 1000, traits: [], keywords: [], effectTags: [],
});

/** Synthetic Otama-SHAPED event: on_play, −2000 to up to 1 opp character.
 *  (Shape only — the test never references a real card.) */
const DEBUFF_EVENT: EventCard = {
  id: '__F8DT_DEBUFF', name: 'F8DT Debuff', kind: 'event', colors: ['red'],
  cost: 1, power: null, counterValue: null, traits: [], keywords: [],
  effectTags: [],
  effectSpecV2: {
    schemaVersion: 2,
    clauses: [{
      trigger: 'on_play',
      action: { kind: 'power_buff', magnitude: -2000, duration: 'this_turn' },
      target: { kind: 'opp_character' },
      verified: 'human-reviewed',
    }],
    continuous: [],
    replacements: [],
  },
} as unknown as EventCard;

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

function boot(human: boolean, oppChars: CharacterCard[]) {
  const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B, charsB: oppChars });
  const s = built.state;
  s.activePlayer = 'A';
  if (human) s.humanControllers = ['A'];
  s.cardLibrary[DEBUFF_EVENT.id] = DEBUFF_EVENT;
  const src = makeInst(DEBUFF_EVENT.id, 'A');
  s.instances[src.instanceId] = src;
  return { built, s, src };
}

describe('F-8D — generic target picker (engine)', () => {
  it('human seat: targeted clause SUSPENDS with candidates instead of auto-picking', () => {
    const { s, src, built } = boot(true, [OPP_CHAR('__F8DT_O1'), OPP_CHAR('__F8DT_O2')]);
    const next = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'on_play');
    expect(next.pending?.kind).toBe('attack_target_pick');
    expect(next.phase).toBe('attack_target_pick');
    const pt = next.pending?.kind === 'attack_target_pick' ? next.pending.pendingTargetPick : null;
    expect(pt?.candidateIds).toHaveLength(2);
    expect(pt?.mayChooseNone).toBe(true);
    expect(pt?.pickLimit).toBe(1);
    // No effect applied yet — confirmation gates the action.
    for (const c of built.fieldB) {
      expect(effectivePower(next, c)).toBe(4000);
    }
  });

  it('RESOLVE_TARGET_PICK applies the action to the PICKED candidate (second one — auto-pick would take the first)', () => {
    const { s, src, built } = boot(true, [OPP_CHAR('__F8DT_O1'), OPP_CHAR('__F8DT_O2')]);
    let st = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'on_play');
    const second = built.fieldB[1]!.instanceId;
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: second }, { checkInvariants: false }).state;
    expect(st.pending).toBeNull();
    expect(st.phase).toBe('main');
    expect(effectivePower(st, st.instances[second]!)).toBe(2000); // 4000 − 2000
    expect(effectivePower(st, st.players.B.field[0]!)).toBe(4000); // untouched
    const fired = (st.history as Array<{ type: string }>).filter((h) => h.type === 'CLAUSE_FIRED');
    expect(fired.length).toBeGreaterThan(0);
  });

  it('choose none resolves with no effect (printed "up to")', () => {
    const { s, src } = boot(true, [OPP_CHAR('__F8DT_O1')]);
    let st = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'on_play');
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: null }, { checkInvariants: false }).state;
    expect(st.pending).toBeNull();
    expect(st.phase).toBe('main');
    expect(effectivePower(st, st.players.B.field[0]!)).toBe(4000);
    const picked = (st.history as Array<{ type: string; choseNone?: boolean }>).filter((h) => h.type === 'TARGET_PICKED');
    expect(picked[0]?.choseNone).toBe(true);
  });

  it('invalid picks are rejected (outside candidate set / over limit)', () => {
    const { s, src } = boot(true, [OPP_CHAR('__F8DT_O1'), OPP_CHAR('__F8DT_O2')]);
    let st = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'on_play');
    const before = st;
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: 'not-a-candidate' }, { checkInvariants: false }).state;
    expect(st.pending?.kind).toBe('attack_target_pick'); // unchanged
    const both = before.pending?.kind === 'attack_target_pick' ? before.pending.pendingTargetPick.candidateIds : [];
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: both[0]!, pickedIds: [both[0]!, both[1]!] }, { checkInvariants: false }).state;
    expect(st.pending?.kind).toBe('attack_target_pick'); // over pickLimit → rejected
  });

  it('NO candidates → NO_VALID_TARGET emitted, no suspension', () => {
    const { s, src } = boot(true, []);
    const next = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'on_play');
    expect(next.pending).toBeNull();
    const nvt = (next.history as Array<{ type: string }>).filter((h) => h.type === 'NO_VALID_TARGET');
    expect(nvt.length).toBeGreaterThan(0);
  });

  it('NON-human seat keeps the V0 deterministic auto-resolve (no pending, first candidate debuffed)', () => {
    const { s, src, built } = boot(false, [OPP_CHAR('__F8DT_O1'), OPP_CHAR('__F8DT_O2')]);
    const next = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'on_play');
    expect(next.pending).toBeNull();
    expect(effectivePower(next, built.fieldB[0]!)).toBe(2000); // auto-picked first
    expect(effectivePower(next, built.fieldB[1]!)).toBe(4000);
  });

  it('clause-TAIL resumes after resolution (multi-clause card: targeted debuff THEN draw)', () => {
    const { s, built } = boot(true, [OPP_CHAR('__F8DT_O1')]);
    const MULTI: EventCard = {
      ...DEBUFF_EVENT,
      id: '__F8DT_MULTI',
      name: 'F8DT Multi',
      effectSpecV2: {
        schemaVersion: 2,
        clauses: [
          {
            trigger: 'on_play',
            action: { kind: 'power_buff', magnitude: -2000, duration: 'this_turn' },
            target: { kind: 'opp_character' },
            verified: 'human-reviewed',
          },
          { trigger: 'on_play', action: { kind: 'draw', magnitude: 1 }, verified: 'human-reviewed' },
        ],
        continuous: [],
        replacements: [],
      },
    } as unknown as EventCard;
    s.cardLibrary[MULTI.id] = MULTI;
    const src = makeInst(MULTI.id, 'A');
    s.instances[src.instanceId] = src;
    // deck card so the tail draw has something to draw
    const dk = makeInst(OPP_CHAR('__F8DT_DECK').id, 'A');
    s.cardLibrary['__F8DT_DECK'] = OPP_CHAR('__F8DT_DECK');
    s.instances[dk.instanceId] = dk;
    s.players.A.deck.push(dk.instanceId);

    let st = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'on_play');
    expect(st.pending?.kind).toBe('attack_target_pick');
    expect(st.players.A.hand.length).toBe(0); // tail NOT yet run
    const target = built.fieldB[0]!.instanceId;
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: target }, { checkInvariants: false }).state;
    expect(effectivePower(st, st.instances[target]!)).toBe(2000); // clause 0 applied
    expect(st.players.A.hand.length).toBe(1); // clause 1 (draw) RESUMED
    expect(st.pending).toBeNull();
    expect(st.phase).toBe('main');
  });

  it('OPT clauses are marked used on resolution (even when choosing none)', () => {
    const { s, built } = boot(true, [OPP_CHAR('__F8DT_O1')]);
    const OPT_CHAR: CharacterCard = {
      ...OPP_CHAR('__F8DT_OPTSRC'),
      effectSpecV2: {
        schemaVersion: 2,
        clauses: [{
          trigger: 'activate_main',
          opt: true,
          action: { kind: 'power_buff', magnitude: -1000, duration: 'this_turn' },
          target: { kind: 'opp_character' },
          verified: 'human-reviewed',
        }],
        continuous: [],
        replacements: [],
      },
    } as unknown as CharacterCard;
    s.cardLibrary[OPT_CHAR.id] = OPT_CHAR;
    const srcInst = makeInst(OPT_CHAR.id, 'A');
    s.instances[srcInst.instanceId] = srcInst;
    s.players.A.field.push(srcInst);

    let st = EffectDispatcher.dispatch(s, { sourceInstanceId: srcInst.instanceId, controller: 'A' }, 'activate_main');
    expect(st.pending?.kind).toBe('attack_target_pick');
    st = applyAction(st, 'A', { type: 'RESOLVE_TARGET_PICK', pickedId: null }, { checkInvariants: false }).state;
    // Re-dispatch: OPT consumed → no second suspension.
    const again = EffectDispatcher.dispatch(st, { sourceInstanceId: srcInst.instanceId, controller: 'A' }, 'activate_main');
    expect(again.pending).toBeNull();
    void built;
  });
});
