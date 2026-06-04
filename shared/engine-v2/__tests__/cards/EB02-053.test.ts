/**
 * Per-card semantic test — EB02-053 Myskina Olga (character).
 * "[On Play]/[On K.O.] Look at up to 1 card from the top of your or your
 *  opponent's Life cards and place it at the top or bottom of the Life
 *  cards."
 * Spec: 2 clauses (on_play + on_ko) each:
 *   choose_one[
 *     {peek_and_reorder_own_life count:1},
 *     {peek_and_reorder_opp_life count:1}
 *   ].
 *
 * SPEC FIX applied (BUGS_FOUND.md EB02-053): was opp-only
 *   `peek_and_reorder_opp_life`; printed text gives choice of own or opp
 *   side. Fix: choose_one with the 2 peek actions.
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
import { applyAction } from '../../reducers/applyAction.js';
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
  id: 'TEST_L_EB02053', name: 'L', kind: 'leader', colors: ['yellow'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function lifeChar(id: string, controller: 'A' | 'B'): string {
  const card: CharacterCard = {
    id, name: id, kind: 'character', colors: ['yellow'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  return card.id;
}

describe('EB02-053 — Myskina Olga', () => {
  const c = loadCards().find((x) => x.id === 'EB02-053');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-053 invalid');
  const olga = c as CharacterCard;
  const clauses = olga.effectSpecV2!.clauses!;

  function seedLife(state: ReturnType<typeof buildState>['state'], player: 'A' | 'B', n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const card: CharacterCard = {
        id: `TEST_LIFE_${player}_${i}_E53`, name: `L${i}`, kind: 'character', colors: ['yellow'],
        cost: 1, power: 1000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
      };
      state.cardLibrary[card.id] = card;
      const inst = makeInst(card.id, player);
      state.instances[inst.instanceId] = inst;
      state.players[player].life.push(inst.instanceId);
      ids.push(inst.instanceId);
    }
    return ids;
  }

  it('shape: 2 clauses (on_play + on_ko) each choose_one[own_life peek 1, opp_life peek 1]', () => {
    expect(clauses).toHaveLength(2);
    expect(clauses[0]!.trigger).toBe('on_play');
    expect(clauses[1]!.trigger).toBe('on_ko');
    for (const cl of clauses) {
      expect(cl.action.kind).toBe('choose_one');
      const opts = (cl.action as { options: ReadonlyArray<{ action: { kind: string; count?: number } }> }).options;
      expect(opts).toHaveLength(2);
      expect(opts[0]!.action.kind).toBe('peek_and_reorder_own_life');
      expect(opts[0]!.action.count).toBe(1);
      expect(opts[1]!.action.kind).toBe('peek_and_reorder_opp_life');
      expect(opts[1]!.action.count).toBe(1);
    }
  });

  it('on_play → choose_one pending enters', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [olga] });
    seedLife(state, 'A', 3);
    seedLife(state, 'B', 3);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.pending?.kind).toBe('choose_one');
    void lifeChar;
  });

  it('on_play option 0 (own life): top of A.life exposed to A.knownByViewer', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [olga] });
    const aLifeIds = seedLife(state, 'A', 3);
    seedLife(state, 'B', 3);
    const dispatched = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    const result = applyAction(dispatched, 'A', { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 } as never);
    expect(result.state.knownByViewer.A).toContain(aLifeIds[0]!);
  });

  it('on_play option 1 (opp life): top of B.life exposed to A.knownByViewer', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [olga] });
    seedLife(state, 'A', 3);
    const bLifeIds = seedLife(state, 'B', 3);
    const dispatched = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    const result = applyAction(dispatched, 'A', { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 1 } as never);
    expect(result.state.knownByViewer.A).toContain(bLifeIds[0]!);
  });

  it('on_ko → choose_one pending enters', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [olga] });
    seedLife(state, 'A', 3);
    seedLife(state, 'B', 3);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_ko',
    );
    expect(next.pending?.kind).toBe('choose_one');
  });
});
