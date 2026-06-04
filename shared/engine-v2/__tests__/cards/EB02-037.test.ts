/**
 * Per-card semantic test — EB02-037 Franky (character).
 * "[On Play]/[When Attacking] If your Leader has the {Straw Hat Crew} type
 *  and the number of DON!! cards on your field is equal to or less than
 *  the number on your opponent's field, add up to 1 DON!! card from your
 *  DON!! deck and rest it."
 * Spec: 2 clauses (on_play, when_attacking) both: AND(SH, if_own_don_le_opp) /
 *   ramp magnitude:1 rested:true.
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

const SH_LEADER: LeaderCard = {
  id: 'TEST_SH_L_E37', name: 'L', kind: 'leader', colors: ['purple'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
};

const NON_SH_LEADER: LeaderCard = {
  id: 'TEST_NON_SH_L_E37', name: 'L', kind: 'leader', colors: ['purple'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: ['Other'], keywords: [], effectTags: [],
};

function addDonToDeck(state: ReturnType<typeof buildState>['state'], n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `A-DON-DECK-${i}-${Math.random().toString(36).slice(2, 8)}`;
    state.instances[id] = {
      instanceId: id, cardId: '__DON', controller: 'A', rested: false,
      summoningSick: false, attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    state.players.A.donDeck.push(id);
    ids.push(id);
  }
  return ids;
}

describe('EB02-037 — Franky', () => {
  const c = loadCards().find((x) => x.id === 'EB02-037');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-037 invalid');
  const fr = c as CharacterCard;
  const clauses = fr.effectSpecV2!.clauses!;

  it('shape: 2 clauses (on_play, when_attacking) AND(SH, if_own_don_le_opp) → ramp 1 rested', () => {
    expect(clauses).toHaveLength(2);
    expect(clauses.map((c) => c.trigger)).toEqual(['on_play', 'when_attacking']);
    for (const cl of clauses) {
      const cond = cl.condition as { type: string; conditions: ReadonlyArray<{ type: string; trait?: string }> };
      expect(cond.type).toBe('and');
      expect(cond.conditions.map((c) => c.type)).toEqual(['if_leader_has_trait', 'if_own_don_le_opp']);
      expect(cond.conditions[0]!.trait).toBe('Straw Hat Crew');
      expect(cl.action.kind).toBe('ramp');
      expect((cl.action as { magnitude: number; rested: boolean }).magnitude).toBe(1);
      expect((cl.action as { magnitude: number; rested: boolean }).rested).toBe(true);
    }
  });

  it('on_play: SH leader + own DON ≤ opp DON → 1 DON moves from donDeck to donRested', () => {
    const { state, fieldA } = buildState({
      leaderA: SH_LEADER, charsA: [fr], donInCostA: 5, donInCostB: 10,
    });
    addDonToDeck(state, 3);
    const deckBefore = state.players.A.donDeck.length;
    const restedBefore = state.players.A.donRested.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.donDeck.length).toBe(deckBefore - 1);
    expect(next.players.A.donRested.length).toBe(restedBefore + 1);
  });

  it('on_play: non-SH leader → no ramp (SH gate fails)', () => {
    const { state, fieldA } = buildState({
      leaderA: NON_SH_LEADER, charsA: [fr], donInCostA: 5, donInCostB: 10,
    });
    addDonToDeck(state, 3);
    const deckBefore = state.players.A.donDeck.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.donDeck.length).toBe(deckBefore);
  });

  it('on_play: SH leader + own DON > opp DON → no ramp (DON-LE gate fails)', () => {
    const { state, fieldA } = buildState({
      leaderA: SH_LEADER, charsA: [fr], donInCostA: 10, donInCostB: 5,
    });
    addDonToDeck(state, 3);
    const deckBefore = state.players.A.donDeck.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.donDeck.length).toBe(deckBefore);
  });

  it('when_attacking: SH leader + own DON ≤ opp → ramps too', () => {
    const { state, fieldA } = buildState({
      leaderA: SH_LEADER, charsA: [fr], donInCostA: 5, donInCostB: 10,
    });
    addDonToDeck(state, 3);
    const deckBefore = state.players.A.donDeck.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'when_attacking',
    );
    expect(next.players.A.donDeck.length).toBe(deckBefore - 1);
  });
});
