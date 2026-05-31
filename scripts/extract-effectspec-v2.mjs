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
  // ── B.3 patterns ────────────────────────────────────────────────
  // Orphan flavor parentheticals — these appear as their own clauses on
  // compound cards because Bandai's <br> separators split them out. They
  // describe the keyword behavior, not a new effect.
  {
    name: 'flavorParen',
    rx: /^\((?:After your opponent declares an attack[^)]+|This card can attack on the turn in which it is played\.|This card deals \d+ damage\.|When this card deals damage, the target card is trashed without activating its Trigger\.)\)\.?\s*$/,
    emit: () => ({}), // no-op match — swallow the clause
  },
  // [On Play] Trash N cards from the top of your deck — self mill.
  {
    name: 'onPlaySelfMill',
    rx: /^\[On Play\] Trash (\d+) cards? from the top of your deck\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'mill_self', magnitude: parseInt(m[1], 10) }, verified: 'auto' }],
    }),
  },
  // "This Leader cannot attack." continuous restriction.
  {
    name: 'leaderCannotAttack',
    rx: /^This Leader cannot attack\.\s*$/,
    emit: () => ({
      continuous: [{ action: { kind: 'restrict_self_attack' } }],
    }),
  },
  // K.O. by base power filter — `with N power or less`.
  {
    name: 'onPlayKoByPower',
    rx: /^\[On Play\] K\.O\. up to (\d+) of your opponent's Characters with (\d+) (?:base )?power or less\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'removal_ko' }, target: { kind: 'opp_character', filter: { powerMax: parseInt(m[2], 10) } }, verified: 'auto' }],
    }),
  },
  // K.O. of RESTED opp character with cost cap.
  {
    name: 'onPlayKoRestedByCost',
    rx: /^\[On Play\] K\.O\. up to (\d+) of your opponent's rested Characters with a cost of (\d+) or less\.\s*$/,
    emit: (m) => ({
      clauses: [{ trigger: 'on_play', action: { kind: 'removal_ko' }, target: { kind: 'opp_character', filter: { costMax: parseInt(m[2], 10), rested: true } }, verified: 'auto' }],
    }),
  },
  // Discard-cost KO: `[On Play] You may trash 1 card from your hand: K.O. ...`
  {
    name: 'onPlayDiscardCostKo',
    rx: /^\[On Play\] You may trash (\d+) cards? from your hand: K\.O\. up to (\d+) of your opponent's Characters with a cost of (\d+) or less\.\s*$/,
    emit: (m) => ({
      clauses: [{
        trigger: 'on_play',
        cost: { discardHand: parseInt(m[1], 10) },
        action: { kind: 'removal_ko' },
        target: { kind: 'opp_character', filter: { costMax: parseInt(m[3], 10) } },
        verified: 'auto',
      }],
    }),
  },
  // Counter buff w/ conditional bonus on low life — "Then, if you have N or less Life cards, that card gains an additional +M power."
  // We capture only the base buff in V0; the conditional bonus is dropped.
  {
    name: 'counterBuffWithLifeBonus',
    rx: /^\[Counter\] Up to (\d+) of your Leader or Character cards gains \+(\d+) power during this battle\. Then, if you have (\d+) or less Life cards, that card gains an additional \+(\d+) power\.\s*$/,
    emit: (m) => ({
      clauses: [{
        trigger: 'on_play',
        action: { kind: 'power_buff', magnitude: parseInt(m[2], 10), duration: 'this_battle' },
        target: { kind: 'your_leader' },
        verified: 'flagged', // conditional bonus dropped — flag for review
      }],
    }),
  },
  // [Main] Choose one: — V0 detect-only stub. Drop a flagged clause so the
  // card isn't silently dropped from the corpus.
  {
    name: 'mainChooseOneStub',
    rx: /^\[Main\] Choose one:\s*$/,
    emit: () => ({
      clauses: [{
        trigger: 'on_play',
        action: { kind: 'choose_one', options: [] }, // V0 stub — options inlined later
        verified: 'flagged',
      }],
    }),
  },
  // Conditional self cost-up: "If your Leader has the {X} type, this Character gains +N cost."
  {
    name: 'leaderTraitCostUp',
    rx: /^If your Leader has the \{([^}]+)\} type, this Character gains \+(\d+) cost\.\s*$/,
    emit: (m) => ({
      continuous: [{
        condition: { type: 'if_leader_has_trait', trait: m[1] },
        action: { kind: 'cost_modifier_in_hand', delta: parseInt(m[2], 10) },
      }],
    }),
  },
  // B.4 patterns
  {
    name: 'counterDiscardBuff',
    rx: /^\[Counter\] You may trash (\d+) cards? from your hand: Up to (\d+) of your Leader or Character cards gains \+(\d+) power during this battle\.\s*$/,
    emit: (m) => ({
      clauses: [{
        trigger: 'on_play',
        cost: { discardHand: parseInt(m[1], 10) },
        action: { kind: 'power_buff', magnitude: parseInt(m[3], 10), duration: 'this_battle' },
        target: { kind: 'your_leader' },
        verified: 'auto',
      }],
    }),
  },
  {
    name: 'replacementDiscardOnRemove',
    rx: /^\[Once Per Turn\] If this Character would be removed from the field by your opponent's effect, you may trash (\d+) cards? from your hand instead\.\s*$/,
    emit: (m) => ({
      replacements: [{
        trigger: 'would_be_removed',
        cost: { discardHand: parseInt(m[1], 10) },
        action: { kind: 'draw', magnitude: 0 }, // V0 placeholder — engine just blocks removal
        conditional: true,
        verified: 'flagged',
      }],
    }),
  },
  {
    name: 'onPlayCostDebuff',
    rx: /^\[On Play\] Give up to (\d+) of your opponent's Characters? −(\d+) cost during this turn\.\s*$/,
    emit: (m) => ({
      clauses: [{
        trigger: 'on_play',
        action: { kind: 'removal_cost_reduce', magnitude: parseInt(m[2], 10), duration: 'this_turn' },
        target: { kind: 'opp_character' },
        verified: 'auto',
      }],
    }),
  },
  {
    name: 'onPlayRampDon',
    rx: /^\[On Play\] Add up to (\d+) DON!! cards? from your DON!! deck and set it as active\.\s*$/,
    emit: (m) => ({
      clauses: [{
        trigger: 'on_play',
        action: { kind: 'ramp', magnitude: parseInt(m[1], 10) },
        verified: 'auto',
      }],
    }),
  },
  {
    name: 'onPlayPeekReorderOwnDeck',
    rx: /^\[On Play\] Look at (\d+) cards? from the top of your deck and place them at the top or bottom of (?:the|your) deck in any order\.\s*$/,
    emit: (m) => ({
      clauses: [{
        trigger: 'on_play',
        action: { kind: 'peek_and_reorder_own_deck', count: parseInt(m[1], 10) },
        verified: 'auto',
      }],
    }),
  },
  {
    name: 'donXBlockerGrant',
    rx: /^\[DON!! x(\d+)\] This Character gains \[Blocker\]\.\s*$/,
    emit: (m) => ({
      continuous: [{
        condition: { type: 'if_have_given_don_min', n: parseInt(m[1], 10) },
        action: { kind: 'grant_keyword_to_self', keyword: 'blocker' },
      }],
    }),
  },
  {
    name: 'donXRushGrant',
    rx: /^\[DON!! x(\d+)\] This Character gains \[Rush\]\.\s*$/,
    emit: (m) => ({
      continuous: [{
        condition: { type: 'if_have_given_don_min', n: parseInt(m[1], 10) },
        action: { kind: 'grant_keyword_to_self', keyword: 'rush' },
      }],
    }),
  },
  {
    name: 'donXAttackKoByPower',
    rx: /^\[DON!! x(\d+)\] \[When Attacking\] K\.O\. up to (\d+) of your opponent's Characters with (\d+) power or less\.\s*$/,
    emit: (m) => ({
      clauses: [{
        trigger: 'when_attacking',
        condition: { type: 'if_have_given_don_min', n: parseInt(m[1], 10) },
        action: { kind: 'removal_ko' },
        target: { kind: 'opp_character', filter: { powerMax: parseInt(m[3], 10) } },
        verified: 'auto',
      }],
    }),
  },
  {
    name: 'donXAttackDebuff',
    rx: /^\[DON!! x(\d+)\] \[When Attacking\] Give up to (\d+) of your opponent's Characters? −(\d+) power during this turn\.\s*$/,
    emit: (m) => ({
      clauses: [{
        trigger: 'when_attacking',
        condition: { type: 'if_have_given_don_min', n: parseInt(m[1], 10) },
        action: { kind: 'power_buff', magnitude: -parseInt(m[3], 10), duration: 'this_turn' },
        target: { kind: 'opp_character' },
        verified: 'auto',
      }],
    }),
  },
];

/** Pre-process a clause: if it starts with `[<trigger>] DON!! −N (...): <rest>`,
 *  extract the cost and return both `{ trigger, cost, restClause }`. Returns
 *  null when no DON-cost prefix present. */
function stripDonCostPrefix(clauseText) {
  const m = clauseText.match(/^(\[(?:On Play|Main|When Attacking|Activate: Main\] \[Once Per Turn|Activate: Main|Counter|On Your Opponent's Attack|On K\.O\.)\]) DON!! −(\d+) \(You may return the specified number of DON!! cards from your field to your DON!! deck\.\): (.+)$/);
  if (!m) return null;
  return {
    triggerPrefix: m[1],
    donCost: parseInt(m[2], 10),
    restClause: `${m[1]} ${m[3]}`,
  };
}

function matchClause(clauseText) {
  const t = clauseText.trim();
  if (!t) return null;
  // First try direct match.
  for (const m of matchers) {
    const r = t.match(m.rx);
    if (r) return { ...m.emit(r), _patternName: m.name };
  }
  // Then try after stripping a DON-cost prefix.
  const stripped = stripDonCostPrefix(t);
  if (stripped) {
    for (const m of matchers) {
      const r = stripped.restClause.match(m.rx);
      if (r) {
        const frag = m.emit(r);
        // Attach donCost to each emitted clause.
        if (frag.clauses) {
          frag.clauses = frag.clauses.map((c) => ({
            ...c,
            cost: { ...(c.cost ?? {}), donCost: stripped.donCost },
          }));
        }
        return { ...frag, _patternName: `${m.name}+donCost` };
      }
    }
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
  // Don't write specs whose merged content is empty (e.g. card had only
  // flavor parentheticals matched). Those carry no value and pollute the
  // count.
  if (merged.clauses.length === 0 && merged.continuous.length === 0 && merged.replacements.length === 0) {
    return null;
  }
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
