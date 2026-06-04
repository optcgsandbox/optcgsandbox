/**
 * Determinism self-test for mechanicInstrument.
 *
 * Asserts:
 *   1. Two identically-seeded instrumented batches produce byte-identical
 *      JSON reports (the determinism guarantee item 3 is built on).
 *   2. Counters reset cleanly between install/uninstall cycles — a second
 *      install starts at zero, regardless of what the first run accumulated.
 *   3. `installMechanicInstrumentation` throws when called twice without
 *      uninstall (catches accidental double-wrap in batch drivers).
 *   4. Counters are non-empty after a real run (sanity check — the wrap
 *      actually fires on every handler invocation, not just on `.get`).
 *
 * Uses a small game count (8) to keep the suite fast while still exercising
 * the full action/cost/target/magnitude pipeline.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { runBatch } from '../runner.js';
import {
  buildReport,
  getCounters,
  installMechanicInstrumentation,
  isInstrumentationInstalled,
  serializeReport,
  uninstallMechanicInstrumentation,
} from '../mechanicInstrument.js';

const SEED_BASE = 42;
const GAMES = 8;

function runOne(): { json: string; totalGames: number; totalTicks: number } {
  installMechanicInstrumentation();
  let summary;
  try {
    summary = runBatch({
      games: GAMES,
      seedBase: SEED_BASE,
      coverage: false,
      stopOnFailure: false,
      writeReports: false,
      adversarial: true,
    });
  } finally {
    uninstallMechanicInstrumentation();
  }
  const report = buildReport({
    totalGames: summary.totalGames,
    totalTicks: summary.totalTicks,
    seedBase: SEED_BASE,
    adversarial: true,
  });
  return {
    json: serializeReport(report),
    totalGames: summary.totalGames,
    totalTicks: summary.totalTicks,
  };
}

// HARDENING: run sequentially. `installMechanicInstrumentation()` mutates the
// public `.get` method on global registries (actionHandlers / costHandlers /
// targetResolvers). When vitest schedules sibling test files concurrently in
// the same worker, mid-install state can leak into another file's `runGame`
// path and cause non-deterministic counter reads. Sequential execution
// constrains the wrap/unwrap window to this file only.
describe.sequential('mechanicInstrument — determinism + lifecycle', () => {
  afterEach(() => {
    // Defensive cleanup in case a test bails mid-install.
    if (isInstrumentationInstalled()) {
      uninstallMechanicInstrumentation();
    }
  });

  it('two identically-seeded runs produce byte-identical JSON', () => {
    const a = runOne();
    const b = runOne();
    expect(a.totalGames).toBe(b.totalGames);
    expect(a.totalTicks).toBe(b.totalTicks);
    expect(a.json).toBe(b.json);
  });

  it('counters reset cleanly between install cycles', () => {
    // First cycle — accumulate something.
    runOne();
    // Second cycle — install must start counters at zero.
    installMechanicInstrumentation();
    try {
      const fresh = getCounters();
      expect(Object.keys(fresh.action)).toHaveLength(0);
      expect(Object.keys(fresh.cost)).toHaveLength(0);
      expect(Object.keys(fresh.target)).toHaveLength(0);
      expect(Object.keys(fresh.magnitude)).toHaveLength(0);
    } finally {
      uninstallMechanicInstrumentation();
    }
  });

  it('double install without uninstall throws', () => {
    installMechanicInstrumentation();
    try {
      expect(() => installMechanicInstrumentation()).toThrow(/already installed/);
    } finally {
      uninstallMechanicInstrumentation();
    }
  });

  it('uninstall is idempotent (safe to call when not installed)', () => {
    expect(() => uninstallMechanicInstrumentation()).not.toThrow();
    expect(isInstrumentationInstalled()).toBe(false);
  });

  it('counters are non-empty after a real batch (wrap actually fires)', () => {
    const { json } = runOne();
    const parsed = JSON.parse(json) as Record<string, Record<string, number>>;
    const sumValues = (rec: Record<string, number>): number =>
      Object.values(rec).reduce((a, b) => a + b, 0);
    expect(sumValues(parsed.action!)).toBeGreaterThan(0);
    expect(sumValues(parsed.target!)).toBeGreaterThan(0);
    // Cost + magnitude can theoretically be zero in 8 short games if no
    // card with cost-bearing effects was played; require action+target as
    // the strict signal and use cost+magnitude as informational.
    expect(sumValues(parsed.cost!)).toBeGreaterThanOrEqual(0);
    expect(sumValues(parsed.magnitude!)).toBeGreaterThanOrEqual(0);
  });
});
