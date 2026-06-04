/**
 * Per-card semantic test — EB01-046 Brook (Straw Hat, character).
 *
 * Printed text (cards.json):
 *   "[On Play]/[When Attacking] Give up to 1 of your opponent's Characters
 *    −1 cost during this turn. Then, K.O. up to 1 of your opponent's
 *    Characters with a cost of 0."
 *
 * 5-axis: TWO clauses (on_play + when_attacking) each running the same
 *   sequence [removal_cost_reduce -1 this_turn opp_character, removal_ko
 *   opp_character costMax:0].
 *
 * The sub-actions carry their own `target` fields (rather than the parent
 * clause's target) — sequence + action.target is the V2 pattern for
 * per-sub-action targeting.
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
  id: 'TEST_LEADER_EB046',
  name: 'TEST',
  kind: 'leader',
  colors: ['black'],
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
    colors: ['black'],
    cost,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-046 — Brook (Straw Hat) (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-046');
  if (eb === undefined) throw new Error('EB01-046 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-046 should be a character');
  const brook = eb as CharacterCard;
  const clauses = brook.effectSpecV2?.clauses ?? [];
  expect(clauses).toHaveLength(2);

  it('clauses: on_play + when_attacking, each is a sequence [removal_cost_reduce, removal_ko]', () => {
    const triggers = clauses.map((c) => c.trigger);
    expect(triggers).toContain('on_play');
    expect(triggers).toContain('when_attacking');
    for (const c of clauses) {
      expect(c.action.kind).toBe('sequence');
      const seq = c.action as { actions: ReadonlyArray<{ kind: string }> };
      expect(seq.actions.map((a) => a.kind)).toEqual(['removal_cost_reduce', 'removal_ko']);
    }
  });

  it(
    'on_play sub-actions honor their own target fields (closes cluster-B engine gap; sequence handler now resolves sub-action target via dispatcher target-resolver registry)',
    () => {
      const oppCostReduce = oppChar('TEST_OPP_REDUCE_46', 1);
      const oppKO = oppChar('TEST_OPP_KO_46', 0);
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [brook],
        charsB: [oppCostReduce, oppKO],
      });
      const sId = fieldA[0]!.instanceId;
      const reduceId = fieldB[0]!.instanceId;
      const koId = fieldB[1]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: sId, controller: 'A' },
        'on_play',
      );
      // KO target should be gone.
      expect(next.players.B.field.some((i) => i.instanceId === koId)).toBe(false);
      // Cost-reduce target should have exactly -1 cost mod (sum of buckets).
      const r = next.instances[reduceId]!;
      const costMod = (r.costModifierThisTurn ?? 0)
        + (r.costModifierOneShot ?? 0)
        + (r.costModifierContinuous ?? 0);
      expect(costMod).toBe(-1);
    },
  );

  it(
    'when_attacking variant: sub-action targets resolved (closes cluster-B engine gap)',
    () => {
      const oppCostReduce = oppChar('TEST_OPP_REDUCE_46B', 1);
      const oppKO = oppChar('TEST_OPP_KO_46B', 0);
      const { state, fieldA, fieldB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [brook],
        charsB: [oppCostReduce, oppKO],
      });
      const sId = fieldA[0]!.instanceId;
      const koId = fieldB[1]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: sId, controller: 'A' },
        'when_attacking',
      );
      expect(next.players.B.field.some((i) => i.instanceId === koId)).toBe(false);
    },
  );
});
