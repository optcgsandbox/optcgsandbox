/**
 * Per-card semantic test — EB02-036 Nico Robin (character).
 * "[Blocker]
 *  [On K.O.] DON!! −1: Look at 3 cards from the top of your deck; reveal
 *   up to 1 {Straw Hat Crew} type card and add it to your hand. Then,
 *   place the rest at the bottom of your deck in any order."
 * Spec:
 *   • Continuous: grant_keyword_to_self 'blocker'.
 *   • Clause on_ko / cost donCostReturnToDeck:1 / searcher_peek lookCount:3
 *     addCount:1 filter{trait:'Straw Hat Crew'}.
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

import { buildState, makeInst } from './_fixtures.js';

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

const L: LeaderCard = {
  id: 'TEST_L_EB02036', name: 'L', kind: 'leader', colors: ['purple'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function shChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['purple'], cost: 1, power: 1000,
    counterValue: 1000, traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
  };
}

function nonSh(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['purple'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-036 — Nico Robin', () => {
  const c = loadCards().find((x) => x.id === 'EB02-036');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-036 invalid');
  const rob = c as CharacterCard;
  const clause = rob.effectSpecV2!.clauses![0]!;

  function seedDeck(state: ReturnType<typeof buildState>['state'], cards: CharacterCard[]): string[] {
    const ids: string[] = [];
    for (const card of cards) {
      state.cardLibrary[card.id] = card;
      const inst = makeInst(card.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.deck.push(inst.instanceId);
      ids.push(inst.instanceId);
    }
    return ids;
  }

  it('shape: on_ko / donCostReturnToDeck:1 / searcher_peek 3/1 SH trait', () => {
    expect(clause.trigger).toBe('on_ko');
    expect(clause.cost!['donCostReturnToDeck']).toBe(1);
    expect(clause.action.kind).toBe('searcher_peek');
    const a = clause.action as { lookCount: number; addCount: number; filter: { trait: string } };
    expect(a.lookCount).toBe(3);
    expect(a.addCount).toBe(1);
    expect(a.filter.trait).toBe('Straw Hat Crew');
  });

  it('continuous grants blocker', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [rob] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
  });

  it('on_ko + cost paid + SH in top 3: searcher adds + 1 DON moves to donDeck', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [rob] });
    const cand = shChar('TEST_SH_E36');
    const ids = seedDeck(state, [cand]);
    const donCostBefore = state.players.A.donCostArea.length;
    const donDeckBefore = state.players.A.donDeck.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_ko',
    );
    expect(next.players.A.hand).toContain(ids[0]!);
    expect(next.players.A.donCostArea.length).toBe(donCostBefore - 1);
    expect(next.players.A.donDeck.length).toBe(donDeckBefore + 1);
  });

  it('on_ko + cost paid + non-SH in top 3: filter exclude → NOT added', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [rob] });
    const cand = nonSh('TEST_NON_SH_E36');
    const ids = seedDeck(state, [cand]);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_ko',
    );
    expect(next.players.A.hand).not.toContain(ids[0]!);
  });

  it('on_ko + 0 DON cost area: cost unpayable → no fire', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [rob], donInCostA: 0 });
    const cand = shChar('TEST_SH_FAIL_E36');
    const ids = seedDeck(state, [cand]);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_ko',
    );
    expect(next.players.A.hand).not.toContain(ids[0]!);
  });
});
