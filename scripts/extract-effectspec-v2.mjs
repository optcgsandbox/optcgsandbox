#!/usr/bin/env node
// Phase B.1 — deterministic regex extractor for effectSpecV2.
//
// Reads shared/data/cards.json, applies regex patterns to each card's
// effect_text, and writes `effectSpecV2` for cards matching the simple
// templates from Phase B's pattern inventory.
//
// V0 scope: 7 templates (standalone Blocker / Banish / Rush; [Counter]
// power buff; [Main] cost-capped KO; [Main] power buff; [Main] minus
// power debuff). Cards with COMPOUND effect_text (multiple clauses,
// `<br>` separators) are skipped — Phase C handles them.
//
// Each match emits `verified: 'auto'`. Cards without a match keep
// existing effectSpec (v1) or effectTags (legacy).
//
// Usage:
//   node scripts/extract-effectspec-v2.mjs
//   # rewrites shared/data/cards.json in place

import { readFileSync, writeFileSync } from 'node:fs';

const CARDS_PATH = 'shared/data/cards.json';
const cards = JSON.parse(readFileSync(CARDS_PATH, 'utf8'));

let updated = 0;
const byPattern = {};

function makeSpec(clauses, continuous = [], replacements = []) {
  return {
    clauses, continuous, replacements,
    schemaVersion: 2,
    verified: 'auto',
  };
}

for (const card of cards) {
  const text = card.effectText;
  if (!text || text === '-') continue;
  // Skip cards that already have a v2 spec (idempotent re-run).
  if (card.effectSpecV2 && card.effectSpecV2.clauses?.length > 0) continue;
  // Skip multi-clause (br-separated) cards — Phase C handles those.
  const hasMultiClause = (text.match(/<br>/g) ?? []).length > 0;

  // ── Pattern 1: standalone [Blocker] ────────────────────────────
  // Note: the (After your opponent declares an attack...) flavor follows
  // immediately. We accept that as part of the canonical Blocker text.
  const blockerOnly = /^\[Blocker\](\s*\(After your opponent declares an attack[^)]+\))?\.?\s*$/;
  if (!hasMultiClause && blockerOnly.test(text)) {
    card.effectSpecV2 = makeSpec([], [
      { action: { kind: 'grant_keyword_to_self', keyword: 'blocker' } },
    ]);
    updated++; byPattern.blockerOnly = (byPattern.blockerOnly ?? 0) + 1;
    continue;
  }

  // ── Pattern 2: standalone [Banish] ─────────────────────────────
  const banishOnly = /^\[Banish\](\s*\(When this card deals damage[^)]+\))?\.?\s*$/;
  if (!hasMultiClause && banishOnly.test(text)) {
    card.effectSpecV2 = makeSpec([], [
      { action: { kind: 'grant_keyword_to_self', keyword: 'banish' } },
    ]);
    updated++; byPattern.banishOnly = (byPattern.banishOnly ?? 0) + 1;
    continue;
  }

  // ── Pattern 3: standalone [Rush] ───────────────────────────────
  const rushOnly = /^\[Rush\](\s*\(This card can attack on the turn in which it is played\.\))?\.?\s*$/;
  if (!hasMultiClause && rushOnly.test(text)) {
    card.effectSpecV2 = makeSpec([], [
      { action: { kind: 'grant_keyword_to_self', keyword: 'rush' } },
    ]);
    updated++; byPattern.rushOnly = (byPattern.rushOnly ?? 0) + 1;
    continue;
  }

  // ── Pattern 4: [Counter] Up to N of your Leader or Character cards gains +M power during this battle ──
  const counterBuff = /^\[Counter\] Up to (\d+) of your Leader or Character cards gains \+(\d+) power during this battle\.\s*$/;
  if (!hasMultiClause) {
    const m = text.match(counterBuff);
    if (m) {
      const power = parseInt(m[2], 10);
      card.effectSpecV2 = makeSpec([
        { trigger: 'on_play', action: { kind: 'power_buff', magnitude: power, duration: 'this_battle' }, target: { kind: 'your_leader' }, verified: 'auto' },
      ]);
      updated++; byPattern.counterBuff = (byPattern.counterBuff ?? 0) + 1;
      continue;
    }
  }

  // ── Pattern 5: [Main] K.O. up to 1 of your opponent's Characters with a cost of N or less. ──
  const mainKoCost = /^\[Main\] K\.O\. up to (\d+) of your opponent's Characters with a cost of (\d+) or less\.\s*$/;
  if (!hasMultiClause) {
    const m = text.match(mainKoCost);
    if (m) {
      const costMax = parseInt(m[2], 10);
      card.effectSpecV2 = makeSpec([
        { trigger: 'on_play', action: { kind: 'removal_ko' }, target: { kind: 'opp_character', filter: { costMax } }, verified: 'auto' },
      ]);
      updated++; byPattern.mainKoCost = (byPattern.mainKoCost ?? 0) + 1;
      continue;
    }
  }

  // ── Pattern 6: [Main] Up to 1 of your Leader or Character cards gains +N power during this turn. ──
  const mainPowerBuff = /^\[Main\] Up to (\d+) of your Leader or Character cards gains \+(\d+) power during this turn\.\s*$/;
  if (!hasMultiClause) {
    const m = text.match(mainPowerBuff);
    if (m) {
      const power = parseInt(m[2], 10);
      card.effectSpecV2 = makeSpec([
        { trigger: 'on_play', action: { kind: 'power_buff', magnitude: power, duration: 'this_turn' }, target: { kind: 'your_leader' }, verified: 'auto' },
      ]);
      updated++; byPattern.mainPowerBuff = (byPattern.mainPowerBuff ?? 0) + 1;
      continue;
    }
  }

  // ── Pattern 7: [Main] Give up to N of your opponent's Characters −N power during this turn. ──
  const mainPowerDebuff = /^\[Main\] Give up to (\d+) of your opponent's Characters −(\d+) power during this turn\.\s*$/;
  if (!hasMultiClause) {
    const m = text.match(mainPowerDebuff);
    if (m) {
      const power = parseInt(m[2], 10);
      card.effectSpecV2 = makeSpec([
        { trigger: 'on_play', action: { kind: 'power_buff', magnitude: -power, duration: 'this_turn' }, target: { kind: 'opp_character' }, verified: 'auto' },
      ]);
      updated++; byPattern.mainPowerDebuff = (byPattern.mainPowerDebuff ?? 0) + 1;
      continue;
    }
  }
}

writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2));
console.log(`Updated ${updated} cards with effectSpecV2.`);
console.log('By pattern:', byPattern);
