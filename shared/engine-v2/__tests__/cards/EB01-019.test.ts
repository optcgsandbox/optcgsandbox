/**
 * Per-card semantic test — EB01-019 Off-White ([Counter] event).
 *
 * Printed text (cards.json):
 *   "[Counter] Up to 1 of your Leader or Character cards gains +4000 power
 *    during this battle. Then, look at 3 cards from the top of your deck;
 *    reveal up to 1 {Donquixote Pirates} type Character card and add it to
 *    your hand. Then, place the rest at the bottom of your deck in any order."
 *
 * Modeling (post F8A-F4 counter-event normalization, 2026-06-11):
 *   - The printed "+4000 during this battle" is carried by
 *     `counterEventBoost: 4000` — applied EXACTLY ONCE by playCounterReducer
 *     (attackFlow.ts) onto pendingAttack.counterBoost. The old duplicate
 *     on_play power_buff clause was removed by the counter sweep: with both
 *     present the engine applied +8000. See counter-boost-invariant.test.ts.
 *   - The spec therefore has ONE on_play clause:
 *     searcher_peek lookCount:3, addCount:1, filter {trait:'Donquixote
 *     Pirates', kind:'character'}, leftoverPlacement:'bottom'.
 *
 * Engine gap history (BUGS_FOUND.md under EB01-009): searcher_peek leftover
 * placement — closed; default leftoverPlacement='bottom' is asserted below.
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
import { applyAction } from '../../reducers/applyAction.js';

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

const VANILLA_LEADER: LeaderCard = {
  id: 'TEST_LEADER_EB019',
  name: 'TEST',
  kind: 'leader',
  colors: ['green'],
  cost: null,
  power: 5000,
  life: 5,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

function dpCharacter(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['green'],
    cost: 3,
    power: 4000,
    counterValue: 1000,
    traits: ['Donquixote Pirates'],
    keywords: [],
    effectTags: [],
  };
}

function vanillaCharacter(id: string): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['green'],
    cost: 2,
    power: 3000,
    counterValue: 1000,
    traits: ['Other Faction'],
    keywords: [],
    effectTags: [],
  };
}

describe('EB01-019 — Off-White ([Counter] event)', () => {
  const allCards = loadCards();
  const eb = allCards.find((c) => c.id === 'EB01-019');
  if (eb === undefined) throw new Error('EB01-019 not in cards.json');
  if (eb.kind !== 'event') throw new Error('EB01-019 should be an event');
  const offWhite = eb as EventCard;

  it('spec is ONE on_play clause (searcher_peek) — the +4000 lives in counterEventBoost (F8A-F4)', () => {
    expect(offWhite.effectSpecV2!.clauses).toHaveLength(1);
    const [c1] = offWhite.effectSpecV2!.clauses!;
    expect(c1!.trigger).toBe('on_play');
    expect(c1!.action.kind).toBe('searcher_peek');
  });

  it('counter-event legality tags wired: counter_event in effectTags + counterEventBoost = 4000', () => {
    expect(offWhite.effectTags).toContain('counter_event');
    expect((offWhite as { counterEventBoost?: number }).counterEventBoost).toBe(4000);
  });

  /** Create an Off-White event instance owned by player A and put it in
   *  the cardLibrary + instances map. Used as the dispatch source so the
   *  dispatcher reads Off-White's spec (not the leader's). */
  function attachEventSource(state: ReturnType<typeof buildState>['state']): string {
    state.cardLibrary[offWhite.id] = offWhite;
    const inst = makeInst(offWhite.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  /** Populate A's deck with a sequence of fresh instances for the given
   *  card defs, in order. Returns the list of instanceIds (deck order). */
  function seedDeckA(
    state: ReturnType<typeof buildState>['state'],
    cards: ReadonlyArray<CharacterCard>,
  ): string[] {
    const ids: string[] = [];
    for (const c of cards) {
      state.cardLibrary[c.id] = c;
      const inst = makeInst(c.id, 'A');
      state.instances[inst.instanceId] = inst;
      ids.push(inst.instanceId);
    }
    state.players.A.deck = [...ids];
    return ids;
  }

  describe('+4000 this_battle — applied exactly once, via counterEventBoost (F8A-F4)', () => {
    it('played in the counter window: pendingAttack.counterBoost = 4000, no clause double-apply', () => {
      const oppLeader: LeaderCard = { ...VANILLA_LEADER, id: 'TEST_OPP_LEADER_EB019', colors: ['red'] };
      const { state, leaderInstA, leaderInstB } = buildState({
        leaderA: oppLeader, // attacker
        leaderB: VANILLA_LEADER, // defender plays Off-White
        donInCostB: 4,
      });
      state.activePlayer = 'A';
      state.cardLibrary[offWhite.id] = offWhite;
      const ce = makeInst(offWhite.id, 'B');
      state.instances[ce.instanceId] = ce;
      state.players.B.hand.push(ce.instanceId);

      let st = applyAction(state, 'A', {
        type: 'DECLARE_ATTACK',
        attackerInstanceId: leaderInstA.instanceId,
        targetInstanceId: leaderInstB.instanceId,
      }, { checkInvariants: false }).state;
      st = applyAction(st, 'B', { type: 'SKIP_BLOCKER' }, { checkInvariants: false }).state;
      st = applyAction(st, 'B', { type: 'PLAY_COUNTER', instanceId: ce.instanceId }, { checkInvariants: false }).state;

      const boost = st.pending?.kind === 'attack'
        ? (st.pending as { pendingAttack: { counterBoost: number } }).pendingAttack.counterBoost
        : -1;
      expect(boost).toBe(4000); // exactly once — pre-sweep this was 4000 boost + 4000 clause
      expect(st.players.B.leader.powerModifierThisBattle ?? 0).toBe(0);
    });
  });

  describe('clause 2 — searcher_peek lookCount:3 addCount:1 Donquixote Pirates character', () => {
    it('with DP character in top 3 → reveals + adds to hand', () => {
      const dp = dpCharacter('TEST_DP_X');
      const filler1 = vanillaCharacter('TEST_FILL_A');
      const filler2 = vanillaCharacter('TEST_FILL_B');
      const { state } = buildState({ leaderA: VANILLA_LEADER });
      const srcId = attachEventSource(state);
      const [dpInstId] = seedDeckA(state, [dp, filler1, filler2]);
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: srcId, controller: 'A' },
        'on_play',
      );
      expect(next.players.A.hand).toContain(dpInstId);
    });

    it('with NO DP character in top 3 → no instance enters hand', () => {
      const f1 = vanillaCharacter('TEST_F1');
      const f2 = vanillaCharacter('TEST_F2');
      const f3 = vanillaCharacter('TEST_F3');
      const { state } = buildState({ leaderA: VANILLA_LEADER });
      const srcId = attachEventSource(state);
      const handBefore = state.players.A.hand.length;
      seedDeckA(state, [f1, f2, f3]);
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: srcId, controller: 'A' },
        'on_play',
      );
      expect(next.players.A.hand.length).toBe(handBefore);
    });

    it('leftover non-added cards go to BOTTOM of deck (closes cluster-A engine gap; searcher_peek default leftoverPlacement="bottom")', () => {
      const dp = dpCharacter('TEST_DP_BOT');
      const filler1 = vanillaCharacter('TEST_LO_1');
      const filler2 = vanillaCharacter('TEST_LO_2');
      const tailX = vanillaCharacter('TEST_TAIL_X');
      const tailY = vanillaCharacter('TEST_TAIL_Y');
      const { state } = buildState({ leaderA: VANILLA_LEADER });
      const srcId = attachEventSource(state);
      const [, filler1Id, , , tailYId] = seedDeckA(state, [
        dp,
        filler1,
        filler2,
        tailX,
        tailY,
      ]);
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: srcId, controller: 'A' },
        'on_play',
      );
      const deck = next.players.A.deck;
      const tailYIdx = deck.indexOf(tailYId!);
      const filler1Idx = deck.indexOf(filler1Id!);
      expect(filler1Idx).toBeGreaterThan(tailYIdx);
    });
  });
});
