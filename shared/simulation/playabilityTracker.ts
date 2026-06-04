/**
 * Phase 7 playability tracker — observer-only.
 *
 * Consumes finished `RunGameResult` objects and aggregates:
 *   - turn count distribution (P25 / P50 / P75 / min / max / mean)
 *   - tick count distribution (same percentiles)
 *   - ticks-per-turn ratio distribution
 *   - terminal categories (completed / failed / timeout)
 *   - winning side (A / B / null when no winner stamped)
 *   - win condition reason (state.result.reason) — counts per reason
 *   - top-level action-type (Action.type) distribution + unique types per game
 *
 * Reads RunGameResult.{ticks, turn, finalState.result, trace}. No engine
 * touch. No state mutation. Deterministic when fed deterministic inputs.
 */

import type { RunGameResult } from './runner.js';
import type { Action } from '../engine-v2/protocol/actions.js';

export interface PlayabilityPercentiles {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
}

export interface PlayabilityReport {
  readonly totalGames: number;
  readonly seedBase: number;
  readonly adversarial: boolean;
  readonly turn: PlayabilityPercentiles;
  readonly ticks: PlayabilityPercentiles;
  readonly ticksPerTurn: PlayabilityPercentiles;
  readonly uniqueActionTypesPerGame: PlayabilityPercentiles;
  readonly terminalCategories: Record<'completed' | 'failed' | 'timeout', number>;
  readonly winnerSide: Record<'A' | 'B' | 'none', number>;
  readonly winReason: Record<string, number>;
  readonly actionTypeDistribution: Record<string, number>;
}

function percentile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function summarize(values: ReadonlyArray<number>): PlayabilityPercentiles {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  if (count === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p25: 0, p50: 0, p75: 0 };
  }
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / count;
  return {
    count,
    min,
    max,
    mean: Math.round(mean * 1000) / 1000,
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
  };
}

function sortedObject(obj: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k]!;
  return out;
}

export class PlayabilityTracker {
  private turns: number[] = [];
  private ticks: number[] = [];
  private ticksPerTurn: number[] = [];
  private uniqueActionTypesPerGame: number[] = [];
  private terminalCategories: { completed: number; failed: number; timeout: number } = {
    completed: 0,
    failed: 0,
    timeout: 0,
  };
  private winnerSide: { A: number; B: number; none: number } = { A: 0, B: 0, none: 0 };
  private winReason: Record<string, number> = {};
  private actionTypeDistribution: Record<string, number> = {};

  reset(): void {
    this.turns = [];
    this.ticks = [];
    this.ticksPerTurn = [];
    this.uniqueActionTypesPerGame = [];
    this.terminalCategories = { completed: 0, failed: 0, timeout: 0 };
    this.winnerSide = { A: 0, B: 0, none: 0 };
    this.winReason = {};
    this.actionTypeDistribution = {};
  }

  observe(r: RunGameResult): void {
    this.turns.push(r.turn);
    this.ticks.push(r.ticks);
    this.ticksPerTurn.push(r.turn > 0 ? r.ticks / r.turn : 0);
    this.terminalCategories[r.result] += 1;

    // Winner / reason from finalState.result.
    const result = (r.finalState as { result?: { loser?: 'A' | 'B'; reason?: string } | null }).result;
    if (result === null || result === undefined) {
      this.winnerSide.none += 1;
    } else {
      const winner = result.loser === 'A' ? 'B' : result.loser === 'B' ? 'A' : null;
      if (winner === null) {
        this.winnerSide.none += 1;
      } else {
        this.winnerSide[winner] += 1;
      }
      const reason = result.reason ?? 'unknown';
      this.winReason[reason] = (this.winReason[reason] ?? 0) + 1;
    }

    // Action-type distribution from trace.
    const seenThisGame = new Set<string>();
    const trace = r.trace as ReadonlyArray<{ move?: Action }>;
    for (const entry of trace) {
      const move = entry.move;
      if (move === undefined) continue;
      const t = (move as { type?: unknown }).type;
      if (typeof t !== 'string') continue;
      this.actionTypeDistribution[t] = (this.actionTypeDistribution[t] ?? 0) + 1;
      seenThisGame.add(t);
    }
    this.uniqueActionTypesPerGame.push(seenThisGame.size);
  }

  report(args: { seedBase: number; adversarial: boolean }): PlayabilityReport {
    return {
      totalGames: this.turns.length,
      seedBase: args.seedBase,
      adversarial: args.adversarial,
      turn: summarize(this.turns),
      ticks: summarize(this.ticks),
      ticksPerTurn: summarize(this.ticksPerTurn),
      uniqueActionTypesPerGame: summarize(this.uniqueActionTypesPerGame),
      terminalCategories: { ...this.terminalCategories },
      winnerSide: { ...this.winnerSide },
      winReason: sortedObject(this.winReason),
      actionTypeDistribution: sortedObject(this.actionTypeDistribution),
    };
  }
}

export function serializePlayabilityReport(report: PlayabilityReport): string {
  // Deterministic top-level key order.
  const order: ReadonlyArray<keyof PlayabilityReport> = [
    'totalGames',
    'seedBase',
    'adversarial',
    'terminalCategories',
    'winnerSide',
    'turn',
    'ticks',
    'ticksPerTurn',
    'uniqueActionTypesPerGame',
    'winReason',
    'actionTypeDistribution',
  ];
  const ordered: Record<string, unknown> = {};
  for (const key of order) ordered[key] = report[key];
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
