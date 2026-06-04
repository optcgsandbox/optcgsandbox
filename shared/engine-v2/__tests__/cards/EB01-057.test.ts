/**
 * Per-card semantic test — EB01-057 Shirahoshi (character).
 * "When this Character is K.O.'d by your opponent's effect, add up to 1
 *  card from the top of your deck to the top of your Life cards.
 *  [Blocker] ..."
 * Spec: on_ko / if_self_kod_by_opp_effect / add_to_own_life_top from:top_of_deck faceUp:false
 *       + continuous grant blocker.
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
  id: 'TEST_L_EB057', name: 'L', kind: 'leader', colors: ['yellow'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

describe('EB01-057 — Shirahoshi', () => {
  const c = loadCards().find((x) => x.id === 'EB01-057');
  if (c === undefined || c.kind !== 'character') throw new Error('EB01-057 invalid');
  const sh = c as CharacterCard;
  const clause = sh.effectSpecV2!.clauses![0]!;

  it('clause shape: on_ko / if_self_kod_by_opp_effect / add_to_own_life_top from:top_of_deck faceUp:false', () => {
    expect(clause.trigger).toBe('on_ko');
    expect(clause.condition!.type).toBe('if_self_kod_by_opp_effect');
    expect(clause.action.kind).toBe('add_to_own_life_top');
    expect((clause.action as { from: string; faceUp: boolean }).from).toBe('top_of_deck');
    expect((clause.action as { from: string; faceUp: boolean }).faceUp).toBe(false);
  });

  it('continuous grants blocker', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sh] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
  });

  it('on_ko by opp effect: top of deck added to life face-down', () => {
    const deckCardId = 'TEST_DECK_57';
    const deckInst = makeInst('__VANILLA', 'A');
    deckInst.instanceId = deckCardId;
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sh] });
    state.instances[deckCardId] = deckInst;
    state.players.A.deck.unshift(deckCardId);
    const shId = fieldA[0]!.instanceId;
    // Mark Shirahoshi as KO'd by opp effect via koSourceStack.
    state.koSourceStack.push({ instanceId: shId, source: 'opp_effect' });
    const lifeBefore = state.players.A.life.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: shId, controller: 'A' }, 'on_ko',
    );
    expect(next.players.A.life.length).toBe(lifeBefore + 1);
    expect(next.players.A.life[0]).toBe(deckCardId);
    // faceUp:false → the new life entry is face-down (not in lifeFaceUp map).
    expect(next.players.A.lifeFaceUp[deckCardId] ?? false).toBe(false);
  });

  it('on_ko by non-opp source (e.g. battle): does NOT add to life (condition false)', () => {
    const deckCardId = 'TEST_DECK_57_B';
    const deckInst = makeInst('__VANILLA', 'A');
    deckInst.instanceId = deckCardId;
    const { state, fieldA } = buildState({ leaderA: L, charsA: [sh] });
    state.instances[deckCardId] = deckInst;
    state.players.A.deck.unshift(deckCardId);
    const shId = fieldA[0]!.instanceId;
    // Battle KO — different source.
    state.koSourceStack.push({ instanceId: shId, source: 'battle' });
    const lifeBefore = state.players.A.life.length;
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: shId, controller: 'A' }, 'on_ko',
    );
    expect(next.players.A.life.length).toBe(lifeBefore);
  });
});
