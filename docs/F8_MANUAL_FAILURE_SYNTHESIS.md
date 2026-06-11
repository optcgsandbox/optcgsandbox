# F-8 Step F — Manual Failure Synthesis

**Method:** Cross-reference the 10 recurring complaints to Steps A/B/C/E findings. Every complaint mapped to a generic root cause and the family-level fix that resolves it. No card-specific findings.

**Authoritative inputs:** `docs/F8_EFFECT_FAMILY_MATRIX.md`, `docs/F8_CORPUS_COMPATIBILITY.md`, `docs/F8_GAMEPLAY_FLOW_AUDIT.md`, `docs/F8_STATE_EXPLAINABILITY.md`.

## Per-complaint root cause table

| # | Complaint | Actual root cause | Severity | Generic fix | Dependency |
|---|---|---|---|---|---|
| 1 | "Nothing happened." | `searcher_peek` handler auto-resolves silently for human (`shared/engine-v2/registry/handlers/actions3.ts:844`). Effect ran; engine mutated state correctly; UI showed nothing. Same shape for action-clause "up to 1" targets — engine auto-picks (`actions.ts:154, 233, 76, 298, 346`). | CRITICAL | Pattern A — pending split + generic prompt for **searcher_peek** + **action-target-pick**. | none — foundational |
| 2 | "Card text didn't work." | Engine DID work. Player can't tell because `beatFor.ts` returns null for ~10 event types (DRAW, DON attach, REST_TARGET, POWER outside combat, life_to_hand effect, mill, hand→trash). State changed; no narrative beat. | CRITICAL | Pattern B — add 9 beat kinds. | none (independent of Pattern A) |
| 3 | "Why did my card go back to hand?" | `BOUNCED` beat (`beatFor.ts:123`) fires but doesn't always carry the SOURCE card name. Step C-18: bounce attribution missing for clause-driven bounces. Same shape as the KO attribution gap. | HIGH | Pattern B — beatFor.BOUNCED enrichment via `scanEffectResults` causal scan (the same utility exists for combat). | none |
| 4 | "Why is combat 0?" | `POWER_MODIFIED` outside combat has NO beat. The `powerModSourceName` field on COMBAT_RESULT (`beatFor.ts:42`) only populates when the modifier fired DURING combat. A pre-combat debuff (e.g. opp's on_play that −2000s a target) is silent — by combat time, power is just "0" with no source. | CRITICAL | Pattern B — add POWER_MODIFIED standalone beat for non-combat power changes. | none |
| 5 | "I couldn't choose anything." | Action clauses with "up to 1" targets don't open a pending state for the human (Step B Gap 1: ~638 clauses). Engine deterministic-picks the first eligible. Player never saw a target picker. | CRITICAL | Pattern A — `PendingTargetPick` (action-clause variant) + `TargetPickPrompt.tsx`. | none — foundational |
| 6 | "Game feels glitchy." | Cumulative effect of #1, #2, #4, #5. Each individually = "small confusion"; together = systemic "I don't trust this game" feeling. ~942 clause instances mutate state without a beat (Step C Q1). Tests pass because engine state IS correct. | CRITICAL | Resolves automatically when #1–#5 fix. | follows from #1, #2, #4, #5 |
| 7 | "Opponent did something and I don't know what." | Opp draw, opp trash, opp mill, opp DON-attach, opp searcher (partial — beat fires but identity may be redacted): all silent. Only opp-PLAY, opp-ATTACK, opp-ACTIVATE, opp-BOUNCE produce beats today. | HIGH | Pattern B — beat kinds for opp's actions ALSO fire (currently `beatFor` is viewer-agnostic for some kinds, but draw/trash/DON have no beat at all). Same fix as #2. | follows from #2 |
| 8 | "I don't know why attack failed." | (a) COMBAT_RESULT shows power math correctly when debuff happened during combat. (b) Pre-combat debuff silent (#4). (c) Blocker chosen but BLOCKED beat doesn't say "blocked by Y with N power" attribution. (d) Counter played but its contribution to attacker/target is visible via COMBAT_RESULT counter_boost (GREEN). | HIGH | (a) GREEN already. (b) resolved by #4. (c) Pattern B — BLOCKED beat enrichment. | follows from #4 |
| 9 | "Effect text shown but effect didn't happen." | TWO failure modes: (a) `reorder_bottom` / `peek_and_reorder_*` are V0 stubs (`actions3.ts:1129`) that only update `knownByViewer` — engine LITERALLY does nothing visible. 39 clauses affected. (b) `give_power` / `removal_ko` "up to 1" auto-resolves with no eligible target → silent NO_VALID_TARGET (beat exists, `beatFor.ts:214`) but easy to miss. | HIGH | Pattern A — complete reorder engine + Prompt for (a). Pattern B — enrich NO_VALID_TARGET beat to be more prominent (longer duration + clearer text) for (b). | foundational for (a) |
| 10 | "Gameplay feels confusing." | Same as #6 — cumulative. Specifically: legality reasons not surfaced (`rules/legality.ts` returns boolean legality, not WHY-illegal). Player taps illegal card / illegal target, sees nothing. No tooltip, no shake. | HIGH | Pattern C — Why-illegal toast. New UI hook listens on illegal-tap, queries legality engine for reason string. | foundational |

## Aggregated root causes (3 patterns, 10 complaints)

- **Pattern A — Generic Pending + Prompt** (resolves #1, #5, #9a)
  - PendingTargetPick (action-clause variant) → ~638 clauses
  - PendingSearcherPeek → 183 clauses
  - PendingReorder + engine completion → 39 clauses
  - Affects 3 of 10 complaints; covers ~860 clauses
- **Pattern B — beatFor enrichment / new beat kinds** (resolves #2, #3, #4, #7, #8, #9b)
  - 9 new beat kinds (DRAW, LIFE_TO_HAND, KO_FROM_EFFECT, DISCARD, MILL, REST_TARGET, UNREST_TARGET, POWER_MODIFIED, DON_ATTACHED, STAGE_REPLACED)
  - 3 beatFor enrichments (BOUNCED attribution, BLOCKED attribution, NO_VALID_TARGET prominence)
  - Affects 6 of 10 complaints; covers ~942 clause instances
- **Pattern C — Legality reason exposure** (resolves #10 partly)
  - 1 UI hook + engine-side reason strings returned from legality.ts
  - Affects 1 of 10 complaints

## Severity rollup

- **CRITICAL** (4): #1, #2, #4, #5, #6 (#6 follows from others)
- **HIGH** (5): #3, #7, #8, #9, #10
- **MEDIUM** (0): none in the 10 — owner's list was already pre-filtered to the biggest issues

## Order of attack (dependency-driven)

1. Pattern A — Action-clause Target Picker — unblocks #1 (partial), #5, #9
2. Pattern A — Searcher Peek UI — unblocks #1 (fully)
3. Pattern B — POWER_MODIFIED beat — unblocks #4, #8 (partial)
4. Pattern B — KO_FROM_EFFECT attribution — unblocks #2 (partial), #8 (fully)
5. Pattern B — DRAW + LIFE_TO_HAND + DISCARD + MILL + DON_ATTACHED beats — unblocks #2 (fully), #7
6. Pattern B — BOUNCED attribution — unblocks #3
7. Pattern B — REST_TARGET + UNREST_TARGET + STAGE_REPLACED beats — polish; unblocks edge of #2
8. Pattern A — Reorder UI + engine completion — unblocks #9a (heaviest single fix)
9. Pattern C — Why-illegal toast — unblocks #10

After step 5, the 4 CRITICAL complaints are resolved. After step 6, all HIGH-impact attribution gaps are filled. Steps 7-9 are polish.

## No card-specific findings

Every root cause above describes a FAMILY-LEVEL or BEAT-LEVEL or PROMPT-LEVEL gap. None of the 10 complaints requires `if (cardId === ...)`, `if (card.name === ...)`, or a per-card handler. Generic engine + generic UI + generic beat additions cover all 10.

## What this audit does NOT claim

- **Does not claim engine state is wrong.** Tests confirm state mutations are correct. The gap is at the narrative/presentation layer.
- **Does not claim the existing visual polish was wasted.** The 13 beat kinds + 9 prompts that exist work correctly. The fix is to extend, not rewrite.
- **Does not claim card data is broken.** The card corpus (`shared/data/cards.json`, 2,489 cards) is fine. The gap is in the action-resolution UX.
- **Does not propose any breaking engine change.** All Pattern A handlers split at `ctx.controller === A` — AI path is preserved exactly.
