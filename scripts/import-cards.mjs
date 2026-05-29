// Card corpus importer for OPTCGSandbox.
//
// Reads a JSON dump of OPTCG cards (one record per card) and writes
// `shared/data/cards.json` in the Card discriminated union shape that
// our engine consumes (shared/engine/cards/Card.ts).
//
// Usage:
//   node scripts/import-cards.mjs <input.json>
//
// Input shape (per record):
// {
//   id: "OP01-001", name: "...", kind: "leader"|"character"|"event"|"stage",
//   colors: ["red"], cost: 5, power: 5000, counterValue: 1000 | null,
//   traits: ["Straw Hat Crew"], keywords: ["blocker"], effectTags: ["draw"],
//   life: 5  // leaders only
// }
//
// Source ideas:
//   1. Hand-curated test deck (50 cards) — use to playtest engine
//   2. Dump from Crew Builder's Supabase — query the `cards` table
//      directly with the service-role key (NOT in optcgsandbox; produce
//      the dump in Crew Builder, copy the JSON into the sim repo)
//   3. Bandai's public card list (en.onepiece-cardgame.com/cardlist/)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ALLOWED_COLORS = new Set(['red', 'green', 'blue', 'purple', 'black', 'yellow']);
const ALLOWED_KINDS = new Set(['leader', 'character', 'event', 'stage', 'don']);
const ALLOWED_KEYWORDS = new Set([
  'blocker', 'rush', 'double_attack', 'banish', 'on_play', 'on_ko',
  'when_attacking', 'activate_main', 'trigger', 'counter', 'once_per_turn',
]);
const ALLOWED_TAGS = new Set([
  'searcher', 'draw', 'removal_ko', 'removal_bounce', 'removal_cost_reduce',
  'blocker', 'rush', 'double_attack', 'counter_event', 'counter_character',
  'power_buff', 'cost_reduction', 'recursion', 'ramp', 'lifegain',
  'life_to_hand', 'disruption', 'vanilla',
]);

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/import-cards.mjs <input.json>');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(input, 'utf8'));
if (!Array.isArray(raw)) {
  console.error('Input must be a JSON array of card records.');
  process.exit(1);
}

const cards = [];
const errors = [];

for (const r of raw) {
  if (!r.id || !r.name || !ALLOWED_KINDS.has(r.kind)) {
    errors.push(`Skipping ${r.id ?? '<no id>'}: bad shape`);
    continue;
  }
  const card = {
    id: String(r.id),
    name: String(r.name),
    kind: r.kind,
    colors: (r.colors ?? []).filter((c) => ALLOWED_COLORS.has(c)),
    cost: r.kind === 'leader' || r.kind === 'don' ? null : (r.cost ?? 0),
    power: r.kind === 'leader' || r.kind === 'character' ? (r.power ?? 0) : null,
    counterValue: r.counterValue ?? null,
    traits: r.traits ?? [],
    keywords: (r.keywords ?? []).filter((k) => ALLOWED_KEYWORDS.has(k)),
    effectTags: (r.effectTags ?? []).filter((t) => ALLOWED_TAGS.has(t)),
    ...(r.kind === 'leader' ? { life: r.life ?? 5 } : {}),
    ...(r.effectText ? { effectText: r.effectText } : {}),
  };
  cards.push(card);
}

const outPath = 'shared/data/cards.json';
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(cards, null, 2));

console.log(`Imported ${cards.length} cards → ${outPath}`);
if (errors.length > 0) {
  console.warn(`${errors.length} records skipped:`);
  for (const e of errors.slice(0, 10)) console.warn(`  ${e}`);
}
