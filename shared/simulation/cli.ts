/**
 * CLI entrypoint for the simulation layer.
 *
 *   node --import tsx shared/simulation/cli.ts -- --games 10000 --coverage true
 *
 * Flags:
 *   --games            number      default 1000
 *   --coverage         boolean     default true
 *   --seed-base        number      default 0
 *   --stop-on-failure  boolean     default true
 *   --no-reports                   suppress disk reports
 */

import { runBatch } from './runner.js';
import type { CoverageTracker } from './coverageTracker.js';

interface ParsedArgs {
  games: number;
  coverage: boolean;
  seedBase: number;
  stopOnFailure: boolean;
  writeReports: boolean;
  adversarial: boolean;
  focusEveryN: number;
  focusK: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    games: 1000,
    coverage: true,
    seedBase: 0,
    stopOnFailure: true,
    writeReports: true,
    adversarial: false,
    focusEveryN: 25,
    focusK: 4,
  };
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
      case '--coverage':
        out.coverage = !(peek === 'false' || peek === '0');
        if (consume) i += 1;
        break;
      case '--seed-base':
        out.seedBase = parseInt(peek ?? '0', 10);
        if (consume) i += 1;
        break;
      case '--stop-on-failure':
        out.stopOnFailure = !(peek === 'false' || peek === '0');
        if (consume) i += 1;
        break;
      case '--no-reports':
        out.writeReports = false;
        break;
      case '--adversarial':
        out.adversarial = !(peek === 'false' || peek === '0');
        if (consume) i += 1;
        break;
      case '--focus-every':
        out.focusEveryN = parseInt(peek ?? '25', 10);
        if (consume) i += 1;
        break;
      case '--focus-k':
        out.focusK = parseInt(peek ?? '4', 10);
        if (consume) i += 1;
        break;
      case '--':
        break;
      default:
        if (!a.startsWith('--')) break;
        // Unknown flag → log and continue
        console.warn(`[simulate] unknown flag: ${a}`);
    }
  }
  return out;
}

function fmtPercent(n: number): string {
  return `${n.toFixed(2)}%`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[simulate] starting — games=${args.games} coverage=${args.coverage} seedBase=${args.seedBase} stopOnFailure=${args.stopOnFailure}`);
  const startedAt = Date.now();

  const onProgress = (i: number, total: number, tracker: CoverageTracker, failures: number): void => {
    const pct = fmtPercent(tracker.coveragePercent());
    const elapsedMs = Date.now() - startedAt;
    const rate = i / Math.max(0.001, elapsedMs / 1000);
    console.log(`[simulate] ${i}/${total} | coverage ${pct} (${tracker.coveredCount()}/${tracker.totalCards()}) | failures ${failures} | ${rate.toFixed(1)} games/s`);
  };

  const summary = runBatch({
    games: args.games,
    seedBase: args.seedBase,
    coverage: args.coverage,
    stopOnFailure: args.stopOnFailure,
    writeReports: args.writeReports,
    adversarial: args.adversarial,
    focusEveryN: args.focusEveryN,
    focusK: args.focusK,
    onProgress,
  });

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);

  console.log('');
  console.log('============================================================');
  console.log('SIMULATION SUMMARY');
  console.log('============================================================');
  console.log(`Total games:        ${summary.totalGames}`);
  console.log(`Elapsed:            ${elapsedSec}s`);
  console.log(`Corpus size:        ${summary.corpusSize} cards`);
  console.log(`Cards covered:      ${summary.coveredCount} (${fmtPercent(summary.coveragePercent)})`);
  console.log(`Cards uncovered:    ${summary.uncoveredCards.length}`);
  console.log(`Failures:           ${summary.failures}`);
  if (summary.failures > 0) {
    console.log('Failures by kind:');
    for (const [kind, count] of Object.entries(summary.failureByKind)) {
      if (count > 0) console.log(`  ${kind.padEnd(20)} ${count}`);
    }
    console.log(`Failure seeds (first 20): ${summary.failureSeeds.slice(0, 20).join(', ')}`);
    if (summary.reportPaths.length > 0) {
      console.log(`Reports written to: ${summary.reportPaths[0]} ... (${summary.reportPaths.length} total)`);
    }
  }
  if (summary.uncoveredCards.length > 0 && summary.uncoveredCards.length <= 50) {
    console.log(`Uncovered cards: ${summary.uncoveredCards.join(', ')}`);
  } else if (summary.uncoveredCards.length > 50) {
    console.log(`Uncovered cards (first 50): ${summary.uncoveredCards.slice(0, 50).join(', ')} ... (+${summary.uncoveredCards.length - 50} more)`);
  }
  if (args.adversarial && summary.exposureTop20.length > 0) {
    console.log('');
    console.log('Top 20 exposureDepth cards (most-exercised):');
    for (const e of summary.exposureTop20) console.log(`  ${e.cardId.padEnd(12)} depth=${e.depth.toFixed(2)}`);
    console.log('');
    console.log('Bottom 20 exposureDepth cards (least-exercised, >0 depth filter):');
    const nonZero = summary.exposureBottom20.filter((e) => e.depth > 0).slice(0, 20);
    const showBottom = nonZero.length >= 20 ? nonZero : summary.exposureBottom20;
    for (const e of showBottom) console.log(`  ${e.cardId.padEnd(12)} depth=${e.depth.toFixed(2)}`);
  }
  console.log('============================================================');

  process.exit(summary.failures > 0 ? 1 : 0);
}

main();
