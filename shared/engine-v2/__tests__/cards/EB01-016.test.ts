/**
 * Per-card semantic test — EB01-016 Bingoh (character).
 *
 * Printed text (cards.json):
 *   "[Activate: Main] You may rest this Character: K.O. up to 1 of your
 *    opponent's rested Characters with a cost of 1 or less."
 *
 * 5-axis: clause activate_main / cost restSelf / target opp_character with
 *   filter {costMax:1, rested:true} / action removal_ko.
 *
 * All primitives registered. No spec gap. No engine gap.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { CostPayer } from '../../effects/CostPayer.js';
import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import { targetResolvers } from '../../registry/types.js';
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
  id: 'TEST_LEADER_EB016',
  name: 'TEST',
  kind: 'leader',
  colors: ['green'],
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
    colors: ['green'],
    cost,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-016 — Bingoh (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-016');
  if (eb === undefined) throw new Error('EB01-016 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-016 should be a character');
  const bingoh = eb as CharacterCard;
  const clause = bingoh.effectSpecV2?.clauses?.[0];
  if (clause === undefined || clause.cost === undefined || clause.target === undefined) {
    throw new Error('EB01-016 missing clause/cost/target');
  }

  describe('cost restSelf', () => {
    it('payable when Bingoh active', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [bingoh] });
      const bId = fieldA[0]!.instanceId;
      expect(
        CostPayer.canPay(state, { sourceInstanceId: bId, controller: 'A' }, clause.cost!),
      ).toBe(true);
    });

    it('unpayable when Bingoh already rested', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [bingoh] });
      const bId = fieldA[0]!.instanceId;
      state.instances[bId]!.rested = true;
      expect(
        CostPayer.canPay(state, { sourceInstanceId: bId, controller: 'A' }, clause.cost!),
      ).toBe(false);
    });

    it('paying rests Bingoh', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [bingoh] });
      const bId = fieldA[0]!.instanceId;
      const next = CostPayer.pay(state, { sourceInstanceId: bId, controller: 'A' }, clause.cost!);
      expect(next).not.toBeNull();
      expect(next!.instances[bId]!.rested).toBe(true);
    });
  });

  describe('target resolver — opp_character costMax:1 rested:true', () => {
    it('EXCLUDES an active opp char (rested:true requires rested)', () => {
      const c = oppChar('TEST_ACTIVE', 1);
      const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [c] });
      const cId = fieldB[0]!.instanceId;
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: 'src', controller: 'A' }, clause.target);
      expect(ids).not.toContain(cId);
    });

    it('INCLUDES a rested cost-1 opp char', () => {
      const c = oppChar('TEST_REST_C1', 1);
      const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [c] });
      const cId = fieldB[0]!.instanceId;
      state.instances[cId]!.rested = true;
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: 'src', controller: 'A' }, clause.target);
      expect(ids).toContain(cId);
    });

    it('EXCLUDES a rested cost-2 opp char (costMax:1)', () => {
      const c = oppChar('TEST_REST_C2', 2);
      const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [c] });
      const cId = fieldB[0]!.instanceId;
      state.instances[cId]!.rested = true;
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: 'src', controller: 'A' }, clause.target);
      expect(ids).not.toContain(cId);
    });
  });

  describe('activate_main dispatch — restSelf → KO rested cost-1 opp char', () => {
    it('rests Bingoh + KOs the rested cost-1 opp char', () => {
      const c = oppChar('TEST_KO_C1', 1);
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [bingoh],
        charsB: [c],
      });
      const bId = fieldA[0]!.instanceId;
      const oppId = fieldB[0]!.instanceId;
      state.instances[oppId]!.rested = true;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: bId, controller: 'A' },
        'activate_main',
      );
      expect(next.instances[bId]!.rested).toBe(true);
      expect(next.players.B.field.some((i) => i.instanceId === oppId)).toBe(false);
      expect(next.players.B.trash).toContain(oppId);
    });
  });
});
