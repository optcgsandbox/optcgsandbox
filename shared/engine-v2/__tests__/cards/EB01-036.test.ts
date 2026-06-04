/**
 * Per-card semantic test — EB01-036 Minochihuahua (character).
 *
 * Printed text (cards.json):
 *   "[Rush] (This card can attack on the turn in which it is played.)
 *    [On K.O.] If your Leader has the {Impel Down} type, add up to 1 DON!!
 *    card from your DON!! deck and rest it."
 *
 * 5-axis:
 *   • Continuous: grant_keyword_to_self 'rush'.
 *   • Clause on_ko: condition if_leader_has_trait Impel Down, action ramp
 *     magnitude:1 rested:true.
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

const ID_LEADER: LeaderCard = {
  id: 'TEST_ID_LEADER_36',
  name: 'TEST',
  kind: 'leader',
  colors: ['purple'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Impel Down'],
  keywords: [],
  effectTags: [],
};

const NON_ID_LEADER: LeaderCard = {
  id: 'TEST_NONID_LEADER_36',
  name: 'TEST',
  kind: 'leader',
  colors: ['purple'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Other'],
  keywords: [],
  effectTags: [],
};

describe('EB01-036 — Minochihuahua (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-036');
  if (eb === undefined) throw new Error('EB01-036 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-036 should be a character');
  const mch = eb as CharacterCard;
  const clause = mch.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-036 missing clause');

  it('clause shape: on_ko / Impel Down / ramp 1 rested', () => {
    expect(clause.trigger).toBe('on_ko');
    expect((clause.condition as { trait: string }).trait).toBe('Impel Down');
    expect(clause.action.kind).toBe('ramp');
    expect((clause.action as { magnitude: number; rested: boolean }).magnitude).toBe(1);
    expect((clause.action as { magnitude: number; rested: boolean }).rested).toBe(true);
  });

  it('continuous grants rush keyword', () => {
    const { state, fieldA } = buildState({ leaderA: ID_LEADER, charsA: [mch] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('rush');
  });

  it('on_ko with Impel Down leader: +1 rested DON', () => {
    const { state, fieldA } = buildState({ leaderA: ID_LEADER, charsA: [mch] });
    // Pre-seed donDeck so ramp has something to pull from.
    const donInstId = 'A-RAMP-DON-1';
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
    const beforeRested = state.players.A.donRested.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_ko',
    );
    expect(next.players.A.donRested.length).toBe(beforeRested + 1);
  });

  it('on_ko WITHOUT Impel Down leader: no ramp', () => {
    const { state, fieldA } = buildState({ leaderA: NON_ID_LEADER, charsA: [mch] });
    const beforeRested = state.players.A.donRested.length;
    const beforeActive = state.players.A.donCostArea.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_ko',
    );
    expect(next.players.A.donRested.length).toBe(beforeRested);
    expect(next.players.A.donCostArea.length).toBe(beforeActive);
  });
});
