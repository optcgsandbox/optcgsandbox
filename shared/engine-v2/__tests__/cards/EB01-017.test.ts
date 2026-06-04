/**
 * Per-card semantic test — EB01-017 Blueno (vanilla blocker).
 *
 * Printed text (cards.json):
 *   "[Blocker] (After your opponent declares an attack, you may rest this
 *    card to make it the new target of the attack.)"
 *
 * 5-axis: only the [Blocker] keyword via continuous grant_keyword_to_self.
 * No clauses, no replacements. All primitives registered. No spec gap.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { ContinuousManager } from '../../effects/ContinuousManager.js';
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
  id: 'TEST_LEADER_EB017',
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

describe('EB01-017 — Blueno (vanilla blocker)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-017');
  if (eb === undefined) throw new Error('EB01-017 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-017 should be a character');
  const blueno = eb as CharacterCard;

  it('continuous refold grants blocker keyword', () => {
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [blueno] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
  });

  it('spec has no clauses and no replacements (only the keyword grant)', () => {
    expect(blueno.effectSpecV2!.clauses ?? []).toHaveLength(0);
    expect(blueno.effectSpecV2!.replacements ?? []).toHaveLength(0);
  });

  it('refold idempotent — blocker stays granted after second fold', () => {
    const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [blueno] });
    const once = ContinuousManager.refold(state);
    const twice = ContinuousManager.refold(once);
    expect(twice.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
  });
});
