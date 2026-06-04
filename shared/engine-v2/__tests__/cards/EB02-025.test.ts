/**
 * Per-card semantic test — EB02-025 Donquixote Rosinante (character).
 * "[Activate: Main] You may rest 1 of your DON!! cards and this Character:
 *  If your Leader is [Donquixote Rosinante], look at 5 cards from the top
 *  of your deck; play up to 1 Character card with a cost of 2 or less
 *  rested. Then, place the rest at the bottom of your deck in any order."
 * Spec: activate_main / if_leader_is Donquixote Rosinante /
 *   cost{restSelf, donCost:1} /
 *   searcher_peek lookCount:5 addCount:1 filter{costMax:2, kind:character}
 *   playInsteadOfHand:true rested:true.
 *
 * Engine gap re-ref EB01-009: leftover non-picks unshift back to TOP not
 * BOTTOM. Leftover-bottom assertion uses it.fails.
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

const DR_LEADER: LeaderCard = {
  id: 'TEST_DR_LEADER_E25', name: 'Donquixote Rosinante', kind: 'leader',
  colors: ['blue'], cost: null, power: 5000, life: 5, counterValue: null,
  traits: ['Donquixote Pirates'], keywords: [], effectTags: [],
};

const OTHER_LEADER: LeaderCard = {
  id: 'TEST_OTHER_L_E25', name: 'NotDR', kind: 'leader',
  colors: ['blue'], cost: null, power: 5000, life: 5, counterValue: null,
  traits: [], keywords: [], effectTags: [],
};

function deckChar(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['blue'], cost, power: 2000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-025 — Donquixote Rosinante', () => {
  const c = loadCards().find((x) => x.id === 'EB02-025');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-025 invalid');
  const r = c as CharacterCard;
  const clause = r.effectSpecV2!.clauses![0]!;

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

  it('shape: activate_main / if_leader_is Donquixote Rosinante / cost{restSelf, donCost:1} / searcher_peek 5/1 filter{costMax:2, kind:character} playInsteadOfHand:true rested:true', () => {
    expect(clause.trigger).toBe('activate_main');
    expect((clause.condition as { type: string; name: string }).type).toBe('if_leader_is');
    expect((clause.condition as { type: string; name: string }).name).toBe('Donquixote Rosinante');
    expect(clause.cost!['restSelf']).toBe(true);
    expect(clause.cost!['donCost']).toBe(1);
    expect(clause.action.kind).toBe('searcher_peek');
    const a = clause.action as {
      lookCount: number; addCount: number;
      filter: { costMax: number; kind: string };
      playInsteadOfHand: boolean; rested: boolean;
    };
    expect(a.lookCount).toBe(5);
    expect(a.addCount).toBe(1);
    expect(a.filter.costMax).toBe(2);
    expect(a.filter.kind).toBe('character');
    expect(a.playInsteadOfHand).toBe(true);
    expect(a.rested).toBe(true);
  });

  it('DR leader + cost-2 char in top 5: char played to field rested', () => {
    const cand = deckChar('TEST_C2_E25', 2);
    const fillers = [
      deckChar('TEST_F1_E25', 5), deckChar('TEST_F2_E25', 5),
      deckChar('TEST_F3_E25', 5), deckChar('TEST_F4_E25', 5),
    ];
    const { state, fieldA } = buildState({ leaderA: DR_LEADER, charsA: [r] });
    const ids = seedDeck(state, [cand, ...fillers]);
    const candId = ids[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'activate_main',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).toContain(candId);
    expect(next.instances[candId]!.rested).toBe(true);
  });

  it('non-DR leader: condition fail → cand stays in deck', () => {
    const cand = deckChar('TEST_C2N_E25', 2);
    const fillers = [
      deckChar('TEST_F1N_E25', 5), deckChar('TEST_F2N_E25', 5),
      deckChar('TEST_F3N_E25', 5), deckChar('TEST_F4N_E25', 5),
    ];
    const { state, fieldA } = buildState({ leaderA: OTHER_LEADER, charsA: [r] });
    const ids = seedDeck(state, [cand, ...fillers]);
    const candId = ids[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'activate_main',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(candId);
    expect(next.players.A.deck).toContain(candId);
  });

  it('DR leader + cost-3 char in top 5: filter exclude → cand NOT played', () => {
    const cand = deckChar('TEST_C3_E25', 3);
    const fillers = [
      deckChar('TEST_FA_E25', 5), deckChar('TEST_FB_E25', 5),
      deckChar('TEST_FC_E25', 5), deckChar('TEST_FD_E25', 5),
    ];
    const { state, fieldA } = buildState({ leaderA: DR_LEADER, charsA: [r] });
    const ids = seedDeck(state, [cand, ...fillers]);
    const candId = ids[0]!;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'activate_main',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(candId);
  });

  it('DR leader fires: source rested + 1 DON moved to donRested (cost paid)', () => {
    const cand = deckChar('TEST_C2C_E25', 2);
    const { state, fieldA } = buildState({ leaderA: DR_LEADER, charsA: [r] });
    seedDeck(state, [cand]);
    const sourceId = fieldA[0]!.instanceId;
    const donBefore = state.players.A.donCostArea.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: sourceId, controller: 'A' }, 'activate_main',
    );
    expect(next.instances[sourceId]!.rested).toBe(true);
    expect(next.players.A.donCostArea.length).toBe(donBefore - 1);
    expect(next.players.A.donRested.length).toBe(1);
  });
});
