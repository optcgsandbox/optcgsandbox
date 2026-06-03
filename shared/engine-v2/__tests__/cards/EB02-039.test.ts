/**
 * Per-card semantic test — EB02-039 GERMA 66 ([Main] event).
 * "[Main] You may trash 1 {GERMA 66} type Character card with 4000 power
 *  or less from your hand: If the number of DON!! cards on your field is
 *  equal to or less than the number on your opponent's field, play up to
 *  1 Character card with 5000 to 7000 power and the same card name as the
 *  trashed card from your trash."
 * Spec: on_play / if_own_don_le_opp / cost discardHandFilter{count:1, filter{trait:GERMA 66, kind:character, powerMax:4000}} /
 *   play_for_free from:trash filter{powerMin:5000, powerMax:7000, kind:character} nameMatchesLastDiscarded:true.
 *
 * Engine gap re-ref EB01-013/020/033/043: play_for_free no clause-target →
 *   no-op. Positive uses it.fails.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, EventCard, LeaderCard } from '../../cards/Card.js';
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
  id: 'TEST_L_EB02039', name: 'L', kind: 'leader', colors: ['purple'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function germaSmall(id: string, name: string): CharacterCard {
  return {
    id, name, kind: 'character', colors: ['purple'], cost: 3, power: 3000,
    counterValue: 1000, traits: ['GERMA 66'], keywords: [], effectTags: [],
  };
}

function germaBig(id: string, name: string): CharacterCard {
  return {
    id, name, kind: 'character', colors: ['purple'], cost: 6, power: 6000,
    counterValue: 1000, traits: ['GERMA 66'], keywords: [], effectTags: [],
  };
}

describe('EB02-039 — GERMA 66', () => {
  const c = loadCards().find((x) => x.id === 'EB02-039');
  if (c === undefined || c.kind !== 'event') throw new Error('EB02-039 invalid');
  const ev = c as EventCard;
  const clause = ev.effectSpecV2!.clauses![0]!;

  function attach(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[ev.id] = ev;
    const inst = makeInst(ev.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('shape: on_play / if_own_don_le_opp / cost bind:discarded_card discardHandFilter / play_for_free trash GERMA 5000-7000 nameIs BindingRef(discarded_card.name)', () => {
    expect(clause.trigger).toBe('on_play');
    expect((clause.condition as { type: string }).type).toBe('if_own_don_le_opp');
    expect((clause.cost as { bind?: string }).bind).toBe('discarded_card');
    const cost = (clause.cost!['discardHandFilter']) as { count: number; filter: { trait: string; kind: string; powerMax: number } };
    expect(cost.count).toBe(1);
    expect(cost.filter.trait).toBe('GERMA 66');
    expect(cost.filter.kind).toBe('character');
    expect(cost.filter.powerMax).toBe(4000);
    expect(clause.action.kind).toBe('play_for_free');
    const a = clause.action as {
      from: string;
      filter: {
        powerMin: number;
        powerMax: number;
        kind: string;
        nameIs: { kind: string; name: string; field: string; op: string };
      };
    };
    expect(a.from).toBe('trash');
    expect(a.filter.powerMin).toBe(5000);
    expect(a.filter.powerMax).toBe(7000);
    // Cross-step binding: filter.nameIs is a BindingRef to the discarded card's name.
    expect(a.filter.nameIs.kind).toBe('binding');
    expect(a.filter.nameIs.name).toBe('discarded_card');
    expect(a.filter.nameIs.field).toBe('name');
    expect(a.filter.nameIs.op).toBe('eq');
  });

  it('DON > opp: condition fail → no hand discard', () => {
    const small = germaSmall('TEST_SMALL_E39', 'Niji');
    const { state, handAInstances } = buildState({
      leaderA: L, handA: [small], donInCostA: 10, donInCostB: 5,
    });
    const srcId = attach(state);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore);
    // Hand small char still present.
    expect(next.players.A.hand).toContain(handAInstances[0]!.instanceId);
  });

  it('no GERMA 66 ≤4000 in hand: cost unpayable → no discard, no play', () => {
    // Hand has a non-GERMA char and a 5000-power GERMA char (both exclude from cost filter).
    const nonGerma: CharacterCard = {
      id: 'TEST_NON_GERMA_E39', name: 'X', kind: 'character', colors: ['purple'],
      cost: 1, power: 1000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    const tooBig = germaBig('TEST_TOO_BIG_E39', 'Yonji');
    const { state, handAInstances } = buildState({
      leaderA: L, handA: [nonGerma, tooBig], donInCostA: 5, donInCostB: 10,
    });
    const srcId = attach(state);
    const handBefore = state.players.A.hand.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
    );
    expect(next.players.A.hand.length).toBe(handBefore);
    expect(next.players.A.hand).toContain(handAInstances[0]!.instanceId);
    expect(next.players.A.hand).toContain(handAInstances[1]!.instanceId);
  });

  it.fails(
    'cost + condition pass: GERMA 66 small in hand + matching name big GERMA in trash → played onto field (engine gap — play_for_free no clause-target)',
    () => {
      const small = germaSmall('TEST_SMALL_FIRE_E39', 'Niji');
      const matchBig = germaBig('TEST_BIG_MATCH_E39', 'Niji');
      const { state } = buildState({
        leaderA: L, handA: [small], donInCostA: 5, donInCostB: 10,
      });
      // Put a matching big GERMA into trash.
      state.cardLibrary[matchBig.id] = matchBig;
      const bigInst = makeInst(matchBig.id, 'A');
      state.instances[bigInst.instanceId] = bigInst;
      state.players.A.trash.push(bigInst.instanceId);
      const bigId = bigInst.instanceId;
      const srcId = attach(state);
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
      );
      expect(next.players.A.field.map((i) => i.instanceId)).toContain(bigId);
    },
  );
});
