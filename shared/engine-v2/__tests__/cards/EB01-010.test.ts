/**
 * Per-card semantic test — EB01-010 "There's No Way You Could Defeat Me!!" (event).
 *
 * Printed text (cards.json):
 *   "[Counter] K.O. up to 1 of your opponent's Characters with 6000 base
 *    power or less."
 *
 * Spec: removal_ko action with target filter `power ≤ 6000`.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { actionHandlers } from '../../registry/types.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';

import { buildState } from './_fixtures.js';

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
  id: 'TEST_LEADER',
  name: 'Vanilla Leader',
  kind: 'leader',
  colors: ['red'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

function oppChar(id: string, basePower: number): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['red'],
    cost: 3,
    power: basePower,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-010 — There\'s No Way You Could Defeat Me!! (event)', () => {
  const allCards = loadCards();
  const card = allCards.find((c) => c.id === 'EB01-010');
  if (card === undefined) throw new Error('EB01-010 not in cards.json');
  if (card.kind !== 'event') throw new Error('EB01-010 should be an event');
  const clause = card.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-010 missing clause');

  it('KOs a 6000-base opp char (== cap)', () => {
    const opp = oppChar('TEST_OPP_6000', 6000);
    const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [opp] });
    const oppId = fieldB[0]!.instanceId;
    const handler = actionHandlers.get(clause.action.kind);
    const next = handler(
      state,
      { sourceInstanceId: 'evt', controller: 'A' },
      clause.action,
      [oppId],
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(false);
    expect(next.players.B.trash).toContain(oppId);
  });

  it('KOs a 4000-base opp char (well under cap)', () => {
    const opp = oppChar('TEST_OPP_4000', 4000);
    const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [opp] });
    const oppId = fieldB[0]!.instanceId;
    const handler = actionHandlers.get(clause.action.kind);
    const next = handler(
      state,
      { sourceInstanceId: 'evt', controller: 'A' },
      clause.action,
      [oppId],
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(false);
  });

  it('does NOT remove the target from B if removal_ko is called with empty targets', () => {
    const opp = oppChar('TEST_OPP_X', 5000);
    const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [opp] });
    const oppId = fieldB[0]!.instanceId;
    const handler = actionHandlers.get(clause.action.kind);
    const next = handler(
      state,
      { sourceInstanceId: 'evt', controller: 'A' },
      clause.action,
      [],
    );
    expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(true);
  });
});
