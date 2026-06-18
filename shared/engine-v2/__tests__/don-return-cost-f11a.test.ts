/**
 * F-11A — printed "DON!! −N" is a RETURN-to-deck cost, not a rest cost.
 *
 * Printed text "DON!! −N (You may return the specified number of DON!! cards
 * from your field to your DON!! deck.)" means: move N DON from the cost area to
 * the DON!! DECK. The corpus had 49 cards (54 clauses) modeling this as
 * `donCost` — which only RESTS the DON (donCostArea → donRested), leaving them
 * on the field. F-11A converted those clauses to `donCostReturnToDeck`
 * (donCostArea → donDeck), preserving N and every other field.
 *
 * Mechanical difference (verified handlers):
 *   - donCost.pay              → donCostArea → donRested  (stays on field)   costs.ts:31
 *   - donCostReturnToDeck.pay  → donCostArea → donDeck    (leaves field)     costs2.ts:391
 *
 * Two cards were deliberately PARTIAL-converted because they print a real
 * rest/➀ cost alongside the −N: EB04-040 (keeps `donCost:6` = "rest 6 DON"),
 * OP05-119 (keeps `donCost:1` = "➀" activate cost). OP10-071 was NOT touched
 * (its `donCost` is a printed "rest 1 of your DON!! cards", its −1 already
 * correctly modeled). See docs/F11_CARD_MAPPING_AUDIT.md §3a.
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

const LEADER_A: LeaderCard = {
  id: '__F11_LA', name: 'F11 Leader A', kind: 'leader', colors: ['red'],
  cost: null, power: 5000, counterValue: null, traits: [], keywords: [],
  effectTags: [], life: 5,
};
const LEADER_B: LeaderCard = { ...LEADER_A, id: '__F11_LB', name: 'F11 Leader B' };
const OPP_CHAR: CharacterCard = {
  id: '__F11_OPP', name: 'F11 Opp', kind: 'character', colors: ['red'],
  cost: 3, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
};
const DECK_CARD: CharacterCard = { ...OPP_CHAR, id: '__F11_DECK', name: 'F11 Deck' };

// printed-N parser (mirrors the audit linter)
const printedN = (txt: string): number | null => {
  const m = (txt || '').toLowerCase().match(/don!!\s*[−-]\s*(\d+)/);
  return m ? Number(m[1]) : null;
};
const occ = (s: string, sub: string): number => s.split(sub).length - 1;

let cardsById: Record<string, Card>;
let rawCards: string;

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
  rawCards = readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf8');
  cardsById = {};
  for (const c of JSON.parse(rawCards) as Card[]) cardsById[(c as { id: string }).id] = c;
});

// The 49 cards F-11A fixed (from docs/F11_CARD_MAPPING_AUDIT.md §3a).
const FIXED_49 = [
  'EB02-010','EB03-031','EB03-034','EB04-033','EB04-036','EB04-040','OP05-119','OP11-062',
  'OP11-073','OP12-041','OP12-061','OP12-069','OP13-064','OP13-069','OP14-060','OP14-061',
  'OP14-069','OP14-078','OP15-060','OP15-061','OP15-063','OP15-064','OP15-066','OP15-067',
  'OP15-072','OP15-074','OP15-075','OP15-076','OP15-077','OP15-078','OP15-118','ST03-001',
  'ST04-001','ST04-002','ST04-003','ST04-004','ST04-005','ST04-006','ST04-010','ST05-001',
  'ST05-004','ST05-006','ST05-010','ST05-011','ST05-016','ST10-001','ST10-003','ST10-013','ST26-005',
];

describe('F-11A invariant — every printed "DON!! −N" is modeled as a return cost', () => {
  it('no card in the corpus prints "DON!! −N" without a matching donCostReturnToDeck:N', () => {
    const violations: string[] = [];
    for (const c of Object.values(cardsById)) {
      const spec = (c as { effectSpecV2?: unknown }).effectSpecV2;
      if (!spec) continue;
      const n = printedN((c as { effectText?: string }).effectText ?? '');
      if (n === null) continue;
      const j = JSON.stringify(spec);
      if (!new RegExp(`"donCostReturnToDeck":\\s*${n}`).test(j)) {
        violations.push(`${(c as { id: string }).id} (N=${n})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('all 49 fixed cards now carry a donCostReturnToDeck cost', () => {
    const stillBad: string[] = [];
    for (const id of FIXED_49) {
      const c = cardsById[id]!;
      if (!/donCostReturnToDeck/.test(JSON.stringify(c.effectSpecV2))) stillBad.push(id);
    }
    expect(stillBad).toEqual([]);
  });

  it('partial-converts keep their LEGIT rest cost (EB04-040 rest:6, OP05-119 ➀:1)', () => {
    // these two print a real rest cost alongside the −N → a donCost must remain
    expect(occ(JSON.stringify(cardsById['EB04-040']!.effectSpecV2), '"donCost":')).toBeGreaterThanOrEqual(1);
    expect(occ(JSON.stringify(cardsById['OP05-119']!.effectSpecV2), '"donCost":')).toBeGreaterThanOrEqual(1);
  });

  it('OP10-071 was NOT touched (its donCost is a printed "rest 1 DON")', () => {
    const c = cardsById['OP10-071']!;
    const j = JSON.stringify(c.effectSpecV2);
    expect(/"donCost":\s*1/.test(j)).toBe(true);            // legit rest preserved
    expect(/"donCostReturnToDeck":\s*1/.test(j)).toBe(true); // its −1 already correct
  });
});

// dispatch a card's on_play and return the resulting state
function playOnPlay(card: Card, n: number, opts: { oppChars?: CharacterCard[]; deck?: CharacterCard[] } = {}) {
  const built = buildState({
    leaderA: LEADER_A, leaderB: LEADER_B, donInCostA: n, donInCostB: 10,
    charsB: opts.oppChars ?? [],
  });
  const s = built.state;
  s.cardLibrary[card.id] = card;
  const inst = makeInst(card.id, 'A');
  s.instances[inst.instanceId] = inst;
  s.players.A.field.push(inst);
  for (const d of opts.deck ?? []) {
    s.cardLibrary[d.id] = d;
    const di = makeInst(d.id, 'A');
    s.instances[di.instanceId] = di;
    s.players.A.deck.push(di.instanceId);
  }
  return EffectDispatcher.dispatch(s, { sourceInstanceId: inst.instanceId, controller: 'A' }, 'on_play');
}

describe('F-11A regression — DON is RETURNED to deck, not merely rested', () => {
  const cases: Array<[string, number, { oppChars?: CharacterCard[]; deck?: CharacterCard[] }]> = [
    ['ST04-003', 5, { oppChars: [OPP_CHAR] }],   // [On Play] DON!!−5: KO up to 1
    ['ST05-016', 2, { oppChars: [OPP_CHAR] }],   // [Main] DON!!−2: KO up to 1
    ['ST10-013', 1, {}],                          // [On Play] DON!!−1: +1000 your leader
    ['OP15-061', 1, { deck: [DECK_CARD] }],       // [On Play] DON!!−1: draw 1
  ];
  for (const [id, n, setup] of cases) {
    it(`${id}: DON!!−${n} moves ${n} DON to the DON deck (donRested stays empty)`, () => {
      const card = cardsById[id]!;
      expect(printedN(card.effectText ?? '')).toBe(n); // sanity: text really prints −N
      const after = playOnPlay(card, n, setup);
      expect(after.players.A.donDeck.length).toBe(n);   // returned to deck ✅
      expect(after.players.A.donRested.length).toBe(0); // NOT rested ✅
      expect(after.players.A.donCostArea.length).toBe(0); // cost area emptied
    });
  }
});

describe('F-11A — proves the PREVIOUS (donCost/rest) modeling was wrong', () => {
  it('ST04-003 with the OLD donCost cost would REST 5 DON (stay on field), not return them', () => {
    // reconstruct the pre-fix spec: swap the return cost back to donCost
    const card = JSON.parse(JSON.stringify(cardsById['ST04-003'])) as Card & { effectSpecV2: { clauses: Array<{ cost?: Record<string, number> }> } };
    const cl = card.effectSpecV2.clauses[0]!;
    cl.cost = { donCost: 5 }; // the bug we fixed
    const after = playOnPlay(card, 5, { oppChars: [OPP_CHAR] });
    expect(after.players.A.donRested.length).toBe(5); // OLD behavior: rested on field
    expect(after.players.A.donDeck.length).toBe(0);   // OLD behavior: nothing returned
    // → demonstrably different from the fixed behavior asserted above.
  });
});
