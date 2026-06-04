/**
 * Per-card semantic test — EB01-052 Viola (character).
 *
 * Printed text (cards.json):
 *   "[Blocker] ... [On Play] Choose one:
 *    • Look at all of your opponent's Life cards and place them back in
 *      their Life area in any order.
 *    • Turn all of your Life cards face-down."
 *
 * 5-axis:
 *   • Continuous: grant_keyword_to_self 'blocker'.
 *   • Clause on_play: choose_one with two options
 *     (peek_and_reorder_opp_life, turn_all_own_life_face_down).
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
import { applyAction } from '../../reducers/applyAction.js';
import { registerAllHandlers } from '../../registry/handlers/index.js';
import { registerAllReducers } from '../../reducers/index.js';
import { actionHandlers } from '../../registry/types.js';

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
  id: 'TEST_L_EB052', name: 'L', kind: 'leader', colors: ['yellow'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

describe('EB01-052 — Viola', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-052');
  if (eb === undefined || eb.kind !== 'character') throw new Error('EB01-052 invalid');
  const viola = eb as CharacterCard;
  const clause = viola.effectSpecV2!.clauses![0]!;

  it('spec shape: on_play / choose_one with two options', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('choose_one');
    const a = clause.action as { options: ReadonlyArray<{ action: { kind: string } }> };
    expect(a.options.map((o) => o.action.kind)).toEqual([
      'peek_and_reorder_opp_life',
      'turn_all_own_life_face_down',
    ]);
  });

  it('continuous grants blocker keyword', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [viola] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
  });

  it('choose_one + both sub-actions registered', () => {
    expect(actionHandlers.has('choose_one')).toBe(true);
    expect(actionHandlers.has('peek_and_reorder_opp_life')).toBe(true);
    expect(actionHandlers.has('turn_all_own_life_face_down')).toBe(true);
  });

  it('on_play dispatch suspends engine in choose_one phase with both options', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [viola] });
    void makeInst;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_play',
    );
    expect(next.pending).not.toBeNull();
    expect(next.pending!.kind).toBe('choose_one');
    expect(next.phase).toBe('choose_one');
    const pc = (next.pending as { pendingChoose: { options: ReadonlyArray<{ action: { kind: string } }> } }).pendingChoose;
    expect(pc.options.map((o) => o.action.kind)).toEqual([
      'peek_and_reorder_opp_life',
      'turn_all_own_life_face_down',
    ]);
  });

  it('RESOLVE_CHOOSE_ONE option 0: fires peek_and_reorder_opp_life (exposes opp life top to A.knownByViewer)', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [viola] });
    // Seed a single opp life instance.
    const oppLifeId = 'B-LIFE-0';
    state.instances[oppLifeId] = {
      instanceId: oppLifeId,
      cardId: '__VANILLA',
      controller: 'B',
      rested: false,
      summoningSick: false,
      attachedDon: [],
      attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    state.players.B.life.push(oppLifeId);
    const afterDispatch = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_play',
    );
    const result = applyAction(afterDispatch, 'A', { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 } as never);
    const resolved = result.state;
    // Pending cleared.
    expect(resolved.pending).toBeNull();
    // knownByViewer.A now includes the opp life entry (peek_and_reorder_opp_life exposes it).
    expect(resolved.knownByViewer.A).toContain(oppLifeId);
  });

  it('RESOLVE_CHOOSE_ONE option 1: fires turn_all_own_life_face_down (lifeFaceUp all true)', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [viola] });
    // Seed 2 own life entries, both face-up initially.
    for (let i = 0; i < 2; i++) {
      const id = `A-LIFE-${i}`;
      state.instances[id] = {
        instanceId: id,
        cardId: '__VANILLA',
        controller: 'A',
        rested: false,
        summoningSick: false,
        attachedDon: [],
        attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      state.players.A.life.push(id);
      state.players.A.lifeFaceUp[id] = true;
    }
    const afterDispatch = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
      'on_play',
    );
    const result = applyAction(afterDispatch, 'A', { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 1 } as never);
    const resolved = result.state;
    expect(resolved.pending).toBeNull();
    // All life entries face-DOWN now.
    for (const id of resolved.players.A.life) {
      expect(resolved.players.A.lifeFaceUp[id] ?? false).toBe(false);
    }
  });
});
