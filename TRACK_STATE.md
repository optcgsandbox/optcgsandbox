# OPTCG Sim — Track State

**Single source of truth for project state. Read this FIRST in every new session.**

Last updated: 2026-06-02

---

## Standing rules (non-negotiable)

- **End goal: 100000000% correctness.** Every card plays per its printed effectText. Verified by independent agent cert.
- **No shortcuts. No assumptions. No skipping.**
- **Time is not important.** Quality over speed.
- **Two independent tracks** must both complete before the project is done.
- **No commit without:** explicit owner approval + tests green + audit/cert CLOSED.
- **Permission first** before any agent launch (per memory rule).

---

## Track 1 — Engine rebuild

**Goal:** clean-slate engine that handles every primitive correctly.

**Status: SHIPPED AND RUNNING THE LIVE SIM.** Cutover landed across commits `8cebcf4` → `b0152f9`. Site at `https://optcgsandbox.pages.dev` runs engine-v2.

- Plan docs:
  - `ENGINE_V2_DEFINITIVE_PLAN.md` (1555 lines, v1 base)
  - `ENGINE_V2_DEFINITIVE_PLAN_V2.md` (745 lines, v2 amendments — read with v1)
- Plan cert results (3-agent independent verification on commit `c4b5549`):
  - Cert 1 (bug-class coverage): CLOSED ✓ (40 V1-V5 bug classes + C41)
  - Cert 2 (primitive catalog): CLOSED ✓ (187 handlers verified against cards.json)
  - Cert 3 (architecture soundness): CLOSED ✓ (19 v1 gaps absorbed in v2)

**Phase progression (verified against codebase 2026-06-02):**
- [x] Phase 1: Architecture spec + state shape definition + module skeleton
- [x] Phase 2: Core engine infrastructure (state container, dispatcher, registry)
- [x] Phase 3: Register primitives — `actionHandlers`, `triggerEmitters` (22 emitters at `registry/handlers/triggers.ts:141`), reducers wired
- [x] Cutover: `src/store/game.ts` + all UI components reference `@shared/engine-v2/*`; 18/18 smoke tests pass; paced R/D/D pipeline restored (commit `9fca0e0` — PhaseScheduler clones state at top of every enter*)

**Known open V2 gaps (verified 2026-06-02):**
- **ContinuousManager NOT WIRED** — no `shared/engine-v2/continuous/` directory exists. **531 of 2489 cards (~21%)** have non-empty continuous clauses. "While X, gain Y" effects on these cards won't fold correctly
- **ReplacementManager status** — 67 of 2489 cards have non-empty replacement clauses; wired state in engine-v2 not yet verified this session
- 4 phase-trigger TODOs in PhaseScheduler (at_draw_phase, at_don_phase, at_main_phase, at_end_phase) were deleted — zero cards in corpus use those triggers, stubs not needed

**Closed (do not re-investigate):**
- ~~`add_to_opp_life_top` crash on 8 cards~~ — was a V1-harness-on-V1-engine failure; V2 has the handler at `registry/handlers/actions3.ts:937`
- ~~Phase pacing collapsed in V2~~ — fixed `9fca0e0` (clone at top of enterRefresh/Draw/Don/End)
- ~~End-turn chained R/D/D internally~~ — fixed `b0152f9` (yields at phase='refresh', host paces)
- ~~Mulligan_second activePlayer convention mismatch~~ — fixed `22b07f5`

---

## Track 2 — Per-card audit (continuing from card #101)

**Goal:** every one of 2489 cards in `shared/data/cards.json` audited per the same 5-axis protocol used for the 100-scope.

**Status: 100 of 2489 done against V1 engine. 2389 REMAINING.**

**Important caveat (2026-06-02):** the 100 audited cards were verified against V1's reducer paths. The app now runs engine-v2 (Track 1 cutover). Before extending the audit past #100, the 100-scope needs a V1↔V2 parity spot-check to confirm those cards still play correctly under V2. Otherwise the audit will keep extending against an outdated baseline.

- 100-scope completed (cards #1-100): EB01-001..EB01-061 + EB02-001..EB02-039
  - 96 root `human-reviewed` + 4 `ground-truth`
  - 0 clause-level `auto` remaining (fixed in commit `d4ed7bc`)
  - 0 root `flagged`
- **Next card: position #101 = `EB02-040`**
- Remaining range: EB02-040 → ST29-017
- Cards.json structure (per `python3 -c "..."` audit run 2026-06-01):
  - EB01: 61 (done), EB02: 61 (39 done, 22 remaining), EB03: 62, EB04: 61
  - OP01-OP15: ~120 cards each (1799 total)
  - P (promos): 95
  - PRB01: 1, PRB02: 18
  - ST01-ST29: ~17 each (~530 total)

### Per-card audit protocol (same as 100-scope)

For each card in sequence (no skipping):
1. Read card's `effectText` from cards.json
2. Read card's `effectSpecV2` (clauses + continuous + replacements)
3. Cross-check spec maps each printed line of effectText
4. Verify trigger choice matches printed mark ([On Play], [Activate: Main], etc.)
5. Verify condition matches printed conditional (e.g., "If your Leader has X")
6. Verify magnitudes match (draw N, KO ≤ cost X, +N power, etc.)
7. Verify target side matches text (your_character / opp_character / any_character)
8. Verify filter (trait, cost range, kind, base power, name exclusions)
9. Verify cost shape (donCost / donCostReturnToDeck / trashSelf / restSelf / discardHand / etc.)
10. Verify duration (this_turn, this_battle, opp_next_turn, opp_next_end_phase, permanent)
11. Verify OPT (`[Once Per Turn]` in text ⇒ `opt: true` on the right clause)
12. Verify replacement `whenSource` (`battle` vs `effect`)
13. If drift found: fix spec + flip verified flag accordingly
14. If clause-level `verified: "auto"` and spec passes audit: flip to `"human-reviewed"`
15. If unable to encode in current spec primitives: flag for engine v2 spec extension

### Cert protocol per batch

After each batch of cards (e.g., 25-50):
- 5-agent audit in parallel (same axes as 100-scope cert rounds):
  - Per-card text faithfulness
  - Engine action handler usage
  - Trigger coverage
  - Replacement / counter-window
  - Adversarial scenarios per card
- All 5 must return CLOSED
- Commit batch only when all CLOSED

### Tracking pointer

Update the line below after each batch landed:

> **Last audited card: EB02-039 (#100). Next to audit: EB02-040 (#101).**

---

## Key file pointers

- Plan docs: `ENGINE_V2_DEFINITIVE_PLAN.md`, `ENGINE_V2_DEFINITIVE_PLAN_V2.md`
- Audit history: `MASTER_PLAN_100_PCT.md` ... `_V5.md` (V1-V5 cert iteration; superseded by ENGINE_V2 plan)
- Cards data: `shared/data/cards.json` (2489 entries)
- Existing engine (to be replaced): `shared/engine/` (153 .ts files, ~5000 lines logic)
- Type schema: `shared/engine/effectSpec/types-v2.ts` (current — V2 will define its own)
- Worker / multiplayer: `worker/GameRoom.ts` (Cloudflare Durable Object)
- AI: `shared/engine/ai/HardAi.ts`, `MediumAi.ts`, `EasyAi.ts`

---

## Commit history (engine + audit milestones)

- `c4b5549 docs(engine-v2): verified rewrite plan + 5-round audit history`
- `d4ed7bc chore(specs): flip 6 auto clauses to human-reviewed in 100-scope`
- `a1bc66c audit-fix(round-3): close all 6 outstanding 100-scope drifts + harden engine paths`
- `14e68cc audit-fix(100-scope): peek-reorder observable + on_ko effect-path + replacement OPT + text drifts`
- `4091a3a 100-scope: close EB01-047 / EB02-023 / EB02-035`
- Prior commits: see `git log --oneline`

---

## What to do in the next session

- Re-read this file first.
- Owner picks: Track 1 next phase OR Track 2 next card batch.
- Execute that single unit. Then update the tracker pointer in this file. Commit.
- Loop until 100000000%.
