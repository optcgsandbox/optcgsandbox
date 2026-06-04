/**
 * Per-card semantic test — EB01-011 Mini-Merry (stage).
 *
 * Printed text (cards.json):
 *   "[Activate: Main] You may rest this card and place 1 of your Characters
 *    with 1000 base power at the bottom of your deck: Draw 1 card."
 *
 * 5-axis: clause activate_main / cost {restSelf:true, bottomOfDeckOwnChar
 *   {filter basePowerMin:1000 basePowerMax:1000}} / action draw magnitude:1.
 *
 * All primitives registered. No spec gap. No engine gap.
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
  id: 'TEST_LEADER_EB011',
  name: 'TEST',
  kind: 'leader',
  colors: ['red'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

function makeChar(id: string, basePower: number): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['red'],
    cost: 1,
    power: basePower,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-011 — Mini-Merry (stage)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-011');
  if (eb === undefined) throw new Error('EB01-011 not in cards.json');
  if (eb.kind !== 'stage') throw new Error('EB01-011 should be a stage');
  const stage = eb as StageCard;
  const clause = stage.effectSpecV2?.clauses?.[0];
  if (clause === undefined || clause.cost === undefined) {
    throw new Error('EB01-011 missing clause/cost');
  }

  function placeStage(state: import('../../state/types.js').GameState): string {
    state.cardLibrary[stage.id] = stage;
    const stageInst = makeInst(stage.id, 'A');
    state.instances[stageInst.instanceId] = stageInst;
    state.players.A.stage = stageInst;
    return stageInst.instanceId;
  }

  it('cost payable when a 1000-base char is on the field', () => {
    const c = makeChar('TEST_CV1', 1000);
    const { state } = buildState({ leaderA: VANILLA_LEADER, charsA: [c] });
    const stageId = placeStage(state);
    expect(
      CostPayer.canPay(state, { sourceInstanceId: stageId, controller: 'A' }, clause.cost!),
    ).toBe(true);
  });

  it('cost NOT payable without a 1000-base char (basePower exact-match filter)', () => {
    const c = makeChar('TEST_CV2', 2000);
    const { state } = buildState({ leaderA: VANILLA_LEADER, charsA: [c] });
    const stageId = placeStage(state);
    expect(
      CostPayer.canPay(state, { sourceInstanceId: stageId, controller: 'A' }, clause.cost!),
    ).toBe(false);
  });

  it('cost NOT payable when stage already rested', () => {
    const c = makeChar('TEST_CV3', 1000);
    const { state } = buildState({ leaderA: VANILLA_LEADER, charsA: [c] });
    const stageId = placeStage(state);
    state.instances[stageId]!.rested = true;
    expect(
      CostPayer.canPay(state, { sourceInstanceId: stageId, controller: 'A' }, clause.cost!),
    ).toBe(false);
  });

  it('paying cost rests stage AND bottoms the 1000-base char', () => {
    const c = makeChar('TEST_CV4', 1000);
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [c] });
    const stageId = placeStage(state);
    const charId = fieldA[0]!.instanceId;
    const next = CostPayer.pay(state, { sourceInstanceId: stageId, controller: 'A' }, clause.cost!);
    expect(next).not.toBeNull();
    expect(next!.players.A.stage!.rested).toBe(true);
    expect(next!.players.A.field.some((i) => i.instanceId === charId)).toBe(false);
    expect(next!.players.A.deck[next!.players.A.deck.length - 1]).toBe(charId);
  });

  it('full activate_main dispatch: rests stage + bottoms 1000-base char + draws 1', () => {
    const c = makeChar('TEST_CV5', 1000);
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [c] });
    const stageId = placeStage(state);
    const charId = fieldA[0]!.instanceId;
    const deckCard = makeChar('TEST_DECK_EB011', 3000);
    state.cardLibrary[deckCard.id] = deckCard;
    const deckInst = makeInst(deckCard.id, 'A');
    state.instances[deckInst.instanceId] = deckInst;
    state.players.A.deck.unshift(deckInst.instanceId);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: stageId, controller: 'A' },
      'activate_main',
    );
    // Stage rested.
    expect(next.players.A.stage!.rested).toBe(true);
    // Char bottomed: gone from field, and now at the deck bottom (the deck
    // card we seeded was at position 0 and is the drawn one, so the bottomed
    // char sits at the tail).
    expect(next.players.A.field.some((i) => i.instanceId === charId)).toBe(false);
    expect(next.players.A.deck[next.players.A.deck.length - 1]).toBe(charId);
    // Draw: drew the seeded deck card → hand +1, deck now only has the
    // bottomed char left (1 entry).
    expect(next.players.A.hand.length).toBe(handBefore + 1);
    expect(next.players.A.hand).toContain(deckInst.instanceId);
  });

  it('full activate_main dispatch: clause skipped when cost unpayable (no 1000-base char)', () => {
    const c = makeChar('TEST_CV_BAD', 2000);
    const { state } = buildState({ leaderA: VANILLA_LEADER, charsA: [c] });
    const stageId = placeStage(state);
    const deckCard = makeChar('TEST_DECK_EB011_B', 3000);
    state.cardLibrary[deckCard.id] = deckCard;
    const deckInst = makeInst(deckCard.id, 'A');
    state.instances[deckInst.instanceId] = deckInst;
    state.players.A.deck.unshift(deckInst.instanceId);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: stageId, controller: 'A' },
      'activate_main',
    );
    // Stage NOT rested, no draw, char still on field.
    expect(next.players.A.stage!.rested).toBe(false);
    expect(next.players.A.hand.length).toBe(handBefore);
  });
});
