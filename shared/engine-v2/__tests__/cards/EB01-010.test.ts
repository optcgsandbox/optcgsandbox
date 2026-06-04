/**
 * Per-card semantic test — EB01-010 "There's No Way You Could Defeat Me!!" (event).
 *
 * Printed text (cards.json):
 *   "[Counter] K.O. up to 1 of your opponent's Characters with 6000 base
 *    power or less."
 *
 * 5-axis: clause on_play / action removal_ko / target opp_character with
 *   filter basePowerMax:6000.
 *
 * Engine gap (logged in BUGS_FOUND.md under EB01-010): same as EB01-009 Gap B —
 *   effect-only [Counter] event not enumerated in legality.ts counterActions
 *   (requires counterEventBoost > 0). Card unplayable in counter window today.
 *
 * Test dispatches via `EffectDispatcher.dispatch` on a synthesized event
 * source instance (Rule 3 — behavioral, not handler-direct).
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

const VANILLA_LEADER: LeaderCard = {
  id: 'TEST_LEADER_EB010',
  name: 'TEST',
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

function oppChar(id: string, basePower: number): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['red'],
    cost: 3,
    power: basePower,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe("EB01-010 — There's No Way You Could Defeat Me!! (event)", () => {
  const allCards = loadCards();
  const ev = allCards.find((c) => c.id === 'EB01-010');
  if (ev === undefined) throw new Error('EB01-010 not in cards.json');
  if (ev.kind !== 'event') throw new Error('EB01-010 should be an event');
  const eventCard = ev as EventCard;

  function attachEventSource(state: import('../../state/types.js').GameState): string {
    state.cardLibrary[eventCard.id] = eventCard;
    const inst = makeInst(eventCard.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('KOs a 6000-base opp char (boundary inclusive)', () => {
    const c = oppChar('TEST_KO_6000', 6000);
    const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [c] });
    const cId = fieldB[0]!.instanceId;
    const srcId = attachEventSource(state);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === cId)).toBe(false);
    expect(next.players.B.trash).toContain(cId);
  });

  it('KOs a 4000-base opp char (well below cap)', () => {
    const c = oppChar('TEST_KO_4000', 4000);
    const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [c] });
    const cId = fieldB[0]!.instanceId;
    const srcId = attachEventSource(state);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === cId)).toBe(false);
    expect(next.players.B.trash).toContain(cId);
  });

  it('does NOT KO a 7000-base opp char (above cap — boundary exclusive)', () => {
    const c = oppChar('TEST_NOKO_7000', 7000);
    const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [c] });
    const cId = fieldB[0]!.instanceId;
    const srcId = attachEventSource(state);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.B.field.some((i) => i.instanceId === cId)).toBe(true);
    expect(next.players.B.trash).not.toContain(cId);
  });

  it('no opp char on field → no state change (target resolver returns empty, clause skipped)', () => {
    const { state } = buildState({ leaderA: VANILLA_LEADER });
    const srcId = attachEventSource(state);
    const trashBefore = state.players.B.trash.length;
    const fieldBefore = state.players.B.field.length;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.B.field.length).toBe(fieldBefore);
    expect(next.players.B.trash.length).toBe(trashBefore);
  });

  it('mixed field: KOs the ≤6000 target; leaves the >6000 target', () => {
    const small = oppChar('TEST_MIX_SMALL', 5000);
    const big = oppChar('TEST_MIX_BIG', 8000);
    const { state, fieldB } = buildState({ leaderA: VANILLA_LEADER, charsB: [small, big] });
    const smallId = fieldB[0]!.instanceId;
    const bigId = fieldB[1]!.instanceId;
    const srcId = attachEventSource(state);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    // Up to 1 → at most one KO. V0 deterministic picks the first match (smaller).
    expect(next.players.B.field.some((i) => i.instanceId === smallId)).toBe(false);
    expect(next.players.B.trash).toContain(smallId);
    expect(next.players.B.field.some((i) => i.instanceId === bigId)).toBe(true);
  });
});
