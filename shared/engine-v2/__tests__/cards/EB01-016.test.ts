/**
 * Per-card semantic test — EB01-016 Bingoh (character).
 *
 * Printed text (cards.json):
 *   "[Activate: Main] You may rest this Character: K.O. up to 1 of your
 *    opponent's rested Characters with a cost of 1 or less."
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
import { actionHandlers, targetResolvers } from '../../registry/types.js';
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
  const bingoh = allCards.find((c) => c.id === 'EB01-016');
  if (bingoh === undefined) throw new Error('EB01-016 not in cards.json');
  if (bingoh.kind !== 'character') throw new Error('EB01-016 should be a character');
  const bingohChar = bingoh as CharacterCard;
  const clause = bingohChar.effectSpecV2?.clauses?.[0];
  if (clause === undefined || clause.cost === undefined || clause.target === undefined) {
    throw new Error('EB01-016 missing clause / cost / target');
  }

  describe('cost — restSelf', () => {
    it('payable when Bingoh is active', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [bingohChar] });
      const bId = fieldA[0]!.instanceId;
      expect(
        CostPayer.canPay(state, { sourceInstanceId: bId, controller: 'A' }, clause.cost!),
      ).toBe(true);
    });

    it('unpayable when Bingoh is already rested', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [bingohChar] });
      const bId = fieldA[0]!.instanceId;
      state.instances[bId]!.rested = true;
      expect(
        CostPayer.canPay(state, { sourceInstanceId: bId, controller: 'A' }, clause.cost!),
      ).toBe(false);
    });

    it('paying cost rests Bingoh', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [bingohChar] });
      const bId = fieldA[0]!.instanceId;
      const next = CostPayer.pay(state, { sourceInstanceId: bId, controller: 'A' }, clause.cost!);
      expect(next).not.toBeNull();
      expect(next!.instances[bId]!.rested).toBe(true);
    });
  });

  describe('target resolver — opp rested characters cost ≤ 1', () => {
    it('EXCLUDES an active (unrested) opp char', () => {
      const active = oppChar('TEST_ACTIVE', 1);
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [bingohChar],
        charsB: [active],
      });
      const bId = fieldA[0]!.instanceId;
      const activeId = fieldB[0]!.instanceId;
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: bId, controller: 'A' }, clause.target);
      expect(ids).not.toContain(activeId);
    });

    it('INCLUDES a rested cost-1 opp char', () => {
      const cheap = oppChar('TEST_CHEAP', 1);
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [bingohChar],
        charsB: [cheap],
      });
      const bId = fieldA[0]!.instanceId;
      const cheapId = fieldB[0]!.instanceId;
      state.instances[cheapId]!.rested = true;
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: bId, controller: 'A' }, clause.target);
      expect(ids).toContain(cheapId);
    });

    it('EXCLUDES a rested cost-2 opp char (cost cap is 1)', () => {
      const big = oppChar('TEST_BIG', 2);
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [bingohChar],
        charsB: [big],
      });
      const bId = fieldA[0]!.instanceId;
      const bigId = fieldB[0]!.instanceId;
      state.instances[bigId]!.rested = true;
      const resolver = targetResolvers.get(clause.target.kind);
      const ids = resolver(state, { sourceInstanceId: bId, controller: 'A' }, clause.target);
      expect(ids).not.toContain(bigId);
    });
  });

  describe('removal_ko action', () => {
    it('KOs the targeted rested opp char', () => {
      const cheap = oppChar('TEST_KOCHEAP', 1);
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [bingohChar],
        charsB: [cheap],
      });
      const bId = fieldA[0]!.instanceId;
      const cheapId = fieldB[0]!.instanceId;
      state.instances[cheapId]!.rested = true;
      const handler = actionHandlers.get(clause.action.kind);
      const next = handler(
        state,
        { sourceInstanceId: bId, controller: 'A' },
        clause.action,
        [cheapId],
      );
      expect(next.players.B.field.some((i) => i.instanceId === cheapId)).toBe(false);
      expect(next.players.B.trash).toContain(cheapId);
    });
  });
});
