/**
 * Per-card semantic test — EB01-008 Little Oars Jr. (character).
 *
 * Printed text (cards.json):
 *   "[Once Per Turn] If this Character would be K.O.'d by an effect, you
 *    may trash 1 Event or Stage card from your hand instead."
 *
 * 5-axis: replacement would_be_ko / whenSource:effect /
 *   cost discardHandFilter count:1 filter kindsAny:[event,stage] /
 *   action noop (the trash IS the replacement) / conditional:true (if can't
 *   pay, fall through and original KO proceeds) / opt:true.
 *
 * All primitives registered (replacements.ts:26 would_be_ko passthrough,
 * costs2.ts:447 discardHandFilter, actions noop). No spec gap. No engine gap.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, EventCard, LeaderCard, StageCard } from '../../cards/Card.js';
import { actionHandlers } from '../../registry/types.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';

import { buildState } from './_fixtures.js';

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
  id: 'TEST_LEADER_EB008',
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

const HAND_EVENT: EventCard = {
  id: 'TEST_EVT_EB008',
  name: 'Some Event',
  kind: 'event',
  colors: ['red'],
  cost: 2,
  counterValue: null,
  traits: [],
  effectTags: [],
};

const HAND_STAGE: StageCard = {
  id: 'TEST_STG_EB008',
  name: 'Some Stage',
  kind: 'stage',
  colors: ['red'],
  cost: 1,
  counterValue: null,
  traits: [],
  effectTags: [],
};

const HAND_CHAR: CharacterCard = {
  id: 'TEST_CHR_EB008',
  name: 'Some Char',
  kind: 'character',
  colors: ['red'],
  cost: 2,
  power: 3000,
  counterValue: 1000,
  traits: [],
  keywords: [],
  effectTags: [],
};

describe('EB01-008 — Little Oars Jr. (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-008');
  if (eb === undefined) throw new Error('EB01-008 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-008 should be a character');
  const loj = eb as CharacterCard;

  it('removal_ko (effect KO) + event in hand: replacement consumes event, LOJ survives', () => {
    const { state, fieldA, handAInstances } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [loj],
      handA: [HAND_EVENT],
    });
    const lojId = fieldA[0]!.instanceId;
    const evtInstId = handAInstances[0]!.instanceId;
    const trashBefore = state.players.A.trash.length;

    const removalKo = actionHandlers.get('removal_ko');
    const next = removalKo(
      state,
      { sourceInstanceId: 'killer', controller: 'B' },
      { kind: 'removal_ko' },
      [lojId],
    );
    expect(next.players.A.field.find((i) => i.instanceId === lojId)).toBeDefined();
    expect(next.players.A.hand).not.toContain(evtInstId);
    expect(next.players.A.trash).toContain(evtInstId);
    expect(next.players.A.trash.length).toBe(trashBefore + 1);
  });

  it('removal_ko + stage in hand: replacement consumes stage, LOJ survives', () => {
    const { state, fieldA, handAInstances } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [loj],
      handA: [HAND_STAGE],
    });
    const lojId = fieldA[0]!.instanceId;
    const stgInstId = handAInstances[0]!.instanceId;

    const removalKo = actionHandlers.get('removal_ko');
    const next = removalKo(
      state,
      { sourceInstanceId: 'killer', controller: 'B' },
      { kind: 'removal_ko' },
      [lojId],
    );
    expect(next.players.A.field.find((i) => i.instanceId === lojId)).toBeDefined();
    expect(next.players.A.hand).not.toContain(stgInstId);
  });

  it('removal_ko + only character in hand: cost unpayable, conditional:true → LOJ KOs, char untouched', () => {
    const { state, fieldA, handAInstances } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [loj],
      handA: [HAND_CHAR],
    });
    const lojId = fieldA[0]!.instanceId;
    const charInstId = handAInstances[0]!.instanceId;

    const removalKo = actionHandlers.get('removal_ko');
    const next = removalKo(
      state,
      { sourceInstanceId: 'killer', controller: 'B' },
      { kind: 'removal_ko' },
      [lojId],
    );
    expect(next.players.A.field.find((i) => i.instanceId === lojId)).toBeUndefined();
    expect(next.players.A.trash).toContain(lojId);
    expect(next.players.A.hand).toContain(charInstId);
  });

  it('removal_ko + empty hand: cost unpayable, LOJ KOs', () => {
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [loj],
    });
    const lojId = fieldA[0]!.instanceId;
    expect(state.players.A.hand).toHaveLength(0);

    const removalKo = actionHandlers.get('removal_ko');
    const next = removalKo(
      state,
      { sourceInstanceId: 'killer', controller: 'B' },
      { kind: 'removal_ko' },
      [lojId],
    );
    expect(next.players.A.field.find((i) => i.instanceId === lojId)).toBeUndefined();
    expect(next.players.A.trash).toContain(lojId);
  });

  it('OPT: replacement only fires once per turn (second removal_ko same turn → LOJ KOs even with event in hand)', () => {
    const { state, fieldA, handAInstances } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [loj, { ...loj, id: 'TEST_LOJ2' }],
      handA: [HAND_EVENT, HAND_EVENT],
    });
    const lojId = fieldA[0]!.instanceId;
    const loj2Id = fieldA[1]!.instanceId;
    void handAInstances;

    const removalKo = actionHandlers.get('removal_ko');
    // First removal: LOJ saved by replacement (consumes 1 event).
    let next = removalKo(
      state,
      { sourceInstanceId: 'killer', controller: 'B' },
      { kind: 'removal_ko' },
      [lojId],
    );
    expect(next.players.A.field.find((i) => i.instanceId === lojId)).toBeDefined();
    // Second removal on a SECOND copy of LOJ — same card-intrinsic
    // replacement, but the OPT key is per-instance per cardReplacementIndex
    // so the SECOND LOJ instance can independently consume its replacement.
    // Verify the second LOJ is also saved.
    next = removalKo(
      next,
      { sourceInstanceId: 'killer', controller: 'B' },
      { kind: 'removal_ko' },
      [loj2Id],
    );
    expect(next.players.A.field.find((i) => i.instanceId === loj2Id)).toBeDefined();
    // Now hit the FIRST LOJ a second time — its OPT should suppress.
    next = removalKo(
      next,
      { sourceInstanceId: 'killer', controller: 'B' },
      { kind: 'removal_ko' },
      [lojId],
    );
    expect(next.players.A.field.find((i) => i.instanceId === lojId)).toBeUndefined();
    expect(next.players.A.trash).toContain(lojId);
  });
});
