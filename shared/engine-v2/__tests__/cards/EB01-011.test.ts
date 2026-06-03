/**
 * Per-card semantic test — EB01-011 Mini-Merry (stage).
 *
 * Printed text (cards.json):
 *   "[Activate: Main] You may rest this card and place 1 of your
 *    Characters with 1000 base power at the bottom of your deck: Draw 1."
 *
 * Spec cost shape: { restSelf: true, bottomOfDeckOwnChar: { filter:
 * { basePowerMin: 1000, basePowerMax: 1000 } } }.
 *
 * Validates the multi-key cost shape (rest + bottom) atomicity and the
 * basePower (NOT effective power) filter on the cost-target.
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
import { actionHandlers } from '../../registry/types.js';
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
  id: 'TEST_LEADER',
  name: 'Vanilla Leader',
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

function makeCharCard(id: string, basePower: number): CharacterCard {
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
  const card = allCards.find((c) => c.id === 'EB01-011');
  if (card === undefined) throw new Error('EB01-011 not in cards.json');
  if (card.kind !== 'stage') throw new Error('EB01-011 should be a stage');
  const stage = card as StageCard;
  const clause = stage.effectSpecV2?.clauses?.[0];
  if (clause === undefined || clause.cost === undefined) {
    throw new Error('EB01-011 missing clause/cost');
  }

  /** Place EB01-011 on A's stage slot and return its instance ID. */
  function placeStage(state: import('../../state/types.js').GameState): string {
    state.cardLibrary[stage.id] = stage;
    const stageInst = makeInst(stage.id, 'A');
    state.instances[stageInst.instanceId] = stageInst;
    state.players.A.stage = stageInst;
    return stageInst.instanceId;
  }

  it('cost payable when a 1000-base char is on the field', () => {
    const charCard = makeCharCard('TEST_CV1', 1000);
    const { state } = buildState({ leaderA: VANILLA_LEADER, charsA: [charCard] });
    const stageId = placeStage(state);
    expect(
      CostPayer.canPay(state, { sourceInstanceId: stageId, controller: 'A' }, clause.cost!),
    ).toBe(true);
  });

  it('cost NOT payable without a 1000-base char (basePower filter)', () => {
    const charCard = makeCharCard('TEST_CV2', 2000);
    const { state } = buildState({ leaderA: VANILLA_LEADER, charsA: [charCard] });
    const stageId = placeStage(state);
    expect(
      CostPayer.canPay(state, { sourceInstanceId: stageId, controller: 'A' }, clause.cost!),
    ).toBe(false);
  });

  it('paying cost rests the stage AND moves the 1000-base char to bottom of deck', () => {
    const charCard = makeCharCard('TEST_CV3', 1000);
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [charCard] });
    const stageId = placeStage(state);
    const charId = fieldA[0]!.instanceId;
    const next = CostPayer.pay(state, { sourceInstanceId: stageId, controller: 'A' }, clause.cost!);
    expect(next).not.toBeNull();
    expect(next!.players.A.stage!.rested).toBe(true);
    expect(next!.players.A.field.some((i) => i.instanceId === charId)).toBe(false);
    expect(next!.players.A.deck[next!.players.A.deck.length - 1]).toBe(charId);
  });

  it('action draws 1', () => {
    const charCard = makeCharCard('TEST_CV4', 1000);
    const { state } = buildState({ leaderA: VANILLA_LEADER, charsA: [charCard] });
    const stageId = placeStage(state);
    // Seed a deck so draw can actually pull a card.
    const deckCard = makeCharCard('TEST_DECK1', 3000);
    state.cardLibrary[deckCard.id] = deckCard;
    const deckInst = makeInst(deckCard.id, 'A');
    state.instances[deckInst.instanceId] = deckInst;
    state.players.A.deck.unshift(deckInst.instanceId);

    const handBefore = state.players.A.hand.length;
    const handler = actionHandlers.get(clause.action.kind);
    const next = handler(
      state,
      { sourceInstanceId: stageId, controller: 'A' },
      clause.action,
      [],
    );
    expect(next.players.A.hand.length).toBe(handBefore + 1);
  });
});
