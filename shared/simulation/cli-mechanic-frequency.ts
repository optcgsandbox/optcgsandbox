/**
 * Mechanic-frequency CLI — installs handler-invocation instrumentation,
 * runs a 1000-game stress batch via the existing runner, and dumps a
 * deterministic per-kind frequency JSON to
 * `shared/simulation/reports/mechanic-frequency-<seed>.json`.
 *
 * Usage:
 *   node --import tsx shared/simulation/cli-mechanic-frequency.ts \
 *     --games 1000 --seed-base 0 --adversarial true
 *
 * Flags:
 *   --games          number    default 1000
 *   --seed-base      number    default 0
 *   --adversarial    boolean   default true
 *
 * Determinism:
 *   - `coverage` is forced to `false` so on-disk coverage state cannot
 *     leak between runs (uncovered-card injection depends on disk).
 *   - `stopOnFailure` is forced to `false` so a single bad seed doesn't
 *     truncate the batch differently between runs.
 *   - `writeReports` is forced to `false` so failure-report disk writes
 *     don't affect the report content.
 *
 * Output JSON keys + nested keys are sorted alphabetically; identical
 * `seedBase` produces byte-identical output (asserted by the determinism
 * test at `__tests__/mechanicInstrument-determinism.test.ts`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBatch } from './runner.js';
import {
  buildReport,
  installMechanicInstrumentation,
  serializeReport,
  uninstallMechanicInstrumentation,
} from './mechanicInstrument.js';

interface ParsedArgs {
  games: number;
  seedBase: number;
  adversarial: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { games: 1000, seedBase: 0, adversarial: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const eq = a.indexOf('=');
    const key = eq === -1 ? a : a.slice(0, eq);
    const inlineVal = eq === -1 ? undefined : a.slice(eq + 1);
    const peek = inlineVal ?? argv[i + 1];
    const consume = inlineVal === undefined;
    switch (key) {
      case '--games':
        out.games = parseInt(peek ?? '1000', 10);
        if (consume) i += 1;
        break;
      case '--seed-base':
        out.seedBase = parseInt(peek ?? '0', 10);
        if (consume) i += 1;
        break;
      case '--adversarial':
        out.adversarial = !(peek === 'false' || peek === '0');
        if (consume) i += 1;
        break;
      case '--':
      case '':
        break;
      default:
        if (a.startsWith('--')) {
          console.warn(`[mechanic-frequency] unknown flag: ${a}`);
        }
    }
  }
  return out;
}

export interface RunFrequencyOutput {
  readonly reportPath: string;
  readonly json: string;
  readonly totalGames: number;
  readonly totalTicks: number;
}

/**
 * Run a deterministic, instrumented batch and write the report JSON.
 * Returns the path written + the serialized JSON for downstream uses
 * (e.g., the determinism self-test).
 */
export function runFrequencyBatch(args: ParsedArgs): RunFrequencyOutput {
  installMechanicInstrumentation();
  let summary;
  try {
    summary = runBatch({
      games: args.games,
      seedBase: args.seedBase,
      coverage: false,
      stopOnFailure: false,
      writeReports: false,
      adversarial: args.adversarial,
    });
  } finally {
    // Restore registries even if runBatch throws.
    uninstallMechanicInstrumentation();
  }

  const report = buildReport({
    totalGames: summary.totalGames,
    totalTicks: summary.totalTicks,
    seedBase: args.seedBase,
    adversarial: args.adversarial,
  });
  const json = serializeReport(report);

  const here = dirname(fileURLToPath(import.meta.url));
  const reportPath = resolve(here, 'reports', `mechanic-frequency-${args.seedBase}.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, json, 'utf8');

  return {
    reportPath,
    json,
    totalGames: summary.totalGames,
    totalTicks: summary.totalTicks,
  };
}

function isMainEntry(): boolean {
  if (typeof process === 'undefined' || process.argv.length < 2) return false;
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  return invoked === fileURLToPath(import.meta.url);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[mechanic-frequency] starting — games=${args.games} seedBase=${args.seedBase} adversarial=${args.adversarial}`,
  );
  const startedAt = Date.now();

  const out = runFrequencyBatch(args);

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(`[mechanic-frequency] done — ${out.totalGames} games / ${out.totalTicks} ticks in ${elapsedSec}s`);
  console.log(`[mechanic-frequency] report: ${out.reportPath}`);
}

if (isMainEntry()) main();
