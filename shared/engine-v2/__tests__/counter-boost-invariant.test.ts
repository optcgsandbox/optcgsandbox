/**
 * F8A-F4 — counter-event boost/clause duplication invariant.
 *
 * Engine contract: `playCounterReducer` applies `counterEventBoost` to the
 * pending attack automatically (attackFlow.ts:364-365) AND fires the event's
 * on_play clauses (attackFlow.ts:398). Therefore a card with
 * `counterEventBoost > 0` must NOT also carry an UNCONDITIONAL, COST-FREE
 * on_play power_buff aimed at the defender's side — that shape always
 * double-applies the printed boost.
 *
 * Allowed (NOT flagged by this invariant):
 *   - costed defensive power_buff clauses ("pay X: +N more") alongside a
 *     boost that models a separate unconditional base;
 *   - conditional "that card gains an additional +N" clauses;
 *   - power_buff clauses targeting the opponent's side (debuffs).
 *
 * Exceptions: none today. If a future card legitimately needs the banned
 * shape, add its id to EXCEPTIONS with a comment explaining the printed text.
 *
 * Scope note: this invariant cannot catch a WRONG boost magnitude (e.g. a
 * cost-gated printed boost stored in counterEventBoost — applied for free).
 * Those are per-card data errors; the 10 found in F8A-F4 are pinned by
 * `counter-event-f4.test.ts`.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const EXCEPTIONS: ReadonlyArray<string> = [
  // none — every exception needs the card id + printed-text justification
];

const DEFENSIVE_TARGETS = new Set([
  'your_leader',
  'your_character',
  'your_leader_or_character',
  'self',
]);

interface ClauseShape {
  trigger?: string;
  cost?: Record<string, unknown>;
  condition?: unknown;
  action: { kind?: string; magnitude?: number };
  target?: { kind?: string };
}

describe('F8A-F4 invariant — no counter-event double-apply shape in cards.json', () => {
  it('no card has counterEventBoost > 0 AND an unconditional cost-free defensive on_play power_buff', () => {
    const raw = readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf8');
    const cards = JSON.parse(raw) as Array<{
      id: string;
      counterEventBoost?: number | null;
      effectSpecV2?: { clauses?: ClauseShape[] };
    }>;

    const violations: string[] = [];
    for (const card of cards) {
      if (EXCEPTIONS.includes(card.id)) continue;
      const boost = card.counterEventBoost ?? 0;
      if (boost <= 0) continue;
      for (const cl of card.effectSpecV2?.clauses ?? []) {
        if (cl.trigger !== 'on_play') continue;
        if (cl.action?.kind !== 'power_buff') continue;
        if (cl.condition !== undefined) continue;
        if (cl.cost !== undefined) continue;
        if (!DEFENSIVE_TARGETS.has(cl.target?.kind ?? '')) continue;
        violations.push(
          `${card.id}: boost=${boost} duplicated by unconditional cost-free ` +
          `power_buff(${cl.action.magnitude}) → ${cl.target?.kind}`,
        );
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
