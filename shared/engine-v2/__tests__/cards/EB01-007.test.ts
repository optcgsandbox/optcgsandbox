/**
 * Per-card semantic test — EB01-007 Yamato (character).
 *
 * Printed text (cards.json):
 *   "[Activate: Main] [Once Per Turn] Give up to 1 rested DON!! card to
 *    your Leader or 1 of your Characters."
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

describe('EB01-007 — Yamato (character)', () => {
  const allCards = loadCards();
  const yamato = allCards.find((c) => c.id === 'EB01-007');
  if (yamato === undefined) throw new Error('EB01-007 not in cards.json');
  if (yamato.kind !== 'character') throw new Error('EB01-007 should be a character');
  const yamatoChar = yamato as CharacterCard;
  const clause = yamatoChar.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-007 missing activate_main clause');

  const ALLY: CharacterCard = {
    id: 'TEST_ALLY_EB007',
    name: 'Ally',
    kind: 'character',
    colors: ['red'],
    cost: 2,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };

  describe('action — give 1 REST DON to a friendly target', () => {
    // Spec at EB01-007 sets `rested: true`, so the handler attaches the
    // DON to inst.attachedDonRested (not attachedDon, which is the active
    // bucket). That distinction matters for refresh-phase un-rest math.
    it('attaches 1 REST DON to a targeted Leader; controller cost area decremented', () => {
      const { state, leaderInstA } = buildState({ leaderA: VANILLA_LEADER });
      const leaderId = leaderInstA.instanceId;
      const costBefore = state.players.A.donCostArea.length;
      const attBefore = state.instances[leaderId]!.attachedDonRested.length;

      const handler = actionHandlers.get(clause.action.kind);
      const next = handler(
        state,
        { sourceInstanceId: 'fake-src', controller: 'A' },
        clause.action,
        [leaderId],
      );
      expect(next.instances[leaderId]!.attachedDonRested.length).toBe(attBefore + 1);
      expect(next.players.A.donCostArea.length).toBe(costBefore - 1);
    });

    it('attaches 1 REST DON to a friendly character target', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [ALLY] });
      const allyId = fieldA[0]!.instanceId;
      const costBefore = state.players.A.donCostArea.length;

      const handler = actionHandlers.get(clause.action.kind);
      const next = handler(
        state,
        { sourceInstanceId: 'fake-src', controller: 'A' },
        clause.action,
        [allyId],
      );
      expect(next.instances[allyId]!.attachedDonRested.length).toBe(1);
      expect(next.players.A.donCostArea.length).toBe(costBefore - 1);
    });

    it('no-op when DON cost area is empty', () => {
      const { state, leaderInstA } = buildState({ leaderA: VANILLA_LEADER, donInCostA: 0 });
      const leaderId = leaderInstA.instanceId;
      const attBefore = state.instances[leaderId]!.attachedDonRested.length;
      expect(state.players.A.donCostArea.length).toBe(0);

      const handler = actionHandlers.get(clause.action.kind);
      const next = handler(
        state,
        { sourceInstanceId: 'fake-src', controller: 'A' },
        clause.action,
        [leaderId],
      );
      expect(next.instances[leaderId]!.attachedDonRested.length).toBe(attBefore);
    });
  });

  it('printed keyword includes once_per_turn (OPT gate enforced at dispatch)', () => {
    expect((yamato as { keywords: string[] }).keywords).toContain('once_per_turn');
  });
});
