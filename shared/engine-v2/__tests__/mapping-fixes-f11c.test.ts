/**
 * F-11C — final proven-data-correctness pass. Invariants + regressions for:
 *  - 5 entangled life-to-hand cards remodeled (class-C double-modeling: a
 *    `flipLife` cost AND a `life_to_hand` action both present). Correct = ONE
 *    clause, cost `{lifeToHand:1}` gating the real effect.
 *  - ST28-004 cost donCost (rest from cost area) → returnAttachedDon (return
 *    GIVEN DON to cost area rested).
 *  - ST27-005 KO target any_character + added [On K.O.] recursion(black).
 *  - EB03-055 added [Opponent's Turn][On K.O.] deal_damage_opp.
 *  - OP14-058 bounce target → any_character.  P-092 continuous → is_opp_turn.
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

const LA: LeaderCard = {
  id: '__F11C_LA', name: 'F11C LA', kind: 'leader', colors: ['red'],
  cost: null, power: 5000, counterValue: null, traits: [], keywords: [], effectTags: [], life: 5,
};
const LB: LeaderCard = { ...LA, id: '__F11C_LB' };
const BLACK: CharacterCard = {
  id: '__F11C_BLACK', name: 'F11C Black', kind: 'character', colors: ['black'],
  cost: 2, power: 2000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
};
const LIFE: CharacterCard = { ...BLACK, id: '__F11C_LIFE', colors: ['red'] };

let cards: Card[];
const byId = (id: string) => cards.find((c) => (c as { id: string }).id === id)!;
const J = (c: Card) => JSON.stringify((c as { effectSpecV2?: unknown }).effectSpecV2 ?? {});

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
  cards = JSON.parse(readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf8')) as Card[];
});

describe('F-11C invariant — no life-to-hand double-modeling remains', () => {
  it('no card carries BOTH a flipLife cost and a life_to_hand action', () => {
    const violations = cards.filter((c) => {
      const spec = (c as { effectSpecV2?: { clauses?: Array<{ cost?: Record<string, unknown> }> } }).effectSpecV2;
      if (!spec) return false;
      const hasFlipCost = (spec.clauses ?? []).some((cl) => cl.cost && 'flipLife' in cl.cost);
      return hasFlipCost && /"kind":"life_to_hand"/.test(J(c));
    }).map((c) => (c as { id: string }).id);
    expect(violations).toEqual([]);
  });
});

describe('F-11C spec-shape — proven single-field fixes', () => {
  it('P-092: continuous -3000 is gated on is_opp_turn (was always)', () => {
    const cont = (byId('P-092') as { effectSpecV2: { continuous: Array<{ condition?: { type?: string } }> } }).effectSpecV2.continuous[0]!;
    expect(cont.condition?.type).toBe('is_opp_turn');
  });
  it('OP14-058: bounce targets any_character (was opp_character)', () => {
    expect(/"removal_bounce","target":\{"kind":"any_character"/.test(J(byId('OP14-058')))).toBe(true);
  });
  it('ST28-004: cost is returnAttachedDon:2 (was donCost:2)', () => {
    const j = J(byId('ST28-004'));
    expect(/"returnAttachedDon":2/.test(j)).toBe(true);
    expect(/"donCost":2/.test(j)).toBe(false);
  });
});

// helper: place a source on A's field and dispatch a trigger
function dispatch(card: Card, trigger: string, mut?: (s: ReturnType<typeof buildState>['state'], inst: ReturnType<typeof makeInst>) => void, opts?: { activeB?: boolean; donA?: number }) {
  const built = buildState({ leaderA: LA, leaderB: LB, donInCostA: opts?.donA ?? 10 });
  const s = built.state;
  if (opts?.activeB) s.activePlayer = 'B';
  s.cardLibrary[(card as { id: string }).id] = card;
  const inst = makeInst((card as { id: string }).id, 'A');
  s.instances[inst.instanceId] = inst;
  s.players.A.field.push(inst);
  mut?.(s, inst);
  return { after: EffectDispatcher.dispatch(s, { sourceInstanceId: inst.instanceId, controller: 'A' }, trigger), inst };
}

describe('F-11C regression — entangled life-to-hand remodel (P-036) works once', () => {
  it('P-036: pays 1 life→hand (once) and applies +1000 to self AND leader', () => {
    const { after, inst } = dispatch(byId('P-036'), 'when_attacking', (s) => {
      s.cardLibrary[LIFE.id] = LIFE;
      for (let i = 0; i < 2; i++) { const li = makeInst(LIFE.id, 'A'); s.instances[li.instanceId] = li; s.players.A.life.push(li.instanceId); }
    });
    expect(after.players.A.hand.length).toBe(1);  // exactly one life moved to hand
    expect(after.players.A.life.length).toBe(1);  // 2 → 1 (not double-consumed)
    const self = after.players.A.field.find((i) => i.instanceId === inst.instanceId)!;
    expect(self.powerModifierOneShot ?? 0).toBe(1000);
    expect(after.players.A.leader.powerModifierOneShot ?? 0).toBe(1000);
  });
});

describe('F-11C regression — ST28-004 returns GIVEN DON (not rest from cost area)', () => {
  it('returnAttachedDon:2 moves 2 attached DON to donRested', () => {
    const { after } = dispatch(byId('ST28-004'), 'activate_main', (s, inst) => {
      inst.attachedDon = ['__d1', '__d2'];
    });
    expect(after.players.A.donRested.length).toBe(2);            // returned to cost area, rested
    const self = after.players.A.field[0]!;
    expect(self.attachedDon.length).toBe(0);                     // given DON left the character
  });
});

describe('F-11C regression — added [On K.O.] clauses fire', () => {
  it('ST27-005: on_ko recursion pulls a black card from trash to hand', () => {
    const { after } = dispatch(byId('ST27-005'), 'on_ko', (s) => {
      s.cardLibrary[BLACK.id] = BLACK;
      const t = makeInst(BLACK.id, 'A'); s.instances[t.instanceId] = t; s.players.A.trash.push(t.instanceId);
    });
    expect(after.players.A.hand.some((id) => after.instances[id]?.cardId === BLACK.id)).toBe(true);
  });

  it('EB03-055: on_ko during opponent turn deals 1 damage (opp life → opp hand)', () => {
    const { after } = dispatch(byId('EB03-055'), 'on_ko', (s) => {
      s.cardLibrary[LIFE.id] = LIFE;
      const li = makeInst(LIFE.id, 'B'); s.instances[li.instanceId] = li; s.players.B.life.push(li.instanceId);
    }, { activeB: true });
    expect(after.players.B.hand.length).toBe(1);  // 1 damage dealt: opp life moved to opp hand
    expect(after.players.B.life.length).toBe(0);
  });
});
