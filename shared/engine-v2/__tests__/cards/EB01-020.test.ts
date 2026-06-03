/**
 * Per-card semantic test — EB01-020 Chambres ([Main] event).
 *
 * Printed text (cards.json):
 *   "[Main] If your Leader has the {Supernovas} type, return 1 of your
 *    Characters to the owner's hand, and play up to 1 Character card with
 *    a cost of 2 or less from your hand that is a different color than the
 *    returned Character."
 *
 * 5-axis: one on_play clause, condition if_leader_has_trait 'Supernovas',
 *   action sequence [removal_bounce, play_for_free filter{costMax:2,
 *   kind:'character'} colorMustDifferFromLastBounced:true], target
 *   your_character.
 *
 * Known engine gap (logged under EB01-013): play_for_free inside a
 * sequence doesn't iterate over hand to resolve its own filter — it expects
 * targets passed from outside the sequence. Chambres re-exhibits.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card, CharacterCard, EventCard, LeaderCard } from '../../cards/Card.js';
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

const SUPERNOVAS_LEADER: LeaderCard = {
  id: 'TEST_SN_LEADER',
  name: 'TEST',
  kind: 'leader',
  colors: ['green'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Supernovas'],
  keywords: [],
  effectTags: [],
};

const NON_SN_LEADER: LeaderCard = {
  id: 'TEST_NONSN_LEADER',
  name: 'TEST',
  kind: 'leader',
  colors: ['green'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: ['Other'],
  keywords: [],
  effectTags: [],
};

function character(id: string, color: string, cost: number): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: [color as 'green'],
    cost,
    power: 3000,
    counterValue: 1000,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-020 — Chambres ([Main] event)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-020');
  if (eb === undefined) throw new Error('EB01-020 not in cards.json');
  if (eb.kind !== 'event') throw new Error('EB01-020 should be an event');
  const chambres = eb as EventCard;

  function attachEventSource(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[chambres.id] = chambres;
    const inst = makeInst(chambres.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('spec is one on_play clause with sequence action [removal_bounce, play_for_free]', () => {
    expect(chambres.effectSpecV2!.clauses).toHaveLength(1);
    const c = chambres.effectSpecV2!.clauses![0]!;
    expect(c.trigger).toBe('on_play');
    expect(c.action.kind).toBe('sequence');
    const seq = c.action as { actions: ReadonlyArray<{ kind: string }> };
    expect(seq.actions.map((a) => a.kind)).toEqual(['removal_bounce', 'play_for_free']);
  });

  it('condition is if_leader_has_trait Supernovas', () => {
    const c = chambres.effectSpecV2!.clauses![0]!;
    expect(c.condition!.type).toBe('if_leader_has_trait');
    expect((c.condition as { trait: string }).trait).toBe('Supernovas');
  });

  it('play_for_free filter uses BindingRef on colors (ne returned_card.colors) + costMax:2 + kind:character', () => {
    const c = chambres.effectSpecV2!.clauses![0]!;
    const seq = c.action as { actions: ReadonlyArray<Record<string, unknown>> };
    const playForFree = seq.actions[1]!;
    const filter = playForFree['filter'] as {
      costMax: number;
      kind: string;
      colors: { kind: string; name: string; field: string; op: string };
    };
    expect(filter.costMax).toBe(2);
    expect(filter.kind).toBe('character');
    // Cross-step binding: filter.colors is a BindingRef to the returned card's colors with negation.
    expect(filter.colors.kind).toBe('binding');
    expect(filter.colors.name).toBe('returned_card');
    expect(filter.colors.field).toBe('colors');
    expect(filter.colors.op).toBe('ne');
  });

  it('target is your_character with bind:returned_card', () => {
    const c = chambres.effectSpecV2!.clauses![0]!;
    expect(c.target!.kind).toBe('your_character');
    expect((c.target as { bind?: string }).bind).toBe('returned_card');
  });

  describe('condition gate', () => {
    it('NO bounce when leader lacks Supernovas trait (condition false)', () => {
      const own = character('TEST_OWN_GREEN', 'green', 2);
      const { state, fieldA } = buildState({ leaderA: NON_SN_LEADER, charsA: [own] });
      const srcId = attachEventSource(state);
      const ownInstId = fieldA[0]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: srcId, controller: 'A' },
        'on_play',
      );
      // Char must still be on field.
      expect(next.players.A.field.some((i) => i.instanceId === ownInstId)).toBe(true);
    });

    it('removal_bounce history event fires when leader has Supernovas trait', () => {
      const own = character('TEST_OWN_GREEN_2', 'green', 2);
      const { state, fieldA } = buildState({ leaderA: SUPERNOVAS_LEADER, charsA: [own] });
      const srcId = attachEventSource(state);
      const ownInstId = fieldA[0]!.instanceId;
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: srcId, controller: 'A' },
        'on_play',
      );
      // The bounce event fires (history has CARD_BOUNCED), proving the
      // condition + target resolution work. Final field state is governed
      // by the subsequent play_for_free sub-action — see it.fails below.
      const bouncedEvents = next.history.filter(
        (e) => (e as { type?: string; instanceId?: string }).type === 'CARD_BOUNCED'
          && (e as { instanceId?: string }).instanceId === ownInstId,
      );
      expect(bouncedEvents.length).toBeGreaterThan(0);
    });

    it.fails(
      'net effect = char stays bounced (engine gap — BUGS_FOUND.md EB01-020 play_for_free at actions2.ts:211-265 reuses parent targets + ignores colorMustDifferFromLastBounced; replays the bounced char)',
      () => {
        const own = character('TEST_OWN_GREEN_3', 'green', 2);
        const { state, fieldA } = buildState({ leaderA: SUPERNOVAS_LEADER, charsA: [own] });
        const srcId = attachEventSource(state);
        const ownInstId = fieldA[0]!.instanceId;
        const next = EffectDispatcher.dispatch(
          state,
          { sourceInstanceId: srcId, controller: 'A' },
          'on_play',
        );
        // Printed: the bounced char should remain in hand because the only
        // play_for_free candidate fails the colorMustDifferFromLastBounced
        // filter. Today the engine re-plays it.
        expect(next.players.A.field.some((i) => i.instanceId === ownInstId)).toBe(false);
        expect(next.players.A.hand).toContain(ownInstId);
      },
    );
  });
});
