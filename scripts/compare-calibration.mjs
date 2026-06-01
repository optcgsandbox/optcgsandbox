#!/usr/bin/env node
// Stage 2 comparator — diff Claude subagent outputs against the ground-truth
// calibration set. Reports per-field accuracy and surfaces mismatches.
//
// Usage:
//   node scripts/compare-calibration.mjs

import { readFileSync } from 'node:fs';

const groundTruth = JSON.parse(readFileSync('data/calibration-cards.json', 'utf8'));
const byIdGT = new Map(groundTruth.cards.map((c) => [c.id, c]));

const outputs = [];
for (let i = 1; i <= 5; i++) {
  const path = `data/calibration-batch-${i}-output.json`;
  try {
    const batch = JSON.parse(readFileSync(path, 'utf8'));
    outputs.push(...batch);
  } catch {
    console.error(`Could not read ${path}`);
  }
}
const byIdClaude = new Map(outputs.map((c) => [c.id, c]));

let total = 0;
let exact = 0;
let bothEmpty = 0;
let bothNonEmpty = 0;
let gtEmptyClaudeNot = 0;
let gtNonEmptyClaudeEmpty = 0;
let triggerMatch = 0;
let actionMatch = 0;
let conditionMatch = 0;
let targetMatch = 0;
let magnitudeMatch = 0;
let clauseCountMatch = 0;
const mismatches = [];

for (const [id, gt] of byIdGT) {
  if (id.endsWith('-dup')) continue;
  total++;
  const claude = byIdClaude.get(id);
  if (!claude) {
    mismatches.push({ id, kind: 'MISSING_CLAUDE_OUTPUT' });
    continue;
  }
  const gtSpecs = gt.effectSpec ?? [];
  const cSpecs = claude.effectSpec ?? [];
  if (gtSpecs.length === 0 && cSpecs.length === 0) {
    bothEmpty++;
    exact++;
    continue;
  }
  if (gtSpecs.length === 0 && cSpecs.length > 0) {
    gtEmptyClaudeNot++;
    mismatches.push({ id, kind: 'GT_EMPTY_CLAUDE_NOT', gt: gtSpecs, claude: cSpecs });
    continue;
  }
  if (gtSpecs.length > 0 && cSpecs.length === 0) {
    gtNonEmptyClaudeEmpty++;
    mismatches.push({ id, kind: 'GT_NONEMPTY_CLAUDE_EMPTY', gt: gtSpecs, claude: cSpecs });
    continue;
  }
  bothNonEmpty++;
  // Compare clause-by-clause (positional). Score per field.
  if (gtSpecs.length === cSpecs.length) clauseCountMatch++;
  const n = Math.min(gtSpecs.length, cSpecs.length);
  for (let i = 0; i < n; i++) {
    const g = gtSpecs[i];
    const c = cSpecs[i];
    if (g.trigger === c.trigger) triggerMatch++;
    if (g.action === c.action) actionMatch++;
    if (JSON.stringify(g.condition ?? null) === JSON.stringify(c.condition ?? null)) conditionMatch++;
    if ((g.target ?? null) === (c.target ?? null)) targetMatch++;
    if ((g.magnitude ?? null) === (c.magnitude ?? null)) magnitudeMatch++;
  }
  const fieldEqual =
    gtSpecs.length === cSpecs.length &&
    gtSpecs.every((g, i) =>
      g.trigger === cSpecs[i].trigger &&
      g.action === cSpecs[i].action &&
      JSON.stringify(g.condition ?? null) === JSON.stringify(cSpecs[i].condition ?? null) &&
      (g.target ?? null) === (cSpecs[i].target ?? null) &&
      (g.magnitude ?? null) === (cSpecs[i].magnitude ?? null),
    );
  if (fieldEqual) exact++;
  else mismatches.push({ id, kind: 'FIELD_DIFF', gt: gtSpecs, claude: cSpecs });
}

const totalClauses = [...byIdGT.values()].reduce((acc, c) => acc + (c.effectSpec?.length ?? 0), 0);

console.log('═══ Stage 2 calibration results ═══');
console.log(`Total cards: ${total}`);
console.log(`Exact match (full spec equal): ${exact} (${((exact / total) * 100).toFixed(1)}%)`);
console.log(`  - both empty (vanilla agreement): ${bothEmpty}`);
console.log(`  - both non-empty AND identical: ${exact - bothEmpty}`);
console.log(`Bucket counts:`);
console.log(`  - both non-empty (any match): ${bothNonEmpty}`);
console.log(`  - GT empty but Claude produced spec: ${gtEmptyClaudeNot}`);
console.log(`  - GT had spec but Claude emitted nothing: ${gtNonEmptyClaudeEmpty}`);
console.log('');
console.log('Per-field match rates (across clauses where both are non-empty):');
console.log(`  - trigger:   ${triggerMatch}/${totalClauses} (${((triggerMatch / totalClauses) * 100).toFixed(1)}%)`);
console.log(`  - action:    ${actionMatch}/${totalClauses} (${((actionMatch / totalClauses) * 100).toFixed(1)}%)`);
console.log(`  - condition: ${conditionMatch}/${totalClauses} (${((conditionMatch / totalClauses) * 100).toFixed(1)}%)`);
console.log(`  - target:    ${targetMatch}/${totalClauses} (${((targetMatch / totalClauses) * 100).toFixed(1)}%)`);
console.log(`  - magnitude: ${magnitudeMatch}/${totalClauses} (${((magnitudeMatch / totalClauses) * 100).toFixed(1)}%)`);
console.log('');
console.log(`Mismatches: ${mismatches.length}`);
for (const m of mismatches.slice(0, 20)) {
  console.log(`  [${m.kind}] ${m.id}`);
  if (m.gt) console.log(`    GT:     ${JSON.stringify(m.gt)}`);
  if (m.claude) console.log(`    Claude: ${JSON.stringify(m.claude)}`);
}
if (mismatches.length > 20) console.log(`  …and ${mismatches.length - 20} more`);
