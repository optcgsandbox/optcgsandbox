/**
 * Per-card semantic test — EB01-007 Yamato (character).
 *
 * Printed text (cards.json):
 *   "[Activate: Main] [Once Per Turn] Give up to 1 rested DON!! card to
 *    your Leader or 1 of your Characters."
 *
 * 5-axis: clause activate_main + opt:true + give_don_to_target rested:true
 *   magnitude 1 + target your_leader_or_character.
 *
 * No spec gap. The V0 deterministic `your_leader_or_character` resolver
 * picks the leader first (engine gap already logged under EB01-002).
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
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
  id: 'TEST_LEADER_EB007',
  name: 'TEST',
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

describe('EB01-007 — Yamato (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-007');
  if (eb === undefined) throw new Error('EB01-007 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-007 should be a character');
  const yamato = eb as CharacterCard;

  describe('clause [Activate: Main] — give 1 REST DON to leader-or-character', () => {
    it('1 REST DON attached to leader; cost area -1 (V0 picks leader first)', () => {
      const { state, fieldA, leaderInstA } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [yamato],
      });
      const yamatoId = fieldA[0]!.instanceId;
      const leaderId = leaderInstA.instanceId;
      const costBefore = state.players.A.donCostArea.length;
      const restedBefore = state.instances[leaderId]!.attachedDonRested.length;

      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: yamatoId, controller: 'A' },
        'activate_main',
      );
      expect(next.instances[leaderId]!.attachedDonRested.length).toBe(restedBefore + 1);
      expect(next.players.A.donCostArea.length).toBe(costBefore - 1);
    });

    it('with multiple friendly targets, exactly 1 REST DON is distributed somewhere among (leader, yamato, ally)', () => {
      const { state, fieldA, leaderInstA } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [yamato, ALLY],
      });
      const yamatoId = fieldA[0]!.instanceId;
      const allyId = fieldA[1]!.instanceId;
      const leaderId = leaderInstA.instanceId;
      const costBefore = state.players.A.donCostArea.length;

      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: yamatoId, controller: 'A' },
        'activate_main',
      );
      const restedTotal =
        next.instances[leaderId]!.attachedDonRested.length +
        next.instances[yamatoId]!.attachedDonRested.length +
        next.instances[allyId]!.attachedDonRested.length;
      expect(restedTotal).toBe(1);
      expect(next.players.A.donCostArea.length).toBe(costBefore - 1);
    });

    it('no DON in cost area → no DON attached anywhere', () => {
      const { state, fieldA, leaderInstA } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [yamato],
        donInCostA: 0,
      });
      const yamatoId = fieldA[0]!.instanceId;
      const leaderId = leaderInstA.instanceId;
      const restedBefore = state.instances[leaderId]!.attachedDonRested.length;
      expect(state.players.A.donCostArea.length).toBe(0);

      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: yamatoId, controller: 'A' },
        'activate_main',
      );
      expect(next.instances[leaderId]!.attachedDonRested.length).toBe(restedBefore);
    });

    it('OPT: second activate_main in same turn does NOT fire (clause marked opt:true)', () => {
      const { state, fieldA, leaderInstA } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [yamato],
      });
      const yamatoId = fieldA[0]!.instanceId;
      const leaderId = leaderInstA.instanceId;
      const costBefore = state.players.A.donCostArea.length;
      let next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: yamatoId, controller: 'A' },
        'activate_main',
      );
      expect(next.instances[leaderId]!.attachedDonRested.length).toBe(1);
      const costAfterFirst = next.players.A.donCostArea.length;
      expect(costAfterFirst).toBe(costBefore - 1);
      // Second activation — OPT should suppress.
      next = EffectDispatcher.dispatch(
        next,
        { sourceInstanceId: yamatoId, controller: 'A' },
        'activate_main',
      );
      expect(next.instances[leaderId]!.attachedDonRested.length).toBe(1);
      expect(next.players.A.donCostArea.length).toBe(costAfterFirst);
    });
  });
});
