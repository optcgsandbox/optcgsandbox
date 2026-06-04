/**
 * Per-card semantic test — EB02-023 Crocodile (character).
 * "[Your Turn] [Once Per Turn] When your opponent's Character is returned
 *  to the owner's hand by your effect, look at 3 cards from the top of
 *  your deck and place them at the top or bottom of the deck in any order."
 * Spec: on_opp_char_bounce_by_me / is_own_turn / peek_and_reorder_own_deck count:3 / opt:true.
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
  id: 'TEST_L_EB02023', name: 'L', kind: 'leader', colors: ['blue'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function deckChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['blue'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-023 — Crocodile', () => {
  const c = loadCards().find((x) => x.id === 'EB02-023');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-023 invalid');
  const croc = c as CharacterCard;
  const clause = croc.effectSpecV2!.clauses![0]!;

  function seedDeck(state: ReturnType<typeof buildState>['state'], cards: CharacterCard[]): string[] {
    const ids: string[] = [];
    for (const card of cards) {
      state.cardLibrary[card.id] = card;
      const inst = makeInst(card.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.deck.push(inst.instanceId);
      ids.push(inst.instanceId);
    }
    return ids;
  }

  it('shape: on_opp_char_bounce_by_me / is_own_turn / peek_and_reorder_own_deck count:3 / opt:true', () => {
    expect(clause.trigger).toBe('on_opp_char_bounce_by_me');
    expect((clause.condition as { type: string }).type).toBe('is_own_turn');
    expect(clause.action.kind).toBe('peek_and_reorder_own_deck');
    expect((clause.action as { count: number }).count).toBe(3);
    expect(clause.opt).toBe(true);
  });

  it('own turn + trigger fires: top 3 deck ids exposed to A', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [croc] });
    const ids = seedDeck(state, [
      deckChar('TEST_D1_E23'), deckChar('TEST_D2_E23'),
      deckChar('TEST_D3_E23'), deckChar('TEST_D4_E23'),
    ]);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_opp_char_bounce_by_me',
    );
    expect(next.knownByViewer.A).toContain(ids[0]!);
    expect(next.knownByViewer.A).toContain(ids[1]!);
    expect(next.knownByViewer.A).toContain(ids[2]!);
    expect(next.knownByViewer.A).not.toContain(ids[3]!);
  });

  it("opp's turn: is_own_turn fails → no exposure", () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [croc] });
    state.activePlayer = 'B';
    const ids = seedDeck(state, [
      deckChar('TEST_O1_E23'), deckChar('TEST_O2_E23'), deckChar('TEST_O3_E23'),
    ]);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_opp_char_bounce_by_me',
    );
    expect(next.knownByViewer.A).not.toContain(ids[0]!);
    expect(next.knownByViewer.A).not.toContain(ids[1]!);
    expect(next.knownByViewer.A).not.toContain(ids[2]!);
  });

  it('OPT: second dispatch same turn does NOT re-fire (effectsUsed gate)', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [croc] });
    seedDeck(state, [
      deckChar('TEST_OPT_1_E23'), deckChar('TEST_OPT_2_E23'),
      deckChar('TEST_OPT_3_E23'), deckChar('TEST_OPT_4_E23'),
    ]);
    const once = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_opp_char_bounce_by_me',
    );
    const firstKnown = [...(once.knownByViewer.A ?? [])];
    const twice = EffectDispatcher.dispatch(
      once, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_opp_char_bounce_by_me',
    );
    // No NEW deck ids exposed by second fire (OPT suppressed).
    expect(twice.knownByViewer.A?.length ?? 0).toBe(firstKnown.length);
  });
});
