/**
 * Per-card semantic test — EB01-009 "Just Shut Up and Come with Us!!!!" (event).
 *
 * Printed text (cards.json):
 *   "[Counter] Look at 5 cards from the top of your deck and play up to 1
 *    {Animal} type Character card with a cost of 3 or less. Then, place
 *    the rest at the bottom of your deck in any order."
 *
 * 5-axis: clause on_play → searcher_peek lookCount:5 addCount:1 filter
 *   {trait:'Animal', costMax:3, kind:'character'} playInsteadOfHand:true.
 *
 * Engine gaps (logged in BUGS_FOUND.md, EB01-009 entry):
 *   (A) searcher_peek leftover goes to TOP not BOTTOM (actions3.ts:802-804).
 *       Behavioral assertion marked `it.fails`.
 *   (B) [Counter] events with counterEventBoost:null are refused by legality
 *       (legality.ts:277-281 requires counterEventBoost > 0). Per-card test
 *       layer cannot exercise legality directly — documented in BUGS_FOUND.md.
 *
 * Test dispatches via `EffectDispatcher.dispatch` on a synthesized event
 * source instance (Rule 3 — behavioral, not handler-direct).
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

const VANILLA_LEADER: LeaderCard = {
  id: 'TEST_LEADER_EB009',
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

function placeOnTopOfDeck(
  state: import('../../state/types.js').GameState,
  card: CharacterCard,
): import('../../state/types.js').CardInstance {
  state.cardLibrary[card.id] = card;
  const inst = makeInst(card.id, 'A');
  state.instances[inst.instanceId] = inst;
  state.players.A.deck.unshift(inst.instanceId);
  return inst;
}

describe('EB01-009 — Just Shut Up and Come with Us!!!! (event)', () => {
  const allCards = loadCards();
  const ev = allCards.find((c) => c.id === 'EB01-009');
  if (ev === undefined) throw new Error('EB01-009 not in cards.json');
  if (ev.kind !== 'event') throw new Error('EB01-009 should be an event');
  const justShutUp = ev as EventCard;

  /** Attach EB01-009 as an event source instance owned by player A.
   *  Returns the synthesized event instance ID. EffectDispatcher reads
   *  spec via state.cardLibrary[inst.cardId].effectSpecV2 — same path the
   *  real "play event" flow uses. */
  function attachEventSource(state: import('../../state/types.js').GameState): string {
    state.cardLibrary[justShutUp.id] = justShutUp;
    const inst = makeInst(justShutUp.id, 'A');
    state.instances[inst.instanceId] = inst;
    return inst.instanceId;
  }

  it('plays a cost-2 Animal char from the top of the deck (summoning-sick)', () => {
    const { state } = buildState({ leaderA: VANILLA_LEADER });
    const animal: CharacterCard = {
      id: 'TEST_ANIM_EB009',
      name: 'Animal',
      kind: 'character',
      colors: ['red'],
      cost: 2,
      power: 3000,
      counterValue: 1000,
      traits: ['Animal'],
      keywords: [],
      effectTags: [],
    };
    const animInst = placeOnTopOfDeck(state, animal);
    const srcId = attachEventSource(state);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.A.field.some((i) => i.instanceId === animInst.instanceId)).toBe(true);
    expect(next.instances[animInst.instanceId]!.summoningSick).toBe(true);
  });

  it('does NOT play a non-Animal trait char (filter rejects)', () => {
    const { state } = buildState({ leaderA: VANILLA_LEADER });
    const human: CharacterCard = {
      id: 'TEST_HUM_EB009',
      name: 'Human',
      kind: 'character',
      colors: ['red'],
      cost: 2,
      power: 3000,
      counterValue: 1000,
      traits: ['Human'],
      keywords: [],
      effectTags: [],
    };
    const inst = placeOnTopOfDeck(state, human);
    const srcId = attachEventSource(state);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.A.field.some((i) => i.instanceId === inst.instanceId)).toBe(false);
  });

  it('does NOT play a cost-4 Animal (costMax:3 filter rejects — boundary exclusive)', () => {
    const { state } = buildState({ leaderA: VANILLA_LEADER });
    const big: CharacterCard = {
      id: 'TEST_BIG_EB009',
      name: 'BigAnimal',
      kind: 'character',
      colors: ['red'],
      cost: 4,
      power: 5000,
      counterValue: 1000,
      traits: ['Animal'],
      keywords: [],
      effectTags: [],
    };
    const inst = placeOnTopOfDeck(state, big);
    const srcId = attachEventSource(state);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.A.field.some((i) => i.instanceId === inst.instanceId)).toBe(false);
  });

  it('plays cost-3 Animal (costMax:3 boundary inclusive)', () => {
    const { state } = buildState({ leaderA: VANILLA_LEADER });
    const c3: CharacterCard = {
      id: 'TEST_C3_EB009',
      name: 'Cost3Animal',
      kind: 'character',
      colors: ['red'],
      cost: 3,
      power: 4000,
      counterValue: 1000,
      traits: ['Animal'],
      keywords: [],
      effectTags: [],
    };
    const inst = placeOnTopOfDeck(state, c3);
    const srcId = attachEventSource(state);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.A.field.some((i) => i.instanceId === inst.instanceId)).toBe(true);
  });

  it('does NOT find an Animal placed at deck position 6 (outside lookCount=5)', () => {
    const { state } = buildState({ leaderA: VANILLA_LEADER });
    for (let i = 0; i < 5; i++) {
      const filler: CharacterCard = {
        id: `TEST_FILL_${i}`,
        name: `F${i}`,
        kind: 'character',
        colors: ['red'],
        cost: 1,
        power: 1000,
        counterValue: 1000,
        traits: ['Human'],
        keywords: [],
        effectTags: [],
      };
      placeOnTopOfDeck(state, filler);
    }
    const deep: CharacterCard = {
      id: 'TEST_DEEP_EB009',
      name: 'Deep',
      kind: 'character',
      colors: ['red'],
      cost: 2,
      power: 3000,
      counterValue: 1000,
      traits: ['Animal'],
      keywords: [],
      effectTags: [],
    };
    state.cardLibrary[deep.id] = deep;
    const animInst = makeInst(deep.id, 'A');
    state.instances[animInst.instanceId] = animInst;
    // Position 5 (zero-indexed) — outside top 5.
    state.players.A.deck.splice(5, 0, animInst.instanceId);

    const srcId = attachEventSource(state);
    const next = EffectDispatcher.dispatch(
      state,
      { sourceInstanceId: srcId, controller: 'A' },
      'on_play',
    );
    expect(next.players.A.field.some((i) => i.instanceId === animInst.instanceId)).toBe(false);
    expect(next.players.A.deck).toContain(animInst.instanceId);
  });

  it(
    'leftover top-5 cards go to BOTTOM of deck (closes cluster-A engine gap; searcher_peek now defaults leftoverPlacement="bottom")',
    () => {
      const { state } = buildState({ leaderA: VANILLA_LEADER });
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const filler: CharacterCard = {
          id: `TEST_LEFT_${i}`,
          name: `L${i}`,
          kind: 'character',
          colors: ['red'],
          cost: 1,
          power: 1000,
          counterValue: 1000,
          traits: ['Human'],
          keywords: [],
          effectTags: [],
        };
        const inst = placeOnTopOfDeck(state, filler);
        ids.push(inst.instanceId);
      }
      const sentinelCard: CharacterCard = {
        id: 'TEST_SENTINEL_EB009',
        name: 'Sentinel',
        kind: 'character',
        colors: ['red'],
        cost: 1,
        power: 1000,
        counterValue: 1000,
        traits: ['Human'],
        keywords: [],
        effectTags: [],
      };
      state.cardLibrary[sentinelCard.id] = sentinelCard;
      const sentinel = makeInst(sentinelCard.id, 'A');
      state.instances[sentinel.instanceId] = sentinel;
      state.players.A.deck.push(sentinel.instanceId);

      const srcId = attachEventSource(state);
      const next = EffectDispatcher.dispatch(
        state,
        { sourceInstanceId: srcId, controller: 'A' },
        'on_play',
      );
      // Per printed text, original top-5 should now be AT THE BOTTOM (after
      // the sentinel which was already at the back). V2 currently unshifts
      // them back to TOP — this assertion fails until engine gap A is fixed.
      const deck = next.players.A.deck;
      const sentinelIdx = deck.indexOf(sentinel.instanceId);
      const firstOriginalTop = deck.indexOf(ids[ids.length - 1]!);
      expect(firstOriginalTop).toBeGreaterThan(sentinelIdx);
    },
  );
});
