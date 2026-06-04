/**
 * Per-card semantic test — EB01-039 Conquerer of Three Worlds Ragnaraku
 * ([Main] event).
 *
 * Printed text (cards.json):
 *   "[Main] DON!! −1: K.O. up to 1 of your opponent's Characters with a
 *    cost of 8 or less."
 *
 * 5-axis: clause on_play / cost donCostReturnToDeck:1 / action removal_ko /
 *   target opp_character costMax:8.
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
  id: 'TEST_LEADER_EB039',
  name: 'TEST',
  kind: 'leader',
  colors: ['purple'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

function oppChar(id: string, cost: number): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['purple'],
    cost,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-039 — Conquerer of Three Worlds Ragnaraku ([Main] event)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-039');
  if (eb === undefined) throw new Error('EB01-039 not in cards.json');
  if (eb.kind !== 'event') throw new Error('EB01-039 should be an event');
  const rag = eb as EventCard;
  const clause = rag.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-039 missing clause');

  function attachEventSource(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[rag.id] = rag;
    const inst = makeInst(rag.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('clause shape: on_play / donCostReturnToDeck:1 / removal_ko / opp_character costMax:8', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.cost!['donCostReturnToDeck']).toBe(1);
    expect(clause.action.kind).toBe('removal_ko');
    expect(clause.target!.kind).toBe('opp_character');
    expect((clause.target as { filter: { costMax: number } }).filter.costMax).toBe(8);
  });

  it('KOs cost-8 opp char', () => {
    const opp = oppChar('TEST_OPP_C8', 8);
    const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [opp] });
    const oppId = fieldB[0]!.instanceId;
    const srcId = attachEventSource(state);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(false);
    expect(next.players.B.trash).toContain(oppId);
  });

  it('does NOT KO cost-9 opp char (filter exclude)', () => {
    const opp = oppChar('TEST_OPP_C9', 9);
    const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [opp] });
    const oppId = fieldB[0]!.instanceId;
    const srcId = attachEventSource(state);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(true);
  });
});
