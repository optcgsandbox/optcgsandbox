/**
 * Per-card semantic test — EB01-013 Kouzuki Hiyori (character).
 *
 * Printed text (cards.json):
 *   "[Activate: Main] You may trash this Character: Play up to 1
 *    {Land of Wano} type Character card with a cost of 5 or less other
 *    than [Kouzuki Hiyori] from your hand. Then, draw 1 card."
 *
 * Exercises trashSelf cost + sequence(play_for_free with filter, draw).
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
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
  colors: ['green'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

const HIYORI: CharacterCard = {
  id: 'TEST_HIY',
  name: 'Kouzuki Hiyori',
  kind: 'character',
  colors: ['green'],
  cost: 4,
  power: 0,
  counterValue: 1000,
  traits: ['Land of Wano', 'Kouzuki Clan'],
  keywords: [],
  effectTags: [],
};

describe('EB01-013 — Kouzuki Hiyori (character)', () => {
  const allCards = loadCards();
  const eb01013 = allCards.find((c) => c.id === 'EB01-013');
  if (eb01013 === undefined) throw new Error('EB01-013 not in cards.json');
  if (eb01013.kind !== 'character') throw new Error('EB01-013 should be a character');
  const clause = eb01013.effectSpecV2?.clauses?.[0];
  if (clause === undefined || clause.cost === undefined) {
    throw new Error('EB01-013 missing clause / cost');
  }

  it('trashSelf cost payable when Hiyori is on field', () => {
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [HIYORI] });
    const hiId = fieldA[0]!.instanceId;
    expect(
      CostPayer.canPay(state, { sourceInstanceId: hiId, controller: 'A' }, clause.cost!),
    ).toBe(true);
  });

  it('paying trashSelf moves Hiyori from field to trash', () => {
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [HIYORI] });
    const hiId = fieldA[0]!.instanceId;
    const next = CostPayer.pay(state, { sourceInstanceId: hiId, controller: 'A' }, clause.cost!);
    expect(next).not.toBeNull();
    expect(next!.players.A.field.find((i) => i.instanceId === hiId)).toBeUndefined();
    expect(next!.players.A.trash).toContain(hiId);
  });

  it('sequence: plays a matching Wano char (cost ≤ 5) from hand AND draws 1', () => {
    const candidate: CharacterCard = {
      id: 'TEST_WANO5',
      name: 'Wano Char',
      kind: 'character',
      colors: ['green'],
      cost: 5,
      power: 6000,
      counterValue: 1000,
      traits: ['Land of Wano'],
      keywords: [],
      effectTags: [],
    };
    const { state, fieldA, handAInstances } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [HIYORI],
      handA: [candidate],
    });
    const hiId = fieldA[0]!.instanceId;
    const wanoId = handAInstances[0]!.instanceId;
    // Seed a deck card so the draw step finds something.
    const deckCard: CharacterCard = {
      id: 'TEST_DECK1_EB013',
      name: 'Deck1',
      kind: 'character',
      colors: ['green'],
      cost: 1,
      power: 1000,
      counterValue: 1000,
      traits: [],
      keywords: [],
      effectTags: [],
    };
    state.cardLibrary[deckCard.id] = deckCard;
    const deckInst = makeInst(deckCard.id, 'A');
    state.instances[deckInst.instanceId] = deckInst;
    state.players.A.deck.unshift(deckInst.instanceId);

    const handBefore = state.players.A.hand.length;
    const handler = actionHandlers.get(clause.action.kind);
    const next = handler(
      state,
      { sourceInstanceId: hiId, controller: 'A' },
      clause.action,
      [wanoId],
    );
    expect(next.players.A.field.some((i) => i.instanceId === wanoId)).toBe(true);
    expect(next.instances[wanoId]!.summoningSick).toBe(true);
    // Net: -1 (played) + 1 (drew) = unchanged.
    expect(next.players.A.hand.length).toBe(handBefore);
  });

  it('clause spec carries the nameExcludes filter (avoids self-replay loop)', () => {
    // The filter is enforced by the target resolver (own_character_in_hand)
    // before the action handler runs. The CLAUSE.action's nested filter spec
    // contains nameExcludes so the resolver knows to skip Hiyori cards.
    const sub0 = (clause.action as { actions?: ReadonlyArray<{ filter?: { nameExcludes?: string } }> }).actions?.[0];
    expect(sub0?.filter?.nameExcludes).toBe('Kouzuki Hiyori');
  });

  it('clause spec caps cost at 5 (costMax filter)', () => {
    const sub0 = (clause.action as { actions?: ReadonlyArray<{ filter?: { costMax?: number } }> }).actions?.[0];
    expect(sub0?.filter?.costMax).toBe(5);
  });
});
