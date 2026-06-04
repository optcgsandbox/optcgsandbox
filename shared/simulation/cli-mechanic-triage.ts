/**
 * Mechanic triage analyzer — classifies zero-fire handler kinds against
 * the corpus.
 *
 * Inputs (read-only):
 *   - shared/simulation/reports/mechanic-frequency-<seed>.json
 *   - shared/data/cards.json   (effectSpecV2 corpus)
 *   - engine-v2 registry snapshots (registered kinds)
 *
 * Output:
 *   - shared/simulation/reports/mechanic-triage-<seed>.md
 *
 * For each layer (action / cost / target / magnitude) and each kind
 * that was registered but recorded zero invocations in the frequency
 * JSON, classify into one of:
 *
 *   orphan_primitive          — corpus contains zero references to this kind
 *   deck_pool_starvation      — corpus has ≤2 cards referencing this kind
 *                               (too few to reliably draft in a 1000-game
 *                               adversarial batch; classification heuristic
 *                               is corpus-reference-count only — see
 *                               CLASSIFICATION CRITERIA below)
 *   conditional_or_rare_path  — corpus has ≥3 cards referencing this kind
 *                               (multiple cards exist, at least one was
 *                               statistically likely to be drafted, so the
 *                               unfired status implies the surrounding
 *                               condition / trigger / target gate was not
 *                               satisfied during sim)
 *
 * The heuristic boundary (≥3 cards) is documented inline and per-row in
 * the report. NO inference beyond corpus-reference count and sim
 * frequency is performed. NO optimization or "fix" recommendations are
 * emitted — classification only.
 *
 * Special-case sections required by the spec:
 *   - match_opp_don: labeled "unobserved in sampled adversarial runs"
 *     and explicitly not classified as unused.
 *   - power_buff vs give_power: report delta frequency + structural
 *     coupling count (cards carrying BOTH kinds) with no causal claim.
 *   - cost zero-fire list: same 3-way classification as actions.
 *
 * Constraints:
 *   - No engine-v2 changes.
 *   - No card-data modifications.
 *   - Deterministic output (sorted keys, fixed section order).
 *   - Runnable independently as a CLI (npx tsx … OR via vitest env-gated).
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

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

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

type Classification =
  | 'orphan_primitive'
  | 'deck_pool_starvation'
  | 'conditional_or_rare_path';

interface ZeroFireRow {
  readonly kind: string;
  readonly classification: Classification;
  readonly cardRefCount: number;
  readonly sampleCards: ReadonlyArray<string>; // up to 5 alphabetically
}

interface LayerTriage {
  readonly layer: 'action' | 'cost' | 'target' | 'magnitude';
  readonly registeredCount: number | null;
  readonly observedCount: number;
  readonly zeroFireCount: number;
  readonly rows: ReadonlyArray<ZeroFireRow>;
}

interface ParsedArgs {
  seedBase: number;
  input: string | null;
  cards: string | null;
  write: boolean;
}

// ────────────────────────────────────────────────────────────────────
// Corpus scan
// ────────────────────────────────────────────────────────────────────

interface CorpusReferenceMaps {
  readonly action: Map<string, Set<string>>;
  readonly cost: Map<string, Set<string>>;
  readonly target: Map<string, Set<string>>;
  readonly magnitude: Map<string, Set<string>>;
}

function addRef(map: Map<string, Set<string>>, kind: string, cardId: string): void {
  let s = map.get(kind);
  if (s === undefined) {
    s = new Set();
    map.set(kind, s);
  }
  s.add(cardId);
}

/**
 * Walk an arbitrary effectSpecV2 sub-tree collecting kinds. The schema
 * is open (types.ts:18 — `EffectActionV2Kind = string`), so we
 * structurally inspect every nested object's `kind` based on its
 * parent's role.
 */
function collectFromActionNode(
  node: unknown,
  cardId: string,
  maps: CorpusReferenceMaps,
): void {
  if (node === null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  // Action's own kind
  if (typeof obj['kind'] === 'string') {
    addRef(maps.action, obj['kind'], cardId);
  }

  // Magnitude (action-level approximation matches mechanicInstrument's
  // coverage scope: number → 'literal'; object with kind → that kind).
  const mag = obj['magnitude'];
  if (typeof mag === 'number') {
    addRef(maps.magnitude, 'literal', cardId);
  } else if (mag !== null && typeof mag === 'object' && 'kind' in mag) {
    const mKind = (mag as { kind?: unknown }).kind;
    if (typeof mKind === 'string') addRef(maps.magnitude, mKind, cardId);
  }

  // Nested actions (sequence / chained_actions / etc.)
  const actions = obj['actions'];
  if (Array.isArray(actions)) {
    for (const a of actions) collectFromActionNode(a, cardId, maps);
  }

  // choose_one / choose_n style options arrays
  const options = obj['options'];
  if (Array.isArray(options)) {
    for (const o of options) collectFromActionNode(o, cardId, maps);
  }
}

function collectFromTargetNode(
  node: unknown,
  cardId: string,
  maps: CorpusReferenceMaps,
): void {
  if (node === null || typeof node !== 'object') return;
  const k = (node as { kind?: unknown }).kind;
  if (typeof k === 'string') addRef(maps.target, k, cardId);
}

function collectFromCostNode(
  node: unknown,
  cardId: string,
  maps: CorpusReferenceMaps,
): void {
  if (node === null || typeof node !== 'object') return;
  for (const key of Object.keys(node as Record<string, unknown>)) {
    if (key === 'bind') continue; // meta-key, not a registered cost handler
    addRef(maps.cost, key, cardId);
  }
}

function collectFromClause(
  clause: unknown,
  cardId: string,
  maps: CorpusReferenceMaps,
): void {
  if (clause === null || typeof clause !== 'object') return;
  const c = clause as Record<string, unknown>;
  if (c['action'] !== undefined) collectFromActionNode(c['action'], cardId, maps);
  if (c['target'] !== undefined) collectFromTargetNode(c['target'], cardId, maps);
  if (c['cost'] !== undefined) collectFromCostNode(c['cost'], cardId, maps);
  // Some clauses (continuous) embed `then.action`, `else.action` etc. —
  // walk every nested object whose own .action / .target / .cost are
  // recognized, one level deep. Deeper alt-paths show up in `actions[]`
  // which collectFromActionNode already recurses into.
  for (const v of Object.values(c)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const sub = v as Record<string, unknown>;
      if ('action' in sub) collectFromActionNode(sub['action'], cardId, maps);
      if ('target' in sub) collectFromTargetNode(sub['target'], cardId, maps);
      if ('cost' in sub) collectFromCostNode(sub['cost'], cardId, maps);
    }
  }
}

function scanCorpus(cards: ReadonlyArray<unknown>): CorpusReferenceMaps {
  const maps: CorpusReferenceMaps = {
    action: new Map(),
    cost: new Map(),
    target: new Map(),
    magnitude: new Map(),
  };
  for (const card of cards) {
    if (card === null || typeof card !== 'object') continue;
    const c = card as Record<string, unknown>;
    const id = typeof c['id'] === 'string' ? c['id'] : '<no-id>';
    const spec = c['effectSpecV2'];
    if (spec === null || typeof spec !== 'object') continue;
    const s = spec as Record<string, unknown>;
    const clauses = s['clauses'];
    if (Array.isArray(clauses)) {
      for (const cl of clauses) collectFromClause(cl, id, maps);
    }
    const continuous = s['continuous'];
    if (Array.isArray(continuous)) {
      for (const cl of continuous) collectFromClause(cl, id, maps);
    }
    const replacements = s['replacements'];
    if (Array.isArray(replacements)) {
      for (const cl of replacements) collectFromClause(cl, id, maps);
    }
  }
  return maps;
}

// ────────────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────────────

function classifyKind(refCount: number): Classification {
  if (refCount === 0) return 'orphan_primitive';
  if (refCount <= 2) return 'deck_pool_starvation';
  return 'conditional_or_rare_path';
}

function triageLayer(
  layer: LayerTriage['layer'],
  observed: Record<string, number>,
  registeredKinds: ReadonlyArray<string> | null,
  refMap: Map<string, Set<string>>,
): LayerTriage {
  const observedKinds = new Set(Object.keys(observed));
  // For magnitude (no registry) the "registered" set is the union of
  // what the corpus references and what the sim observed — i.e., every
  // magnitude kind we have evidence of. Zero-fire ⊆ corpus-refs that
  // never fired in sim.
  const candidateKinds = registeredKinds !== null
    ? [...registeredKinds]
    : [...new Set([...refMap.keys(), ...observedKinds])].sort();

  const zeroFire = candidateKinds
    .filter((k) => !observedKinds.has(k))
    .sort();
  const rows: ZeroFireRow[] = zeroFire.map((kind) => {
    const refs = refMap.get(kind) ?? new Set<string>();
    const refCount = refs.size;
    const sampleCards = [...refs].sort().slice(0, 5);
    return {
      kind,
      classification: classifyKind(refCount),
      cardRefCount: refCount,
      sampleCards,
    };
  });

  return {
    layer,
    registeredCount: registeredKinds === null ? null : registeredKinds.length,
    observedCount: observedKinds.size,
    zeroFireCount: zeroFire.length,
    rows,
  };
}

// ────────────────────────────────────────────────────────────────────
// Markdown rendering (deterministic, sorted)
// ────────────────────────────────────────────────────────────────────

function renderRow(r: ZeroFireRow): string {
  const sample = r.sampleCards.length === 0
    ? '—'
    : r.sampleCards.map((id) => `\`${id}\``).join(', ');
  return `| \`${r.kind}\` | ${r.classification} | ${r.cardRefCount} | ${sample} |`;
}

function renderLayer(t: LayerTriage): string {
  const lines: string[] = [];
  lines.push(`### ${t.layer}`);
  lines.push('');
  if (t.registeredCount !== null) {
    lines.push(`- Registered kinds: **${t.registeredCount}**`);
  } else {
    lines.push(`- Registered kinds: (no engine registry — corpus + sim union)`);
  }
  lines.push(`- Observed (fired in sim): **${t.observedCount}**`);
  lines.push(`- Zero-fire: **${t.zeroFireCount}**`);
  lines.push('');
  if (t.rows.length === 0) {
    lines.push('_No zero-fire kinds in this layer._');
    lines.push('');
    return lines.join('\n');
  }
  // Group by classification for readability; deterministic order:
  // orphan_primitive → deck_pool_starvation → conditional_or_rare_path
  const order: ReadonlyArray<Classification> = [
    'orphan_primitive',
    'deck_pool_starvation',
    'conditional_or_rare_path',
  ];
  for (const cls of order) {
    const subset = t.rows.filter((r) => r.classification === cls);
    if (subset.length === 0) continue;
    lines.push(`#### ${cls} (${subset.length})`);
    lines.push('');
    lines.push('| Kind | Classification | Corpus refs | Sample cards |');
    lines.push('|------|----------------|------------:|--------------|');
    for (const r of subset) lines.push(renderRow(r));
    lines.push('');
  }
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────
// Cross-cut sections (per spec)
// ────────────────────────────────────────────────────────────────────

function renderMatchOppDonNote(report: FrequencyReport): string {
  const fired = report.magnitude['match_opp_don'] ?? 0;
  const lines: string[] = [];
  lines.push('### `match_opp_don` (magnitude formula)');
  lines.push('');
  lines.push(`- Sim invocations (seedBase=${report.seedBase}, ${report.totalGames} games): **${fired}**`);
  lines.push('- Status: **unobserved in sampled adversarial runs** — NOT classified as unused.');
  lines.push('- Notes: magnitude coverage is `action-level only`; counts only reach this report when the formula is consumed by an action handler reachable via `action.magnitude`.');
  lines.push('');
  return lines.join('\n');
}

function renderPowerBuffGivePowerCoupling(
  report: FrequencyReport,
  refs: CorpusReferenceMaps,
): string {
  const pb = report.action['power_buff'] ?? 0;
  const gp = report.action['give_power'] ?? 0;
  const pbCards = refs.action.get('power_buff') ?? new Set<string>();
  const gpCards = refs.action.get('give_power') ?? new Set<string>();
  const intersection = new Set<string>();
  for (const id of pbCards) if (gpCards.has(id)) intersection.add(id);
  const lines: string[] = [];
  lines.push('### `power_buff` ↔ `give_power` structural coupling');
  lines.push('');
  lines.push(`- Sim count \`power_buff\`: **${pb}**`);
  lines.push(`- Sim count \`give_power\`: **${gp}**`);
  lines.push(`- Delta (gp − pb): **${gp - pb}**`);
  lines.push(`- Cards referencing \`power_buff\`: **${pbCards.size}**`);
  lines.push(`- Cards referencing \`give_power\`: **${gpCards.size}**`);
  lines.push(`- Cards referencing BOTH: **${intersection.size}**`);
  lines.push('- Notes: frequency delta + corpus-reference overlap are reported as raw counts. NO causality is inferred.');
  lines.push('');
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────
// Driver
// ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { seedBase: 0, input: null, cards: null, write: true };
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
      case '--cards':
        out.cards = peek ?? null;
        if (consume) i += 1;
        break;
      case '--no-write':
        out.write = false;
        break;
      default:
        if (a.startsWith('--')) {
          console.warn(`[mechanic-triage] unknown flag: ${a}`);
        }
    }
  }
  return out;
}

function ensureHandlerRegistry(): void {
  if (!actionHandlers.has('draw')) registerAllHandlers();
}

export interface TriageOutput {
  readonly reportPath: string | null;
  readonly markdown: string;
  readonly stdoutText: string;
  readonly layers: ReadonlyArray<LayerTriage>;
}

export function runTriage(args: ParsedArgs): TriageOutput {
  ensureHandlerRegistry();
  const here = dirname(fileURLToPath(import.meta.url));

  // Repo-root-relative resolution: this file is at
  // <repo>/shared/simulation/cli-mechanic-triage.ts, so the corpus is
  // at ../data/cards.json relative to here.
  const inputPath = args.input ?? resolve(here, 'reports', `mechanic-frequency-${args.seedBase}.json`);
  const cardsPath = args.cards ?? resolve(here, '..', 'data', 'cards.json');

  const reportRaw = readFileSync(inputPath, 'utf8');
  const report = JSON.parse(reportRaw) as FrequencyReport;
  const cardsRaw = readFileSync(cardsPath, 'utf8');
  const cards = JSON.parse(cardsRaw) as ReadonlyArray<unknown>;

  const refs = scanCorpus(cards);

  const actionKinds = actionHandlers.snapshot();
  const costKinds = costHandlers.snapshot();
  const targetKinds = targetResolvers.snapshot();

  const layers: LayerTriage[] = [
    triageLayer('action', report.action, actionKinds, refs.action),
    triageLayer('cost', report.cost, costKinds, refs.cost),
    triageLayer('target', report.target, targetKinds, refs.target),
    triageLayer('magnitude', report.magnitude, null, refs.magnitude),
  ];

  const md = [
    `# Mechanic triage — seedBase=${report.seedBase}`,
    '',
    `- Frequency source: \`${inputPath}\``,
    `- Corpus source: \`${cardsPath}\` (${cards.length} cards)`,
    `- Sim batch: ${report.totalGames} games / ${report.totalTicks} ticks / adversarial=${report.adversarial}`,
    `- Magnitude coverage: \`${report.magnitudeCoverage}\``,
    '',
    '## CLASSIFICATION CRITERIA',
    '',
    '- `orphan_primitive` — corpus contains **0** references to this kind.',
    '- `deck_pool_starvation` — corpus has **1–2** cards referencing this kind (sample too thin to be reliably drafted in 1000 games × 2 decks).',
    '- `conditional_or_rare_path` — corpus has **3+** cards referencing this kind (at least one card statistically should have been drafted; unfired implies the surrounding trigger / condition / target gate was not satisfied during sim).',
    '',
    'The 3-way split uses corpus reference count only. NO inference is performed beyond `(corpus_refs, sim_frequency)`. NO optimization or "fix" recommendations are emitted.',
    '',
    '## Per-layer zero-fire classification',
    '',
    ...layers.map(renderLayer),
    '## Cross-cut notes',
    '',
    renderMatchOppDonNote(report),
    renderPowerBuffGivePowerCoupling(report, refs),
  ].join('\n');

  let reportPath: string | null = null;
  if (args.write) {
    reportPath = resolve(here, 'reports', `mechanic-triage-${args.seedBase}.md`);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, md, 'utf8');
  }

  const stdoutLines: string[] = [];
  stdoutLines.push(`Mechanic triage — seedBase=${report.seedBase}  games=${report.totalGames}  ticks=${report.totalTicks}`);
  stdoutLines.push('');
  for (const t of layers) {
    stdoutLines.push(`── ${t.layer.toUpperCase()} ──`);
    const counts = {
      orphan_primitive: t.rows.filter((r) => r.classification === 'orphan_primitive').length,
      deck_pool_starvation: t.rows.filter((r) => r.classification === 'deck_pool_starvation').length,
      conditional_or_rare_path: t.rows.filter((r) => r.classification === 'conditional_or_rare_path').length,
    };
    stdoutLines.push(`  registered=${t.registeredCount ?? '(none)'} observed=${t.observedCount} zeroFire=${t.zeroFireCount}`);
    stdoutLines.push(`  orphan_primitive=${counts.orphan_primitive}  deck_pool_starvation=${counts.deck_pool_starvation}  conditional_or_rare_path=${counts.conditional_or_rare_path}`);
  }

  return { reportPath, markdown: md, stdoutText: stdoutLines.join('\n'), layers };
}

function isMainEntry(): boolean {
  if (typeof process === 'undefined' || process.argv.length < 2) return false;
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  return invoked === fileURLToPath(import.meta.url);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const out = runTriage(args);
  console.log(out.stdoutText);
  if (out.reportPath !== null) {
    console.log('');
    console.log(`[mechanic-triage] markdown report: ${out.reportPath}`);
  }
}

if (isMainEntry()) main();
