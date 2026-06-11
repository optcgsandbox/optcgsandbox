// counter-event-double-count-corpus-audit — Stage B AUDIT spec.
//
// Reads `shared/data/cards.json` directly (no browser); enumerates
// every event card where `counterEventBoost > 0` AND at least one
// `effectSpecV2.clauses[]` matches the double-encoded pattern:
//
//   trigger === 'on_play'
//   action.kind === 'power_buff'
//   target.kind ∈ DEFENDER_TARGET_KINDS
//
// For each suspect clause, classifies as:
//
//   SAFE_TO_DATA_FIX_NOW  : unconditional, no cost, no opt, target is
//     defender-equivalent, magnitude exactly equals counterEventBoost
//     ⇒ safe to remove the clause from cards.json without breaking
//     any other semantics.
//
//   NEEDS_MANUAL_REVIEW   : duplicate clause has extra condition/cost/
//     opt OR magnitude !== counterEventBoost (e.g. multi-part text
//     like OP01-029 "+2000; if life≤2 +2000 more" where the
//     counterEventBoost is the SUM of multiple clause magnitudes).
//
//   NOT_DUPLICATE         : power_buff clause targets a non-defender
//     scope (e.g. opp_leader_or_character) — not actually redundant
//     with counterEventBoost.
//
// AUDIT semantics: test PASSES on clean data capture; the report IS
// the output. No edits.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect } from '@playwright/test';

interface Action {
  kind?: string;
  magnitude?: number;
  duration?: string;
  filter?: Record<string, unknown>;
}

interface Target {
  kind?: string;
  filter?: Record<string, unknown>;
}

interface Clause {
  trigger?: string;
  action?: Action;
  target?: Target;
  condition?: { type?: string } & Record<string, unknown>;
  cost?: Record<string, unknown>;
  opt?: boolean;
  verified?: string;
}

interface CardLike {
  id: string;
  name: string;
  kind: string;
  counterEventBoost?: number | null;
  effectSpecV2?: { clauses?: Clause[] };
}

interface SuspectFinding {
  cardId: string;
  cardName: string;
  counterEventBoost: number;
  clauseIndex: number;
  magnitude: number;
  targetKind: string;
  hasCondition: boolean;
  conditionType: string | null;
  hasCost: boolean;
  hasOpt: boolean;
  classification: 'SAFE_TO_DATA_FIX_NOW' | 'NEEDS_MANUAL_REVIEW' | 'NOT_DUPLICATE';
  reason: string;
}

// Target kinds that resolve to the defender (your_leader_or_character
// for the controller of the counter event during counter_window =
// the defender). NOT_DUPLICATE catch is `opp_leader_or_character` etc.
const DEFENDER_TARGET_KINDS = new Set([
  'your_leader_or_character',
  'your_leader',
  'self',
]);

function loadCorpus(): CardLike[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const path = resolve(__dirname, '../shared/data/cards.json');
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  return (Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, unknown>)) as CardLike[];
}

function classifyClause(card: CardLike, clause: Clause): SuspectFinding | null {
  if (clause.trigger !== 'on_play') return null;
  if (clause.action?.kind !== 'power_buff') return null;
  const targetKind = clause.target?.kind ?? '<none>';
  const magnitude = clause.action?.magnitude ?? 0;
  const hasCondition = clause.condition !== undefined && clause.condition !== null;
  const hasCost = clause.cost !== undefined && Object.keys(clause.cost ?? {}).length > 0;
  const hasOpt = clause.opt === true;
  const boost = card.counterEventBoost ?? 0;

  let classification: SuspectFinding['classification'];
  const reasons: string[] = [];

  if (!DEFENDER_TARGET_KINDS.has(targetKind)) {
    classification = 'NOT_DUPLICATE';
    reasons.push(`target=${targetKind} (not defender-equivalent)`);
  } else if (hasCondition || hasCost || hasOpt) {
    classification = 'NEEDS_MANUAL_REVIEW';
    if (hasCondition) reasons.push(`condition=${clause.condition?.type ?? '?'}`);
    if (hasCost) reasons.push(`cost=${JSON.stringify(clause.cost)}`);
    if (hasOpt) reasons.push('opt=true');
  } else if (magnitude !== boost) {
    classification = 'NEEDS_MANUAL_REVIEW';
    reasons.push(`magnitude ${magnitude} !== counterEventBoost ${boost}`);
  } else {
    classification = 'SAFE_TO_DATA_FIX_NOW';
    reasons.push('unconditional, no cost, no opt, magnitude exactly equals counterEventBoost');
  }

  return {
    cardId: card.id,
    cardName: card.name,
    counterEventBoost: boost,
    clauseIndex: card.effectSpecV2!.clauses!.indexOf(clause),
    magnitude,
    targetKind,
    hasCondition,
    conditionType: clause.condition?.type ?? null,
    hasCost,
    hasOpt,
    classification,
    reason: reasons.join('; '),
  };
}

test.describe('counter-event double-count corpus audit', () => {
  test('enumerate all corpus counter events with double-encoded defender power_buff', async () => {
    const corpus = loadCorpus();
    const events = corpus.filter((c) => c.kind === 'event');
    const counterEvents = events.filter((c) => (c.counterEventBoost ?? 0) > 0);

    const findings: SuspectFinding[] = [];
    for (const c of counterEvents) {
      const clauses = c.effectSpecV2?.clauses ?? [];
      for (const cl of clauses) {
        const f = classifyClause(c, cl);
        if (f !== null) findings.push(f);
      }
    }

    const safe = findings.filter((f) => f.classification === 'SAFE_TO_DATA_FIX_NOW');
    const manual = findings.filter((f) => f.classification === 'NEEDS_MANUAL_REVIEW');
    const notDup = findings.filter((f) => f.classification === 'NOT_DUPLICATE');
    const safeCardIds = new Set(safe.map((f) => f.cardId));
    const manualCardIds = new Set(manual.map((f) => f.cardId));

    /* eslint-disable no-console */
    console.log('\n=== COUNTER-EVENT DOUBLE-COUNT CORPUS AUDIT ===');
    console.log(`total events: ${events.length}`);
    console.log(`total counter events (counterEventBoost > 0): ${counterEvents.length}`);
    console.log(`total power_buff clauses targeting defender / self: ${findings.length}`);
    console.log(`  SAFE_TO_DATA_FIX_NOW clauses: ${safe.length}  (distinct cards: ${safeCardIds.size})`);
    console.log(`  NEEDS_MANUAL_REVIEW  clauses: ${manual.length}  (distinct cards: ${manualCardIds.size})`);
    console.log(`  NOT_DUPLICATE        clauses: ${notDup.length}`);

    console.log('\n--- SAFE_TO_DATA_FIX_NOW (full list) ---');
    console.log(['cardId', 'name', 'boost', 'clauseIdx', 'mag', 'target', 'reason'].join('\t'));
    for (const f of safe) {
      console.log([f.cardId, f.cardName.slice(0, 40), f.counterEventBoost, f.clauseIndex, f.magnitude, f.targetKind, f.reason].join('\t'));
    }

    console.log('\n--- NEEDS_MANUAL_REVIEW (full list) ---');
    console.log(['cardId', 'name', 'boost', 'clauseIdx', 'mag', 'target', 'condType', 'hasCost', 'hasOpt', 'reason'].join('\t'));
    for (const f of manual) {
      console.log([f.cardId, f.cardName.slice(0, 40), f.counterEventBoost, f.clauseIndex, f.magnitude, f.targetKind, f.conditionType ?? '-', f.hasCost, f.hasOpt, f.reason].join('\t'));
    }

    console.log('\n--- NOT_DUPLICATE (sample first 10) ---');
    for (const f of notDup.slice(0, 10)) {
      console.log([f.cardId, f.cardName.slice(0, 40), f.targetKind, f.magnitude].join('\t'));
    }

    console.log('\n=== END REPORT ===\n');
    /* eslint-enable no-console */

    // Audit invariants: at minimum, the 7 OP01 already-tested suspects
    // must appear in findings.
    const op01Suspects = ['OP01-026', 'OP01-029', 'OP01-057', 'OP01-058', 'OP01-086', 'OP01-088', 'OP01-119'];
    for (const id of op01Suspects) {
      expect(findings.some((f) => f.cardId === id), `${id} present in findings`).toBe(true);
    }

    // Expose results for downstream patch step via the report.
    expect(findings.length, 'findings collected').toBeGreaterThan(0);
  });
});
