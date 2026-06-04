/**
 * Per-card semantic test — EB02-047 Blueno (CP9 black).
 * "[Activate: Main] You may trash 1 card from your hand and trash this
 *  Character: Play up to 1 Character card with a type including "CP" and
 *  a cost of 5 or less other than [Blueno] from your trash."
 * Spec: activate_main / cost{discardHand:1, trashSelf:true} /
 *   play_for_free from:trash filter{typeIncludes:CP, costMax:5, nameExcludes:Blueno, kind:character}.
 *
 * Engine gap re-ref EB01-013: play_for_free no clause-target → no-op.
 * Positive uses it.fails.
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

const L: LeaderCard = {
  id: 'TEST_L_EB02047', name: 'L', kind: 'leader', colors: ['black'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function cpChar(id: string, name: string, cost: number, type: string = 'CP9'): CharacterCard {
  return {
    id, name, kind: 'character', colors: ['black'], cost, power: 3000,
    counterValue: 1000, traits: [type], keywords: [], effectTags: [],
  };
}

function nonCp(id: string, cost: number): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['black'], cost, power: 3000,
    counterValue: 1000, traits: ['Navy'], keywords: [], effectTags: [],
  };
}

describe('EB02-047 — Blueno (CP9 black)', () => {
  const c = loadCards().find((x) => x.id === 'EB02-047');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-047 invalid');
  const bl = c as CharacterCard;
  const clause = bl.effectSpecV2!.clauses![0]!;

  it('shape: activate_main / cost{discardHand:1, trashSelf} / play_for_free trash CP costMax:5 nameExcludes:Blueno', () => {
    expect(clause.trigger).toBe('activate_main');
    expect(clause.cost!['discardHand']).toBe(1);
    expect(clause.cost!['trashSelf']).toBe(true);
    expect(clause.action.kind).toBe('play_for_free');
    const a = clause.action as { from: string; filter: { typeIncludes: string; costMax: number; nameExcludes: string; kind: string } };
    expect(a.from).toBe('trash');
    expect(a.filter.typeIncludes).toBe('CP');
    expect(a.filter.costMax).toBe(5);
    expect(a.filter.nameExcludes).toBe('Blueno');
    expect(a.filter.kind).toBe('character');
  });

  it('no hand to discard: cost unpayable → no fire (Blueno still on field)', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [bl] });
    // hand empty by default. Put cand in trash.
    const cand = cpChar('TEST_CAND_E47', 'Lucci', 5);
    state.cardLibrary[cand.id] = cand;
    const candInst = makeInst(cand.id, 'A');
    state.instances[candInst.instanceId] = candInst;
    state.players.A.trash.push(candInst.instanceId);
    const blueId = fieldA[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: blueId, controller: 'A' }, 'activate_main',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).toContain(blueId);
    expect(next.players.A.trash).toContain(candInst.instanceId);
  });

  it('cost-6 CP in trash: filter exclude (costMax)', () => {
    const handFiller: CharacterCard = {
      id: 'TEST_HAND_FILLER_E47', name: 'X', kind: 'character', colors: ['black'],
      cost: 1, power: 1000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    const { state, fieldA } = buildState({ leaderA: L, charsA: [bl], handA: [handFiller] });
    const big = cpChar('TEST_BIG_CP_E47', 'Bigger', 6);
    state.cardLibrary[big.id] = big;
    const bigInst = makeInst(big.id, 'A');
    state.instances[bigInst.instanceId] = bigInst;
    state.players.A.trash.push(bigInst.instanceId);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'activate_main',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(bigInst.instanceId);
  });

  it('cost-5 CP Blueno in trash: nameExcludes filter blocks', () => {
    const handFiller: CharacterCard = {
      id: 'TEST_HAND_FB_E47', name: 'X', kind: 'character', colors: ['black'],
      cost: 1, power: 1000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    const { state, fieldA } = buildState({ leaderA: L, charsA: [bl], handA: [handFiller] });
    const blueno5 = cpChar('TEST_BLUENO5_E47', 'Blueno', 5);
    state.cardLibrary[blueno5.id] = blueno5;
    const bluenoInst = makeInst(blueno5.id, 'A');
    state.instances[bluenoInst.instanceId] = bluenoInst;
    state.players.A.trash.push(bluenoInst.instanceId);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'activate_main',
    );
    expect(next.players.A.field.map((i) => i.instanceId)).not.toContain(bluenoInst.instanceId);
  });

  it(
    'cost-5 CP9 non-Blueno in trash + hand to discard: positive play',
    () => {
      const handCard: CharacterCard = {
        id: 'TEST_DISCARD_E47', name: 'X', kind: 'character', colors: ['black'],
        cost: 1, power: 1000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
      };
      const { state, fieldA } = buildState({ leaderA: L, charsA: [bl], handA: [handCard] });
      const lucci = cpChar('TEST_LUCCI_E47', 'Lucci', 5);
      state.cardLibrary[lucci.id] = lucci;
      const lucciInst = makeInst(lucci.id, 'A');
      state.instances[lucciInst.instanceId] = lucciInst;
      state.players.A.trash.push(lucciInst.instanceId);
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'activate_main',
      );
      expect(next.players.A.field.map((i) => i.instanceId)).toContain(lucciInst.instanceId);
      void nonCp;
    },
  );
});
