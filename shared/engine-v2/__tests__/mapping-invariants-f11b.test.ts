/**
 * F-11B — data-correctness invariants + regressions for the life-to-hand and
 * duration mapping fixes. Pairs with don-return-cost-f11a.test.ts.
 *
 * Bug classes fixed (data-only, cards.json):
 *  - life-to-hand cost mis-keyed as `flipLife` (flips face-up in place) instead
 *    of `lifeToHand` (moves the card to hand). 18 cards. costs2.ts:257 vs flipLife.
 *  - power duration `this_turn` where text says "until the start of your next
 *    turn" → `opp_next_turn`. 3 cards. givePower reads action.duration
 *    (actions.ts:78); clause-level duration is NOT applied.
 *
 * The audit (F-11) undercounted life-to-hand (7) because its regex used a tight
 * `.{0,30}` gap that missed the "top OR bottom of your Life cards to your hand"
 * variants; the true count is 23. 18 were clean key-swaps; 5 are entangled
 * (a `life_to_hand` ACTION already present alongside the `flipLife` cost, i.e.
 * the cost-effect is double-modeled) and are deferred to manual review.
 */

import { beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';

import type { Card, CharacterCard, LeaderCard } from '../cards/Card.js';
import { EffectDispatcher } from '../effects/EffectDispatcher.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';
import { buildState, makeInst } from './cards/_fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

// Entangled life-to-hand cards (cost `flipLife` AND a `life_to_hand` action,
// or a duplicated-cost group) — need a remodel, not a key swap. Deferred to
// manual review. Remove an id here only when the card is properly remodeled.
const LIFE_TO_HAND_EXCEPTIONS: ReadonlyArray<string> = ['P-036', 'P-073', 'P-105', 'ST13-012', 'PRB02-016'];

let cards: Card[];
const lifeToHandText = (t: string) => /life cards to (your )?hand/i.test(t || '');
const hasFlipCost = (c: Card) =>
  ((c as { effectSpecV2?: { clauses?: Array<{ cost?: Record<string, unknown> }> } }).effectSpecV2?.clauses ?? [])
    .some((cl) => cl.cost !== undefined && 'flipLife' in cl.cost);
const hasNextTurnText = (t: string) => /until the start of (your|the opponent'?s)[^.]*next turn/i.test(t || '');

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
  cards = JSON.parse(readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf8')) as Card[];
});

describe('F-11B invariant — life-to-hand cost is never mis-keyed as flipLife', () => {
  it('no card prints "…Life cards to your hand" as a cost while using flipLife (except documented entangled cards)', () => {
    const violations = cards
      .filter((c) => hasFlipCost(c) && lifeToHandText((c as { effectText?: string }).effectText ?? ''))
      .map((c) => (c as { id: string }).id)
      .filter((id) => !LIFE_TO_HAND_EXCEPTIONS.includes(id));
    expect(violations).toEqual([]);
  });
});

describe('F-11B invariant — "until the start of your next turn" never maps to this_turn', () => {
  it('no card with next-turn power text leaves a this_turn duration in its spec', () => {
    const violations: string[] = [];
    for (const c of cards) {
      const spec = (c as { effectSpecV2?: unknown }).effectSpecV2;
      if (!spec) continue;
      if (!hasNextTurnText((c as { effectText?: string }).effectText ?? '')) continue;
      if (/"duration":\s*"this_turn"/.test(JSON.stringify(spec))) violations.push((c as { id: string }).id);
    }
    expect(violations).toEqual([]);
  });
});

// ── runtime regressions ──
const LEADER_A: LeaderCard = {
  id: '__F11B_LA', name: 'F11B LA', kind: 'leader', colors: ['red'],
  cost: null, power: 5000, counterValue: null, traits: [], keywords: [], effectTags: [], life: 5,
};
const LEADER_B: LeaderCard = { ...LEADER_A, id: '__F11B_LB' };
const OPP: CharacterCard = {
  id: '__F11B_OPP', name: 'F11B Opp', kind: 'character', colors: ['red'],
  cost: 3, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
};
const LIFECARD: CharacterCard = { ...OPP, id: '__F11B_LIFE', name: 'F11B Life' };

function byId(id: string): Card { return cards.find((c) => (c as { id: string }).id === id)!; }

function dispatchWithLife(card: Card, trigger: string, opts: { lives: number; oppChars?: CharacterCard[] }) {
  const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B, donInCostA: 10, charsB: opts.oppChars ?? [] });
  const s = built.state;
  s.cardLibrary[(card as { id: string }).id] = card;
  const inst = makeInst((card as { id: string }).id, 'A');
  s.instances[inst.instanceId] = inst;
  s.players.A.field.push(inst);
  s.cardLibrary[LIFECARD.id] = LIFECARD;
  for (let i = 0; i < opts.lives; i++) {
    const li = makeInst(LIFECARD.id, 'A');
    s.instances[li.instanceId] = li;
    s.players.A.life.push(li.instanceId);
  }
  return { after: EffectDispatcher.dispatch(s, { sourceInstanceId: inst.instanceId, controller: 'A' }, trigger), inst };
}

describe('F-11B regression — life-to-hand MOVES a life card to hand (not flip-in-place)', () => {
  it('ST08-014: the cost moves 1 life card to hand and shrinks life', () => {
    const { after } = dispatchWithLife(byId('ST08-014'), 'on_play', { lives: 2, oppChars: [OPP] });
    expect(after.players.A.hand.length).toBe(1);  // life card landed in hand
    expect(after.players.A.life.length).toBe(1);  // life shrank 2 → 1
  });

  it('PROOF the old flipLife modeling was wrong: it leaves life count unchanged + flips face-up', () => {
    // reconstruct the pre-fix spec: cost flipLife instead of lifeToHand
    const card = JSON.parse(JSON.stringify(byId('ST08-014'))) as Card & { effectSpecV2: { clauses: Array<{ cost?: Record<string, number> }> } };
    card.effectSpecV2.clauses[0]!.cost = { flipLife: 1 };
    const { after } = dispatchWithLife(card, 'on_play', { lives: 2, oppChars: [OPP] });
    expect(after.players.A.hand.length).toBe(0);  // OLD: nothing added to hand
    expect(after.players.A.life.length).toBe(2);  // OLD: life unchanged
    expect(Object.keys(after.players.A.lifeFaceUp).length).toBeGreaterThan(0); // OLD: flipped face-up
  });
});

describe('F-11B regression — "until start of next turn" lasts into the opponent turn (opp_next_turn)', () => {
  it('OP06-006: +1000 buff has expiresInTurns = 1 (opp_next_turn), not 0 (this_turn)', () => {
    const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B, donInCostA: 2 });
    const s = built.state;
    s.cardLibrary['OP06-006'] = byId('OP06-006');
    const inst = makeInst('OP06-006', 'A');
    inst.attachedDon = ['__f11b_don']; // [DON!! x1] requirement (if_attached_don_min reads .length)
    s.instances[inst.instanceId] = inst;
    s.players.A.field.push(inst);
    const after = EffectDispatcher.dispatch(s, { sourceInstanceId: inst.instanceId, controller: 'A' }, 'when_attacking');
    const self = after.players.A.field.find((i) => i.instanceId === inst.instanceId)!;
    expect(self.powerModifierOneShot ?? 0).toBe(1000);
    expect(self.powerModifierExpiresInTurns).toBe(1); // opp_next_turn (pre-fix: 0 = this_turn)
  });
});
