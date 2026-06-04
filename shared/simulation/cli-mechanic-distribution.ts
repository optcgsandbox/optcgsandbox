/**
 * Mechanic-distribution analyzer — reads a mechanic-frequency JSON
 * produced by `cli-mechanic-frequency.ts` and emits:
 *
 *   - top-10 most invoked per layer (action / cost / target / magnitude)
 *   - zero-invocation registered keys per layer (registered handlers
 *     that did not fire in the batch)
 *   - normalized per-tick rates (calls / totalTicks) for cross-layer
 *     comparison of mechanic intensity
 *
 * Output is printed to stdout AND written as Markdown to
 * `shared/simulation/reports/mechanic-distribution-<seed>.md`.
 *
 * "Registered but unfired" requires the set of registered kinds. We
 * read them via the engine's existing public `Registry.snapshot()` API
 * (no private internals) AFTER calling `registerAllHandlers()` /
 * `registerAllReducers()` so the full handler set is present.
 *
 * Usage:
 *   node --import tsx shared/simulation/cli-mechanic-distribution.ts \
 *     --seed-base 0
 *
 * Flags:
 *   --seed-base  number  default 0
 *   --input      path    override input JSON path (default
 *                        shared/simulation/reports/mechanic-frequency-<seed>.json)
 *   --no-write           skip the markdown report write
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  actionHandlers,
  costHandlers,
  targetResolvers,
} from '../engine-v2/registry/types.js';
import { registerAllHandlers } from '../engine-v2/registry/handlers/index.js';

interface FrequencyReport {
  totalGames: number;
  totalTicks: number;
  seedBase: number;
  adversarial: boolean;
  magnitudeCoverage: string;
  action: Record<string, number>;
  cost: Record<string, number>;
  target: Record<string, number>;
  magnitude: Record<string, number>;
}

interface ParsedArgs {
  seedBase: number;
  input: string | null;
  write: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { seedBase: 0, input: null, write: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const eq = a.indexOf('=');
    const key = eq === -1 ? a : a.slice(0, eq);
    const inlineVal = eq === -1 ? undefined : a.slice(eq + 1);
    const peek = inlineVal ?? argv[i + 1];
    const consume = inlineVal === undefined;
    switch (key) {
      case '--seed-base':
        out.seedBase = parseInt(peek ?? '0', 10);
        if (consume) i += 1;
        break;
      case '--input':
        out.input = peek ?? null;
        if (consume) i += 1;
        break;
      case '--no-write':
        out.write = false;
        break;
      default:
        if (a.startsWith('--')) {
          console.warn(`[mechanic-distribution] unknown flag: ${a}`);
        }
    }
  }
  return out;
}

interface LayerAnalysis {
  readonly layer: 'action' | 'cost' | 'target' | 'magnitude';
  readonly total: number;
  readonly perTickRate: number;
  readonly top10: ReadonlyArray<{ kind: string; count: number; share: number; perTick: number }>;
  readonly zeroFire: ReadonlyArray<string>;
  readonly registeredCount: number | null; // null = layer has no registry snapshot (magnitude)
}

function ensureRegistries(): void {
  // Idempotent — already-registered registries throw on duplicate, so
  // we use a feature-detect via `has()`. Reducers are NOT needed: the
  // distribution analyzer only reads `Registry.snapshot()` on the four
  // handler registries.
  if (!actionHandlers.has('draw')) registerAllHandlers();
}

function analyzeLayer(
  layer: LayerAnalysis['layer'],
  data: Record<string, number>,
  totalTicks: number,
  registeredKinds: ReadonlyArray<string> | null,
): LayerAnalysis {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top10 = sorted.slice(0, 10).map(([kind, count]) => ({
    kind,
    count,
    share: total > 0 ? count / total : 0,
    perTick: totalTicks > 0 ? count / totalTicks : 0,
  }));
  const observed = new Set(Object.keys(data));
  const zeroFire = registeredKinds === null
    ? []
    : registeredKinds.filter((k) => !observed.has(k)).sort();
  return {
    layer,
    total,
    perTickRate: totalTicks > 0 ? total / totalTicks : 0,
    top10,
    zeroFire,
    registeredCount: registeredKinds === null ? null : registeredKinds.length,
  };
}

function formatLayerMd(a: LayerAnalysis): string {
  const lines: string[] = [];
  lines.push(`### ${a.layer}`);
  lines.push('');
  if (a.registeredCount !== null) {
    lines.push(`- Registered kinds: **${a.registeredCount}**`);
  }
  lines.push(`- Total invocations: **${a.total.toLocaleString()}**`);
  lines.push(`- Per-tick rate: **${a.perTickRate.toFixed(4)}** calls/tick`);
  if (a.registeredCount !== null) {
    lines.push(`- Observed kinds: **${a.registeredCount - a.zeroFire.length}** / ${a.registeredCount}`);
    lines.push(`- Zero-fire kinds: **${a.zeroFire.length}**`);
  }
  lines.push('');
  lines.push('| Rank | Kind | Count | Share | Per-tick |');
  lines.push('|-----:|------|------:|------:|---------:|');
  a.top10.forEach((row, i) => {
    lines.push(
      `| ${i + 1} | \`${row.kind}\` | ${row.count.toLocaleString()} | ${(row.share * 100).toFixed(2)}% | ${row.perTick.toFixed(4)} |`,
    );
  });
  lines.push('');
  if (a.zeroFire.length > 0) {
    lines.push(`<details><summary>${a.zeroFire.length} zero-fire kinds</summary>`);
    lines.push('');
    lines.push(a.zeroFire.map((k) => `- \`${k}\``).join('\n'));
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  return lines.join('\n');
}

function formatLayerStdout(a: LayerAnalysis): string {
  const lines: string[] = [];
  lines.push(`── ${a.layer.toUpperCase()} ──`);
  if (a.registeredCount !== null) {
    lines.push(`  registered=${a.registeredCount} observed=${a.registeredCount - a.zeroFire.length} zeroFire=${a.zeroFire.length}`);
  }
  lines.push(`  total=${a.total} perTickRate=${a.perTickRate.toFixed(4)}`);
  lines.push('  top-10:');
  a.top10.forEach((row, i) => {
    const sharePct = (row.share * 100).toFixed(2).padStart(6);
    lines.push(`    ${String(i + 1).padStart(2)}. ${row.kind.padEnd(28)} ${String(row.count).padStart(8)}  ${sharePct}%  ${row.perTick.toFixed(4)}/tick`);
  });
  if (a.zeroFire.length > 0) {
    const head = a.zeroFire.slice(0, 10).join(', ');
    const more = a.zeroFire.length > 10 ? ` ... (+${a.zeroFire.length - 10})` : '';
    lines.push(`  zero-fire: ${head}${more}`);
  }
  return lines.join('\n');
}

export interface DistributionOutput {
  readonly reportPath: string | null;
  readonly stdoutText: string;
  readonly markdown: string;
  readonly analyses: ReadonlyArray<LayerAnalysis>;
}

export function runDistribution(args: ParsedArgs): DistributionOutput {
  ensureRegistries();

  const here = dirname(fileURLToPath(import.meta.url));
  const inputPath = args.input ?? resolve(here, 'reports', `mechanic-frequency-${args.seedBase}.json`);
  const raw = readFileSync(inputPath, 'utf8');
  const report = JSON.parse(raw) as FrequencyReport;

  const actionKinds = actionHandlers.snapshot();
  const costKinds = costHandlers.snapshot();
  const targetKinds = targetResolvers.snapshot();

  const analyses: LayerAnalysis[] = [
    analyzeLayer('action', report.action, report.totalTicks, actionKinds),
    analyzeLayer('cost', report.cost, report.totalTicks, costKinds),
    analyzeLayer('target', report.target, report.totalTicks, targetKinds),
    // Magnitude has no registry (formula.ts is a free function), so
    // zero-fire is intentionally empty. Known kinds documented below.
    analyzeLayer('magnitude', report.magnitude, report.totalTicks, null),
  ];

  const stdoutText = [
    `Mechanic distribution — seedBase=${report.seedBase} games=${report.totalGames} ticks=${report.totalTicks} adversarial=${report.adversarial}`,
    `Magnitude coverage: ${report.magnitudeCoverage}`,
    '',
    ...analyses.map(formatLayerStdout),
  ].join('\n\n');

  // HARDENING: presentation-only alias-folded view. The 5 wrapper pairs at
  // shared/engine-v2/registry/handlers/actions3.ts:1142-1146 cause every
  // card-level invocation to record TWO action-counter increments (outer +
  // inner). The raw JSON in `mechanic-frequency-<seed>.json` is unchanged;
  // this section subtracts each inner-alias count from itself for display.
  const ACTION_ALIAS_INNERS = new Set<string>([
    'give_power',          // outer: power_buff
    'trash_top_of_deck',   // outer: mill_self
    'mill',                // outer: mill_opp
    'active_target',       // outer: set_active
    'discard_opp_hand',    // outer: opp_discard_from_hand
  ]);
  const ACTION_ALIAS_PAIRS: ReadonlyArray<{ outer: string; inner: string }> = [
    { outer: 'power_buff', inner: 'give_power' },
    { outer: 'mill_self', inner: 'trash_top_of_deck' },
    { outer: 'mill_opp', inner: 'mill' },
    { outer: 'set_active', inner: 'active_target' },
    { outer: 'opp_discard_from_hand', inner: 'discard_opp_hand' },
  ];
  const rawActionTotal = Object.values(report.action).reduce((a, b) => a + b, 0);
  const aliasedInnerTotal = Object.entries(report.action)
    .filter(([k]) => ACTION_ALIAS_INNERS.has(k))
    .reduce((a, [, v]) => a + v, 0);
  const foldedActionTotal = rawActionTotal - aliasedInnerTotal;
  const aliasPairsRows = ACTION_ALIAS_PAIRS.map(({ outer, inner }) => {
    const o = report.action[outer] ?? 0;
    const i = report.action[inner] ?? 0;
    return `| \`${outer}\` | \`${inner}\` | ${o} | ${i} | ${o === i ? '✓' : '⚠ mismatch'} |`;
  });

  const md = [
    `# Mechanic distribution — seedBase=${report.seedBase}`,
    '',
    `- Games: **${report.totalGames}**`,
    `- Ticks: **${report.totalTicks}**`,
    `- Adversarial: **${report.adversarial}**`,
    `- Magnitude coverage: \`${report.magnitudeCoverage}\``,
    `- Source: \`${inputPath}\``,
    '',
    '## Per-layer distribution',
    '',
    ...analyses.map(formatLayerMd),
    '## Alias-folded action view (presentation-only)',
    '',
    `- Raw action invocations (incl. wrapper double-counts): **${rawActionTotal.toLocaleString()}**`,
    `- Inner-alias contribution (subtracted in folded view): **${aliasedInnerTotal.toLocaleString()}**`,
    `- Folded action invocations (outer-only): **${foldedActionTotal.toLocaleString()}**`,
    '',
    '| Outer (cards.json) | Inner (engine-only) | Outer count | Inner count | Match |',
    '|---|---|---:|---:|:-:|',
    ...aliasPairsRows,
    '',
    '_Raw JSON counts in `mechanic-frequency-<seed>.json` are unchanged. This view subtracts inner-alias counts for human reading only; the instrumentation correctly records every `actionHandlers.get(kind)` lookup._',
    '',
  ].join('\n');

  let reportPath: string | null = null;
  if (args.write) {
    reportPath = resolve(here, 'reports', `mechanic-distribution-${args.seedBase}.md`);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, md, 'utf8');
  }

  return { reportPath, stdoutText, markdown: md, analyses };
}

function isMainEntry(): boolean {
  if (typeof process === 'undefined' || process.argv.length < 2) return false;
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  return invoked === fileURLToPath(import.meta.url);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const out = runDistribution(args);
  console.log(out.stdoutText);
  if (out.reportPath !== null) {
    console.log('');
    console.log(`[mechanic-distribution] markdown report: ${out.reportPath}`);
  }
}

if (isMainEntry()) main();
