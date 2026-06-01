#!/usr/bin/env node
// One-shot script: regex-extract `counterEventBoost` from each event's
// effectText and write it back to shared/data/cards.json.
//
// Rationale: sync-from-crewbuilder.mjs:140-141 hardcodes `counterEventBoost = null`
// for every event. That broke 374 events including 119 [Counter] events — the
// engine's playCounter path (applyAction.ts:580) short-circuits when boost is
// null, so no counter event could ever be counter-played.
//
// This script scans each event's effectText for the "+N000 power" pattern
// after [Counter] and populates counterEventBoost. Cards whose text doesn't
// mention a numeric boost (utility-only counters with the badge but no text)
// stay null with a console warning so they can be filled in by hand later.
//
// Usage:
//   node scripts/backfill-counter-boost.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, '..', 'shared', 'data', 'cards.json');
const cards = JSON.parse(readFileSync(dataPath, 'utf8'));

let backfilled = 0;
let unfilled = 0;
const unfilledList = [];

for (const c of cards) {
  if (c.kind !== 'event') continue;
  if (c.counterEventBoost !== null && c.counterEventBoost !== undefined) continue;

  const text = c.effectText ?? '';
  if (!text.startsWith('[Counter]')) {
    // Not a Counter event — counterEventBoost stays null (correct).
    continue;
  }

  // Patterns we accept (in priority order):
  //   1. "gains +N000 power during this battle" (most common; explicit boost)
  //   2. "gains an additional +N000 power" (compound boost)
  // We sum 1+2 when both appear (rare).
  let boost = 0;
  const m1 = text.match(/gains? \+(\d+) power during this battle/i);
  if (m1) boost += parseInt(m1[1], 10);
  const m2 = text.match(/gains? an additional \+(\d+) power/i);
  if (m2) boost += parseInt(m2[1], 10);

  if (boost > 0) {
    c.counterEventBoost = boost;
    backfilled++;
  } else {
    unfilled++;
    unfilledList.push(`${c.id} :: ${text.slice(0, 100).replace(/<br>/g, ' / ')}`);
  }
}

writeFileSync(dataPath, JSON.stringify(cards, null, 2));
console.log(`Backfilled: ${backfilled} counter events.`);
console.log(`Unfilled (text doesn't mention +N power; boost stays null): ${unfilled}`);
if (unfilled > 0) {
  console.log('--- Unfilled samples (first 10):');
  for (const l of unfilledList.slice(0, 10)) console.log(' ', l);
}
