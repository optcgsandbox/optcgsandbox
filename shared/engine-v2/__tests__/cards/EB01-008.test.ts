/**
 * Per-card semantic test — EB01-008 Little Oars Jr. (character).
 *
 * Printed text (cards.json):
 *   "[Once Per Turn] If this Character would be K.O.'d by an effect, you
 *    may trash 1 Event or Stage card from your hand instead."
 *
 * Tests the would_be_ko replacement via ReplacementManager + the
 * trashFromHand cost path filtered to event/stage kind.
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

const EVENT_CARD: EventCard = {
  id: 'TEST_EVT_EB008',
  name: 'Some Event',
  kind: 'event',
  colors: ['red'],
  cost: 2,
  counterValue: null,
  traits: [],
  effectTags: [],
};

const STAGE_CARD: StageCard = {
  id: 'TEST_STG_EB008',
  name: 'Some Stage',
  kind: 'stage',
  colors: ['red'],
  cost: 1,
  counterValue: null,
  traits: [],
  effectTags: [],
};

const FILLER_CHAR: CharacterCard = {
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

describe('EB01-008 — Little Oars Jr.', () => {
  const allCards = loadCards();
  const loj = allCards.find((c) => c.id === 'EB01-008');
  if (loj === undefined) throw new Error('EB01-008 not in cards.json');
  if (loj.kind !== 'character') throw new Error('EB01-008 should be a character');
  const lojChar = loj as CharacterCard;

  it('KOs normally when only a Character is in hand (replacement cost unpayable)', () => {
    const { state, fieldA } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [lojChar],
      handA: [FILLER_CHAR],
    });
    const lojId = fieldA[0]!.instanceId;

    const removalKo = actionHandlers.get('removal_ko');
    const next = removalKo(
      state,
      { sourceInstanceId: 'killer', controller: 'B' },
      { kind: 'removal_ko' },
      [lojId],
    );
    // LOJ should be off the field + in trash.
    expect(next.players.A.field.find((i) => i.instanceId === lojId)).toBeUndefined();
    expect(next.players.A.trash).toContain(lojId);
  });

  it('survives KO when an Event in hand is discarded (replacement payable)', () => {
    const { state, fieldA, handAInstances } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [lojChar],
      handA: [EVENT_CARD],
    });
    const lojId = fieldA[0]!.instanceId;
    const eventInstId = handAInstances[0]!.instanceId;
    const trashBefore = state.players.A.trash.length;

    const removalKo = actionHandlers.get('removal_ko');
    const next = removalKo(
      state,
      { sourceInstanceId: 'killer', controller: 'B' },
      { kind: 'removal_ko' },
      [lojId],
    );
    expect(next.players.A.field.find((i) => i.instanceId === lojId)).toBeDefined();
    expect(next.players.A.hand).not.toContain(eventInstId);
    expect(next.players.A.trash.length).toBe(trashBefore + 1);
    expect(next.players.A.trash).toContain(eventInstId);
  });

  it('survives KO when a Stage in hand is discarded', () => {
    const { state, fieldA, handAInstances } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [lojChar],
      handA: [STAGE_CARD],
    });
    const lojId = fieldA[0]!.instanceId;
    const stageInstId = handAInstances[0]!.instanceId;

    const removalKo = actionHandlers.get('removal_ko');
    const next = removalKo(
      state,
      { sourceInstanceId: 'killer', controller: 'B' },
      { kind: 'removal_ko' },
      [lojId],
    );
    expect(next.players.A.field.find((i) => i.instanceId === lojId)).toBeDefined();
    expect(next.players.A.hand).not.toContain(stageInstId);
  });

  it('does NOT consume a character from hand as the cost', () => {
    const { state, fieldA, handAInstances } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [lojChar],
      handA: [FILLER_CHAR],
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
    // Character should NOT have been trashed (cost couldn't pay).
    expect(next.players.A.hand).toContain(charInstId);
  });
});
