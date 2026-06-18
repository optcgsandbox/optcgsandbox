/**
 * F8A-F1 invariant — no duplicated identical-cost clause groups.
 *
 * EffectDispatcher pays clause costs per clause (EffectDispatcher.ts:202-244).
 * A card whose printed text is "pay cost: do A. Then do B." must therefore be
 * ONE clause (cost + `sequence` action), never 2+ clauses repeating the cost —
 * repayable costs double-charge and non-repayable costs (restSelf/trashSelf)
 * silently drop the later clauses.
 *
 * EXCEPTIONS: cards whose duplicated-cost group could NOT be mechanically
 * merged in F8A-F1 (each needs its own modeling decision; see
 * docs/F8_ENGINE_CORRECTNESS_TRIAGE.md Finding 1 follow-ups). Remove ids from
 * this list as they get fixed — additions require a documented reason.
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
  // Cost is ALSO encoded as the first action (merge would double-dip; needs
  // the cost-as-action duplicate removed under per-card review):
  // (PRB02-016 pruned 2026-06-17 — remodeled in F-11C to one clause
  //  cost {restSelf, lifeToHand} + power_buff; no longer a dup-cost group.)
  'OP03-102', 'OP03-110', 'OP06-106', 'OP15-100', 'ST13-001',
  // Printed text has NO cost — the modeled cost itself is wrong:
  'OP08-014', 'OP13-042',
  // "K.O. OR rest" / opponent-chooses branch — sequence would run BOTH arms:
  'OP14-062', 'OP15-059',
  // Two byte-identical clauses for one printed effect — needs dedup-to-one,
  // not a sequence merge:
  'OP11-071',
  // "If you do, ..." gating on a conditional play — needs binding support:
  'ST13-007', 'ST13-010', 'ST13-014',
];

interface ClauseShape {
  trigger?: string;
  cost?: Record<string, unknown>;
}

describe('F8A-F1 invariant — duplicated identical-cost clause groups', () => {
  it('no card outside the documented exceptions repeats an identical cost on the same trigger', () => {
    const raw = readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf8');
    const cards = JSON.parse(raw) as Array<{
      id: string;
      effectSpecV2?: { clauses?: ClauseShape[] };
    }>;

    const violations: string[] = [];
    for (const card of cards) {
      if (EXCEPTIONS.includes(card.id)) continue;
      const groups = new Map<string, number>();
      for (const cl of card.effectSpecV2?.clauses ?? []) {
        if (cl.cost === undefined) continue;
        const key = `${cl.trigger}|${JSON.stringify(cl.cost, Object.keys(cl.cost).sort())}`;
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      for (const [key, count] of groups) {
        if (count > 1) violations.push(`${card.id}: ${count}× ${key}`);
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('every documented exception still exhibits the shape (prune the list as cards get fixed)', () => {
    const raw = readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf8');
    const cards = JSON.parse(raw) as Array<{
      id: string;
      effectSpecV2?: { clauses?: ClauseShape[] };
    }>;
    const stale: string[] = [];
    for (const id of EXCEPTIONS) {
      const card = cards.find((c) => c.id === id);
      const groups = new Map<string, number>();
      for (const cl of card?.effectSpecV2?.clauses ?? []) {
        if (cl.cost === undefined) continue;
        const key = `${cl.trigger}|${JSON.stringify(cl.cost, Object.keys(cl.cost).sort())}`;
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      if (![...groups.values()].some((n) => n > 1)) stale.push(id);
    }
    expect(stale, `fixed cards still in EXCEPTIONS: ${stale.join(', ')}`).toEqual([]);
  });
});
