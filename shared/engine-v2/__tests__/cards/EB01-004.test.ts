/**
 * Per-card semantic test — EB01-004 Koza (character).
 *
 * Printed text (cards.json):
 *   "[When Attacking] You may give your 1 active Leader −5000 power during
 *    this turn: Give up to 1 of your opponent's Characters −3000 power
 *    during this turn."
 *
 * Spec uses `selfPowerCost: 5000` (debuff the caster's own leader power) as
 * the cost shape; action is power_buff with magnitude=-3000 + duration this_turn.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { PhaseScheduler } from '../../phases/PhaseScheduler.js';
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

describe('EB01-004 — Koza (character)', () => {
  const allCards = loadCards();
  const koza = allCards.find((c) => c.id === 'EB01-004');
  if (koza === undefined) throw new Error('EB01-004 not in cards.json');
  if (koza.kind !== 'character') throw new Error('EB01-004 should be a character');
  const clauses = koza.effectSpecV2?.clauses ?? [];
  const clause = clauses[0];
  if (clause === undefined) throw new Error('EB01-004 missing when_attacking clause');

  const OPP_CHAR: CharacterCard = {
    id: 'TEST_OPP_CHAR',
    name: 'Opp Char',
    kind: 'character',
    colors: ['red'],
    cost: 3,
    power: 4000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };

  describe('action — power_buff -3000 this_turn on opp character', () => {
    it('dispatching power_buff with magnitude=-3000 applies -3000 to target', () => {
      const { state, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [koza as CharacterCard],
        charsB: [OPP_CHAR],
      });
      const oppCharId = fieldB[0]!.instanceId;
      const handler = actionHandlers.get(clause.action.kind);
      const next = handler(
        state,
        { sourceInstanceId: 'fake-src', controller: 'A' },
        clause.action,
        [oppCharId],
      );
      const inst = next.instances[oppCharId]!;
      expect(inst.powerModifierOneShot).toBe(-3000);
      expect(inst.powerModifierExpiresInTurns).toBe(0);
    });

    it('-3000 debuff clears after end of active player\'s turn', () => {
      const { state, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [koza as CharacterCard],
        charsB: [OPP_CHAR],
      });
      const oppCharId = fieldB[0]!.instanceId;
      const handler = actionHandlers.get(clause.action.kind);
      let next = handler(
        state,
        { sourceInstanceId: 'fake-src', controller: 'A' },
        clause.action,
        [oppCharId],
      );
      expect(next.instances[oppCharId]!.powerModifierOneShot).toBe(-3000);
      next = PhaseScheduler.enterEnd(next);
      expect(next.instances[oppCharId]!.powerModifierOneShot).toBeUndefined();
    });
  });
});
