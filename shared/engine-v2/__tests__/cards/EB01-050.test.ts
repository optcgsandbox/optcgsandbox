/**
 * Per-card semantic test — EB01-050 ...I Want to Live!! ([Counter] event).
 * "[Counter] If you have 30 or more cards in your trash, add up to 1 card
 *  from the top of your deck to the top of your Life cards."
 * Spec: on_play / if_trash_min n:30 / add_to_own_life_top from:top_of_deck faceUp:false.
 *
 * Engine gap re-ref (BUGS_FOUND.md EB01-038): counterEventBoost is null;
 * legality.ts:277-281 currently refuses null-boost [Counter] events.
 * Per-card test cannot exercise legality directly — deferred to post-audit fix.
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
  id: 'TEST_L_EB050', name: 'L', kind: 'leader', colors: ['black'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function filler(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['black'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB01-050 — ...I Want to Live!!', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-050');
  if (eb === undefined || eb.kind !== 'event') throw new Error('EB01-050 invalid');
  const ev = eb as EventCard;
  const clause = ev.effectSpecV2!.clauses![0]!;

  function attachSrc(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[ev.id] = ev;
    const inst = makeInst(ev.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('spec shape: on_play / if_trash_min n:30 / add_to_own_life_top from:top_of_deck faceUp:false', () => {
    expect(clause.trigger).toBe('on_play');
    expect((clause.condition as { n: number; type: string }).n).toBe(30);
    expect(clause.action.kind).toBe('add_to_own_life_top');
    expect((clause.action as { from: string; faceUp: boolean }).from).toBe('top_of_deck');
    expect((clause.action as { from: string; faceUp: boolean }).faceUp).toBe(false);
  });

  it('with trash ≥ 30: adds top deck card to life', () => {
    const top = filler('TEST_TOP_50');
    const { state } = buildState({ leaderA: L });
    state.cardLibrary[top.id] = top;
    const topInst = makeInst(top.id, 'A');
    state.instances[topInst.instanceId] = topInst;
    state.players.A.deck.push(topInst.instanceId);
    // Seed 30 trash IDs.
    for (let i = 0; i < 30; i++) {
      const id = `T-${i}`;
      state.instances[id] = makeInst('__VANILLA', 'A');
      state.instances[id].instanceId = id;
      state.players.A.trash.push(id);
    }
    const lifeBefore = state.players.A.life.length;
    const srcId = attachSrc(state);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.life.length).toBe(lifeBefore + 1);
    expect(next.players.A.life[0]).toBe(topInst.instanceId);
  });

  it('with trash = 29 (boundary exclusive): no life added (condition false)', () => {
    const top = filler('TEST_TOP_50_B');
    const { state } = buildState({ leaderA: L });
    state.cardLibrary[top.id] = top;
    const topInst = makeInst(top.id, 'A');
    state.instances[topInst.instanceId] = topInst;
    state.players.A.deck.push(topInst.instanceId);
    for (let i = 0; i < 29; i++) {
      const id = `T-29-${i}`;
      state.instances[id] = makeInst('__VANILLA', 'A');
      state.instances[id].instanceId = id;
      state.players.A.trash.push(id);
    }
    const lifeBefore = state.players.A.life.length;
    const srcId = attachSrc(state);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.life.length).toBe(lifeBefore);
  });
});
