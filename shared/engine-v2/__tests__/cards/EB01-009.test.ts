/**
 * Per-card semantic test — EB01-009 "Just Shut Up and Come with Us!!!!" (event).
 *
 * Printed text (cards.json):
 *   "[Counter] Look at 5 cards from the top of your deck and play up to 1
 *    {Animal} type Character card with a cost of 3 or less. Then, place
 *    the rest at the bottom of your deck in any order."
 *
 * Spec: searcher_peek action with playInsteadOfHand=true + filter
 * {trait:'Animal', maxCost:3, kind:'character'}.
 *
 * Validates the searcher_peek filter (trait + cost), the play branch
 * (which fires on_play per H23/Fix #5 wired this session), and
 * summoning sickness on plays.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
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

function placeOnTop(state: import('../../state/types.js').GameState, card: CharacterCard): import('../../state/types.js').CardInstance {
  state.cardLibrary[card.id] = card;
  const inst = makeInst(card.id, 'A');
  state.instances[inst.instanceId] = inst;
  state.players.A.deck.unshift(inst.instanceId);
  return inst;
}

describe('EB01-009 — "Just Shut Up and Come with Us!!!!" (event)', () => {
  const allCards = loadCards();
  const card = allCards.find((c) => c.id === 'EB01-009');
  if (card === undefined) throw new Error('EB01-009 not in cards.json');
  if (card.kind !== 'event') throw new Error('EB01-009 should be an event');
  const clause = card.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-009 missing clause');

  it('plays a cost-2 Animal char from the top of the deck onto the field (summoning-sick)', () => {
    const { state } = buildState({ leaderA: VANILLA_LEADER });
    const animal: CharacterCard = {
      id: 'TEST_ANIM',
      name: 'Animal',
      kind: 'character',
      colors: ['red'],
      cost: 2,
      power: 3000,
      counterValue: 1000,
      traits: ['Animal'],
      keywords: [],
      effectTags: [],
    };
    const animInst = placeOnTop(state, animal);

    const handler = actionHandlers.get(clause.action.kind);
    const next = handler(
      state,
      { sourceInstanceId: 'fake-src', controller: 'A' },
      clause.action,
      [],
    );
    expect(next.players.A.field.some((i) => i.instanceId === animInst.instanceId)).toBe(true);
    expect(next.instances[animInst.instanceId]!.summoningSick).toBe(true);
  });

  it('does NOT play a non-Animal char (trait filter rejects)', () => {
    const { state } = buildState({ leaderA: VANILLA_LEADER });
    const human: CharacterCard = {
      id: 'TEST_HUM',
      name: 'Human',
      kind: 'character',
      colors: ['red'],
      cost: 2,
      power: 3000,
      counterValue: 1000,
      traits: ['Human'],
      keywords: [],
      effectTags: [],
    };
    const humInst = placeOnTop(state, human);

    const handler = actionHandlers.get(clause.action.kind);
    const next = handler(
      state,
      { sourceInstanceId: 'fake-src', controller: 'A' },
      clause.action,
      [],
    );
    expect(next.players.A.field.some((i) => i.instanceId === humInst.instanceId)).toBe(false);
  });

  it('does NOT play a cost-4 Animal (costMax=3 filter rejects)', () => {
    const { state } = buildState({ leaderA: VANILLA_LEADER });
    const bigAnim: CharacterCard = {
      id: 'TEST_BIG_ANIM',
      name: 'BigAnimal',
      kind: 'character',
      colors: ['red'],
      cost: 4,
      power: 5000,
      counterValue: 1000,
      traits: ['Animal'],
      keywords: [],
      effectTags: [],
    };
    const bigInst = placeOnTop(state, bigAnim);

    const handler = actionHandlers.get(clause.action.kind);
    const next = handler(
      state,
      { sourceInstanceId: 'fake-src', controller: 'A' },
      clause.action,
      [],
    );
    expect(next.players.A.field.some((i) => i.instanceId === bigInst.instanceId)).toBe(false);
  });

  it('does NOT find an Animal at deck position 6 (outside lookCount=5)', () => {
    const { state } = buildState({ leaderA: VANILLA_LEADER });
    // Seed 5 filler cards at the top, then the Animal at position 6.
    for (let i = 0; i < 5; i++) {
      const filler: CharacterCard = {
        id: `TEST_FILL_${i}`,
        name: `F${i}`,
        kind: 'character',
        colors: ['red'],
        cost: 1,
        power: 1000,
        counterValue: 1000,
        traits: ['Human'],
        keywords: [],
        effectTags: [],
      };
      placeOnTop(state, filler);
    }
    const animal: CharacterCard = {
      id: 'TEST_DEEP_ANIM',
      name: 'Deep',
      kind: 'character',
      colors: ['red'],
      cost: 2,
      power: 3000,
      counterValue: 1000,
      traits: ['Animal'],
      keywords: [],
      effectTags: [],
    };
    state.cardLibrary[animal.id] = animal;
    const animInst = makeInst(animal.id, 'A');
    state.instances[animInst.instanceId] = animInst;
    // Place at position 5 (zero-indexed) — outside the top 5.
    state.players.A.deck.splice(5, 0, animInst.instanceId);

    const handler = actionHandlers.get(clause.action.kind);
    const next = handler(
      state,
      { sourceInstanceId: 'fake-src', controller: 'A' },
      clause.action,
      [],
    );
    expect(next.players.A.field.some((i) => i.instanceId === animInst.instanceId)).toBe(false);
    expect(next.players.A.deck).toContain(animInst.instanceId);
  });
});
