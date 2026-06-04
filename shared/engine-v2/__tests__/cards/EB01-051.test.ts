/**
 * Per-card semantic test — EB01-051 Finger Pistol ([Main] event).
 * "[Main] You may trash 2 cards from the top of your deck: K.O. up to 1 of
 *  your opponent's Characters with a cost of 5 or less."
 * Spec: on_play / cost millSelf:2 / removal_ko / opp_character costMax:5.
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

const L: LeaderCard = {
  id: 'TEST_L_EB051', name: 'L', kind: 'leader', colors: ['black'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function opp(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['black'], cost, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

function filler(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['black'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB01-051 — Finger Pistol', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-051');
  if (eb === undefined || eb.kind !== 'event') throw new Error('EB01-051 invalid');
  const ev = eb as EventCard;
  const clause = ev.effectSpecV2!.clauses![0]!;

  function attachSrc(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[ev.id] = ev;
    const inst = makeInst(ev.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('spec shape: on_play / millSelf:2 / removal_ko / opp_character costMax:5', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.cost!['millSelf']).toBe(2);
    expect(clause.action.kind).toBe('removal_ko');
    expect((clause.target as { filter: { costMax: number } }).filter.costMax).toBe(5);
  });

  it('mills 2 from own deck + KOs cost-5 opp char', () => {
    const o = opp('TEST_OPP_C5', 5);
    const m1 = filler('TEST_M1');
    const m2 = filler('TEST_M2');
    const { state, fieldB } = buildState({ leaderA: L, charsB: [o] });
    for (const c of [m1, m2]) {
      state.cardLibrary[c.id] = c;
      const inst = makeInst(c.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.deck.push(inst.instanceId);
    }
    const oId = fieldB[0]!.instanceId;
    const trashBefore = state.players.A.trash.length;
    const srcId = attachSrc(state);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.trash.length).toBe(trashBefore + 2);
    expect(next.players.B.field.some((i) => i.instanceId === oId)).toBe(false);
    expect(next.players.B.trash).toContain(oId);
  });

  it('does NOT KO cost-6 opp char (boundary exclusive)', () => {
    const o = opp('TEST_OPP_C6', 6);
    const m1 = filler('TEST_M1_B');
    const m2 = filler('TEST_M2_B');
    const { state, fieldB } = buildState({ leaderA: L, charsB: [o] });
    for (const c of [m1, m2]) {
      state.cardLibrary[c.id] = c;
      const inst = makeInst(c.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.deck.push(inst.instanceId);
    }
    const oId = fieldB[0]!.instanceId;
    const srcId = attachSrc(state);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oId)).toBe(true);
  });
});
