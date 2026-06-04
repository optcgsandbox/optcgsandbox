/**
 * Per-card semantic test — EB01-038 Oh Come My Way ([Counter] event).
 *
 * Printed text (cards.json):
 *   "[Counter] DON!! −1: If your Leader's type includes "Baroque Works",
 *    select 1 of your Characters. Change the attack target to the selected
 *    Character."
 *
 * 5-axis: clause on_play / condition if_leader_has_type Baroque Works /
 *   cost donCostReturnToDeck:1 / action attack_redirect_to_target /
 *   target your_character.
 *
 * Engine gap (logged in BUGS_FOUND.md EB01-038): counterEventBoost is null on
 * this card; `legality.ts:277-281` enumerates PLAY_COUNTER only for events
 * with `counterEventBoost > 0`. The card cannot enter play in counter step
 * today. Per-card test cannot exercise legality directly; this is a known
 * engine gap deferred to post-audit fix.
 *
 * Action-side test exercises the attack redirect via `EffectDispatcher`
 * after seeding a pending attack state — proves the action correctly
 * mutates `pending.pendingAttack.targetInstanceId` to the chosen own char.
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
import { actionHandlers } from '../../registry/types.js';

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

const BW_LEADER: LeaderCard = {
  id: 'TEST_BW_LEADER_38',
  name: 'TEST',
  kind: 'leader',
  colors: ['purple'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Baroque Works'],
  keywords: [],
  effectTags: [],
};

const NON_BW_LEADER: LeaderCard = {
  id: 'TEST_NONBW_LEADER_38',
  name: 'TEST',
  kind: 'leader',
  colors: ['purple'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Other'],
  keywords: [],
  effectTags: [],
};

function ownChar(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['purple'],
    cost: 2,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-038 — Oh Come My Way ([Counter] event)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-038');
  if (eb === undefined) throw new Error('EB01-038 not in cards.json');
  if (eb.kind !== 'event') throw new Error('EB01-038 should be an event');
  const ev = eb as EventCard;
  const clause = ev.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-038 missing clause');

  function attachEventSource(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[ev.id] = ev;
    const inst = makeInst(ev.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('clause shape: on_play / Baroque Works / donCostReturnToDeck:1 / attack_redirect_to_target / your_character', () => {
    expect(clause.trigger).toBe('on_play');
    expect((clause.condition as { typeString: string }).typeString).toBe('Baroque Works');
    expect(clause.cost!['donCostReturnToDeck']).toBe(1);
    expect(clause.action.kind).toBe('attack_redirect_to_target');
    expect(clause.target!.kind).toBe('your_character');
  });

  it('attack_redirect_to_target action is registered', () => {
    expect(actionHandlers.has('attack_redirect_to_target')).toBe(true);
  });

  it('event is tagged counter_event but counterEventBoost is null (BUGS_FOUND.md EB01-038: legality.ts:277-281 refuses null counterEventBoost)', () => {
    expect(ev.effectTags).toContain('counter_event');
    expect((ev as { counterEventBoost?: number | null }).counterEventBoost).toBeNull();
  });

  it('with Baroque Works leader + pending attack: redirects attack target to own char', () => {
    const own = ownChar('TEST_OWN_REDIRECT');
    const { state, fieldA, leaderInstA } = buildState({ leaderA: BW_LEADER, charsA: [own] });
    const ownId = fieldA[0]!.instanceId;
    // Seed a pending attack: attacker = opp leader, target = own leader.
    state.pending = {
      kind: 'attack',
      pendingAttack: {
        attackerInstanceId: 'fake-attacker',
        targetInstanceId: leaderInstA.instanceId,
      },
    } as never;
    const srcId = attachEventSource(state);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    // Pending attack target now redirected to the own char.
    expect((next.pending as { pendingAttack: { targetInstanceId: string } } | null)!.pendingAttack.targetInstanceId).toBe(ownId);
  });

  it('without Baroque Works leader: condition false → no redirect (target stays the leader)', () => {
    const own = ownChar('TEST_OWN_REDIRECT_NEG');
    const { state, fieldA, leaderInstA } = buildState({ leaderA: NON_BW_LEADER, charsA: [own] });
    void fieldA;
    state.pending = {
      kind: 'attack',
      pendingAttack: {
        attackerInstanceId: 'fake-attacker',
        targetInstanceId: leaderInstA.instanceId,
      },
    } as never;
    const srcId = attachEventSource(state);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect((next.pending as { pendingAttack: { targetInstanceId: string } } | null)!.pendingAttack.targetInstanceId).toBe(leaderInstA.instanceId);
  });
});
