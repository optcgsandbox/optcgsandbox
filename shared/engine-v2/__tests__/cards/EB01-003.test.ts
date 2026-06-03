/**
 * Per-card semantic test — EB01-003 Kid & Killer (character).
 *
 * Printed text (cards.json):
 *   "[Rush] (This card can attack on the turn in which it is played.)
 *    [When Attacking] If your opponent has 2 or less Life cards, this
 *    Character gains +2000 power during this turn."
 *
 * Plan §5.2 per-card semantic layer.
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

describe('EB01-003 — Kid & Killer (character)', () => {
  const allCards = loadCards();
  const kk = allCards.find((c) => c.id === 'EB01-003');
  if (kk === undefined) throw new Error('EB01-003 not in cards.json');
  if (kk.kind !== 'character') throw new Error('EB01-003 should be a character');
  const kkChar = kk as CharacterCard;

  describe('continuous — grants Rush to self', () => {
    it('grantedKeywordsContinuous includes rush after refold', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [kkChar] });
      const folded = ContinuousManager.refold(state);
      const inst = folded.instances[fieldA[0]!.instanceId]!;
      expect(inst.grantedKeywordsContinuous ?? []).toContain('rush');
    });
  });

  describe('when_attacking — opp life ≤ 2 grants +2000 power', () => {
    it('dispatching when_attacking adds +2000 powerModifier (this_turn scope)', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [kkChar] });
      const attackerId = fieldA[0]!.instanceId;
      // Empty opp life so the condition "opp has ≤ 2 life" holds.
      state.players.B.life = [];
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: attackerId, controller: 'A' },
        'when_attacking',
      );
      const inst = next.instances[attackerId]!;
      // V2 power-buff split: this_turn duration writes to powerModifierOneShot
      // with expires=0 (cleared on endTurn). Confirm BOTH the buff applied AND
      // the scoping is correct.
      expect(inst.powerModifierOneShot ?? 0).toBe(2000);
      expect(inst.powerModifierExpiresInTurns).toBe(0);
    });

    it('does NOT apply +2000 when opp life is 3', () => {
      const { state, fieldA, leaderInstB } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [kkChar],
      });
      const attackerId = fieldA[0]!.instanceId;
      // Need 3 life cards on opp side. Use the leader instance ID 3 times as
      // life entries (life uses arbitrary instance IDs).
      state.players.B.life = [leaderInstB.instanceId, leaderInstB.instanceId, leaderInstB.instanceId];
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: attackerId, controller: 'A' },
        'when_attacking',
      );
      const inst = next.instances[attackerId]!;
      expect(inst.powerModifierOneShot ?? 0).toBe(0);
    });

    it('+2000 buff is cleared after the active player ends their turn', () => {
      const { state, fieldA } = buildState({ leaderA: VANILLA_LEADER, charsA: [kkChar] });
      const attackerId = fieldA[0]!.instanceId;
      state.players.B.life = [];
      // Apply the buff.
      let next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: attackerId, controller: 'A' },
        'when_attacking',
      );
      expect(next.instances[attackerId]!.powerModifierOneShot ?? 0).toBe(2000);
      // End turn: PhaseScheduler.enterEnd ticks OneShot expiresInTurns and
      // clears the modifier when it reaches zero.
      next = PhaseScheduler.enterEnd(next);
      expect(next.instances[attackerId]!.powerModifierOneShot).toBeUndefined();
    });
  });
});
