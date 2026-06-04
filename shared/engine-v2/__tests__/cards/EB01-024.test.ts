/**
 * Per-card semantic test — EB01-024 Hamlet (character).
 *
 * Printed text (cards.json):
 *   "If you have 4 or less cards in your hand, all of your {SMILE} type
 *    Characters gain +1000 power."
 *
 * 5-axis: one continuous effect — condition if_hand_max n:4, action
 *   aura_power_buff filter{trait:'SMILE', kind:'character'} magnitude:1000.
 *
 * No clauses, no replacements. All primitives registered. No spec gap.
 * Note: Hamlet himself carries the SMILE trait so self-buffs when
 * condition holds (printed scope = "all of your SMILE characters").
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
  id: 'TEST_LEADER_EB024',
  name: 'TEST',
  kind: 'leader',
  colors: ['blue'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

function smileChar(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['blue'],
    cost: 2,
    power: 3000,
    counterValue: 1000,
    traits: ['SMILE'],
    keywords: [],
    effectTags: [],
  };
}

function nonSmileChar(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['blue'],
    cost: 2,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

function dummyHandCard(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['blue'],
    cost: 1,
    power: 1000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-024 — Hamlet (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-024');
  if (eb === undefined) throw new Error('EB01-024 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-024 should be a character');
  const hamlet = eb as CharacterCard;
  const cont = hamlet.effectSpecV2?.continuous?.[0];
  if (cont === undefined) throw new Error('EB01-024 missing continuous');

  it('continuous shape: if_hand_max 4 → aura_power_buff filter{trait:SMILE, kind:character} +1000', () => {
    expect(cont.condition!.type).toBe('if_hand_max');
    expect((cont.condition as { n: number }).n).toBe(4);
    expect(cont.action.kind).toBe('aura_power_buff');
    const action = cont.action as { magnitude: number; filter: { trait: string; kind: string } };
    expect(action.magnitude).toBe(1000);
    expect(action.filter.trait).toBe('SMILE');
    expect(action.filter.kind).toBe('character');
  });

  it('hand size 0 → SMILE char gets +1000', () => {
    const ally = smileChar('TEST_SMILE_ALLY');
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [hamlet, ally],
    });
    expect(state.players.A.hand.length).toBe(0);
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[1]!.instanceId]!.powerModifierContinuous ?? 0).toBe(1000);
  });

  it('Hamlet self-buffs (SMILE trait → in own filter scope) when condition holds', () => {
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [hamlet] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.powerModifierContinuous ?? 0).toBe(1000);
  });

  it('hand size 4 — boundary inclusive — SMILE char gets +1000', () => {
    const ally = smileChar('TEST_SMILE_ALLY_2');
    const h1 = dummyHandCard('TEST_HND_1');
    const h2 = dummyHandCard('TEST_HND_2');
    const h3 = dummyHandCard('TEST_HND_3');
    const h4 = dummyHandCard('TEST_HND_4');
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [hamlet, ally],
      handA: [h1, h2, h3, h4],
    });
    expect(state.players.A.hand.length).toBe(4);
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[1]!.instanceId]!.powerModifierContinuous ?? 0).toBe(1000);
  });

  it('hand size 5 → no buff (condition false)', () => {
    const ally = smileChar('TEST_SMILE_ALLY_3');
    const hs = [1, 2, 3, 4, 5].map((i) => dummyHandCard(`TEST_HNDX_${i}`));
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [hamlet, ally],
      handA: hs,
    });
    expect(state.players.A.hand.length).toBe(5);
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[1]!.instanceId]!.powerModifierContinuous ?? 0).toBe(0);
  });

  it('non-SMILE ally is NOT buffed', () => {
    const ally = nonSmileChar('TEST_NON_SMILE');
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [hamlet, ally],
    });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[1]!.instanceId]!.powerModifierContinuous ?? 0).toBe(0);
  });
});
