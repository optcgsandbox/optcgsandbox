/**
 * Per-card semantic test — EB02-033 Klabautermann (character).
 * "If you have [Merry Go] on your field, this Character gains [Blocker]."
 * Spec: continuous if_owned_other_with_name Merry Go / grant_keyword_to_self blocker.
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

const L: LeaderCard = {
  id: 'TEST_L_EB02033', name: 'L', kind: 'leader', colors: ['purple'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function merryGoStage(): CharacterCard {
  return {
    id: 'TEST_MERRY_GO', name: 'Merry Go', kind: 'character', colors: ['purple'],
    cost: 2, power: 2000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-033 — Klabautermann', () => {
  const c = loadCards().find((x) => x.id === 'EB02-033');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-033 invalid');
  const kl = c as CharacterCard;
  const cont = kl.effectSpecV2!.continuous![0]!;

  it('shape: if_owned_other_with_name Merry Go / grant blocker', () => {
    expect((cont.condition as { name: string }).name).toBe('Merry Go');
    expect(cont.action.kind).toBe('grant_keyword_to_self');
    expect((cont.action as { keyword: string }).keyword).toBe('blocker');
  });

  it('with Merry Go on field: Klabautermann gets blocker', () => {
    const mg = merryGoStage();
    const { state, fieldA } = buildState({ leaderA: L, charsA: [kl, mg] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
  });

  it('without Merry Go: no blocker', () => {
    const other: CharacterCard = {
      id: 'TEST_NOT_MERRY_E33', name: 'NotMerryGo', kind: 'character', colors: ['purple'],
      cost: 2, power: 2000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    const { state, fieldA } = buildState({ leaderA: L, charsA: [kl, other] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).not.toContain('blocker');
  });
});
