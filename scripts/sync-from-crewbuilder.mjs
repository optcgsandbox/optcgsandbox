#!/usr/bin/env node
// One-shot sync: pull the OPTCG card corpus from Crew Builder's Supabase
// (`cards` + `card_tags` tables) and write `shared/data/cards.json` in the
// shape OPTCGSandbox's Card discriminated union expects.
//
// Credentials live in `~/Developer/crew-builder/.env`:
//   SUPABASE_URL, SUPABASE_ACCESS_TOKEN
// We hit the Management API SQL endpoint (the same path Crew Builder uses
// for DDL via PAT). Data is public OP-TCG card facts — copying it does NOT
// cross the account/payment isolation line documented in MEMORY.md, and
// nothing is written back to Crew Builder.
//
// Usage:
//   node scripts/sync-from-crewbuilder.mjs
//   # writes shared/data/cards.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

// ── 1. Load credentials from Crew Builder's .env ──────────────────────────
const CB_ENV = join(homedir(), 'Developer/crew-builder/.env');
const env = Object.fromEntries(
  readFileSync(CB_ENV, 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const eq = line.indexOf('=');
      return [line.slice(0, eq), line.slice(eq + 1).replace(/^"|"$/g, '')];
    }),
);
const SUPABASE_URL = env.SUPABASE_URL;
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
if (!SUPABASE_URL || !ACCESS_TOKEN) {
  console.error('Missing SUPABASE_URL or SUPABASE_ACCESS_TOKEN in Crew Builder .env');
  process.exit(1);
}
const PROJECT_REF = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

// ── 2. Allowed sets (kept in sync with shared/engine/cards/Card.ts) ───────
const ALLOWED_COLORS = new Set(['red', 'green', 'blue', 'purple', 'black', 'yellow']);
const ALLOWED_KINDS = new Set(['leader', 'character', 'event', 'stage']);
const ALLOWED_KEYWORDS = new Set([
  'blocker', 'rush', 'rush_character', 'double_attack', 'banish', 'unblockable',
  'on_play', 'on_ko', 'when_attacking', 'activate_main', 'trigger', 'counter',
  'once_per_turn',
]);
const ALLOWED_TAGS = new Set([
  'searcher', 'draw', 'removal_ko', 'removal_bounce', 'removal_cost_reduce',
  'blocker', 'rush', 'double_attack', 'counter_event', 'counter_character',
  'power_buff', 'set_power_zero', 'replace_ko_to_hand', 'cost_reduction',
  'recursion', 'ramp', 'lifegain', 'life_to_hand', 'disruption', 'vanilla',
  'trigger',
  // V3-5:
  'rest_opp_don', 'mill', 'reveal_opp_hand', 'take_from_opp_hand',
  'search_deck', 'exile', 'play_for_free', 'rest_target', 'move_to_top',
]);

// ── 3. Helper: run a SQL query via the Management API ─────────────────────
async function sql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SQL failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── 4. Pull cards + tags ──────────────────────────────────────────────────
console.log('Querying Crew Builder cards…');
const rows = await sql(`
  select id, set_code, card_number, name, type, color, cost, power, counter, life, traits, effect_text
  from cards
  order by set_code, card_number
`);
console.log(`  ${rows.length} card rows.`);

console.log('Querying Crew Builder card_tags…');
const tagRows = await sql(`select card_id, tag from card_tags`);
console.log(`  ${tagRows.length} tag rows.`);

// Index tags by card_id for O(1) lookup.
const tagsByCard = new Map();
for (const t of tagRows) {
  if (!tagsByCard.has(t.card_id)) tagsByCard.set(t.card_id, []);
  tagsByCard.get(t.card_id).push(t.tag);
}

// ── 5. Transform rows → Card-shape records ────────────────────────────────
const cards = [];
let skipped = 0;
for (const r of rows) {
  const kind = (r.type ?? '').toLowerCase();
  if (!ALLOWED_KINDS.has(kind)) {
    skipped++;
    continue;
  }
  const id = r.set_code && r.card_number ? `${r.set_code}-${r.card_number}` : r.id;
  // Split "red" or "red,green" into array; drop unknown colors.
  const colorsRaw = (r.color ?? '').split(',').map((c) => c.trim().toLowerCase());
  const colors = colorsRaw.filter((c) => ALLOWED_COLORS.has(c));
  if (colors.length === 0) {
    skipped++;
    continue;
  }
  // Tag split: any tag in ALLOWED_KEYWORDS goes into `keywords`; any in
  // ALLOWED_TAGS goes into `effectTags`. Tags can appear in both (blocker,
  // rush, double_attack, trigger). The taxonomy is shared with Crew Builder
  // intentionally so this mapping is direct.
  const rawTags = tagsByCard.get(r.id) ?? [];
  const keywords = [...new Set(rawTags.filter((t) => ALLOWED_KEYWORDS.has(t)))];
  const effectTags = [...new Set(rawTags.filter((t) => ALLOWED_TAGS.has(t)))];
  if (effectTags.length === 0) effectTags.push('vanilla');

  const card = {
    id,
    name: r.name ?? id,
    kind,
    colors,
    cost: kind === 'leader' ? null : (r.cost ?? 0),
    power: kind === 'leader' || kind === 'character' ? (r.power ?? 0) : null,
    counterValue: r.counter ?? null,
    traits: Array.isArray(r.traits) ? r.traits : [],
    keywords,
    effectTags,
  };
  if (kind === 'leader') card.life = r.life ?? 5;
  if (r.effect_text) card.effectText = r.effect_text;
  // Events with [Counter +N] in text — leave counterEventBoost null; D3 covers
  // the boost at play-time via the effect-tag dispatch when authored per-card.
  if (kind === 'event') card.counterEventBoost = null;

  // V3 per-card param binding (regex-extract from effect_text):
  //   draw N        — "Draw N cards"
  //   mill N        — "trash N cards from the top of your opponent's deck"
  //   lifegain N    — "add the top card of your deck to your life"
  //   power_buff +N — "gains +N power"
  //   searcher peek — "Look at the top N cards … may add up to M" → {lookCount: N, addCount: M}
  // Only emit templateParams when the regex hits — defaults stay in effect
  // otherwise. Multi-effect cards may have partial coverage; that's accepted
  // V0 fidelity per the engine-v3 roadmap.
  const text = r.effect_text ?? '';
  const params = {};
  if (effectTags.includes('draw')) {
    const m = text.match(/Draw (\d+) cards?/i);
    if (m) params.draw = parseInt(m[1], 10);
  }
  if (effectTags.includes('mill')) {
    const m = text.match(/trash (\d+) cards? from the top of your (own )?deck/i)
      ?? text.match(/Place the top (\d+) cards? of your deck in your trash/i);
    if (m) params.mill = parseInt(m[1], 10);
  }
  if (effectTags.includes('power_buff')) {
    const m = text.match(/gains? \+(\d+) power/i);
    if (m) params.power_buff = parseInt(m[1], 10);
  }
  if (effectTags.includes('searcher')) {
    const m = text.match(/Look at the top (\d+) cards? of your deck/i);
    if (m) {
      const lookCount = parseInt(m[1], 10);
      const addMatch = text.match(/(?:reveal|add) (?:up to )?(\d+)/i);
      const addCount = addMatch ? parseInt(addMatch[1], 10) : 1;
      params.searcher = { lookCount, addCount };
    }
  }
  if (effectTags.includes('rest_opp_don')) {
    const m = text.match(/rest (\d+) of your opponent's DON/i);
    if (m) params.rest_opp_don = parseInt(m[1], 10);
  }
  if (Object.keys(params).length > 0) card.templateParams = params;

  cards.push(card);
}

// ── 6. Write output ───────────────────────────────────────────────────────
const outPath = 'shared/data/cards.json';
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(cards, null, 2));

console.log(`Wrote ${cards.length} cards → ${outPath} (${skipped} skipped).`);

// Useful sanity counts:
const byKind = cards.reduce((acc, c) => ((acc[c.kind] = (acc[c.kind] ?? 0) + 1), acc), {});
console.log('  by kind:', byKind);
