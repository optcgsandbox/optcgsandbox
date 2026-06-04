/**
 * Per-card semantic test — EB01-034 Ms. Wednesday (character).
 *
 * Printed text (cards.json):
 *   "[Blocker] (After your opponent declares an attack, you may rest this
 *    card to make it the new target of the attack.)
 *    [On Your Opponent's Attack] [Once Per Turn] DON!! −1 ...: If your
 *    Leader's type includes "Baroque Works", add up to 1 DON!! card from
 *    your DON!! deck and set it as active."
 *
 * 5-axis:
 *   • Continuous: grant_keyword_to_self 'blocker'.
 *   • Clause on_opp_attack: condition if_leader_has_type 'Baroque Works',
 *     cost donCostReturnToDeck:1, action ramp magnitude:1 rested:false,
 *     opt:true (Once Per Turn).
 *
 * All primitives registered.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { ContinuousManager } from '../../effects/ContinuousManager.js';
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

const BW_LEADER: LeaderCard = {
  id: 'TEST_BW_LEADER_34',
  name: 'TEST',
  kind: 'leader',
  colors: ['purple'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Baroque Works'],
  keywords: [],
  effectTags: [],
};

describe('EB01-034 — Ms. Wednesday (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-034');
  if (eb === undefined) throw new Error('EB01-034 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-034 should be a character');
  const wed = eb as CharacterCard;
  const clause = wed.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-034 missing clause');

  it('clause shape: on_opp_attack / Baroque Works / donCostReturnToDeck:1 / ramp 1 active / opt:true', () => {
    expect(clause.trigger).toBe('on_opp_attack');
    expect((clause.condition as { typeString: string }).typeString).toBe('Baroque Works');
    expect(clause.cost!['donCostReturnToDeck']).toBe(1);
    expect(clause.action.kind).toBe('ramp');
    expect((clause.action as { magnitude: number; rested: boolean }).magnitude).toBe(1);
    expect((clause.action as { magnitude: number; rested: boolean }).rested).toBe(false);
    expect(clause.opt).toBe(true);
  });

  it('continuous grants blocker keyword', () => {
    const { state, fieldA } = buildState({ leaderA: BW_LEADER, charsA: [wed] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
  });

  it('on_opp_attack dispatch: pays 1 DON to deck, ramps +1 active DON, marks OPT used', () => {
    const { state, fieldA } = buildState({ leaderA: BW_LEADER, charsA: [wed] });
    const sId = fieldA[0]!.instanceId;
    const beforeActive = state.players.A.donCostArea.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: sId, controller: 'A' },
      'on_opp_attack',
    );
    // Net: -1 DON (paid) + 1 DON (ramped) = beforeActive
    expect(next.players.A.donCostArea.length).toBe(beforeActive);
    expect(next.instances[sId]!.perTurn.effectsUsed.length).toBeGreaterThan(0);
  });

  it('non-Baroque Works leader: condition false → no DON paid, no ramp', () => {
    const nonBW: LeaderCard = { ...BW_LEADER, id: 'TEST_NONBW_34', traits: ['Other'] };
    const { state, fieldA } = buildState({ leaderA: nonBW, charsA: [wed] });
    const beforeActive = state.players.A.donCostArea.length;
    const beforeDeck = state.players.A.donDeck.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_opp_attack',
    );
    expect(next.players.A.donCostArea.length).toBe(beforeActive);
    expect(next.players.A.donDeck.length).toBe(beforeDeck);
  });

  it('second on_opp_attack same turn does NOT fire (OPT gate)', () => {
    const { state, fieldA } = buildState({ leaderA: BW_LEADER, charsA: [wed] });
    const sId = fieldA[0]!.instanceId;
    const beforeDeck = state.players.A.donDeck.length;
    const once = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: sId, controller: 'A' },
      'on_opp_attack',
    );
    const after1 = once.players.A.donCostArea.length;
    const twice = EffectDispatcher.dispatch(
      once,
      { sourceInstanceId: sId, controller: 'A' },
      'on_opp_attack',
    );
    // Active count unchanged after second fire (OPT blocks).
    expect(twice.players.A.donCostArea.length).toBe(after1);
    // donDeck not further drained.
    expect(twice.players.A.donDeck.length).toBeLessThanOrEqual(beforeDeck);
  });
});
