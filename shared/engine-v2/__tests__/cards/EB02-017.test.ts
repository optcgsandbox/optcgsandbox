/**
 * Per-card semantic test — EB02-017 Nami (character).
 * "[On Play] Look at 5 cards from the top of your deck; reveal up to 1
 *  {Straw Hat Crew} type card other than [Nami] and add it to your hand.
 *  Then, place the rest at the bottom of your deck in any order."
 * Spec: on_play / searcher_peek lookCount:5 addCount:1 filter{trait:SH, nameExcludes:Nami}.
 *
 * Engine gap re-ref EB01-009/EB02-008: searcher_peek leftover goes to TOP
 * not BOTTOM. Leftover-bottom assertion uses it.fails.
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
  id: 'TEST_L_EB02017', name: 'L', kind: 'leader', colors: ['green'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function shChar(id: string, name: string): CharacterCard {
  return {
    id, name, kind: 'character', colors: ['green'], cost: 2, power: 3000,
    counterValue: 1000, traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
  };
}

function nonSh(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['green'], cost: 2, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-017 — Nami', () => {
  const c = loadCards().find((x) => x.id === 'EB02-017');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-017 invalid');
  const nami = c as CharacterCard;
  const clause = nami.effectSpecV2!.clauses![0]!;

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

  it('shape: on_play / searcher_peek lookCount:5 addCount:1 filter{trait:SH, nameExcludes:Nami}', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('searcher_peek');
    const a = clause.action as { lookCount: number; addCount: number; filter: { trait: string; nameExcludes: string } };
    expect(a.lookCount).toBe(5);
    expect(a.addCount).toBe(1);
    expect(a.filter.trait).toBe('Straw Hat Crew');
    expect(a.filter.nameExcludes).toBe('Nami');
  });

  it('adds an SH character (not Nami) from top 5 to hand', () => {
    const target = shChar('TEST_SH_TARGET_E17', 'Zoro');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [nami] });
    seedDeck(state, [target]);
    const tInstId = state.players.A.deck[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand).toContain(tInstId);
  });

  it('non-SH char on top: NOT added (trait filter exclude)', () => {
    const filler = nonSh('TEST_NON_SH_E17');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [nami] });
    seedDeck(state, [filler]);
    const fId = state.players.A.deck[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand).not.toContain(fId);
  });

  it('another SH Nami in deck: NOT added (nameExcludes)', () => {
    const anotherNami = shChar('TEST_NAMI2_E17', 'Nami');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [nami] });
    seedDeck(state, [anotherNami]);
    const nId = state.players.A.deck[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand).not.toContain(nId);
  });

  it(
    'leftover top-5 non-picked cards go to BOTTOM of deck (closes cluster-A engine gap; searcher_peek default leftoverPlacement="bottom")',
    () => {
      const cand = shChar('TEST_PICK_E17', 'Zoro');
      const fillers = [
        nonSh('TEST_LO1_E17'),
        nonSh('TEST_LO2_E17'),
        nonSh('TEST_LO3_E17'),
        nonSh('TEST_LO4_E17'),
      ];
      const tail = nonSh('TEST_TAIL_E17');
      const { state, fieldA } = buildState({ leaderA: L, charsA: [nami] });
      const ids = seedDeck(state, [cand, ...fillers, tail]);
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
      );
      const tailIdx = next.players.A.deck.indexOf(ids[5]!);
      const filler1Idx = next.players.A.deck.indexOf(ids[1]!);
      expect(filler1Idx).toBeGreaterThan(tailIdx);
    },
  );
});
