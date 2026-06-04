/**
 * Per-card semantic test — EB01-042 Scarlet (character).
 *
 * Printed text (cards.json):
 *   "[Activate: Main] You may trash this Character: Play up to 1 {Dressrosa}
 *    type Character card with a cost of 3 or less other than [Scarlet] from
 *    your hand rested. Then, give up to 1 of your opponent's Characters −2
 *    cost during this turn."
 *
 * 5-axis: clause activate_main / cost trashSelf:true /
 *   action sequence [play_for_free filter{Dressrosa,costMax:3,nameExcludes:Scarlet,kind:character} rested:true,
 *                     removal_cost_reduce magnitude:2 duration:this_turn] /
 *   target opp_character.
 *
 * Engine gap (re-ref EB01-013/020/033): play_for_free in sequence iterates
 *   the parent clause's resolved targets — which here are the opp_character
 *   (a foreign char, not the Dressrosa hand card). The play_for_free filter
 *   on the action is ignored. Same root cause; logged.
 *
 * removal_cost_reduce DOES correctly receive the opp_character target, so
 * the second half of the sequence works as printed.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, LeaderCard } from '../../cards/Card.js';
import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
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
  id: 'TEST_LEADER_EB042',
  name: 'TEST',
  kind: 'leader',
  colors: ['black'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

function oppChar(id: string, cost: number): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['black'],
    cost,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-042 — Scarlet (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-042');
  if (eb === undefined) throw new Error('EB01-042 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-042 should be a character');
  const scar = eb as CharacterCard;
  const clause = scar.effectSpecV2?.clauses?.[0];
  if (clause === undefined) throw new Error('EB01-042 missing clause');

  it('clause shape: activate_main / trashSelf / sequence [play_for_free, removal_cost_reduce] / opp_character', () => {
    expect(clause.trigger).toBe('activate_main');
    expect(clause.cost!['trashSelf']).toBe(true);
    expect(clause.action.kind).toBe('sequence');
    const seq = clause.action as { actions: ReadonlyArray<{ kind: string }> };
    expect(seq.actions.map((a) => a.kind)).toEqual(['play_for_free', 'removal_cost_reduce']);
    expect(clause.target!.kind).toBe('opp_character');
  });

  it('removal_cost_reduce sub-action carries magnitude:2 duration:this_turn', () => {
    const seq = clause.action as { actions: ReadonlyArray<Record<string, unknown>> };
    const rcr = seq.actions[1]!;
    expect(rcr['magnitude']).toBe(2);
    expect(rcr['duration']).toBe('this_turn');
  });

  it('Scarlet trashes herself + opp char gets cost-reduced by 2 this turn', () => {
    const opp = oppChar('TEST_OPP_REDUCE', 5);
    const { state, fieldA, fieldB } = buildState({
      leaderA: VANILLA_LEADER,
      charsA: [scar],
      charsB: [opp],
    });
    const sId = fieldA[0]!.instanceId;
    const oppId = fieldB[0]!.instanceId;
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: sId, controller: 'A' },
      'activate_main',
    );
    // Scarlet to trash (self-trash cost).
    expect(next.players.A.field.some((i) => i.instanceId === sId)).toBe(false);
    expect(next.players.A.trash).toContain(sId);
    // Opp char gets cost reduction (presence of any cost mod field).
    const oppInst = next.instances[oppId]!;
    const costMod = (oppInst.costModifierThisTurn ?? 0)
      + (oppInst.costModifierOneShot ?? 0)
      + (oppInst.costModifierContinuous ?? 0);
    expect(costMod).toBe(-2);
  });

  it(
    'play_for_free plays a Dressrosa cost-≤3 non-Scarlet char from hand rested',
    () => {
      const drsCandidate: CharacterCard = {
        id: 'TEST_DRS_HAND',
        name: 'Drs Hand',
        kind: 'character',
        colors: ['black'],
        cost: 3,
        power: 3000,
        counterValue: 1000,
        traits: ['Dressrosa'],
        keywords: [],
        effectTags: [],
      };
      const opp = oppChar('TEST_OPP_REDUCE_2', 5);
      const { state, fieldA, fieldB, handAInstances } = buildState({
        leaderA: VANILLA_LEADER,
        charsA: [scar],
        charsB: [opp],
        handA: [drsCandidate],
      });
      const sId = fieldA[0]!.instanceId;
      const drsHandId = handAInstances[0]!.instanceId;
      void fieldB;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: sId, controller: 'A' },
        'activate_main',
      );
      // Per printed text the Dressrosa hand char should now be on field rested.
      expect(next.players.A.field.some((i) => i.instanceId === drsHandId)).toBe(true);
      expect(next.instances[drsHandId]!.rested).toBe(true);
    },
  );
});
