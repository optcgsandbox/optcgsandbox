/**
 * Per-card semantic test — EB01-027 Mr.1 (Daz.Bonez) (character).
 *
 * Printed text (cards.json):
 *   "If your Leader's type includes "Baroque Works", this Character gains
 *    +1000 power for every 2 Events in your trash.
 *    [On Play] Draw 2 cards and trash 1 card from your hand."
 *
 * 5-axis:
 *   • Continuous: condition if_leader_has_type 'Baroque Works', action
 *     self_power_buff with magnitude {per_count, own_trash_event_count, /2, *1000}.
 *   • Clause on_play: sequence [draw 2, discard_from_hand 1].
 *
 * Known engine gap (EB01-014): continuous handlers' readMagnitude returns
 * 0 for formula magnitudes — the +1000-per-2-events buff is 0 today. The
 * continuous-buff test is marked it.fails; the on_play sequence works.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, EventCard, LeaderCard } from '../../cards/Card.js';
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

const BW_LEADER: LeaderCard = {
  id: 'TEST_BW_LEADER',
  name: 'TEST',
  kind: 'leader',
  colors: ['blue'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Baroque Works'],
  keywords: [],
  effectTags: [],
};

const NON_BW_LEADER: LeaderCard = {
  id: 'TEST_NONBW_LEADER',
  name: 'TEST',
  kind: 'leader',
  colors: ['blue'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Other'],
  keywords: [],
  effectTags: [],
};

function fillerEvent(id: string): EventCard {
  return {
    id,
    name: id,
    kind: 'event',
    colors: ['blue'],
    cost: 1,
    power: null,
    counterValue: null,
    traits: [],
    keywords: [],
    effectTags: [],
    counterEventBoost: null,
  };
}

function fillerCharacter(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['blue'],
    cost: 1,
    power: 1000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-027 — Mr.1 (Daz.Bonez) (character)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-027');
  if (eb === undefined) throw new Error('EB01-027 not in cards.json');
  if (eb.kind !== 'character') throw new Error('EB01-027 should be a character');
  const daz = eb as CharacterCard;
  const clause = daz.effectSpecV2?.clauses?.[0];
  const cont = daz.effectSpecV2?.continuous?.[0];
  if (clause === undefined || cont === undefined) throw new Error('EB01-027 missing clause/continuous');

  it('clause shape: on_play / sequence [draw 2, discard_from_hand 1]', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.action.kind).toBe('sequence');
    const seq = clause.action as { actions: ReadonlyArray<{ kind: string; magnitude?: number }> };
    expect(seq.actions[0]!.kind).toBe('draw');
    expect(seq.actions[0]!.magnitude).toBe(2);
    expect(seq.actions[1]!.kind).toBe('discard_from_hand');
    expect(seq.actions[1]!.magnitude).toBe(1);
  });

  it('continuous shape: if_leader_has_type Baroque Works / self_power_buff per_count own_trash_event_count /2 *1000', () => {
    expect(cont.condition!.type).toBe('if_leader_has_type');
    expect((cont.condition as { typeString: string }).typeString).toBe('Baroque Works');
    expect(cont.action.kind).toBe('self_power_buff');
    const mag = (cont.action as { magnitude: { kind: string; countSource: string; divisor: number; perUnit: number } }).magnitude;
    expect(mag.kind).toBe('per_count');
    expect(mag.countSource).toBe('own_trash_event_count');
    expect(mag.divisor).toBe(2);
    expect(mag.perUnit).toBe(1000);
  });

  describe('on_play sequence', () => {
    it('draws 2 + nets -1 from hand (discard 1) — net hand +1', () => {
      const d1 = fillerCharacter('TEST_D1');
      const d2 = fillerCharacter('TEST_D2');
      const handStart = fillerCharacter('TEST_HND_KEEP');
      const { state, fieldA } = buildState({
        leaderA: BW_LEADER,
        charsA: [daz],
        handA: [handStart],
      });
      // Seed deck with two draw targets.
      for (const card of [d1, d2]) {
        state.cardLibrary[card.id] = card;
        const inst = makeInst(card.id, 'A');
        state.instances[inst.instanceId] = inst;
        state.players.A.deck.push(inst.instanceId);
      }
      const handBefore = state.players.A.hand.length;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' },
        'on_play',
      );
      expect(next.players.A.hand.length).toBe(handBefore + 1);
      expect(next.players.A.trash.length).toBe(1);
    });
  });

  describe('continuous per_count formula', () => {
    it('NO buff when leader lacks Baroque Works trait (condition false)', () => {
      const evA = fillerEvent('TEST_EV_A');
      const evB = fillerEvent('TEST_EV_B');
      const { state, fieldA } = buildState({ leaderA: NON_BW_LEADER, charsA: [daz] });
      for (const ev of [evA, evB]) {
        state.cardLibrary[ev.id] = ev;
        const inst = makeInst(ev.id, 'A');
        state.instances[inst.instanceId] = inst;
        state.players.A.trash.push(inst.instanceId);
      }
      const next = ContinuousManager.refold(state);
      expect(next.instances[fieldA[0]!.instanceId]!.powerModifierContinuous ?? 0).toBe(0);
    });

    it(
      '+1000 power per 2 events in trash when leader has Baroque Works (closes cluster-C engine gap)',
      () => {
        const evA = fillerEvent('TEST_EV_A2');
        const evB = fillerEvent('TEST_EV_B2');
        const { state, fieldA } = buildState({ leaderA: BW_LEADER, charsA: [daz] });
        for (const ev of [evA, evB]) {
          state.cardLibrary[ev.id] = ev;
          const inst = makeInst(ev.id, 'A');
          state.instances[inst.instanceId] = inst;
          state.players.A.trash.push(inst.instanceId);
        }
        const next = ContinuousManager.refold(state);
        expect(next.instances[fieldA[0]!.instanceId]!.powerModifierContinuous).toBe(1000);
      },
    );
  });
});
