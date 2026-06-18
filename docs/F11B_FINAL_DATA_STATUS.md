# F-11B — Final Card-Mapping Data Status

**Date:** 2026-06-17 · **Scope:** data-correctness only (cards.json). No engine/UI/AI/multiplayer/animation changes. Not committed.

All fixes are surgical, per-clause, assertion-gated edits; ambiguous/entangled cards were **deferred, not guessed**. Tests: `npx vitest run` → **1159 passed / 0 failed / 2 skipped**; `npm run build` → green.

---

## A. Cards fixed in F-11A (49) — DON!! −N cost key

`donCost` (rests DON on field) → `donCostReturnToDeck` (returns DON to deck). 54 clauses across 49 cards. Two partial-converts kept a legit rest cost (EB04-040 `donCost:6` = "rest 6 DON"; OP05-119 `donCost:1` = "➀" activate). OP10-071 untouched (its `donCost` is a printed "rest 1 DON").

## B. Cards fixed in F-11B (21 cards)

### B1. Life-to-hand cost key (18 cards) — `flipLife` → `lifeToHand`
`flipLife` flips a life card face-up in place (`costs2.ts` flipLife); the printed cost "add 1 card from … your Life cards to your hand" must **move** it to hand (`lifeToHand`, costs2.ts:257).

> **The F-11 audit UNDERCOUNTED this class.** It found 7; the true count is **23**. Its regex used a tight `.{0,30}` gap that missed the "top **or bottom** of your Life cards to your hand" phrasing (16 extra cards). Of those, 11 were clean key-swaps (fixed); 5 are entangled (deferred — see C).

Fixed (18): `OP09-075, OP11-069, OP12-100, OP15-109, ST07-004, ST08-014, ST20-004` (the 7 from the audit) + `OP09-028, OP10-103, OP11-106, OP11-110, ST07-001, ST07-005, ST07-009, ST07-017, ST09-007, ST09-008, ST09-012` (11 missed by the audit).

Residual note: `lifeToHand` takes the **top** N; cards printing "top **or bottom**" lose that choice (a known V1 limitation, not a key error). OP12-100 also has *separate* unrelated gaps ("+3 cost" missing) — out of scope, flagged for review.

### B2. Duration (3 cards) — `this_turn` → `opp_next_turn`
Text "until the start of your next turn" must outlast the current turn. `givePower` reads **`action.duration`** (`actions.ts:78`); clause-level duration is ignored.

- **OP02-120 Uta** — TRUE BUG, both `power_buff` (leader + all chars) were `this_turn`.
- **OP06-006 Saga** — TRUE BUG, the +1000 was `this_turn` (clause[1]'s separate action-mismatch bug left for review).
- **OP04-006 Koza** — TRUE BUG. **This corrects my F-11A claim that it was a false positive.** Independent verification showed the +2000 action carries `duration:"this_turn"` while the clause-level `opp_next_turn` is **dead** (the engine never reads clause-level duration), so the buff actually expired this turn. Fixed.

A robust re-derivation confirms duration is now **complete** — 0 cards remain with next-turn text + a `this_turn` duration.

**Total fixed A+B: 70 unique cards** (49 + 21; no overlap — OP02-120's DON cost was already correct, it was a duration-only bug).

---

## C. Remaining PROVEN-wrong cards (11) — deferred, NOT guessed

### C1. Entangled life-to-hand (5) — need a remodel, not a key swap
`flipLife` cost AND a `life_to_hand` ACTION already present (the cost-effect is double-modeled), or a duplicated-cost group: `P-036, P-073, P-105, ST13-012, PRB02-016`. PRB02-016 additionally is a documented F-8A cost-dup exception and has a wrong target. Each needs a per-card remodel (F-11C / manual).

### C2. Other proven classes (3) — outside F-11B's phases (F-8A-flagged)
- `ST28-004` — "return the given DON" modeled as `donCost` (rest). (Not the "DON!! −N" pattern, so F-11A didn't touch it.)
- `ST22-001` — text prints place-on-**TOP** of deck; spec uses `bottom_of_deck_from_hand`.
- `OP14-058` — `[Main]`/`[Counter]` sections share one `on_play` trigger (mode mixing).

### C3. Structural under-models (3) — PARTIAL
- `EB03-055`, `ST27-005` — printed **[On K.O.]** secondary clause missing from the spec.
- `P-092` — `[Opponent's Turn] −3000` self-debuff not represented.

---

## D. Remaining UNSUPPORTED cards (19) — classified, NOT authored

### D1. Author-safe (9) — complete text, existing primitives
Plain `[Counter]` power buffs ± simple riders (set-DON-active, conditional draw, trait filter):
`OP03-118` (+5000), `OP09-116` (+2000), `OP14-117` (+3000 trait), `ST01-014` (+3000), `ST06-016` (+2000), `ST02-015` (+2000 + set DON active), `ST02-016` (+4000 + set DON active), `OP10-115` (+4000 + if-0-life draw), `OP04-099` (name-alias only → `rules.nameAliases`).

### D2. Needs manual review (10)
- **Truncated source text in the corpus** (un-authorable until re-scraped): `OP03-032` (len 44), `OP04-042` (len 25), `OP06-026` (len 29) — all end mid-sentence.
- **Missing condition handler / complex trigger:** `OP06-038` (needs "8+ rested cards" condition — no handler, an F-8 D-item), `OP14-018` ("if a Character ≥8000 power"), `OP02-002` (on-DON-given trigger), `OP01-062` (leader once-per-turn-draw tracking), `OP04-047` (end-of-battle bottom-deck).
- **Conditional/named riders:** `OP12-115` (named recursion if ≤2 Life), `OP13-115` (nested conditional buff).

---

## E. Remaining NEEDS_HUMAN_REVIEW (~680)

All carry `flagged` provenance and no decisive deterministic signal. The linter cannot certify them either way — this is the genuine unknown. Converting them to a verdict requires a per-card reading pass (LLM agent fan-out or human). **Unverified, not "fine."**

---

## F. Confidence summary

```
Total cards:                 2489

Known correct:               1779   (303 vanilla/ground-truth EXACT
                                      + 1476 human-reviewed passing ALL deterministic
                                      text↔spec checks, incl. the 70 fixed in A+B)
Proven wrong (deferred):       11   (5 entangled life + 3 F-8A class + 3 PARTIAL)
Unsupported:                   19   (9 author-safe + 10 manual; 3 are truncated text)
Needs human review:           680   (flagged provenance — UNVERIFIED)
```

**Caveats (no hand-waving):**
- "Known correct" means *passed deterministic checks + good provenance* — NOT individually proven. Subtle errors the linter doesn't probe (wrong filter trait, off-by-one count, target side) can still hide here. Two human-reviewed cards were proven wrong this session (the DON undercount), so provenance is not a guarantee.
- The 680 NEEDS_HUMAN_REVIEW are unverified; they are the next real coverage frontier.
- Proven-wrong is now **11** (down from the audit's 62: 49 + 21 fixed, the rest were already correct or moved on re-verification). Every remaining one is enumerated above with a reason for deferral.

---

## Files & tests

- `shared/data/cards.json` — 76 surgical key/value swaps (54 DON + 18 life + 4 duration), 70 unique cards. No other lines touched.
- `shared/engine-v2/__tests__/don-return-cost-f11a.test.ts` — DON invariant + 4 regressions + old-behavior proof (9 tests).
- `shared/engine-v2/__tests__/mapping-invariants-f11b.test.ts` — life-to-hand + duration invariants (with documented exception list) + runtime regressions + old-behavior proofs (5 tests).
- `shared/engine-v2/__tests__/cards/EB02-010.test.ts` — updated the one per-card test that pinned the old `donCost:2`.

Re-run audits: `node /tmp/f9/lint.mjs` (current snapshot). Patch scripts (idempotent, assertion-gated): `/tmp/f9/patch_don.mjs`, `/tmp/f9/patch_f11b.mjs`, `/tmp/f9/patch_life15.mjs`.
