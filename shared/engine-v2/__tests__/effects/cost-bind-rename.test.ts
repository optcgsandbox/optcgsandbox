/**
 * Engine V2 — hardening unit test: dispatcher cost.bind sentinel rename.
 *
 * Validates the EffectDispatcher.ts:226-230 contract:
 *   - cost handlers (returnSelfChar, discardHandFilter, returnOwnCharFilter)
 *     write `_costPicked` to ctx.scratch when cost.bind is declared
 *   - dispatcher renames scratch['_costPicked'] → scratch[cost.bind]
 *   - sentinel is deleted post-rename
 *   - cost handler that doesn't write sentinel → no crash, no rename
 *
 * Tested indirectly through play_for_free filter resolution: a card with
 *   cost: { returnSelfChar: {bind: 'returned'} }
 *   action: { kind: 'play_for_free', filter: { colors: BindingRef('returned', op:'ne') } }
 * exercises the full rename → resolve chain. If the rename works, the
 * hand-scan filter excludes the bound source's colors and plays only the
 * opposite-color hand card.
 *
 * Scope: minimal-dispatch flow via a synthesized card spec.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';
import type { CharacterCard, LeaderCard } from '../../cards/Card.js';

import { buildState, makeInst } from '../cards/_fixtures.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

const L: LeaderCard = {
  id: 'TEST_CBR_L', name: 'L', kind: 'leader', colors: ['red'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function ch(id: string, color: 'red' | 'blue', name: string, extra: Partial<CharacterCard> = {}): CharacterCard {
  return {
    id, name, kind: 'character', colors: [color], cost: 2, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [], ...extra,
  };
}

describe('dispatcher cost.bind sentinel rename (returnSelfChar → BindingRef chain)', () => {
  it('returnSelfChar writes _costPicked; dispatcher renames to cost.bind; play_for_free filter sees it', () => {
    const { state, fieldA } = buildState({ leaderA: L });
    // Mint a red source on field with synthetic effectSpecV2 carrying the
    // returnSelfChar + play_for_free hand-scan with BindingRef[op:'ne'] filter.
    const sourceCard: CharacterCard = {
      ...ch('CBR_SRC', 'red', 'SourceChar'),
      effectSpecV2: {
        clauses: [
          {
            trigger: 'on_play',
            cost: { returnSelfChar: {}, bind: 'returned' },
            action: {
              kind: 'play_for_free',
              from: 'hand',
              filter: {
                kind: 'character',
                colors: { kind: 'binding', name: 'returned', field: 'colors', op: 'ne' },
              },
            },
          },
        ],
        continuous: [],
        replacements: [],
        schemaVersion: 2,
      },
    };
    state.cardLibrary[sourceCard.id] = sourceCard;
    const sourceInst = makeInst(sourceCard.id, 'A');
    state.instances[sourceInst.instanceId] = sourceInst;
    state.players.A.field.push(sourceInst);
    // Hand has one red and one blue character; only blue should be played
    // (red is excluded by colors BindingRef op:'ne' against the source's
    // red colors via the cost.bind rename).
    const redHand = ch('CBR_HAND_R', 'red', 'HandRed');
    const blueHand = ch('CBR_HAND_B', 'blue', 'HandBlue');
    state.cardLibrary[redHand.id] = redHand;
    state.cardLibrary[blueHand.id] = blueHand;
    const redInst = makeInst(redHand.id, 'A');
    const blueInst = makeInst(blueHand.id, 'A');
    state.instances[redInst.instanceId] = redInst;
    state.instances[blueInst.instanceId] = blueInst;
    state.players.A.hand.push(redInst.instanceId, blueInst.instanceId);
    void fieldA;

    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: sourceInst.instanceId, controller: 'A' },
      'on_play',
    );

    // Source returned to hand by returnSelfChar cost.
    expect(next.players.A.hand).toContain(sourceInst.instanceId);
    expect(next.players.A.field.some((i) => i.instanceId === sourceInst.instanceId)).toBe(false);
    // Blue played onto field; red still in hand (filter op:'ne' resolved
    // correctly against the bound source's colors).
    expect(next.players.A.field.some((i) => i.instanceId === blueInst.instanceId)).toBe(true);
    expect(next.players.A.hand).toContain(redInst.instanceId);
    expect(next.players.A.field.some((i) => i.instanceId === redInst.instanceId)).toBe(false);
  });

  it('cost handler does NOT write sentinel (donCost-only) + cost.bind declared → graceful no-op rename', () => {
    // donCost doesn't touch ctx.scratch. cost.bind is declared but the
    // sentinel is never written. Dispatcher's check (scratch['_costPicked']
    // !== undefined) fails → no rename, no crash. The BindingRef filter on
    // the action then resolves to undefined → field stripped → all hand
    // cards eligible.
    const { state } = buildState({ leaderA: L, donInCostA: 5 });
    const sourceCard: CharacterCard = {
      ...ch('CBR2_SRC', 'red', 'Source2'),
      effectSpecV2: {
        clauses: [
          {
            trigger: 'on_play',
            cost: { donCost: 0, bind: 'noSentinel' },
            action: {
              kind: 'play_for_free',
              from: 'hand',
              filter: {
                kind: 'character',
                colors: { kind: 'binding', name: 'noSentinel', field: 'colors', op: 'ne' },
              },
            },
          },
        ],
        continuous: [],
        replacements: [],
        schemaVersion: 2,
      },
    };
    state.cardLibrary[sourceCard.id] = sourceCard;
    const sourceInst = makeInst(sourceCard.id, 'A');
    state.instances[sourceInst.instanceId] = sourceInst;
    state.players.A.field.push(sourceInst);
    const redHand = ch('CBR2_HAND_R', 'red', 'HR');
    state.cardLibrary[redHand.id] = redHand;
    const redInst = makeInst(redHand.id, 'A');
    state.instances[redInst.instanceId] = redInst;
    state.players.A.hand.push(redInst.instanceId);

    expect(() => {
      EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: sourceInst.instanceId, controller: 'A' },
        'on_play',
      );
    }).not.toThrow();
    // Filter field stripped → red card plays (no op:'ne' exclusion applies).
    expect(state.players.A.field.some((i) => i.instanceId === redInst.instanceId)).toBe(true);
  });
});
