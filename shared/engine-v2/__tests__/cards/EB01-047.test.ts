/**
 * Per-card semantic test — EB01-047 Laboon (character, 2c/4000p).
 *
 * Printed text (cards.json):
 *   "[Once Per Turn] When a Character is K.O.'d, draw 1 card and trash 1
 *    card from your hand."
 *
 * 5-axis: clause on_any_char_ko / sequence [draw 1, discard_from_hand 1] /
 *   opt:true.
 *
 * All primitives registered.
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

const VANILLA_LEADER: LeaderCard = {
  id: 'TEST_LEADER_EB047',
  name: 'TEST',
  kind: 'leader',
  colors: ['black'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

function filler(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['black'],
    cost: 1,
    power: 1000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-047 — Laboon 2c (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-047');
  if (eb === undefined) throw new Error('EB01-047 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-047 should be a character');
  const lab = eb as CharacterCard;
  const clause = lab.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-047 missing clause');

  it('clause shape: on_any_char_ko / sequence [draw 1, discard_from_hand 1] / opt:true', () => {
    expect(clause.trigger).toBe('on_any_char_ko');
    expect(clause.action.kind).toBe('sequence');
    const seq = clause.action as { actions: ReadonlyArray<{ kind: string; magnitude?: number }> };
    expect(seq.actions[0]!.kind).toBe('draw');
    expect(seq.actions[0]!.magnitude).toBe(1);
    expect(seq.actions[1]!.kind).toBe('discard_from_hand');
    expect(seq.actions[1]!.magnitude).toBe(1);
    expect(clause.opt).toBe(true);
  });

  it('on_any_char_ko dispatch: nets +0 to hand (draw 1, discard 1)', () => {
    const dc = filler('TEST_DECK_1');
    const hc = filler('TEST_HND_1');
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [lab],
      handA: [hc],
    });
    // Seed deck with one instance to draw.
    state.cardLibrary[dc.id] = dc;
    const dcInst = makeInst(dc.id, 'A');
    state.instances[dcInst.instanceId] = dcInst;
    state.players.A.deck.push(dcInst.instanceId);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_any_char_ko',
    );
    expect(next.players.A.hand.length).toBe(handBefore);
    expect(next.players.A.trash.length).toBe(1);
  });

  it('OPT: second on_any_char_ko same turn does NOT fire again', () => {
    const dc1 = filler('TEST_DECK_OPT_1');
    const dc2 = filler('TEST_DECK_OPT_2');
    const hc1 = filler('TEST_HND_OPT_1');
    const hc2 = filler('TEST_HND_OPT_2');
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [lab],
      handA: [hc1, hc2],
    });
    for (const c of [dc1, dc2]) {
      state.cardLibrary[c.id] = c;
      const inst = makeInst(c.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.deck.push(inst.instanceId);
    }
    const sId = fieldA[0]!.instanceId;
    const once = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: sId, controller: 'A' },
      'on_any_char_ko',
    );
    const handAfterFirst = once.players.A.hand.length;
    const trashAfterFirst = once.players.A.trash.length;
    const deckAfterFirst = once.players.A.deck.length;
    const twice = EffectDispatcher.dispatch(
      once,
      { sourceInstanceId: sId, controller: 'A' },
      'on_any_char_ko',
    );
    // Second fire suppressed by OPT: hand/trash/deck unchanged.
    expect(twice.players.A.hand.length).toBe(handAfterFirst);
    expect(twice.players.A.trash.length).toBe(trashAfterFirst);
    expect(twice.players.A.deck.length).toBe(deckAfterFirst);
  });
});
