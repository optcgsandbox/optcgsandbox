/**
 * Engine V2 — corpus execution coverage harness (multi-scenario).
 *
 * Loads ALL cards from cards.json. For each card, iterates the
 * deterministic SCENARIOS library at shared/engine-v2/tests/corpus-scenarios.ts
 * and drives every card-clause trigger through real EffectDispatcher.dispatch.
 *
 * For each card, aggregates the BEST outcome across all applicable
 * (scenario, trigger) pairs. Category ranks (best to worst):
 *   FULL_COVERAGE > PARTIAL_COVERAGE > NOT_TRIGGERED > ERROR
 *
 * The harness reports:
 *   - category distribution (BASELINE single-state vs MULTI-SCENARIO)
 *   - cards upgraded PARTIAL → FULL by better scenario matching
 *   - newly-exercised triggers (triggers that BASELINE never reached but
 *     scenarios did)
 *   - ERROR cards grouped by root cause
 *   - ClauseScratch users (cards with bind/BindingRef in spec)
 *
 * Rules: NO engine code mutation; NO card-data mutation; observation only.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error
import { resolve } from 'node:path';
// @ts-expect-error
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card } from '../cards/Card.js';
import { EffectDispatcher } from '../effects/EffectDispatcher.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';
import type { EffectClauseV2 } from '../spec/types.js';
import type { GameState } from '../state/types.js';

import {
  applicableScenarios,
  BASELINE,
  type Scenario,
} from '../tests/corpus-scenarios.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

// ────────────────────────────────────────────────────────────────────
// Metrics
// ────────────────────────────────────────────────────────────────────

interface PerScenarioTriggerMetrics {
  readonly scenario: string;
  readonly trigger: string;
  readonly trigger_fired: boolean;
  readonly clause_executed: boolean;
  readonly cost_phase_reached: boolean;
  readonly target_phase_reached: boolean;
  readonly action_phase_reached: boolean;
  readonly replacement_invoked: boolean;
  readonly pending_triggered: boolean;
  readonly scratch_used: boolean;
  readonly error?: string;
}

type Category = 'FULL_COVERAGE' | 'PARTIAL_COVERAGE' | 'NOT_TRIGGERED' | 'ERROR';

interface CardCoverage {
  readonly cardId: string;
  readonly baselineCategory: Category;
  readonly bestCategory: Category;
  readonly upgradedFromBaseline: boolean;
  readonly bestScenarioName: string | null;
  readonly metrics: ReadonlyArray<PerScenarioTriggerMetrics>;
  readonly hasClauses: boolean;
  readonly usesBindingsInSpec: boolean;
  readonly triggers: ReadonlyArray<string>;
  readonly firedTriggers: ReadonlyArray<string>;
  readonly baselineFiredTriggers: ReadonlyArray<string>;
}

function categoryRank(c: Category): number {
  switch (c) {
    case 'FULL_COVERAGE': return 3;
    case 'PARTIAL_COVERAGE': return 2;
    case 'NOT_TRIGGERED': return 1;
    case 'ERROR': return 0;
  }
}

function clauseUsesScratch(clause: EffectClauseV2): boolean {
  function hasBindingRef(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as { kind?: unknown };
    if (v.kind === 'binding') return true;
    if (Array.isArray(value)) return value.some(hasBindingRef);
    for (const k of Object.keys(value as Record<string, unknown>)) {
      if (hasBindingRef((value as Record<string, unknown>)[k])) return true;
    }
    return false;
  }
  const target = clause.target as { bind?: unknown } | undefined;
  const cost = clause.cost as { bind?: unknown } | undefined;
  const action = clause.action as { bind?: unknown } | undefined;
  if (target && typeof target.bind === 'string') return true;
  if (cost && typeof cost.bind === 'string') return true;
  if (action && typeof action.bind === 'string') return true;
  return (
    hasBindingRef(clause.target) ||
    hasBindingRef(clause.cost) ||
    hasBindingRef(clause.action) ||
    hasBindingRef(clause.condition)
  );
}

// ────────────────────────────────────────────────────────────────────
// Single (scenario, trigger) dispatch — observation only
// ────────────────────────────────────────────────────────────────────

interface SingleRunOutcome {
  readonly category: Category;
  readonly metrics: PerScenarioTriggerMetrics;
}

function runSingle(
  card: Card,
  scenario: Scenario,
  trigger: string,
  matchedClauses: ReadonlyArray<EffectClauseV2>,
): SingleRunOutcome {
  const { state, sourceId } = scenario.build(card);
  const historyBefore = state.history.length;
  let after: GameState;
  try {
    after = EffectDispatcher.dispatch(state, { sourceInstanceId: sourceId, controller: 'A' }, trigger);
  } catch (e) {
    return {
      category: 'ERROR',
      metrics: {
        scenario: scenario.name, trigger,
        trigger_fired: true, clause_executed: false,
        cost_phase_reached: false, target_phase_reached: false,
        action_phase_reached: false, replacement_invoked: false,
        pending_triggered: false, scratch_used: false,
        error: (e as Error).message,
      },
    };
  }

  const newEvents = (after.history as ReadonlyArray<{ type?: string }>).slice(historyBefore);
  const clauseFired = newEvents.some((e) => e?.type === 'CLAUSE_FIRED');
  const replacementFired = newEvents.some((e) => e?.type === 'REPLACEMENT_FIRED');
  const pendingActive = after.pending !== null;
  const usesScratch = matchedClauses.some(clauseUsesScratch);

  return {
    category: clauseFired ? 'FULL_COVERAGE' : 'PARTIAL_COVERAGE',
    metrics: {
      scenario: scenario.name, trigger,
      trigger_fired: true,
      clause_executed: clauseFired,
      cost_phase_reached: clauseFired && matchedClauses.some((c) => c.cost !== undefined),
      target_phase_reached: clauseFired && matchedClauses.some((c) => c.target !== undefined),
      action_phase_reached: clauseFired,
      replacement_invoked: replacementFired,
      pending_triggered: pendingActive,
      scratch_used: usesScratch,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Multi-scenario card evaluation
// ────────────────────────────────────────────────────────────────────

function evaluateCard(card: Card): CardCoverage {
  const spec = card.effectSpecV2;
  const clauses: ReadonlyArray<EffectClauseV2> = (spec && Array.isArray(spec.clauses)) ? spec.clauses : [];
  const hasClauses = clauses.length > 0;
  const usesBindingsInSpec = clauses.some(clauseUsesScratch);
  const uniqueTriggers = Array.from(new Set(clauses.map((c) => c.trigger))).sort();

  if (!hasClauses) {
    return {
      cardId: card.id,
      baselineCategory: 'NOT_TRIGGERED',
      bestCategory: 'NOT_TRIGGERED',
      upgradedFromBaseline: false,
      bestScenarioName: null,
      metrics: [],
      hasClauses: false,
      usesBindingsInSpec: false,
      triggers: [],
      firedTriggers: [],
      baselineFiredTriggers: [],
    };
  }

  const scenarios = applicableScenarios(card);
  const allMetrics: PerScenarioTriggerMetrics[] = [];
  let bestCategory: Category = 'NOT_TRIGGERED';
  let bestScenarioName: string | null = null;
  let baselineCategory: Category = 'NOT_TRIGGERED';
  const firedTriggers = new Set<string>();
  const baselineFiredTriggers = new Set<string>();

  for (const scenario of scenarios) {
    let scenarioBest: Category = 'NOT_TRIGGERED';
    for (const trig of uniqueTriggers) {
      const matched = clauses.filter((c) => c.trigger === trig);
      const out = runSingle(card, scenario, trig, matched);
      allMetrics.push(out.metrics);
      if (categoryRank(out.category) > categoryRank(scenarioBest)) scenarioBest = out.category;
      if (out.metrics.clause_executed) firedTriggers.add(trig);
      if (scenario.name === BASELINE.name && out.metrics.clause_executed) {
        baselineFiredTriggers.add(trig);
      }
    }
    if (scenario.name === BASELINE.name) baselineCategory = scenarioBest;
    if (categoryRank(scenarioBest) > categoryRank(bestCategory)) {
      bestCategory = scenarioBest;
      bestScenarioName = scenario.name;
    }
  }

  return {
    cardId: card.id,
    baselineCategory,
    bestCategory,
    upgradedFromBaseline:
      categoryRank(bestCategory) > categoryRank(baselineCategory),
    bestScenarioName,
    metrics: allMetrics,
    hasClauses: true,
    usesBindingsInSpec,
    triggers: uniqueTriggers,
    firedTriggers: [...firedTriggers].sort(),
    baselineFiredTriggers: [...baselineFiredTriggers].sort(),
  };
}

// ────────────────────────────────────────────────────────────────────
// Vitest entry
// ────────────────────────────────────────────────────────────────────

function loadCards(): Card[] {
  const raw = readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf-8');
  return JSON.parse(raw) as Card[];
}

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

describe('corpus execution coverage harness (multi-scenario)', () => {
  it('produces a multi-scenario per-card execution report', () => {
    const cards = loadCards();
    const results: CardCoverage[] = cards.map(evaluateCard);

    const total = results.length;
    const baselineDist: Record<Category, number> = {
      FULL_COVERAGE: 0, PARTIAL_COVERAGE: 0, NOT_TRIGGERED: 0, ERROR: 0,
    };
    const bestDist: Record<Category, number> = {
      FULL_COVERAGE: 0, PARTIAL_COVERAGE: 0, NOT_TRIGGERED: 0, ERROR: 0,
    };
    for (const r of results) {
      baselineDist[r.baselineCategory] += 1;
      bestDist[r.bestCategory] += 1;
    }
    const withClauses = results.filter((r) => r.hasClauses);
    const baselineFullOfClause = withClauses.filter((r) => r.baselineCategory === 'FULL_COVERAGE').length;
    const bestFullOfClause = withClauses.filter((r) => r.bestCategory === 'FULL_COVERAGE').length;
    const baselinePct = withClauses.length > 0 ? (baselineFullOfClause / withClauses.length) * 100 : 0;
    const bestPct = withClauses.length > 0 ? (bestFullOfClause / withClauses.length) * 100 : 0;
    const upgraded = results.filter((r) => r.upgradedFromBaseline);
    const partialToFull = upgraded.filter((r) => r.baselineCategory === 'PARTIAL_COVERAGE' && r.bestCategory === 'FULL_COVERAGE');

    // Triggers exercised under any scenario but not baseline.
    const newlyExercisedTriggers = new Set<string>();
    const baselineExercisedTriggers = new Set<string>();
    for (const r of results) {
      for (const t of r.firedTriggers) newlyExercisedTriggers.add(t);
      for (const t of r.baselineFiredTriggers) baselineExercisedTriggers.add(t);
    }
    for (const t of baselineExercisedTriggers) newlyExercisedTriggers.delete(t);

    const scratchUsers = results.filter((r) => r.usesBindingsInSpec);

    /* eslint-disable no-console */
    console.log('\n========== MULTI-SCENARIO COVERAGE REPORT ==========');
    console.log(`Total cards in corpus:                ${total}`);
    console.log(`Cards with effectSpecV2.clauses:      ${withClauses.length}`);
    console.log(`Vanilla / no-clause cards:            ${total - withClauses.length}`);
    console.log(`Cards with ClauseScratch in spec:     ${scratchUsers.length}`);
    console.log('--- BASELINE (single-state) distribution ---');
    console.log(`FULL_COVERAGE:                        ${baselineDist.FULL_COVERAGE}`);
    console.log(`PARTIAL_COVERAGE:                     ${baselineDist.PARTIAL_COVERAGE}`);
    console.log(`NOT_TRIGGERED:                        ${baselineDist.NOT_TRIGGERED}`);
    console.log(`ERROR:                                ${baselineDist.ERROR}`);
    console.log(`% FULL of clause-bearing:             ${baselinePct.toFixed(1)}%`);
    console.log('--- MULTI-SCENARIO (best of applicable scenarios) ---');
    console.log(`FULL_COVERAGE:                        ${bestDist.FULL_COVERAGE}`);
    console.log(`PARTIAL_COVERAGE:                     ${bestDist.PARTIAL_COVERAGE}`);
    console.log(`NOT_TRIGGERED:                        ${bestDist.NOT_TRIGGERED}`);
    console.log(`ERROR:                                ${bestDist.ERROR}`);
    console.log(`% FULL of clause-bearing:             ${bestPct.toFixed(1)}%`);
    console.log('--- DELTAS ---');
    console.log(`Cards upgraded (any → better):        ${upgraded.length}`);
    console.log(`Cards upgraded PARTIAL → FULL:        ${partialToFull.length}`);
    console.log(`FULL_COVERAGE absolute delta:         +${bestDist.FULL_COVERAGE - baselineDist.FULL_COVERAGE}`);

    if (partialToFull.length > 0) {
      console.log('\n--- PARTIAL → FULL upgrades (sample of first 25) ---');
      for (const r of partialToFull.slice(0, 25)) {
        const newlyFired = r.firedTriggers.filter((t) => !r.baselineFiredTriggers.includes(t));
        console.log(`  ${r.cardId}  via=${r.bestScenarioName}  newTriggers=[${newlyFired.join('|')}]`);
      }
      if (partialToFull.length > 25) console.log(`  …and ${partialToFull.length - 25} more`);
    }

    if (newlyExercisedTriggers.size > 0) {
      console.log('\n--- Triggers newly exercised by scenarios (not by BASELINE) ---');
      for (const t of [...newlyExercisedTriggers].sort()) {
        console.log(`  ${t}`);
      }
    } else {
      console.log('\n--- Triggers newly exercised by scenarios: NONE ---');
    }

    const errorCards = results.filter((r) => r.bestCategory === 'ERROR');
    if (errorCards.length > 0) {
      console.log('\n--- ERROR root causes (grouped) ---');
      const grouped = new Map<string, string[]>();
      for (const e of errorCards) {
        const errMetric = [...e.metrics].reverse().find((m) => m.error !== undefined);
        const msg = errMetric?.error ?? 'unknown';
        const key = msg.replace(/instance="[^"]+"/g, 'instance=…')
                       .replace(/[A-Z]{2}\d{2}-\d{3}/g, '<cardId>')
                       .slice(0, 100);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(e.cardId);
      }
      for (const [k, ids] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`  [${ids.length}] ${k}`);
        console.log(`        → ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? `, …(+${ids.length - 6} more)` : ''}`);
      }
    } else {
      console.log('\n--- ERROR cards: NONE ---');
    }

    if (scratchUsers.length > 0) {
      console.log('\n--- ClauseScratch users (cards with bind/BindingRef in spec) ---');
      for (const r of scratchUsers) {
        console.log(`  ${r.cardId}  baseline=${r.baselineCategory}  best=${r.bestCategory}  via=${r.bestScenarioName ?? '-'}`);
      }
    }

    console.log('=====================================================\n');
    /* eslint-enable no-console */

    // Observability test — always passes; value is the console output.
    expect(total).toBeGreaterThan(0);
  }, 120_000);
});
