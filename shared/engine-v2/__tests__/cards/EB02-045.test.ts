/**
 * Per-card semantic test — EB02-045 Trafalgar Law (character).
 * "[Blocker]
 *  [On Play] You may place 2 cards from your trash at the bottom of your
 *  deck in any order: Choose one:
 *  • Draw 1 card.
 *  • If your opponent has 5 or more cards in their hand, your opponent
 *    trashes 1 card from their hand."
 * Spec: continuous grant_keyword_to_self blocker. Clause on_play /
 *   cost bottomOfDeckFromTrash:2 / choose_one[draw 1, opp_discard_from_hand
 *   1 (gated if_opp_hand_min:5)].
 *
 * Spec was previously root-flagged + auditNote re: opp-discard semantics.
 * Resolved: spec axis is correct (`opp_discard_from_hand`). The engine V0
 * gap (deterministic head-of-hand vs printed "opp chooses") is now logged
 * in BUGS_FOUND.md (opp_discard_from_hand V0 entry) and is out of scope
 * for spec axis-faithfulness.
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
  id: 'TEST_L_EB02045', name: 'L', kind: 'leader', colors: ['black'], cost: null,
  power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
};

function deckChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['black'], cost: 1, power: 1000,
    counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
}

describe('EB02-045 — Trafalgar Law', () => {
  const c = loadCards().find((x) => x.id === 'EB02-045');
  if (c === undefined || c.kind !== 'character') throw new Error('EB02-045 invalid');
  const law = c as CharacterCard;
  const clause = law.effectSpecV2!.clauses![0]!;
  const cont = law.effectSpecV2!.continuous![0]!;

  function seedTrash(state: ReturnType<typeof buildState>['state'], n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const card = deckChar(`TEST_TRASH_${i}_E45`);
      state.cardLibrary[card.id] = card;
      const inst = makeInst(card.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.trash.push(inst.instanceId);
      ids.push(inst.instanceId);
    }
    return ids;
  }

  function seedDeck(state: ReturnType<typeof buildState>['state'], n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const card = deckChar(`TEST_DECK_${i}_E45`);
      state.cardLibrary[card.id] = card;
      const inst = makeInst(card.id, 'A');
      state.instances[inst.instanceId] = inst;
      state.players.A.deck.push(inst.instanceId);
      ids.push(inst.instanceId);
    }
    return ids;
  }

  function seedOppHand(state: ReturnType<typeof buildState>['state'], n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const card = deckChar(`TEST_OPP_HAND_${i}_E45`);
      state.cardLibrary[card.id] = card;
      const inst = makeInst(card.id, 'B');
      state.instances[inst.instanceId] = inst;
      state.players.B.hand.push(inst.instanceId);
      ids.push(inst.instanceId);
    }
    return ids;
  }

  it('shape: on_play / bottomOfDeckFromTrash:2 / choose_one[draw 1, opp_discard_from_hand 1 if hand≥5] + continuous blocker', () => {
    expect(clause.trigger).toBe('on_play');
    expect(clause.cost!['bottomOfDeckFromTrash']).toBe(2);
    expect(clause.action.kind).toBe('choose_one');
    const opts = (clause.action as { options: ReadonlyArray<{ action: { kind: string; magnitude?: number }; condition?: { type: string; n?: number } }> }).options;
    expect(opts).toHaveLength(2);
    expect(opts[0]!.action.kind).toBe('draw');
    expect(opts[0]!.action.magnitude).toBe(1);
    expect(opts[1]!.action.kind).toBe('opp_discard_from_hand');
    expect(opts[1]!.action.magnitude).toBe(1);
    expect(opts[1]!.condition?.type).toBe('if_opp_hand_min');
    expect(opts[1]!.condition?.n).toBe(5);
    expect((cont.action as { kind: string; keyword: string }).kind).toBe('grant_keyword_to_self');
    expect((cont.action as { kind: string; keyword: string }).keyword).toBe('blocker');
  });

  it('continuous grants blocker', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [law] });
    const next = ContinuousManager.refold(state);
    expect(next.instances[fieldA[0]!.instanceId]!.grantedKeywordsContinuous ?? []).toContain('blocker');
  });

  it('on_play with 2+ in trash: enters choose_one pending', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [law] });
    seedTrash(state, 2);
    seedDeck(state, 3);
    const next = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    expect(next.pending?.kind).toBe('choose_one');
  });

  it('on_play choose option 0 (draw): hand +1, trash sends 2 to bottom of deck (cost)', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [law] });
    const trashIds = seedTrash(state, 2);
    seedDeck(state, 3);
    const handBefore = state.players.A.hand.length;
    const trashBefore = state.players.A.trash.length;
    const dispatched = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    const result = applyAction(dispatched, 'A', { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 } as never);
    const next = result.state;
    expect(next.players.A.hand.length).toBe(handBefore + 1);
    expect(next.players.A.trash.length).toBe(trashBefore - 2);
    // 2 trash cards moved to deck.
    expect(next.players.A.deck).toContain(trashIds[0]!);
    expect(next.players.A.deck).toContain(trashIds[1]!);
  });

  it('on_play choose option 1: opp hand=5 → opp loses 1 card from hand', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [law] });
    seedTrash(state, 2);
    seedDeck(state, 3);
    const oppIds = seedOppHand(state, 5);
    const oppHandBefore = state.players.B.hand.length;
    const oppTrashBefore = state.players.B.trash.length;
    const dispatched = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    const result = applyAction(dispatched, 'A', { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 1 } as never);
    const next = result.state;
    expect(next.players.B.hand.length).toBe(oppHandBefore - 1);
    expect(next.players.B.trash.length).toBe(oppTrashBefore + 1);
    void oppIds;
  });

  it('on_play choose option 1: opp hand=4 → condition fail (no discard)', () => {
    const { state, fieldA } = buildState({ leaderA: L, charsA: [law] });
    seedTrash(state, 2);
    seedDeck(state, 3);
    seedOppHand(state, 4);
    const oppHandBefore = state.players.B.hand.length;
    const dispatched = EffectDispatcher.dispatch(
      state, { sourceInstanceId: fieldA[0]!.instanceId, controller: 'A' }, 'on_play',
    );
    const result = applyAction(dispatched, 'A', { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 1 } as never);
    const next = result.state;
    expect(next.players.B.hand.length).toBe(oppHandBefore);
  });
});
