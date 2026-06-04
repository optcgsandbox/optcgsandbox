/**
 * Per-card semantic test — EB01-060 Did Someone Say...Kami? ([Main] event).
 * "[Main] Play up to 1 [Enel] with a cost of 7 or less from your hand or
 *  trash. Then, trash cards from the top of your Life cards until you have
 *  1 Life card."
 * Spec: TWO on_play clauses:
 *   1) play_for_free from:'hand_or_trash' filter{nameIs:Enel, costMax:7, kind:character}
 *   2) trash_own_life_until n:1
 *
 * Engine gap re-ref (EB01-013/020/033/043): play_for_free no clause-level
 * target → action no-op. Second clause works.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, EventCard, LeaderCard } from '../../cards/Card.js';
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
  id: 'TEST_L_EB060', name: 'L', kind: 'leader', colors: ['yellow'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function seedLife(state: ReturnType<typeof buildState>['state'], n: number): void {
  for (let i = 0; i < n; i++) {
    const id = `A-LIFE-60-${i}`;
    state.instances[id] = makeInst('__VANILLA', 'A');
    state.instances[id].instanceId = id;
    state.players.A.life.push(id);
  }
}

describe('EB01-060 — Did Someone Say...Kami?', () => {
  const c = loadCards().find((x) => x.id === 'EB01-060');
  if (c === undefined || c.kind !== 'event') throw new Error('EB01-060 invalid');
  const ev = c as EventCard;
  const clauses = ev.effectSpecV2!.clauses!;

  function attach(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[ev.id] = ev;
    const inst = makeInst(ev.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('shape: two on_play clauses [play_for_free hand_or_trash Enel costMax:7, trash_own_life_until n:1]', () => {
    expect(clauses).toHaveLength(2);
    expect(clauses[0]!.action.kind).toBe('play_for_free');
    const a = clauses[0]!.action as { from: string; filter: { nameIs: string; costMax: number; kind: string } };
    expect(a.from).toBe('hand_or_trash');
    expect(a.filter.nameIs).toBe('Enel');
    expect(a.filter.costMax).toBe(7);
    expect(a.filter.kind).toBe('character');
    expect(clauses[1]!.action.kind).toBe('trash_own_life_until');
    expect((clauses[1]!.action as { n: number }).n).toBe(1);
  });

  it(
    'clause 2 (trash_own_life_until) trims life to 1 — printed "until you have 1 Life card" — closes cluster-D engine gap',
    () => {
      const { state } = buildState({ leaderA: L });
      seedLife(state, 4);
      const srcId = attach(state);
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
      );
      expect(next.players.A.life.length).toBe(1);
    },
  );

  it(
    'clause 1 (play_for_free) plays an Enel from hand',
    () => {
      const enel = {
        id: 'TEST_ENEL_HAND',
        name: 'Enel',
        kind: 'character' as const,
        colors: ['yellow' as const],
        cost: 7,
        power: 9000,
        counterValue: 1000,
        traits: ['Sky Island'],
        keywords: [],
        effectTags: [],
      };
      const { state, handAInstances } = buildState({ leaderA: L, handA: [enel] });
      const enelId = handAInstances[0]!.instanceId;
      seedLife(state, 2);
      const srcId = attach(state);
      const next = EffectDispatcher.dispatch(
        state, { sourceInstanceId: srcId, controller: 'A' }, 'on_play',
      );
      expect(next.players.A.field.some((i) => i.instanceId === enelId)).toBe(true);
    },
  );
});
