/**
 * Per-card semantic test — EB01-029 Sorry. I'm a Goner. ([Counter] event).
 *
 * Printed text (cards.json):
 *   "[Counter] Reveal 1 card from the top of your deck. If the revealed
 *    card has a cost of 4 or more, return up to 1 of your Characters to
 *    the owner's hand. Then, place the revealed card at the bottom of
 *    your deck."
 *
 * 5-axis: one on_play clause / action reveal_top_then_if_cost_min with
 *   filter{minCost:4} + minCost:4 (both forms — see SPEC FIX below) +
 *   thenAction removal_bounce / target your_character.
 *
 * SPEC FIX (prior audit): action now carries `filter:{minCost:4}` in addition
 * to the legacy top-level `minCost:4`. Without the explicit filter object,
 * `revealMatchesFilter` at actions3.ts:838-839 falls back to the action
 * itself as the filter, and the action's `kind:'reveal_top_then_if_cost_min'`
 * is then read as a card-kind filter (line 842) — failing the check against
 * the revealed character's kind:'character'. Adding `filter:{minCost:4}`
 * forces the handler down the explicit-filter path; engine-side gap logged
 * in BUGS_FOUND.md EB01-029.
 *
 * Legality gap re-ref (BUGS_FOUND.md EB01-038): counterEventBoost is null on
 * this card; `legality.ts:277-281` only enumerates PLAY_COUNTER for events
 * with `counterEventBoost > 0`. The card cannot enter play in counter step
 * today. Per-card test cannot exercise legality directly; this is a known
 * engine gap deferred to post-audit fix.
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

const VANILLA_LEADER: LeaderCard = {
  id: 'TEST_LEADER_EB029',
  name: 'TEST',
  kind: 'leader',
  colors: ['blue'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

function ownChar(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['blue'],
    cost: 3,
    power: 4000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

function cardWithCost(id: string, cost: number): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['blue'],
    cost,
    power: 1000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe("EB01-029 — Sorry. I'm a Goner. ([Counter] event)", () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-029');
  if (eb === undefined) throw new Error('EB01-029 not in cards.json');
  if (eb.kind !== 'event') throw new Error('EB01-029 should be an event');
  const sorry = eb as EventCard;
  const clause = sorry.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-029 missing clause');

  function attachEventSource(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[sorry.id] = sorry;
    const inst = makeInst(sorry.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('clause shape: on_play / reveal_top_then_if_cost_min filter{minCost:4} thenAction removal_bounce / target your_character', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('reveal_top_then_if_cost_min');
    const action = clause.action as { minCost: number; filter: { minCost: number }; thenAction: { kind: string } };
    expect(action.filter.minCost).toBe(4);
    expect(action.minCost).toBe(4);
    expect(action.thenAction.kind).toBe('removal_bounce');
    expect(clause.target!.kind).toBe('your_character');
  });

  it('boundary inclusive: revealed cost-4 char triggers bounce', () => {
    // Already covered below; this is an explicit boundary acknowledgement.
    expect((clause.action as { minCost: number }).minCost).toBe(4);
  });

  it('revealed cost-4 card → own char gets bounced', () => {
    const own = ownChar('TEST_OWN_BOUNCE');
    const top = cardWithCost('TEST_TOP_C4', 4);
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [own] });
    state.cardLibrary[top.id] = top;
    const topInst = makeInst(top.id, 'A');
    state.instances[topInst.instanceId] = topInst;
    state.players.A.deck = [topInst.instanceId];
    const srcId = attachEventSource(state);
    const ownId = fieldA[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.A.field.some((i) => i.instanceId === ownId)).toBe(false);
    expect(next.players.A.hand).toContain(ownId);
  });

  it('revealed cost-3 card → own char NOT bounced (threshold below 4)', () => {
    const own = ownChar('TEST_OWN_SAFE');
    const top = cardWithCost('TEST_TOP_C3', 3);
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [own] });
    state.cardLibrary[top.id] = top;
    const topInst = makeInst(top.id, 'A');
    state.instances[topInst.instanceId] = topInst;
    state.players.A.deck = [topInst.instanceId];
    const srcId = attachEventSource(state);
    const ownId = fieldA[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.A.field.some((i) => i.instanceId === ownId)).toBe(true);
  });
});
