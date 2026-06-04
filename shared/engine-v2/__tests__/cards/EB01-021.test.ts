/**
 * Per-card semantic test — EB01-021 Hannyabal (leader).
 *
 * Printed text (cards.json):
 *   "[End of Your Turn] You may return 1 of your {Impel Down} type
 *    Characters with a cost of 2 or more to the owner's hand: Add up to 1
 *    DON!! card from your DON!! deck and set it as active."
 *
 * Spec encodes:
 *   trigger:'at_end_of_turn_self'
 *   cost: { returnOwnCharFilter: { filter:{ trait:'Impel Down', costMin:2 } } }
 *   action: { kind:'ramp', magnitude:1, rested:false }
 *
 * SPEC FIX applied this audit pass (Rule 2): old spec used `returnSelfChar`
 * which bounces the SOURCE instance — but Hannyabal IS the leader source,
 * so that primitive can NEVER pay for him. Printed text says "return 1 of
 * your CHARACTERS" — meaning one of your own non-self characters by filter.
 * The correct primitive is `returnOwnCharFilter` (sister to the registered
 * `restOwnCharFilter` at costs2.ts:445).
 *
 * Engine gap (logged in BUGS_FOUND.md EB01-021): `returnOwnCharFilter` is
 * NOT yet registered in `costHandlers`. The spec is now faithful to printed
 * text, but `CostPayer.canPay` will throw `RegistryValidationError` when it
 * encounters this cost key. Behavioral tests assert (a) the spec now has
 * the right shape, (b) the engine is missing the handler, and (c) calling
 * canPay throws.
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
import { costHandlers } from '../../registry/types.js';
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

function impelDownChar(id: string, cost: number): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['blue'],
    cost,
    power: 4000,
    counterValue: 1000,
    traits: ['Impel Down'],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-021 — Hannyabal (leader)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-021');
  if (eb === undefined) throw new Error('EB01-021 not in cards.json');
  if (eb.kind !== 'leader') throw new Error('EB01-021 should be a leader');
  const hannyabal = eb as LeaderCard;
  const clause = hannyabal.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-021 missing clause');

  it('clause shape: trigger at_end_of_turn_self, ramp 1 active', () => {
    expect(clause.trigger).toBe('at_end_of_turn_self');
    expect(clause.action.kind).toBe('ramp');
    expect((clause.action as { magnitude: number }).magnitude).toBe(1);
    expect((clause.action as { rested: boolean }).rested).toBe(false);
  });

  it('cost encodes returnOwnCharFilter with filter {trait:Impel Down, costMin:2} (SPEC FIX from returnSelfChar)', () => {
    expect(clause.cost).toBeDefined();
    expect(clause.cost!['returnOwnCharFilter']).toBeDefined();
    expect(clause.cost!['returnSelfChar']).toBeUndefined();
    const filter = (clause.cost!['returnOwnCharFilter'] as { filter: { trait: string; costMin: number } }).filter;
    expect(filter.trait).toBe('Impel Down');
    expect(filter.costMin).toBe(2);
  });

  it('returnOwnCharFilter handler is registered (sister to restOwnCharFilter)', () => {
    expect(costHandlers.has('returnOwnCharFilter')).toBe(true);
    expect(costHandlers.has('restOwnCharFilter')).toBe(true);
  });

  it('cost canPay returns true when an Impel Down cost-2 char is on field', () => {
    const id2char = impelDownChar('TEST_ID_C2', 2);
    const { state, leaderInstA } = buildState({ leaderA: hannyabal, charsA: [id2char] });
    expect(
      CostPayer.canPay(
        state,
        { sourceInstanceId: leaderInstA.instanceId, controller: 'A' },
        clause.cost!,
      ),
    ).toBe(true);
  });

  it(
    'end-of-turn dispatch ramps +1 active DON when paying with a valid char (closes cluster-G xfail; corrected fixture seeds donDeck per canonical DON-ramp template used by EB01-036 / EB01-061)',
    () => {
      const id2char = impelDownChar('TEST_ID_C2B', 2);
      const { state, leaderInstA } = buildState({ leaderA: hannyabal, charsA: [id2char] });
      // Pre-seed donDeck so ramp has something to pull from.
      // (Canonical template — same shape as EB01-036.test.ts / EB01-061.test.ts.)
      const donInstId = 'A-RAMP-DON-21';
      state.instances[donInstId] = {
        instanceId: donInstId,
        cardId: '__DON',
        controller: 'A',
        rested: false,
        summoningSick: false,
        attachedDon: [],
        attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      state.players.A.donDeck.push(donInstId);
      const beforeDon = state.players.A.donCostArea.length;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: leaderInstA.instanceId, controller: 'A' },
        'at_end_of_turn_self',
      );
      expect(next.players.A.donCostArea.length).toBe(beforeDon + 1);
    },
  );

  it('without ANY Impel Down character on field, dispatch is a no-op (canPay returns false → dispatcher skips the clause silently)', () => {
    // With no chars on field, canPay returns false and the dispatcher
    // skips the clause without throwing. No DON ramp occurs.
    const { state, leaderInstA } = buildState({ leaderA: hannyabal });
    const beforeDon = state.players.A.donCostArea.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: leaderInstA.instanceId, controller: 'A' },
      'at_end_of_turn_self',
    );
    expect(next.players.A.donCostArea.length).toBe(beforeDon);
  });
});
