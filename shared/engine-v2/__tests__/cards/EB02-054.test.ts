/**
 * Per-card semantic test — EB02-054 Sanji (character).
 * "[Blocker] (After your opponent declares an attack, you may rest this
 *   card to make it the new target of the attack.)
 *  [On Play] If you have 2 or less Life cards, draw 2 cards and trash 1
 *   card from your hand."
 * Spec: 2 on_play clauses both gated if_own_life_max:2:
 *   1) draw 2
 *   2) discard_from_hand magnitude:1
 *   + continuous grant_keyword_to_self blocker.
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
  id: 'TEST_L_EB02054', name: 'L', kind: 'leader', colors: ['yellow'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function filler(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['yellow'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-054 — Sanji', () => {
  const c = loadCards().find((x) => x.id === 'EB02-054');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-054 invalid');
  const sanji = c as CharacterCard;
  const clauses = sanji.effectSpecV2!.clauses!;
  const cont = sanji.effectSpecV2!.continuous![0]!;

  function seedDeck(state: ReturnType<typeof buildState>['state'], n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const card = filler(`TEST_D${i}_E54`);
      state.cardLibrary[card.id] = card;
      const inst = makeInst(card.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.deck.push(inst.instanceId);
      ids.push(inst.instanceId);
    }
    return ids;
  }

  function seedLife(state: ReturnType<typeof buildState>['state'], n: number): void {
    for (let i = 0; i < n; i++) {
      const card = filler(`TEST_LIFE${i}_E54`);
      state.cardLibrary[card.id] = card;
      const inst = makeInst(card.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.life.push(inst.instanceId);
    }
  }

  it('shape: 2 on_play clauses gated if_own_life_max:2 [draw 2, discard_from_hand 1] + continuous blocker', () => {
    expect(clauses).toHaveLength(2);
    for (const cl of clauses) {
      expect(cl.trigger).toBe('on_play');
      expect((cl.condition as { type: string; n: number }).type).toBe('if_own_life_max');
      expect((cl.condition as { type: string; n: number }).n).toBe(2);
    }
    expect(clauses[0]!.action.kind).toBe('draw');
    expect((clauses[0]!.action as { magnitude: number }).magnitude).toBe(2);
    expect(clauses[1]!.action.kind).toBe('discard_from_hand');
    expect((clauses[1]!.action as { magnitude: number }).magnitude).toBe(1);
    expect((cont.action as { kind: string; keyword: string }).kind).toBe('grant_keyword_to_self');
    expect((cont.action as { kind: string; keyword: string }).keyword).toBe('blocker');
  });

  it('continuous: blocker granted', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sanji] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
  });

  it('life=2 + 1 hand card: draw 2 + discard 1 (hand net +1)', () => {
    const handCard = filler('TEST_HAND_E54');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sanji], handA: [handCard] });
    seedDeck(state, 3);
    seedLife(state, 2);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    // Draw 2 then discard 1 ⇒ net +1 in hand.
    expect(next.players.A.hand.length).toBe(handBefore + 1);
  });

  it('life=3 (>2): condition fail → no draw, no discard (hand unchanged)', () => {
    const handCard = filler('TEST_HAND_NB_E54');
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sanji], handA: [handCard] });
    seedDeck(state, 3);
    seedLife(state, 3);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore);
  });
});
