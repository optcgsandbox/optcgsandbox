/**
 * Per-card semantic test — EB02-052 Enel (character).
 * "If your Leader has the {Sky Island} type, this Character gains [Rush].
 *  [When Attacking] You may trash 1 card from your hand: If you have 1 or
 *  less Life cards, add up to 1 card from the top of your deck to the top
 *  of your Life cards. Then, this Character gains +1000 power during this
 *  turn."
 * Spec: 2 when_attacking clauses each with cost discardHand:1:
 *   1) if_own_life_max:1 / add_to_own_life_top from:top_of_deck faceUp:false
 *   2) power_buff +1000 this_turn / self
 *   + continuous if_leader_has_trait Sky Island / grant rush.
 *
 * Engine gap (BUGS_FOUND.md "Compound-cost clauses"): printed text shares
 *   1 discard across both effects; current split-clause encoding pays the
 *   cost twice. Spec is the best the engine supports today; test asserts
 *   per-clause behavior independently.
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

const SKY_LEADER: LeaderCard = {
  id: 'TEST_SKY_L_E52', name: 'L', kind: 'leader', colors: ['yellow'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: ['Sky Island'], keywords: [], effectTags: [],
};

const NON_SKY_LEADER: LeaderCard = {
  id: 'TEST_NON_SKY_L_E52', name: 'L', kind: 'leader', colors: ['yellow'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function handChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['yellow'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-052 — Enel', () => {
  const c = loadCards().find((x) => x.id === 'EB02-052');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-052 invalid');
  const enel = c as CharacterCard;
  const clauses = enel.effectSpecV2!.clauses!;
  const cont = enel.effectSpecV2!.continuous![0]!;

  it('shape: SP-1 single when_attacking clause [cost discardHand:1 / sequence(life-add cond:if_own_life_max:1, power_buff +1000 self)] + continuous Sky Island grants rush', () => {
    expect(clauses).toHaveLength(1);
    expect(clauses[0]!.trigger).toBe('when_attacking');
    expect(clauses[0]!.cost!['discardHand']).toBe(1);
    expect(clauses[0]!.action.kind).toBe('sequence');
    const subs = (clauses[0]!.action as { actions: Array<{ kind: string; condition?: { type: string; n: number }; magnitude?: number; duration?: string; from?: string }> }).actions;
    expect(subs).toHaveLength(2);
    expect(subs[0]!.kind).toBe('add_to_own_life_top');
    expect(subs[0]!.condition!.type).toBe('if_own_life_max');
    expect(subs[0]!.condition!.n).toBe(1);
    expect(subs[0]!.from).toBe('top_of_deck');
    expect(subs[1]!.kind).toBe('power_buff');
    expect(subs[1]!.magnitude).toBe(1000);
    expect(subs[1]!.duration).toBe('this_turn');
    expect(clauses[0]!.target!.kind).toBe('self');
    expect((cont.condition as { type: string; trait: string }).type).toBe('if_leader_has_trait');
    expect((cont.condition as { type: string; trait: string }).trait).toBe('Sky Island');
    expect((cont.action as { kind: string; keyword: string }).kind).toBe('grant_keyword_to_self');
    expect((cont.action as { kind: string; keyword: string }).keyword).toBe('rush');
  });

  it('continuous: Sky Island leader → Enel gains rush', () => {
    const { state, fieldA } = buildState({ leaderA: SKY_LEADER, charsA: [enel] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('rush');
  });

  it('continuous: non-Sky Island leader → Enel does NOT gain rush', () => {
    const { state, fieldA } = buildState({ leaderA: NON_SKY_LEADER, charsA: [enel] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).not.toContain('rush');
  });

  it('when_attacking with 2+ hand: power_buff fires (+1000 on self) and at least 1 discard happens (cost paid)', () => {
    const h1 = handChar('TEST_H1_E52');
    const h2 = handChar('TEST_H2_E52');
    const { state, fieldA, handAInstances } = buildState({
      leaderA: SKY_LEADER, charsA: [enel], handA: [h1, h2],
    });
    const enelId = fieldA[0]!.instanceId;
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: enelId, controller: 'A' }, 'when_attacking',
    );
    expect(next.instances[enelId]!.powerModifierOneShot ?? 0).toBeGreaterThanOrEqual(1000);
    // Cost paid → hand decreased.
    expect(next.players.A.hand.length).toBeLessThan(handBefore);
    void handAInstances;
  });

  it('when_attacking with life=2 (>1): life-add condition fails → life unchanged regardless of dispatch', () => {
    const h1 = handChar('TEST_H1B_E52');
    const h2 = handChar('TEST_H2B_E52');
    const { state, fieldA } = buildState({
      leaderA: SKY_LEADER, charsA: [enel], handA: [h1, h2],
    });
    // Seed 2 life cards (> 1).
    for (let i = 0; i < 2; i++) {
      const lf = handChar(`TEST_LIFE_${i}_E52`);
      state.cardLibrary[lf.id] = lf;
      const lifeInst = makeInst(lf.id, 'A');
      state.instances[lifeInst.instanceId] = lifeInst;
      state.players.A.life.push(lifeInst.instanceId);
    }
    // Seed a deck top card.
    const deckTop = handChar('TEST_DECK_TOP_E52');
    state.cardLibrary[deckTop.id] = deckTop;
    const deckInst = makeInst(deckTop.id, 'A');
    state.instances[deckInst.instanceId] = deckInst;
    state.players.A.deck.push(deckInst.instanceId);
    const lifeBefore = state.players.A.life.length;
    expect(lifeBefore).toBe(2);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'when_attacking',
    );
    expect(next.players.A.life.length).toBe(lifeBefore);
  });

  it('when_attacking with life=1 + 2 hand cards: life-add condition passes → life grows by 1 (deck top moved)', () => {
    const h1 = handChar('TEST_H1C_E52');
    const h2 = handChar('TEST_H2C_E52');
    const { state, fieldA } = buildState({
      leaderA: SKY_LEADER, charsA: [enel], handA: [h1, h2],
    });
    // Seed 1 life card.
    const lf = handChar('TEST_LIFE_ONLY_E52');
    state.cardLibrary[lf.id] = lf;
    const lifeInst = makeInst(lf.id, 'A');
    state.instances[lifeInst.instanceId] = lifeInst;
    state.players.A.life.push(lifeInst.instanceId);
    // Seed a deck top card.
    const deckTop = handChar('TEST_DECK_TOP_LOW_E52');
    state.cardLibrary[deckTop.id] = deckTop;
    const deckInst = makeInst(deckTop.id, 'A');
    state.instances[deckInst.instanceId] = deckInst;
    state.players.A.deck.push(deckInst.instanceId);
    const lifeBefore = state.players.A.life.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'when_attacking',
    );
    expect(next.players.A.life.length).toBe(lifeBefore + 1);
    expect(next.players.A.life).toContain(deckInst.instanceId);
  });
});
