/**
 * Phase 7 — T1 playability driver. Runs N games deterministically and
 * writes a per-game-aggregate report.
 *
 * Bypasses `runBatch` (which doesn't expose per-game results) and uses
 * `runGame` directly — same engine + same seed → same outcome.
 *
 * Output (deterministic across runs at fixed seedBase):
 *   - shared/simulation/reports/playability-<seed>.json
 *   - shared/simulation/reports/playability-<seed>.md
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGame } from './runner.js';
import { computeCardMeta } from './cardMeta.js';
import { loadAllCards } from './stateInit.js';
import {
  PlayabilityTracker,
  serializePlayabilityReport,
  type PlayabilityReport,
} from './playabilityTracker.js';
import { writeConcedeTraceReport } from './concedeTrace.js';

export interface PlayabilityArgs {
  games: number;
  seedBase: number;
  adversarial: boolean;
}

export interface PlayabilityRunOutput {
  readonly jsonPath: string;
  readonly markdownPath: string;
  readonly report: PlayabilityReport;
  readonly elapsedSec: number;
}

function fmtPct(v: PlayabilityReport['turn']): string {
  return `p25=${v.p25} p50=${v.p50} p75=${v.p75} min=${v.min} max=${v.max} mean=${v.mean}`;
}

function fmtTable(label: string, v: PlayabilityReport['turn']): string {
  return `| ${label} | ${v.count} | ${v.min} | ${v.p25} | ${v.p50} | ${v.p75} | ${v.max} | ${v.mean} |`;
}

function renderMarkdown(r: PlayabilityReport): string {
  const lines: string[] = [];
  lines.push(`# Playability — seedBase=${r.seedBase}`);
  lines.push('');
  lines.push(`- Games: ${r.totalGames}`);
  lines.push(`- Adversarial: ${r.adversarial}`);
  lines.push('');
  lines.push('## Distributions');
  lines.push('');
  lines.push('| Metric | n | min | P25 | P50 | P75 | max | mean |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  lines.push(fmtTable('turn', r.turn));
  lines.push(fmtTable('ticks', r.ticks));
  lines.push(fmtTable('ticksPerTurn', r.ticksPerTurn));
  lines.push(fmtTable('uniqueActionTypesPerGame', r.uniqueActionTypesPerGame));
  lines.push('');
  lines.push('## Terminal categories');
  lines.push('');
  for (const [k, v] of Object.entries(r.terminalCategories)) lines.push(`- ${k}: **${v}**`);
  lines.push('');
  lines.push('## Winner side');
  lines.push('');
  for (const [k, v] of Object.entries(r.winnerSide)) lines.push(`- ${k}: **${v}**`);
  lines.push('');
  lines.push('## Win reason');
  lines.push('');
  if (Object.keys(r.winReason).length === 0) {
    lines.push('_none recorded_');
  } else {
    for (const [k, v] of Object.entries(r.winReason)) lines.push(`- \`${k}\`: ${v}`);
  }
  lines.push('');
  lines.push('## Top-level action-type frequency');
  lines.push('');
  const sortedActions = Object.entries(r.actionTypeDistribution).sort((a, b) => b[1] - a[1]);
  lines.push('| Rank | Type | Count |');
  lines.push('|---:|------|------:|');
  sortedActions.slice(0, 20).forEach(([k, v], i) => lines.push(`| ${i + 1} | \`${k}\` | ${v} |`));
  return lines.join('\n');
}

export function runPlayability(args: PlayabilityArgs): PlayabilityRunOutput {
  const allCards = loadAllCards();
  const cardMeta = args.adversarial ? computeCardMeta(allCards) : new Map();
  const tracker = new PlayabilityTracker();
  const startedAt = Date.now();
  const concedeTraceEnabled = process.env['CONCEDE_TRACE'] === '1';
  const concedeTraceResults: ReturnType<typeof runGame>[] = concedeTraceEnabled ? [] : ([] as never);

  for (let i = 0; i < args.games; i++) {
    const seed = args.seedBase + i;
    const result = runGame(seed, null, null, allCards, {
      adversarial: args.adversarial,
      cardMeta: args.adversarial ? cardMeta : undefined,
    });
    tracker.observe(result);
    if (concedeTraceEnabled) concedeTraceResults.push(result);
  }

  const elapsedSec = (Date.now() - startedAt) / 1000;
  const report = tracker.report({ seedBase: args.seedBase, adversarial: args.adversarial });
  const json = serializePlayabilityReport(report);
  const md = renderMarkdown(report);

  const here = dirname(fileURLToPath(import.meta.url));
  const jsonPath = resolve(here, 'reports', `playability-${args.seedBase}.json`);
  const markdownPath = resolve(here, 'reports', `playability-${args.seedBase}.md`);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, json, 'utf8');
  writeFileSync(markdownPath, md, 'utf8');

  // eslint-disable-next-line no-console
  console.log(
    `[playability] ${args.games} games adv=${args.adversarial} seedBase=${args.seedBase} in ${elapsedSec.toFixed(2)}s`,
  );
  // eslint-disable-next-line no-console
  console.log(`[playability] turn ${fmtPct(report.turn)}`);
  // eslint-disable-next-line no-console
  console.log(`[playability] ticks ${fmtPct(report.ticks)}`);
  // eslint-disable-next-line no-console
  console.log(`[playability] ticksPerTurn ${fmtPct(report.ticksPerTurn)}`);
  // eslint-disable-next-line no-console
  console.log(`[playability] terminals ${JSON.stringify(report.terminalCategories)}`);
  // eslint-disable-next-line no-console
  console.log(`[playability] winnerSide ${JSON.stringify(report.winnerSide)}`);
  // eslint-disable-next-line no-console
  console.log(`[playability] winReason ${JSON.stringify(report.winReason)}`);

  if (concedeTraceEnabled) {
    const reportPath = writeConcedeTraceReport({ seedBase: args.seedBase, results: concedeTraceResults });
    // eslint-disable-next-line no-console
    console.log(`[concede-trace] root-cause report → ${reportPath}`);
  }

  return { jsonPath, markdownPath, report, elapsedSec };
}

function isMainEntry(): boolean {
  if (typeof process === 'undefined' || process.argv.length < 2) return false;
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  return invoked === fileURLToPath(import.meta.url);
}

function parseArgs(argv: string[]): PlayabilityArgs {
  const out: PlayabilityArgs = { games: 1000, seedBase: 0, adversarial: true };
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
      default:
        if (a.startsWith('--')) console.warn(`[playability] unknown flag: ${a}`);
    }
  }
  return out;
}

if (isMainEntry()) runPlayability(parseArgs(process.argv.slice(2)));
