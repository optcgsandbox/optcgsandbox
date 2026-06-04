/**
 * Per-card semantic test — EB01-028 Gum-Gum Champion Rifle ([Counter] event).
 *
 * Printed text (cards.json):
 *   "[Counter] If your Leader has the {Impel Down} type, up to 1 of your
 *    Leader or Character cards gains +2000 power during this battle. Then,
 *    your opponent returns 1 of their active Characters to the owner's hand."
 *
 * 5-axis: TWO on_play clauses (both gated by if_leader_has_trait Impel Down):
 *   1) power_buff +2000 this_battle target your_leader_or_character
 *   2) removal_bounce target opp_character filter{active:true}
 *
 * counterEventBoost on cards.json should be 2000. The spec is faithful;
 * primitives all present.
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

const ID_LEADER: LeaderCard = {
  id: 'TEST_ID_LEADER',
  name: 'TEST',
  kind: 'leader',
  colors: ['blue'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Impel Down'],
  keywords: [],
  effectTags: [],
};

const NON_ID_LEADER: LeaderCard = {
  id: 'TEST_NONID_LEADER',
  name: 'TEST',
  kind: 'leader',
  colors: ['blue'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Other'],
  keywords: [],
  effectTags: [],
};

function oppChar(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['blue'],
    cost: 3,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-028 — Gum-Gum Champion Rifle ([Counter] event)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-028');
  if (eb === undefined) throw new Error('EB01-028 not in cards.json');
  if (eb.kind !== 'event') throw new Error('EB01-028 should be an event');
  const rifle = eb as EventCard;

  function attachEventSource(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[rifle.id] = rifle;
    const inst = makeInst(rifle.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('spec is two on_play clauses (power_buff + removal_bounce) both gated by Impel Down', () => {
    const cs = rifle.effectSpecV2!.clauses!;
    expect(cs).toHaveLength(2);
    expect(cs[0]!.trigger).toBe('on_play');
    expect(cs[0]!.action.kind).toBe('power_buff');
    expect((cs[0]!.condition as { type: string; trait: string }).trait).toBe('Impel Down');
    expect(cs[1]!.action.kind).toBe('removal_bounce');
    expect((cs[1]!.condition as { type: string; trait: string }).trait).toBe('Impel Down');
  });

  it('counter_event legality wired (effectTags + counterEventBoost=2000)', () => {
    expect(rifle.effectTags).toContain('counter_event');
    expect((rifle as { counterEventBoost?: number }).counterEventBoost).toBe(2000);
  });

  it('with Impel Down leader: +2000 to own leader bucket + bounces an active opp char', () => {
    const opp = oppChar('TEST_OPP_RIFLE');
    const { state, leaderInstA, fieldB } = buildState({
      leaderA: ID_LEADER,
      charsB: [opp],
    });
    const srcId = attachEventSource(state);
    const oppId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.instances[leaderInstA.instanceId]!.powerModifierThisBattle ?? 0).toBe(2000);
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(false);
    expect(next.players.B.hand).toContain(oppId);
  });

  it('without Impel Down leader: condition false → no buff and no bounce', () => {
    const opp = oppChar('TEST_OPP_RIFLE_B');
    const { state, leaderInstA, fieldB } = buildState({
      leaderA: NON_ID_LEADER,
      charsB: [opp],
    });
    const srcId = attachEventSource(state);
    const oppId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.instances[leaderInstA.instanceId]!.powerModifierThisBattle ?? 0).toBe(0);
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(true);
  });

  it('rested opp char NOT bounced (filter active:true excludes rested)', () => {
    const opp = oppChar('TEST_OPP_RIFLE_REST');
    const { state, fieldB } = buildState({ leaderA: ID_LEADER, charsB: [opp] });
    const srcId = attachEventSource(state);
    const oppId = fieldB[0]!.instanceId;
    state.instances[oppId]!.rested = true;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(true);
  });

  it('P-OPP-FORCED-ACTION: bounce step (clause 2) has target.oppSelect===true', () => {
    const spec = (eb as { effectSpecV2: { clauses: Array<{ action: { kind: string }; target?: { oppSelect?: boolean } }> } }).effectSpecV2;
    const bounceClause = spec.clauses.find((c) => c.action.kind === 'removal_bounce');
    expect(bounceClause).toBeDefined();
    expect(bounceClause!.target!.oppSelect).toBe(true);
  });

  it('P-OPP-FORCED-ACTION: with 2+ active opp chars, bounce step suspends into PendingChoose with controller=B (opp)', () => {
    const opp1 = oppChar('TEST_OPP_RIFLE_M1');
    const opp2 = oppChar('TEST_OPP_RIFLE_M2');
    const { state, fieldB } = buildState({ leaderA: ID_LEADER, charsB: [opp1, opp2] });
    const srcId = attachEventSource(state);
    const opp1Id = fieldB[0]!.instanceId;
    const opp2Id = fieldB[1]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.pending).not.toBeNull();
    expect((next.pending as { kind: string }).kind).toBe('choose_one');
    const pc = (next.pending as { pendingChoose: { controller: string; options: Array<unknown> } }).pendingChoose;
    expect(pc.controller).toBe('B');
    expect(pc.options).toHaveLength(2);
    // Both opp chars remain on B.field until B resolves the choice.
    expect(next.players.B.field.some((i) => i.instanceId === opp1Id)).toBe(true);
    expect(next.players.B.field.some((i) => i.instanceId === opp2Id)).toBe(true);
  });
});
