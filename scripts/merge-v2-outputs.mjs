#!/usr/bin/env node
// Phase D merge — fold subagent-produced effectSpecV2 JSON into cards.json.
//
// Reads every `data/unmatched-batch-N-output.json` file and merges the
// effectSpecV2 specs into `shared/data/cards.json`. Validates each entry
// before merging — malformed/missing-field entries are skipped and reported.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const CARDS_PATH = 'shared/data/cards.json';
const cards = JSON.parse(readFileSync(CARDS_PATH, 'utf8'));
const byId = new Map(cards.map((c) => [c.id, c]));

const VALID_TRIGGERS = new Set([
  'on_play', 'on_ko', 'on_block', 'when_attacking',
  'activate_main', 'trigger', 'at_start_of_game',
  'at_end_of_turn_self', 'at_end_of_turn', 'on_opp_attack',
  'on_life_changed', 'at_opp_refresh', 'on_damage_taken',
  'on_own_don_returned', 'during_opp_turn', 'on_opp_play_character',
]);
const VALID_VERIFIED = new Set(['ground-truth', 'auto', 'human-reviewed', 'flagged', 'human-deferred']);

function isValidSpec(spec) {
  if (!spec || typeof spec !== 'object') return false;
  if (spec.schemaVersion !== 2) return false;
  if (!VALID_VERIFIED.has(spec.verified)) return false;
  if (spec.clauses !== undefined && !Array.isArray(spec.clauses)) return false;
  if (spec.continuous !== undefined && !Array.isArray(spec.continuous)) return false;
  if (spec.replacements !== undefined && !Array.isArray(spec.replacements)) return false;
  // Per-clause sanity: trigger must be valid for clauses.
  if (Array.isArray(spec.clauses)) {
    for (const c of spec.clauses) {
      if (!c || typeof c !== 'object') return false;
      if (c.trigger && !VALID_TRIGGERS.has(c.trigger)) return false;
      if (c.verified && !VALID_VERIFIED.has(c.verified)) return false;
    }
  }
  return true;
}

let merged = 0;
let skippedInvalid = 0;
let skippedMissing = 0;
let skippedAlreadyHasSpec = 0;

const files = readdirSync('data').filter((f) => /^unmatched-batch-\d+-output\.json$/.test(f));
console.log(`Found ${files.length} batch output files.`);

for (const file of files) {
  const path = `data/${file}`;
  if (!existsSync(path)) continue;
  let outputs;
  try {
    outputs = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse ${path}: ${e.message}`);
    continue;
  }
  if (!Array.isArray(outputs)) continue;
  for (const entry of outputs) {
    if (!entry || !entry.id) { skippedMissing++; continue; }
    const card = byId.get(entry.id);
    if (!card) { skippedMissing++; continue; }
    if (!isValidSpec(entry.effectSpecV2)) { skippedInvalid++; continue; }
    // Don't overwrite existing non-empty specs.
    if (card.effectSpecV2 && (card.effectSpecV2.clauses?.length > 0 || card.effectSpecV2.continuous?.length > 0 || card.effectSpecV2.replacements?.length > 0)) {
      skippedAlreadyHasSpec++;
      continue;
    }
    card.effectSpecV2 = entry.effectSpecV2;
    merged++;
  }
}

writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2));
console.log(`Merged ${merged} effectSpecV2 entries.`);
console.log(`  ${skippedInvalid} skipped (invalid shape).`);
console.log(`  ${skippedMissing} skipped (id not in corpus).`);
console.log(`  ${skippedAlreadyHasSpec} skipped (card already has v2 spec).`);

// Coverage summary
const withV2 = cards.filter((c) => c.effectSpecV2 && (c.effectSpecV2.clauses?.length > 0 || c.effectSpecV2.continuous?.length > 0 || c.effectSpecV2.replacements?.length > 0));
const auto = withV2.filter((c) => c.effectSpecV2.verified === 'auto').length;
const flagged = withV2.filter((c) => c.effectSpecV2.verified === 'flagged').length;
console.log(`Total v2-tagged: ${withV2.length}/${cards.length} (${(withV2.length / cards.length * 100).toFixed(1)}%)`);
console.log(`  auto: ${auto}, flagged: ${flagged}`);
