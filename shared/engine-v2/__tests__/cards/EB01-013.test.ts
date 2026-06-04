/**
 * Per-card semantic test — EB01-013 Kouzuki Hiyori (character).
 *
 * Printed text (cards.json):
 *   "[Activate: Main] You may trash this Character: Play up to 1
 *    {Land of Wano} type Character card with a cost of 5 or less other
 *    than [Kouzuki Hiyori] from your hand. Then, draw 1 card."
 *
 * 5-axis: clause activate_main / cost trashSelf / action sequence
 *   [play_for_free filter{trait Wano, costMax 5, nameExcludes Hiyori,
 *   kind character}, draw 1] / opt:true.
 *
 * Engine gap (logged in BUGS_FOUND.md): play_for_free sub-action inside
 * sequence runs with empty targets because the clause has no target.kind
 * and play_for_free doesn't internally resolve action.filter. The
 * "play Wano cost-5 from hand" half is inert today.
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
  id: 'TEST_LEADER_EB013',
  name: 'TEST',
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

describe('EB01-013 — Kouzuki Hiyori (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-013');
  if (eb === undefined) throw new Error('EB01-013 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-013 should be a character');
  const hiyori = eb as CharacterCard;
  const clause = hiyori.effectSpecV2?.clauses?.[0];
  if (clause === undefined || clause.cost === undefined) {
    throw new Error('EB01-013 missing clause/cost');
  }

  describe('trashSelf cost', () => {
    it('payable when Hiyori is on field', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [hiyori] });
      const hiId = fieldA[0]!.instanceId;
      expect(
        CostPayer.canPay(state, { sourceInstanceId: hiId, controller: 'A' }, clause.cost!),
      ).toBe(true);
    });

    it('paying cost moves Hiyori from field to trash', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [hiyori] });
      const hiId = fieldA[0]!.instanceId;
      const next = CostPayer.pay(state, { sourceInstanceId: hiId, controller: 'A' }, clause.cost!);
      expect(next).not.toBeNull();
      expect(next!.players.A.field.find((i) => i.instanceId === hiId)).toBeUndefined();
      expect(next!.players.A.trash).toContain(hiId);
    });

    it('NOT payable when Hiyori is not on field (already trashed)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [hiyori] });
      const hiId = fieldA[0]!.instanceId;
      // Manually remove Hiyori from field.
      state.players.A.field = state.players.A.field.filter((i) => i.instanceId !== hiId);
      state.players.A.trash.push(hiId);
      expect(
        CostPayer.canPay(state, { sourceInstanceId: hiId, controller: 'A' }, clause.cost!),
      ).toBe(false);
    });
  });

  describe('action sequence — play_for_free + draw', () => {
    it('draw 1 sub-action fires (deck → hand)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [hiyori] });
      const hiId = fieldA[0]!.instanceId;
      // Seed a deck card.
      const filler: CharacterCard = {
        id: 'TEST_DECK_EB013',
        name: 'D',
        kind: 'character',
        colors: ['green'],
        cost: 1,
        power: 1000,
        counterValue: 1000,
        traits: [],
        keywords: [],
        effectTags: [],
      };
      state.cardLibrary[filler.id] = filler;
      const deckInst = makeInst(filler.id, 'A');
      state.instances[deckInst.instanceId] = deckInst;
      state.players.A.deck.unshift(deckInst.instanceId);

      const handBefore = state.players.A.hand.length;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: hiId, controller: 'A' },
        'activate_main',
      );
      // Note: EffectDispatcher pays the cost too (trashSelf removes Hiyori
      // from field) before running the sequence. Sequence runs both
      // sub-actions. play_for_free is inert (engine gap), draw runs.
      expect(next.players.A.hand.length).toBe(handBefore + 1);
    });

    it('play_for_free plays a Wano cost-5 char from hand', () => {
      const wanoCard: CharacterCard = {
        id: 'TEST_WANO5_EB013',
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
        charsA: [hiyori],
        handA: [wanoCard],
      });
      const hiId = fieldA[0]!.instanceId;
      const wanoId = handAInstances[0]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: hiId, controller: 'A' },
        'activate_main',
      );
      // Per printed text the Wano char should now be on field. Engine gap.
      expect(next.players.A.field.some((i) => i.instanceId === wanoId)).toBe(true);
    });

    it('OPT: second activate_main same turn does NOT fire (trashSelf already paid, but engine OPT-gate suppression too — clause.opt:true)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [hiyori] });
      const hiId = fieldA[0]!.instanceId;
      // Seed deck so draw works.
      const filler: CharacterCard = {
        id: 'TEST_OPT_DECK',
        name: 'D',
        kind: 'character',
        colors: ['green'],
        cost: 1,
        power: 1000,
        counterValue: 1000,
        traits: [],
        keywords: [],
        effectTags: [],
      };
      state.cardLibrary[filler.id] = filler;
      const d1 = makeInst(filler.id, 'A');
      const d2 = makeInst(filler.id, 'A');
      state.instances[d1.instanceId] = d1;
      state.instances[d2.instanceId] = d2;
      state.players.A.deck.unshift(d2.instanceId);
      state.players.A.deck.unshift(d1.instanceId);
      const handBefore = state.players.A.hand.length;
      let next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: hiId, controller: 'A' },
        'activate_main',
      );
      const handAfterFirst = next.players.A.hand.length;
      expect(handAfterFirst).toBe(handBefore + 1);
      // Manually put Hiyori back on field so the cost-payable check can't
      // be the gate. The OPT key is what should suppress.
      state.players.A.trash = state.players.A.trash.filter((id) => id !== hiId);
      next.players.A.trash = next.players.A.trash.filter((id) => id !== hiId);
      next.players.A.field.push({ ...fieldA[0]! });
      const handBeforeSecond = next.players.A.hand.length;
      next = EffectDispatcher.dispatch(
        next,
        { sourceInstanceId: hiId, controller: 'A' },
        'activate_main',
      );
      expect(next.players.A.hand.length).toBe(handBeforeSecond);
    });
  });
});
