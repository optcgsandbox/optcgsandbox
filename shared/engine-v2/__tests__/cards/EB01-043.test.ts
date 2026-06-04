/**
 * Per-card semantic test — EB01-043 Spandine (character).
 *
 * Printed text (cards.json):
 *   "[On Play] You may place 3 cards with a type including "CP" from your
 *    trash at the bottom of your deck in any order: Play up to 1 Character
 *    card with a type including "CP" and a cost of 4 or less other than
 *    [Spandine] from your trash rested."
 *
 * 5-axis: clause on_play / cost bottomOfDeckFromTrashFilter{count:3,
 *   filter:{typeIncludes:'CP'}} / action play_for_free from:'trash'
 *   filter{typeIncludes:'CP', costMax:4, nameExcludes:'Spandine',
 *   kind:'character'} rested:true.
 *
 * Engine gap (re-ref EB01-013/020/033): play_for_free in this clause has
 * no clause.target — the filter on the action is ignored. The cost half
 * works (bottomOfDeckFromTrashFilter handles its own filter); the play
 * half no-ops.
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
  id: 'TEST_LEADER_EB043',
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

function cpCharInTrash(id: string, cost: number): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['black'],
    cost,
    power: 3000,
    counterValue: 1000,
    traits: ['CP9'],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-043 — Spandine (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-043');
  if (eb === undefined) throw new Error('EB01-043 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-043 should be a character');
  const spandine = eb as CharacterCard;
  const clause = spandine.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-043 missing clause');

  it('clause shape: on_play / bottomOfDeckFromTrashFilter count:3 filter typeIncludes:CP / play_for_free trash CP costMax:4 nameExcludes:Spandine rested', () => {
    expect(clause.trigger).toBe('on_play');
    const costRow = clause.cost!['bottomOfDeckFromTrashFilter'] as { count: number; filter: { typeIncludes: string } };
    expect(costRow.count).toBe(3);
    expect(costRow.filter.typeIncludes).toBe('CP');
    expect(clause.action.kind).toBe('play_for_free');
    const action = clause.action as { from: string; rested: boolean; filter: { typeIncludes: string; costMax: number; nameExcludes: string; kind: string } };
    expect(action.from).toBe('trash');
    expect(action.rested).toBe(true);
    expect(action.filter.typeIncludes).toBe('CP');
    expect(action.filter.costMax).toBe(4);
    expect(action.filter.nameExcludes).toBe('Spandine');
    expect(action.filter.kind).toBe('character');
  });

  it(
    'plays a CP character (cost ≤ 4, not Spandine) from trash',
    () => {
      const t1 = cpCharInTrash('TEST_CP_1', 3);
      const t2 = cpCharInTrash('TEST_CP_2', 3);
      const t3 = cpCharInTrash('TEST_CP_3', 3);
      const cand = cpCharInTrash('TEST_CP_CAND', 3);
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [spandine] });
      for (const c of [t1, t2, t3, cand]) {
        state.cardLibrary[c.id] = c;
        const inst = makeInst(c.id, 'A');
        state.instances[inst.instanceId] = inst;
        state.players.A.trash.push(inst.instanceId);
      }
      const candId = state.players.A.trash[state.players.A.trash.length - 1]!;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
        'on_play',
      );
      expect(next.players.A.field.some((i) => i.instanceId === candId)).toBe(true);
    },
  );
});
