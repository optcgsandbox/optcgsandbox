/**
 * Per-card semantic test — EB02-051 Three-Pace Hum Soul Notch Slash ([Main] event).
 * "[Main] Choose one:
 *  • K.O. up to 1 of your opponent's Characters with a cost of 2 or less.
 *  • Give up to 1 of your opponent's Characters −4 cost during this turn."
 * Spec: on_play / choose_one[
 *   {removal_ko / opp_character costMax:2},
 *   {removal_cost_reduce magnitude:4 duration:this_turn / opp_character}].
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, EventCard, LeaderCard } from '../../cards/Card.js';
import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import { applyAction } from '../../reducers/applyAction.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';

import { buildState, makeInst } from './_fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

function loadCards(): Card[] {
  const raw = readFileSync(resolve(__dirname, '../../../data/cards.json'), 'utf-8');
  return JSON.parse(raw) as Card[];
}

const L: LeaderCard = {
  id: 'TEST_L_EB02051', name: 'L', kind: 'leader', colors: ['black'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function opp(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['black'], cost, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-051 — Three-Pace Hum Soul Notch Slash', () => {
  const c = loadCards().find((x) => x.id === 'EB02-051');
  if (c === undefined || c.kind !== 'event') throw new Error('EB02-051 invalid');
  const ev = c as EventCard;
  const clause = ev.effectSpecV2!.clauses![0]!;

  function attach(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[ev.id] = ev;
    const inst = makeInst(ev.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('shape: on_play / choose_one[{removal_ko opp_character costMax:2}, {removal_cost_reduce mag:4 this_turn opp_character}]', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('choose_one');
    const opts = (clause.action as { options: ReadonlyArray<{ action: { kind: string; magnitude?: number; duration?: string }; target?: { kind: string; filter?: { costMax?: number } } }> }).options;
    expect(opts).toHaveLength(2);
    expect(opts[0]!.action.kind).toBe('removal_ko');
    expect(opts[0]!.target!.kind).toBe('opp_character');
    expect(opts[0]!.target!.filter?.costMax).toBe(2);
    expect(opts[1]!.action.kind).toBe('removal_cost_reduce');
    expect(opts[1]!.action.magnitude).toBe(4);
    expect(opts[1]!.action.duration).toBe('this_turn');
    expect(opts[1]!.target!.kind).toBe('opp_character');
  });

  it('choose option 0: cost-2 opp char KO\'d', () => {
    const target = opp('TEST_OPP_C2_E51', 2);
    const { state, fieldB } = buildState({ leaderA: L, charsB: [target] });
    const srcId = attach(state);
    const oppId = fieldB[0]!.instanceId;
    const dispatched = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(dispatched.pending?.kind).toBe('choose_one');
    const result = applyAction(dispatched, 'A', { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 } as never);
    expect(result.state.players.B.field.some((i) => i.instanceId === oppId)).toBe(false);
    expect(result.state.players.B.trash).toContain(oppId);
  });

  it('choose option 0: cost-3 opp char NOT KO\'d (filter exclude)', () => {
    const target = opp('TEST_OPP_C3_E51', 3);
    const { state, fieldB } = buildState({ leaderA: L, charsB: [target] });
    const srcId = attach(state);
    const oppId = fieldB[0]!.instanceId;
    const dispatched = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    const result = applyAction(dispatched, 'A', { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 } as never);
    expect(result.state.players.B.field.some((i) => i.instanceId === oppId)).toBe(true);
  });

  it('choose option 1: any opp char → costModifier=-4', () => {
    const target = opp('TEST_OPP_REDUCE_E51', 5);
    const { state, fieldB } = buildState({ leaderA: L, charsB: [target] });
    const srcId = attach(state);
    const oppId = fieldB[0]!.instanceId;
    const dispatched = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    const result = applyAction(dispatched, 'A', { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 1 } as never);
    expect(result.state.instances[oppId]!.costModifierOneShot ?? 0).toBe(-4);
  });
});
