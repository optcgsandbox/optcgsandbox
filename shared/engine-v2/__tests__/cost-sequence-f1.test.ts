/**
 * F8A-F1 — per-clause cost duplication fixed via sequence normalization.
 *
 * Cards printing "pay cost: do A. Then do B." were modeled as 2+ clauses
 * EACH carrying the cost; EffectDispatcher pays per clause
 * (EffectDispatcher.ts:202-244), so repayable costs double-charged and
 * non-repayable costs (restSelf/trashSelf) silently dropped clause 2.
 *
 * Fix (data-only): 91 cards / 93 groups remodeled as ONE clause =
 * shared cost once + `sequence` action with the original sub-actions in
 * printed order (sub-level target/condition preserved).
 *
 * This file pins the four representative cost families through the live
 * engine; `cost-duplication-invariant.test.ts` guards the corpus shape.
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
import { applyAction } from '../reducers/applyAction.js';

import { buildState, makeInst } from './cards/_fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const LEADER_A: LeaderCard = {
  id: '__F1_LA', name: 'F1 Leader A', kind: 'leader', colors: ['red'],
  cost: null, power: 5000, counterValue: null, traits: [], keywords: [],
  effectTags: [], life: 5,
};
const LEADER_B: LeaderCard = { ...LEADER_A, id: '__F1_LB', name: 'F1 Leader B' };
const VANILLA: CharacterCard = {
  id: '__F1_VAN', name: 'F1 Vanilla', kind: 'character', colors: ['red'],
  cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [],
  effectTags: ['vanilla'],
};

let cardsById: Record<string, Card>;

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
  const raw = readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf8');
  cardsById = {};
  for (const c of JSON.parse(raw) as Card[]) cardsById[(c as { id: string }).id] = c;
});

describe('F8A-F1 — OP01-118 Ulti-Mortar (DON return cost, was double-charged)', () => {
  it('counter window: DON!!−2 paid ONCE (2 returned, not 4); +2000 applies; draw 1 applies', () => {
    const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B, donInCostB: 6 });
    const s = built.state;
    s.activePlayer = 'A';
    s.cardLibrary['OP01-118'] = cardsById['OP01-118']!;
    const ev = makeInst('OP01-118', 'B');
    s.instances[ev.instanceId] = ev;
    s.players.B.hand.push(ev.instanceId);
    // deck card so the sequence's draw sub-action has something to draw
    s.cardLibrary[VANILLA.id] = VANILLA;
    const dk = makeInst(VANILLA.id, 'B');
    s.instances[dk.instanceId] = dk;
    s.players.B.deck.push(dk.instanceId);

    let st = applyAction(s, 'A', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: built.leaderInstA.instanceId,
      targetInstanceId: built.leaderInstB.instanceId,
    }, { checkInvariants: false }).state;
    st = applyAction(st, 'B', { type: 'SKIP_BLOCKER' }, { checkInvariants: false }).state;

    const donDeckBefore = st.players.B.donDeck.length;
    const handBefore = st.players.B.hand.length;
    st = applyAction(st, 'B', { type: 'PLAY_COUNTER', instanceId: ev.instanceId }, { checkInvariants: false }).state;

    expect(st.players.B.donDeck.length).toBe(donDeckBefore + 2); // pre-fix: +4
    expect(st.players.B.leader.powerModifierThisBattle ?? 0).toBe(2000); // once
    // hand: −1 (counter played) +1 (draw) → net unchanged
    expect(st.players.B.hand.length).toBe(handBefore);
  });
});

describe('F8A-F1 — EB03-001 Nefeltari Vivi (restSelf, second effect was silently lost)', () => {
  it('one leader-rest pays for BOTH the −2000 debuff and the Rush grant', () => {
    const built = buildState({
      leaderA: { ...(cardsById['EB03-001'] as LeaderCard), life: 4 },
      leaderB: LEADER_B,
      charsA: [VANILLA],
      charsB: [{ ...VANILLA, id: '__F1_OPP', name: 'F1 Opp' }],
    });
    const s = built.state;
    s.cardLibrary['EB03-001'] = cardsById['EB03-001']!;
    const next = EffectDispatcher.dispatch(s, {
      sourceInstanceId: built.leaderInstA.instanceId,
      controller: 'A',
    }, 'activate_main');

    expect(next.players.A.leader.rested).toBe(true); // cost paid exactly once
    expect(next.players.B.field[0]!.powerModifierOneShot ?? 0).toBe(-2000);
    const grants = next.players.A.field[0]!.grantedKeywordsOneShot ?? [];
    expect(grants.some((g) => g.keyword === 'rush')).toBe(true); // pre-fix: never fired
  });
});

describe('F8A-F1 — OP07-118 Sabo (discardHand, was discarding 2 for a printed 1)', () => {
  it('one discard pays for both K.O.s', () => {
    const built = buildState({
      leaderA: LEADER_A,
      leaderB: LEADER_B,
      handA: [VANILLA, { ...VANILLA, id: '__F1_VAN2', name: 'F1 Vanilla 2' }],
      charsB: [
        { ...VANILLA, id: '__F1_C5', name: 'F1 Cost5', cost: 5, power: 6000 },
        { ...VANILLA, id: '__F1_C3', name: 'F1 Cost3', cost: 3, power: 4000 },
      ],
    });
    const s = built.state;
    s.cardLibrary['OP07-118'] = cardsById['OP07-118']!;
    const ev = makeInst('OP07-118', 'A');
    s.instances[ev.instanceId] = ev;

    const handBefore = s.players.A.hand.length;
    const next = EffectDispatcher.dispatch(s, { sourceInstanceId: ev.instanceId, controller: 'A' }, 'on_play');

    expect(next.players.A.hand.length).toBe(handBefore - 1); // pre-fix: −2
    expect(next.players.B.field.length).toBe(0); // both KOs landed
  });
});

describe('F8A-F1 — OP07-109 Luffy (trashSelf, draw was silently lost)', () => {
  it('one self-trash pays for the K.O. AND the draw (at ≤2 life)', () => {
    const built = buildState({
      leaderA: LEADER_A,
      leaderB: LEADER_B,
      charsA: [VANILLA], // placeholder; replaced by OP07-109 instance below
      charsB: [{ ...VANILLA, id: '__F1_C4', name: 'F1 Cost4', cost: 4, power: 5000 }],
    });
    const s = built.state;
    s.cardLibrary['OP07-109'] = cardsById['OP07-109']!;
    const src = makeInst('OP07-109', 'A');
    s.instances[src.instanceId] = src;
    s.players.A.field = [src];
    // condition: if_own_life_max 2 — give A 1 life card
    const li = makeInst(VANILLA.id, 'A');
    s.instances[li.instanceId] = li;
    s.players.A.life.push(li.instanceId);
    // deck for the draw
    const dk = makeInst(VANILLA.id, 'A');
    s.instances[dk.instanceId] = dk;
    s.players.A.deck.push(dk.instanceId);

    const handBefore = s.players.A.hand.length;
    const next = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'activate_main');

    expect(next.players.A.field.some((c) => c.instanceId === src.instanceId)).toBe(false);
    expect(next.players.A.trash.filter((id) => id === src.instanceId).length).toBe(1); // trashed once
    expect(next.players.B.field.length).toBe(0); // KO landed
    expect(next.players.A.hand.length).toBe(handBefore + 1); // pre-fix: draw never fired
  });
});
