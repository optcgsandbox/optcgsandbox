/**
 * Per-card semantic test — EB01-030 Loguetown (stage).
 *
 * Printed text (cards.json):
 *   "[Activate: Main] You may place this card and 1 card from your hand at
 *    the bottom of your deck in any order: Draw 2 cards."
 *
 * 5-axis: clause activate_main, cost {bottomOfDeckSelf:true,
 *   bottomOfDeckFromHand:1}, action draw magnitude:2.
 *
 * Implicit once_per_turn via keywords (cards.json keywords includes
 * 'once_per_turn'), but the spec doesn't carry an `opt:true` field — OPT
 * gating for stage-activate is handled outside the clause OPT path. Cost
 * already enforces single-fire-per-turn since stage moves to deck.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard, StageCard } from '../../cards/Card.js';
import { CostPayer } from '../../effects/CostPayer.js';
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

const VANILLA_LEADER: LeaderCard = {
  id: 'TEST_LEADER_EB030',
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

function fillerCharacter(id: string): CharacterCard {
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

describe('EB01-030 — Loguetown (stage)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-030');
  if (eb === undefined) throw new Error('EB01-030 not in cards.json');
  if (eb.kind !== 'stage') throw new Error('EB01-030 should be a stage');
  const loguetown = eb as StageCard;
  const clause = loguetown.effectSpecV2?.clauses?.[0];
  if (clause === undefined || clause.cost === undefined) throw new Error('EB01-030 missing clause/cost');

  /** Place Loguetown in A's stage. Returns the stage instance ID. */
  function placeStage(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[loguetown.id] = loguetown;
    const inst = makeInst(loguetown.id, 'A');
    state.instances[inst.instanceId] = inst;
    state.players.A.stage = inst;
    return inst.instanceId;
  }

  /** Add `n` filler cards to A's hand (each gets its own instance). */
  function seedHandA(state: ReturnType<typeof buildState>['state'], n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = fillerCharacter(`TEST_HND_${i}`);
      state.cardLibrary[c.id] = c;
      const inst = makeInst(c.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.hand.push(inst.instanceId);
      ids.push(inst.instanceId);
    }
    return ids;
  }

  /** Add `n` filler cards to A's deck (each gets its own instance). */
  function seedDeckA(state: ReturnType<typeof buildState>['state'], n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = fillerCharacter(`TEST_DECK_${i}`);
      state.cardLibrary[c.id] = c;
      const inst = makeInst(c.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.deck.push(inst.instanceId);
      ids.push(inst.instanceId);
    }
    return ids;
  }

  it('clause shape: activate_main / cost {bottomOfDeckSelf, bottomOfDeckFromHand:1} / draw 2', () => {
    expect(clause.trigger).toBe('activate_main');
    expect(clause.cost!['bottomOfDeckSelf']).toBe(true);
    expect(clause.cost!['bottomOfDeckFromHand']).toBe(1);
    expect(clause.action.kind).toBe('draw');
    expect((clause.action as { magnitude: number }).magnitude).toBe(2);
  });

  it('canPay = true when Loguetown is on stage AND hand has ≥ 1 card', () => {
    const { state } = buildState({ leaderA: VANILLA_LEADER });
    const stageId = placeStage(state);
    seedHandA(state, 1);
    expect(
      CostPayer.canPay(state, { sourceInstanceId: stageId, controller: 'A' }, clause.cost!),
    ).toBe(true);
  });

  it('canPay = false when hand is empty (bottomOfDeckFromHand:1 unmet)', () => {
    const { state } = buildState({ leaderA: VANILLA_LEADER });
    const stageId = placeStage(state);
    expect(
      CostPayer.canPay(state, { sourceInstanceId: stageId, controller: 'A' }, clause.cost!),
    ).toBe(false);
  });

  it('activate_main dispatch: stage → bottom of deck, hand-1 → bottom of deck, +2 drawn', () => {
    const { state } = buildState({ leaderA: VANILLA_LEADER });
    const stageId = placeStage(state);
    const [handId] = seedHandA(state, 1);
    seedDeckA(state, 5);
    const deckBefore = state.players.A.deck.length;
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: stageId, controller: 'A' },
      'activate_main',
    );
    // Stage cleared.
    expect(next.players.A.stage).toBeNull();
    // Both stage + hand card went to bottom of deck.
    expect(next.players.A.deck).toContain(stageId);
    expect(next.players.A.deck).toContain(handId);
    // Deck size: started with 5; +2 (stage + hand cards added bottom), -2 drawn = net +0
    expect(next.players.A.deck.length).toBe(deckBefore + 2 - 2);
    // Hand: started with 1; -1 (paid) + 2 (drawn) = net +1
    expect(next.players.A.hand.length).toBe(handBefore + 1);
  });
});
