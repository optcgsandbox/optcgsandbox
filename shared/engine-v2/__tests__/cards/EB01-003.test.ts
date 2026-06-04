/**
 * Per-card semantic test — EB01-003 Kid & Killer (character).
 *
 * Printed text (cards.json):
 *   "[Rush] (This card can attack on the turn in which it is played.)
 *    [When Attacking] If your opponent has 2 or less Life cards, this
 *    Character gains +2000 power during this turn."
 *
 * 5-axis audit (per TASK_PHASE4_PER_CARD.md):
 *   Continuous → grant_keyword_to_self 'rush' (encodes [Rush]).
 *   Clause when_attacking → condition if_opp_life_max n:2; action
 *     power_buff +2000 duration this_turn; target self.
 *
 * All 5 primitives registered (when_attacking trigger, if_opp_life_max
 * condition, power_buff action, grant_keyword_to_self continuous,
 * self target). No spec gap. No engine gap.
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
import { PhaseScheduler } from '../../phases/PhaseScheduler.js';
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
  id: 'TEST_LEADER_EB003',
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

describe('EB01-003 — Kid & Killer (character)', () => {
  const allCards = loadCards();
  const eb01_003 = allCards.find((c) => c.id === 'EB01-003');
  if (eb01_003 === undefined) throw new Error('EB01-003 not in cards.json');
  if (eb01_003.kind !== 'character') throw new Error('EB01-003 should be a character');
  const kk = eb01_003 as CharacterCard;

  describe('continuous — [Rush] keyword grant', () => {
    it('grantedKeywordsContinuous includes rush after refold', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [kk] });
      const next = ContinuousManager.refold(state);
      expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('rush');
    });

    it('refold idempotence — rush stays granted after a second fold', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [kk] });
      const once = ContinuousManager.refold(state);
      const twice = ContinuousManager.refold(once);
      expect(twice.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('rush');
    });
  });

  describe('clause [When Attacking] — opp life ≤ 2 grants +2000 power this_turn', () => {
    function opponentLifeOf(n: number): string[] {
      // Use placeholder instance IDs for life slots. The condition only
      // checks the array length.
      return Array.from({ length: n }, (_, i) => `life-placeholder-${i}`);
    }

    it('+2000 power when opp life = 2 (boundary, inclusive)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [kk] });
      const kkId = fieldA[0]!.instanceId;
      state.players.B.life = opponentLifeOf(2);
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: kkId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[kkId]!.powerModifierOneShot).toBe(2000);
      expect(next.instances[kkId]!.powerModifierExpiresInTurns).toBe(0);
    });

    it('+2000 power when opp life = 0 (well below threshold)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [kk] });
      const kkId = fieldA[0]!.instanceId;
      state.players.B.life = [];
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: kkId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[kkId]!.powerModifierOneShot).toBe(2000);
    });

    it('+2000 power when opp life = 1', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [kk] });
      const kkId = fieldA[0]!.instanceId;
      state.players.B.life = opponentLifeOf(1);
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: kkId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[kkId]!.powerModifierOneShot).toBe(2000);
    });

    it('NO buff when opp life = 3 (just above threshold)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [kk] });
      const kkId = fieldA[0]!.instanceId;
      state.players.B.life = opponentLifeOf(3);
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: kkId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[kkId]!.powerModifierOneShot ?? 0).toBe(0);
    });

    it('NO buff when opp life = 5 (typical mid-game)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [kk] });
      const kkId = fieldA[0]!.instanceId;
      state.players.B.life = opponentLifeOf(5);
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: kkId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[kkId]!.powerModifierOneShot ?? 0).toBe(0);
    });

    it('+2000 buff clears after end of active player\'s turn (this_turn duration)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [kk] });
      const kkId = fieldA[0]!.instanceId;
      state.players.B.life = [];
      let next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: kkId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[kkId]!.powerModifierOneShot).toBe(2000);
      next = PhaseScheduler.enterEnd(next);
      expect(next.instances[kkId]!.powerModifierOneShot).toBeUndefined();
    });
  });
});
