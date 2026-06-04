/**
 * Per-card semantic test — EB02-012 Gaimon (character).
 * "If you have a [Sarfunkel], this Character gains [Blocker]."
 * Spec: continuous if_owned_other_with_name 'Sarfunkel' / grant_keyword_to_self blocker.
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
  id: 'TEST_L_EB02012', name: 'L', kind: 'leader', colors: ['green'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function sarfunkel(): CharacterCard {
  return {
    id: 'TEST_SARFUNKEL', name: 'Sarfunkel', kind: 'character', colors: ['green'],
    cost: 2, power: 1000, counterValue: 1000, traits: ['East Blue'], keywords: [], effectTags: [],
  };
}

function vanillaOther(): CharacterCard {
  return {
    id: 'TEST_VANILLA_NS', name: 'NotSarfunkel', kind: 'character', colors: ['green'],
    cost: 2, power: 2000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-012 — Gaimon', () => {
  const c = loadCards().find((x) => x.id === 'EB02-012');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-012 invalid');
  const gai = c as CharacterCard;
  const cont = gai.effectSpecV2!.continuous![0]!;

  it('shape: continuous if_owned_other_with_name Sarfunkel / grant_keyword_to_self blocker', () => {
    expect((cont.condition as { name: string }).name).toBe('Sarfunkel');
    expect(cont.action.kind).toBe('grant_keyword_to_self');
    expect((cont.action as { keyword: string }).keyword).toBe('blocker');
  });

  it('with Sarfunkel on field: Gaimon gets blocker', () => {
    const sa = sarfunkel();
    const { state, fieldA } = buildState({ leaderA: L, charsA: [gai, sa] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
  });

  it('without Sarfunkel: no blocker', () => {
    const v = vanillaOther();
    const { state, fieldA } = buildState({ leaderA: L, charsA: [gai, v] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).not.toContain('blocker');
  });
});
