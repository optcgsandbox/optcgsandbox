# F-11 — Card Text → effectSpecV2 Mapping Audit

**Date:** 2026-06-13 · **Scope:** read-only · **Question:** for every card, does `effectSpecV2` actually match the *printed English text* — not just "is the primitive supported" (that was F-9).

## Method & honesty statement

This audit is a **deterministic text↔spec linter** (`/tmp/f9/lint.mjs`), **not** a full LLM/human semantic read of 2,489 cards. It parses high-signal tokens from `effectText` (trigger tags, `DON!! −N`, "until … next turn", power/draw numbers, cost filters, "you may"/"up to") and compares them to the corresponding `effectSpecV2` fields. It therefore reports two kinds of result with very different confidence:

- **PROVABLE mismatches** (`WRONG`/`PARTIAL`) — a measured contradiction between text and spec, each re-checkable. These are real.
- **Provenance-based confidence** for everything the linter can't decisively judge (`LIKELY_CORRECT`/`NEEDS_HUMAN_REVIEW`) — the linter passed its checks, but did **not** prove full semantic equivalence.

I am **not** claiming to have hand-read every card. Converting the 659 `NEEDS_HUMAN_REVIEW` cards to a verdict requires a per-card reading pass (LLM agent fan-out or human) — flagged as the follow-up. Every claim below is grounded in a script or a file:line, per project discipline.

---

## 1. Headline classification (all 2,489 cards)

| status | count | % | meaning |
|---|---:|---:|---|
| **EXACT** | 303 | 12.2% | vanilla (`effectText "-"` ↔ empty spec) — nothing to mismap |
| **LIKELY_CORRECT** | 1,443 | 58.0% | human-reviewed provenance + passed every deterministic check |
| **PARTIAL** | 3 | 0.1% | spec under-models the text (a printed clause is missing) |
| **WRONG** | 62 | 2.5% | **proven** text↔spec contradiction (cost-key / duration / number) |
| **NEEDS_HUMAN_REVIEW** | 659 | 26.5% | `flagged` provenance, no decisive linter signal — unverified |
| **UNSUPPORTED** | 19 | 0.8% | empty/unauthored spec, real ability text (from F-9) |

> Of 2,167 effect-bearing specs, the linter **proves 65 are mis-mapped** (62 WRONG + 3 PARTIAL), confirms 1,443 against good provenance, and leaves **659 (all `flagged`) genuinely unverified**. The honest read: the *known-good* portion is ~58%, the *known-bad* ~3%, and ~27% is **unknown** pending a reading pass.

---

## 2. Provenance reliability — two structural findings

1. **There is no authoritative-verified *effect* spec.** All 297 `ground-truth` cards are **vanillas** (0 non-vanilla — verified). Every card with an actual effect is at best `human-reviewed` (1,490) or `flagged` (702). "ground-truth" in this corpus just marks "no effect to get wrong."
2. **Human review is not a reliable correctness signal for cost-key fidelity.** Of the 62 WRONG cards, **36 are `human-reviewed`** and only 26 are `flagged`. The systemic `DON!! −N` mis-key (below) slipped past human review on 36 cards — consistent with F-8A's note that cost-KEY fidelity was deferred to "Track 2." Reviewers checked *effect logic*, not *exact cost semantics*.

---

## 3. Top mismatch patterns (the WRONG bucket, all proven)

### 3a. `DON!! −N` modeled as **rest** instead of **return** — 49 cards 🔴 HIGHEST IMPACT
Printed "DON!! −N (You may return … to your DON!! deck)" = **return** N DON to the DON deck. The spec uses `donCost` (which **rests** N DON on the field — `costs.ts:31`) instead of `donCostReturnToDeck` (which returns — `costs2.ts:391`). Mechanically different: the player keeps N DON rested on the field instead of losing them, changing future-turn DON count and any rested-DON synergy.

Verified handler semantics + 3 hand-spot-checks (EB02-010, OP12-041, OP11-073 all print `DON!! −N` but spec `donCost`). **Concentrated by set** → batch-tagging error: **ST04 ×7** (Kaido starter ST04-001…010), **ST05 ×6, ST10 ×3, OP15 ×17**, plus EB/OP scatter.

```
EB02-010 EB03-031 EB03-034 EB04-033 EB04-036 EB04-040 OP05-119 OP11-062 OP11-073
OP12-041 OP12-061 OP12-069 OP13-064 OP13-069 OP14-060 OP14-061 OP14-069 OP14-078
OP15-060/061/063/064/066/067/072/074/075/076/077/078/118 ST03-001 ST04-001…006/010
ST05-001/004/006/010/011/016 ST10-001/003/013 ST26-005
```

### 3b. Life-to-hand modeled as `flipLife` — 6–7 cards 🟠
Printed "add 1 card from … your Life … to your hand" = move a life card **to hand** (`lifeToHand`); spec uses `flipLife` (flips it **face-up** in the life area — different zone outcome). Cards: `OP09-075, OP11-069, OP12-100, OP15-109, ST07-004, ST08-014, ST20-004`.

### 3c. Duration: "until the start of … next turn" modeled as `this_turn` — 3 cards 🟠
Should be `opp_next_turn` (confirmed by EB01-001 which maps the same phrase correctly). The buff expires a full turn too early. Cards: `OP02-120, OP04-006, OP06-006`.

### 3d. F-8A hand-verified residue (folded in) — ~4 cards
`ST22-001` (prints place-on-**TOP** of deck, spec `bottom_of_deck_from_hand`), `OP14-058` ([Main]/[Counter] sections share one `on_play` trigger — mode mixing), `ST28-004` (return-given-DON modeled as `donCost`). Source: `F8_ENGINE_CORRECTNESS_TRIAGE.md`.

### 3e. PARTIAL — printed clause missing from spec — 3 cards
- `EB03-055`, `ST27-005` — the printed **[On K.O.]** secondary ability is absent from the spec (only the first clause modeled).
- `P-092` — the `[Opponent's Turn] −3000` self-debuff is not represented as a magnitude.

---

## 4. Findings by audit dimension

| dimension | result |
|---|---|
| **1. Trigger/timing** | Trigger tags generally match (`on_play`/`activate_main`/`when_attacking`). One **mode-mixing** class proven (`OP14-058`); `[Counter]` events correctly use the engine's `on_play`-in-counter-window convention (not a bug). 2 cards drop a `[On K.O.]` clause (§3e). |
| **2. Cost** | **The weakest dimension.** 49 `DON!! −N` rest-vs-return + 6 life-to-hand + 1 return-given-DON = **56 proven cost mis-keys.** Optional-vs-mandatory cost is handled at runtime (F-8D optional-costed-clause offer). |
| **3. Optionality** | "up to"/"you may" decline is engineered (`pickLimit`+`mayChooseNone`+`effect_offer`, see F-9). **228 cards** carry a *soft* note ("you may" with no explicit `opt`/cost) — recorded in the CSV `notes`, **not** counted as WRONG (most are runtime-handled); a sampling pass is the way to confirm. |
| **4. Targeting** | Self/opp/any, leader/char/stage, cost/trait/color/rested filters, named exclusions (`nameExcludes`) and count min/max are richly modeled and matched the text in every spot-check. No systemic targeting mismatch surfaced. |
| **5. Effect action** | draw/KO/bounce/rest/power/cost-reduce/keyword/DON all matched; formula magnitudes (`per_count`/`read_state`) verified as a legitimate dynamic-power pattern, not a number error. |
| **6. Duration** | `this_turn` / `this_battle` / `opp_next_turn` / permanent all used; 3 proven `next-turn → this_turn` errors (§3c). |
| **7. Sequence/order** | "A then B" / "choose one" / "if you do" modeled via `sequence` + `choose_one` + binding refs; the F-8A-F1 cost-dup→`sequence` fix already corrected 91 multi-clause cards. |
| **8. Conditions** | `if leader is X` / `if N DON` / `if opp hand ≥ N` / `if rested` / trait/color conditions present and `and`/`or`/`not` compose them; no systemic condition mismatch found (but the 659 flagged cards are unverified here). |

---

## 5. Highest-impact fixes (data-only — no engine change)

All fixes are **data normalization** in `cards.json`; every required primitive already exists (per F-9). Per project rule: **read each card's printed text before editing — no blind mass-replace** (the cost-key transform must confirm each card prints "return", not "rest").

1. **`DON!! −N` → `donCostReturnToDeck` (49 cards).** Highest impact, tightly patterned by set (ST04/05/10, OP15). One reviewed transform pass clears the largest proven-WRONG class. Add a corpus invariant test: "no card whose text matches `DON!! −\d` carries `donCost`."
2. **Life-to-hand → `lifeToHand` (6–7 cards).**
3. **Duration → `opp_next_turn` (3 cards).**
4. **Add the missing `[On K.O.]` clauses (EB03-055, ST27-005) + P-092 debuff.**
5. **Reading pass over the 659 `NEEDS_HUMAN_REVIEW` (all `flagged`).** This is the real unknown — the linter cannot certify them. Recommend an agent fan-out (batched per-card text↔spec read) to convert flagged → EXACT/WRONG. This is where the next real coverage gain lives.
6. **Author the 19 UNSUPPORTED specs** (carried from F-9).

---

## 6. Limitations (so the numbers aren't over-trusted)

- `LIKELY_CORRECT` (1,443) = "passed deterministic checks + good provenance," **not** "proven exact." Subtle semantic errors the linter doesn't probe (wrong filter trait, off-by-one count, target side) can still hide here.
- `NEEDS_HUMAN_REVIEW` (659) is **unverified**, not "fine."
- The linter checks the 8 dimensions above; it does **not** simulate the card. A spec can pass every token check and still play wrong (that's F-8's correctness axis, separate).
- Soft "you may" (228) and any single-card PARTIAL should be confirmed by reading the card.

---

*Artifacts:* `F11_CARD_MAPPING_MATRIX.csv` (per-card: text, spec summary, status, mismatchType, severity, needsFix, notes, provenance, reviewedBy). Re-run: `node /tmp/f9/lint.mjs && node /tmp/f9/emit_f11.mjs`.
