#!/usr/bin/env node
// Phase B — deterministic regex extractor for effectSpecV2.
//
// Reads shared/data/cards.json, applies regex patterns to each card's
// effect_text, and writes `effectSpecV2` for cards matching the templates
// from the Phase B pattern inventory. Compound effects separated by
// `<br>` are split per-clause and each clause matched independently.
//
// Each emitted spec carries `verified: 'auto'`. Cards without any
// matching clauses are left untouched. Cards with PARTIAL matches (some
// clauses matched, others didn't) emit specs for the matched portions
// only and are flagged so a human knows the spec is incomplete.

import { readFileSync, writeFileSync } from 'node:fs';

const CARDS_PATH = 'shared/data/cards.json';
const cards = JSON.parse(readFileSync(CARDS_PATH, 'utf8'));

// Pattern matchers each take a clause string and return a partial spec
// fragment (`{ clauses?, continuous?, replacements? }`) or null.

const matchers = [
  // ── Keyword-only clauses ──────────────────────────────────────
  {
    name: 'blockerOnly',
    rx: /^\[Blocker\](\s*\(After your opponent declares an attack[^)]+\))?\.?\s*$/,
    emit: () => ({ continuous: [{ action: { kind: 'grant_keyword_to_self', keyword: 'blocker' } }] }),
  },
  {
    name: 'banishOnly',
    rx: /^\[Banish\](\s*\(When this card deals damage[^)]+\))?\.?\s*$/,
    emit: () => ({ continuous: [{ action: { kind: 'grant_keyword_to_self', keyword: 'banish' } }] }),
  },
  {
    name: 'rushOnly',
    rx: /^\[Rush\](\s*\(This card can attack on the turn in which it is played\.\))?\.?\s*$/,
    emit: () => ({ continuous: [{ action: { kind: 'grant_keyword_to_self', keyword: 'rush' } }] }),
  },
  {
    name: 'doubleAttackOnly',
    rx: /^\[Double Attack\](\s*\(This card deals \d+ damage\.\))?\.?\s*$/,
    emit: () => ({ continuous: [{ action: { kind: 'grant_keyword_to_self', keyword: 'double_attack' } }] }),
  },

  // ── [Counter] effects ─────────────────────────────────────────
  {
    name: 'counterBuffLeaderOrChar',
    rx: /^\[Counter\] Up to (\d+) of your Leader or Character cards gains \+(\d+) power during this battle\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'power_buff', magnitude: parseInt(m[2], 10), duration: 'this_battle' }, target: { kind: 'your_leader' }, verified: 'auto' }],
    }),
  },
  {
    name: 'counterBuffOwnLeader',
    rx: /^\[Counter\] Your Leader gains \+(\d+) power during this battle\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'power_buff', magnitude: parseInt(m[1], 10), duration: 'this_battle' }, target: { kind: 'your_leader' }, verified: 'auto' }],
    }),
  },

  // ── [On Play] / [Main] simple actions ─────────────────────────
  {
    name: 'onPlayDrawN',
    rx: /^\[On Play\] Draw (\d+) cards?\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'draw', magnitude: parseInt(m[1], 10) }, verified: 'auto' }],
    }),
  },
  {
    name: 'mainDrawN',
    rx: /^\[Main\] Draw (\d+) cards?\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'draw', magnitude: parseInt(m[1], 10) }, verified: 'auto' }],
    }),
  },
  {
    name: 'onPlayKoCost',
    rx: /^\[On Play\] K\.O\. up to (\d+) of your opponent's Characters with a cost of (\d+) or less\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'removal_ko' }, target: { kind: 'opp_character', filter: { costMax: parseInt(m[2], 10) } }, verified: 'auto' }],
    }),
  },
  {
    name: 'mainKoCost',
    rx: /^\[Main\] K\.O\. up to (\d+) of your opponent's Characters with a cost of (\d+) or less\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'removal_ko' }, target: { kind: 'opp_character', filter: { costMax: parseInt(m[2], 10) } }, verified: 'auto' }],
    }),
  },
  {
    name: 'onPlayBounceCost',
    rx: /^\[On Play\] Return up to (\d+) of your opponent's Characters? with a cost of (\d+) or less to the owner's hand\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'removal_bounce' }, target: { kind: 'opp_character', filter: { costMax: parseInt(m[2], 10) } }, verified: 'auto' }],
    }),
  },
  {
    name: 'onPlayBuffLeaderOrChar',
    rx: /^\[On Play\] Up to (\d+) of your Leader or Character cards gains \+(\d+) power during this turn\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'power_buff', magnitude: parseInt(m[2], 10), duration: 'this_turn' }, target: { kind: 'your_leader' }, verified: 'auto' }],
    }),
  },
  {
    name: 'mainBuffLeaderOrChar',
    rx: /^\[Main\] Up to (\d+) of your Leader or Character cards gains \+(\d+) power during this turn\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'power_buff', magnitude: parseInt(m[2], 10), duration: 'this_turn' }, target: { kind: 'your_leader' }, verified: 'auto' }],
    }),
  },
  {
    name: 'onPlayDebuff',
    rx: /^\[On Play\] Give up to (\d+) of your opponent's Characters? −(\d+) power during this turn\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'power_buff', magnitude: -parseInt(m[2], 10), duration: 'this_turn' }, target: { kind: 'opp_character' }, verified: 'auto' }],
    }),
  },
  {
    name: 'mainDebuff',
    rx: /^\[Main\] Give up to (\d+) of your opponent's Characters? −(\d+) power during this turn\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'power_buff', magnitude: -parseInt(m[2], 10), duration: 'this_turn' }, target: { kind: 'opp_character' }, verified: 'auto' }],
    }),
  },
  {
    name: 'onPlayRestOppCharCost',
    rx: /^\[On Play\] Rest up to (\d+) of your opponent's Characters? with a cost of (\d+) or less\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'rest_target' }, target: { kind: 'opp_character', filter: { costMax: parseInt(m[2], 10) } }, verified: 'auto' }],
    }),
  },
  {
    name: 'mainRestOppCharCost',
    rx: /^\[Main\] Rest up to (\d+) of your opponent's Characters? with a cost of (\d+) or less\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'rest_target' }, target: { kind: 'opp_character', filter: { costMax: parseInt(m[2], 10) } }, verified: 'auto' }],
    }),
  },
  // ── Ramp-to-leader (give rested DON) ──────────────────────────
  {
    name: 'onPlayRampToLeader',
    rx: /^\[On Play\] Give up to (\d+) rested DON!! cards? to (?:your|1 of your) (?:Leader|Leader or 1 of your Characters?)\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'give_don_to_target', magnitude: parseInt(m[1], 10), rested: true }, target: { kind: 'your_leader' }, verified: 'auto' }],
    }),
  },
  {
    name: 'activateMainRampToLeader',
    rx: /^\[Activate: Main\] \[Once Per Turn\] Give up to (\d+) rested DON!! cards? to (?:your|1 of your) (?:Leader|Leader or 1 of your Characters?)\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'activate_main', action: { kind: 'give_don_to_target', magnitude: parseInt(m[1], 10), rested: true }, target: { kind: 'your_leader' }, verified: 'auto' }],
    }),
  },
  // ── On-K.O. simple draw ───────────────────────────────────────
  {
    name: 'onKoDraw',
    rx: /^\[On K\.O\.\] Draw (\d+) cards?\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_ko', action: { kind: 'draw', magnitude: parseInt(m[1], 10) }, verified: 'auto' }],
    }),
  },
  // ── Searcher peek (deck top N, add up to M, by-trait/type filter) ──
  {
    name: 'onPlaySearcherByTrait',
    rx: /^\[On Play\] Look at (\d+) cards? from the top of your deck; reveal up to (\d+) \{([^}]+)\} type cards? (?:other than \[[^\]]+\] )?and add (?:them|it) to your hand\. Then, place the rest at the bottom of your deck in any order\.\s*$/,
    emit: (m) => ({
      clauses: [{
        trigger: 'on_play',
        action: { kind: 'searcher_peek', lookCount: parseInt(m[1], 10), addCount: parseInt(m[2], 10), filter: { trait: m[3] } },
        verified: 'auto',
      }],
    }),
  },
  // ── Lifegain (top deck card → top life) ──────────────────────
  {
    name: 'onPlayLifegain',
    rx: /^\[On Play\] Add up to (\d+) cards? from the top of your deck to the top of your Life cards\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'add_to_own_life_top', faceUp: false, from: 'top_of_deck' }, magnitude: parseInt(m[1], 10), verified: 'auto' } ],
    }),
  },
];

function matchClause(clauseText) {
  const t = clauseText.trim();
  if (!t) return null;
  for (const m of matchers) {
    const r = t.match(m.rx);
    if (r) return { ...m.emit(r), _patternName: m.name };
  }
  return null;
}

function matchCardEffectText(text) {
  // Split on <br> AND treat raw newlines as boundaries.
  const clauses = text.split(/<br>/i).map((c) => c.trim()).filter(Boolean);
  const merged = { clauses: [], continuous: [], replacements: [] };
  let anyMatched = false;
  let allMatched = true;
  const patternsHit = [];
  for (const clause of clauses) {
    const frag = matchClause(clause);
    if (!frag) { allMatched = false; continue; }
    anyMatched = true;
    patternsHit.push(frag._patternName);
    if (frag.clauses) merged.clauses.push(...frag.clauses);
    if (frag.continuous) merged.continuous.push(...frag.continuous);
    if (frag.replacements) merged.replacements.push(...frag.replacements);
  }
  if (!anyMatched) return null;
  return {
    spec: {
      ...merged,
      schemaVersion: 2,
      verified: allMatched ? 'auto' : 'flagged',
    },
    patternsHit,
    allMatched,
  };
}

let updated = 0;
let flagged = 0;
const byPattern = {};

for (const card of cards) {
  const text = card.effectText;
  if (!text || text === '-') continue;
  if (card.effectSpecV2 && (card.effectSpecV2.clauses?.length > 0 || card.effectSpecV2.continuous?.length > 0)) continue;
  const result = matchCardEffectText(text);
  if (!result) continue;
  card.effectSpecV2 = result.spec;
  updated++;
  if (!result.allMatched) flagged++;
  for (const p of result.patternsHit) byPattern[p] = (byPattern[p] ?? 0) + 1;
}

writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2));
console.log(`Updated ${updated} cards with effectSpecV2.`);
console.log(`  ${updated - flagged} fully matched (verified: 'auto').`);
console.log(`  ${flagged} partial matches (verified: 'flagged' for review).`);
console.log('By pattern:', byPattern);
