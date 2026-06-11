# F-8A — Engine Correctness Triage

**Date:** 2026-06-11
**Mode:** READ + VERIFY ONLY. No fixes applied. No cards changed. No tests added to the repo.
**Method:** every claim re-verified against the current working tree with deterministic probes run through the live engine-v2 (`registerAllReducers()` + `registerAllHandlers()` + real reducers via `applyAction` / `EffectDispatcher.dispatch`). Probe scripts lived in `/tmp` (`/tmp/f8a_probe.mts`, `/tmp/optcg_audit_doublecost.mts`); their full source is reproduced in Appendix A so the repros are re-runnable.

**Status legend:** ✅ VERIFIED TRUE · ⚠️ PARTIAL · ❌ FALSE

| # | Finding | Verdict | Severity |
|---|---------|---------|----------|
| 1 | Per-clause cost duplication | ✅ TRUE | 🔴 HIGH — 105 cards |
| 2 | Attached DON +1000 on both turns | ✅ TRUE | 🔴 HIGH — systemic combat math |
| 3 | Double Attack / Banish missing | ✅ TRUE (V2 regression — V1 had both) | 🟠 MED-HIGH — 31 + 22 cards |
| 4 | Counter sweep incomplete (10 residuals) | ✅ TRUE (+1 extra data bug found) | 🟠 MEDIUM |
| 5 | Test suite health | ✅ TRUE on all four sub-claims | 🟡 process |

---

## Finding 1 — Per-clause cost duplication

**Verdict: ✅ VERIFIED TRUE.**
**STATUS: ✅ FIXED 2026-06-11 (F8A-F1, owner-approved) — 91 of 105 cards converted; 14 NEEDS_REVIEW skipped.** Each affected card's printed text was read individually; the 91 whose text prints ONE cost gating sequential effects were remodeled as one clause = shared cost + `sequence` action (sub-order, sub-targets, sub-conditions, opt, and conservative provenance preserved; clause-level dead `duration` key dropped — engine never reads it). The 14 skips, each needing its own modeling decision, are pinned as documented exceptions in `cost-duplication-invariant.test.ts`: cost-encoded-as-action double-dips (OP03-102, OP03-110, OP06-106, OP15-100, PRB02-016, ST13-001), no-cost-printed-but-cost-modeled (OP08-014, OP13-042), either-or/opponent-branch semantics (OP14-062, OP15-059), byte-identical duplicate clause (OP11-071), "if you do" binding gates (ST13-007/010/014). Regressions: `cost-sequence-f1.test.ts` — OP01-118 returns exactly 2 DON with +2000 and draw both landing; EB03-001 one rest pays for debuff AND Rush; OP07-118 one discard pays both KOs; OP07-109 self-trash pays KO AND draw. Wrong-cost-KEY fidelity notes surfaced during review (separate from F1, for Track 2): ST04-003/ST05-011/ST10-001 print DON!!−N (return) but spec uses `donCost` (rest); ST07-004/OP15-109 print life-to-hand but spec uses `flipLife`; ST28-004 prints return-given-DON but spec uses `donCost`; OP02-120 prints "until start of your next turn" but action says `this_turn`; ST22-001 prints place-on-TOP-of-deck but action is `bottom_of_deck_from_hand`; OP14-058 [Main]/[Counter] sections share the `on_play` trigger (mode mixing). Zero new suite failures (16-red baseline unchanged; determinism test re-verified green in isolation — byte-identical with the new data).

### Mechanism
`EffectDispatcher.dispatch` walks each clause independently and runs `cost.canPay` / `cost.pay` per clause (`shared/engine-v2/effects/EffectDispatcher.ts:202-244`). There is no cross-clause cost dedup. Cards whose printed text is "pay cost: do A. **Then**, do B" but whose spec is *two clauses each carrying the cost* therefore misbehave in one of two modes:

- **DOUBLE_CHARGE** (repayable costs — `discardHand`, `donCost`, `donCostReturnToDeck`, `flipLife`, `lifeToHand`, `bottomOfDeckFromTrash`, …): the cost is paid once per clause.
- **SILENT_SKIP** (non-repayable costs — `restSelf`, `trashSelf`, `returnSelfChar`): clause 1 pays and consumes the resource; clause 2's `canPay` fails (e.g. `restSelf.canPay` requires `rested === false`, `shared/engine-v2/registry/handlers/costs2.ts:21-23`) → the second printed effect **silently never happens**. No history event, no error.

### Deterministic repro (probe output, live engine)
```
F1a OP01-118 (printed: DON!!−2): DON returned = 4            ← printed cost is 2
F1b EB03-001 (printed: rest leader → −2000 THEN keyword):
    fired=["power_buff"]  give_keyword MISSING, leader rested=true
```
- OP01-118 Ulti-Mortar — `[Counter] DON!!−2: +2000, then draw 1` → spec has `{donCostReturnToDeck: 2}` on BOTH the power_buff clause and the draw clause → 4 DON returned. (It additionally hits Finding 4 — see below.)
- EB03-001 Nefeltari Vivi — `rest this Leader: −2000 ... Then, [keyword clause]` → both clauses carry `{restSelf: true}`; the −2000 fires, the second clause is silently dropped.

### Affected scope (scan of `shared/data/cards.json`, current working tree)
- **105 unique cards** have ≥2 clauses sharing the same trigger AND a byte-identical cost object.
- **107 duplicate-cost clause groups** total: **86 DOUBLE_CHARGE / 21 SILENT_SKIP**. No card is in both modes.
- Scan rule: group clauses by `(trigger, JSON(cost))`; flag groups with >1 member. (Re-runnable one-liner in Appendix B.)
- Caveat: a card whose printed text *genuinely* charges the same cost twice would be a false positive — none observed in the samples read (EB03-001, EB03-052, OP01-118, OP02-120, OP12-119, EB04-059 all print one cost), but the transform pass must read each card's text (provenance discipline, no blind mass-edit).

### Risk
- Real games: players over-pay resources on 86 card-groups; lose printed effects entirely on 21. Outcome-changing in normal play, not edge-case.

### Proposed generic fix — **data normalization, no engine change**
- The engine already has the correct primitive: the **`sequence` action** (registered at `shared/engine-v2/registry/handlers/actions2.ts:533`, per-sub-action conditions supported since commit `9314438`, already used by 15 clauses, e.g. EB01-013).
- Transform: for each duplicate-cost group → ONE clause: `{trigger, cost, action: {kind:'sequence', actions:[A, B, ...]}}`, preserving each sub-action's own target/condition/duration.
- Rejected alternative: engine-side "pay identical costs once per dispatch" — hides data intent, would mis-handle any future card that legitimately charges twice, and changes dispatcher semantics for all 3127 clauses. The data is wrong, not the dispatcher.

### Files likely touched (when approved)
- `shared/data/cards.json` (105 cards — scripted transform + per-card text read + provenance re-mark)
- New invariant test (see Tests) — nothing in `shared/engine-v2/` source.

### Tests needed
- Data invariant test (sibling of `__tests__/registry-coverage.test.ts`): assert the duplicate-cost scan returns 0 groups.
- Per-card semantic tests for the repro pair (OP01-118: exactly 2 DON returned + both effects; EB03-001: one rest → both effects) in `shared/engine-v2/__tests__/cards/`.
- Spot tests for one SILENT_SKIP (`trashSelf` — EB03-052) and one multi-target sequence (EB04-059 two KOs off one flip).

---

## Finding 2 — Attached DON applies on both turns

**Verdict: ✅ VERIFIED TRUE.**
**STATUS: ✅ FIXED 2026-06-11 (F8A-F2, owner-approved).** DON term in `effectivePower` now gated on `state.activePlayer === inst.controller` (`shared/engine-v2/state/derived/power.ts`); stale "C41 / CR §4-5-1" comment corrected to CR §6-5-5-2. Tests: `shared/engine-v2/__tests__/power-don-turn-gate.test.ts` (5 cases, all green). Probe re-run: targetPower 6000→5000, defender now loses the life. Zero new failures in `shared/` suite (16 remaining reds are the pre-classified F5 set). Known out-of-scope leftover: `EasyAi.ts:77-83` duplicates unconditional DON math for its *attack heuristics* (AI estimation only, not rules math) — flag for F5/cleanup pass.

### Mechanism
`effectivePower` (`shared/engine-v2/state/derived/power.ts:40-48`) adds `(attachedDon + attachedDonRested) × 1000` **unconditionally** — it never reads `state.activePlayer` vs `inst.controller`. The code comment claims "C41: unconditional per CR §4-5-1", but §4-5 is the **Draw** rule per this repo's own rules doc (`docs/optcg-sim/rules-reference.md:156`). The correct rule:
- `docs/optcg-sim/rules-reference.md:223` — "Leader/Char gains +1000 power **during your turn** per attached DON [CR §6-5-5-2]"
- crew-builder `docs/optcg-sim/rules-reference.md:76` — "+1000 power per DON **during your turn only** [rule_comprehensive.pdf 6-5-5-2]"

DON stays physically attached through the opponent's turn (detach happens at the owner's next Refresh, `shared/engine-v2/phases/PhaseScheduler.ts:103-106`), so the wrong bonus is live for the entire opponent turn.

### Deterministic repro (full reducer pipeline: DECLARE_ATTACK → SKIP_BLOCKER → SKIP_COUNTER)
```
F2 5000 attacker vs 5000 defender leader holding 1 attached DON (opponent's turn):
   attackerPower=5000 targetPower=6000; B life 2→2
```
Correct per CR §6-5-5-2: target should be 5000 → attack succeeds (tie goes to attacker, `attackFlow.ts:462`) → B loses 1 life. Engine: defender wrongly survives.

### Affected scope
- Every battle in every game where the defending side has DON attached to the attacked leader/character — systemic, not card-specific. Also contaminates every power-filter read (`powerMax`/`powerMin` target filters route through the same helper) during the opponent's turn.

### Risk
- Highest gameplay-correctness impact of all findings: defenders survive attacks they should lose, in the most common board state of the game (leader loaded with DON).

### Proposed smallest fix
- In `effectivePower`, gate the DON term: `(state.activePlayer === inst.controller ? donCount * 1000 : 0)`.
- This is the single source of truth (enforced by ESLint `no-redefine-canonical-helper` per the file header), so one edit covers combat, legality, filters, and display (`effectivePowerForDisplay` wraps it).
- Pre-fix check: grep AI evaluation + view code for any consumer that *wants* the unconditional value (none expected — header says no duplicates exist).
- The stale "C41 / CR §4-5-1" comment must be corrected to CR §6-5-5-2 in the same change.

### Files likely touched
- `shared/engine-v2/state/derived/power.ts` (one expression + comment)

### Tests needed
- Defender with attached DON during opponent's attack → no +1000 (the F2 repro as a vitest case).
- Attacker with attached DON on own turn → +1000 still applies (existing behavior guard).
- A `[DON!!xX]` condition card (e.g. EB01-001) still fires — `if_attached_don_min` counts cards, not power, so it must be unaffected.

---

## Finding 3 — Double Attack / Banish missing in V2

**Verdict: ✅ VERIFIED TRUE — and it is a V2-cutover REGRESSION, not a never-built feature.**
**STATUS: ✅ FIXED 2026-06-11 (F8A-F3, owner-approved).** Engine-only, no card data touched. Design: leader damage now runs through `continueLeaderDamage(state, defender, flips, banish)` (attackFlow.ts) — flips = 2 when `instHasKeyword(attacker,'double_attack')` (granted keywords count, unlike V1 which only read printed); banish=true sends each life card to trash with a `LIFE_CARD_BANISHED` history event and never opens a trigger window (CR §10-1-3, rules-reference.md:341, V1 D7 parity); non-banish flips suspend on a [Trigger] life card with `PendingTrigger.remainingLifeFlips` (new field, types.ts), and `RESOLVE_TRIGGER` (choiceResolve.ts — needed beyond the original allowed list, flagged and approved in relay-back) continues the remaining flips after activate/decline, re-suspending if flip 2 also reveals a Trigger; lethal mid-procedure stops immediately (`life_zero`). Tests: `keyword-damage-f3.test.ts` — 10 cases covering all 7 required behaviors through the real DECLARE_ATTACK→SKIP_BLOCKER→SKIP_COUNTER(→RESOLVE_TRIGGER) pipeline. Zero new suite failures.

### Mechanism
`resolveDamage` (`shared/engine-v2/reducers/attackFlow.ts:437-509`) always runs the leader-damage procedure exactly once (`flipTopLifeToHand`, line 471) and always routes the life card to hand. No code in `shared/engine-v2/` reads `double_attack` or `banish` outside the type union (`cards/Card.ts:34-35`).

**V1 implemented both** — this is the reference implementation for the fix:
- Double Attack: `shared/engine/applyAction.ts:648` — `lifeFlipsOwed = attackerCard.keywords.includes('double_attack') ? 2 : 1`.
- Banish: D7 (2026-05-29, `docs/optcg-sim/rules-reference.md:471`) — `flipLifeCards(attackerHasBanish)` → life card to trash AND trigger window skipped; worked with Double Attack; had test coverage in `shared/engine/__tests__/trigger.test.ts`.

Rules doc grounding: `docs/optcg-sim/rules-reference.md:340-341` — Double Attack "life-add procedure runs 2×" [CR §10-1-2]; Banish "trashes the life card without revealing; Trigger does NOT fire" [CR §10-1-3].

### Coverage (scan of current cards.json)
- `double_attack`: **31 cards** carry the printed keyword; **12 more clauses** grant it via `give_keyword` (e.g. EB02-018 — whose V2 test only asserts the *grant*, never the 2-damage behavior).
- `banish`: 0 cards in `keywords[]`, but **22 cards** print Banish and **all 22** model it in spec as continuous `grant_keyword_to_self: 'banish'` (e.g. OP01-067). Data is ready; the engine never consumes it.

### Deterministic repro
```
F3 double_attack 7000 vs leader 5000: B life 3→2     ← should be 3→1
```

### Risk
- 31+22 cards deal wrong damage / wrong zone. Banish additionally lets Triggers fire that the rules forbid. Loud, user-visible in any meta deck running these staples (OP01-121 carries both keywords).

### Proposed generic fix (keyword implementation plan — generic, no per-card code)
1. In `resolveDamage`'s leader branch: `const flips = instHasKeyword(state, attackerInst, 'double_attack') ? 2 : 1` — **use `instHasKeyword` (`state/derived/keyword.ts:22`), not printed `card.keywords`**, so the 12 `give_keyword` grants and 22 `grant_keyword_to_self` continuous grants are honored (V1 only read printed keywords — don't copy that limitation).
2. Loop the flip procedure `flips` times, re-checking `state.result` after each flip (lethal on flip 1 ends the loop) — per CR the procedure *repeats*, it is not "flip 2 at once".
3. Banish branch per flip: if `instHasKeyword(attacker, 'banish')` → life card to trash, skip trigger-window suspension entirely (no `pendingTrigger`), mirroring V1 D7 semantics.
4. Open design point for the loop + triggers: a non-banish Double Attack flip can suspend on a trigger window mid-procedure → `pendingAttack` needs a `lifeFlipsRemaining` counter so `RESOLVE_TRIGGER` resumes the second flip. This is the only non-trivial part; everything else is local to `resolveDamage`.

### Files likely touched
- `shared/engine-v2/reducers/attackFlow.ts` (resolveDamage leader branch)
- `shared/engine-v2/state/types.ts` (PendingAttack: `lifeFlipsRemaining?`)
- `shared/engine-v2/reducers/choiceResolve.ts` (trigger resume drains remaining flips)

### Tests needed
- Double Attack vs 3-life leader → 2 life lost; vs 1-life leader → game ends after first flip.
- Granted (not printed) double_attack via EB02-018 → 2 life lost.
- Banish → life to trash, no trigger window even when the life card has a `trigger` clause.
- Double Attack + Banish together (OP01-121) → 2 cards trashed, 0 triggers.
- Trigger mid-Double-Attack: flip 1 suspends on trigger, resolve, flip 2 still happens.

---

## Finding 4 — Counter-event sweep incomplete (10 residual double-applies)

**Verdict: ✅ VERIFIED TRUE in the current working tree — plus one extra data bug found during repro.**
**STATUS: ✅ FIXED 2026-06-11 (F8A-F4, owner-approved).** All 10 cards individually verified against printed text and corrected in `cards.json` (classification table in the F8A-F4 report): 7 cost-gated boosts zeroed (playability preserved via `isCounterEventPlayable` Path B); OP06-038/OP12-098 boosts de-summed to printed base (4000→2000) with uncond dup clauses removed; OP12-018 rider rebuilt as ONE `donCost:1` + `sequence` clause (was: two cost-free clauses); 3 wrong cost/target keys fixed (OP07-056 `returnSelfChar`→`returnOwnCharFilter` — old clause was dead; ST04-016 `donCost`→`donCostReturnToDeck`; OP14-036 target `your_character`→`your_leader_or_character`). New tests: `counter-boost-invariant.test.ts` (corpus-wide, 0 violations) + `counter-event-f4.test.ts` (5 full-counter-window regressions). Zero new suite failures. **Open D-items:** OP06-038's conditional "+2000 if 8+ rested cards" tier NOT modeled (no rested-cards-total condition handler — engine work, out of F4 scope); OP14-036 `restSelf` cost is a free no-op on an event (no rest-any-own-card cost handler); OP12-098 "that card" binding still V0-defender-collapsed; e2e audit harnesses `family-counter-event-double-count-audit.spec.ts:87` + `stage-c-generated-counter-events.spec.ts:120` pin OP01-118's OLD boost=2000 and need updating when Playwright next runs.

### Context
Counter events apply `counterEventBoost` directly onto `pendingAttack.counterBoost` (`attackFlow.ts:364-365`) AND fire their `on_play` clauses (`attackFlow.ts:398`). The uncommitted sweep (77 cards) removed duplicate unconditional `power_buff` clauses — correct direction — but left 10 cards with `counterEventBoost > 0` AND a retained unconditional defensive `power_buff` clause:

| Card | boost | clause magnitude | clause cost | clause provenance |
|------|-------|-----------------|-------------|-------------------|
| OP01-118 | 2000 | 2000 | donCostReturnToDeck: 2 | human-reviewed ×2 |
| OP02-068 | 3000 | 3000 | discardHand: 1 | auto |
| OP04-016 | 3000 | 3000 | discardHand: 1 | auto |
| OP04-074 | 1000 | 1000 | donCostReturnToDeck: 1 | human-reviewed ×2 |
| OP06-038 | 4000 | 2000 | — | flagged |
| OP07-056 | 4000 | 4000 | returnSelfChar | auto |
| OP12-018 | 2000 | 2000 | — | human-reviewed ×3 |
| OP12-098 | 4000 | 2000 | — | human-reviewed ×2 |
| OP14-036 | 4000 | 4000 | restSelf | human-reviewed |
| ST04-016 | 4000 | 4000 | donCost: 1 | flagged |

Two distinct wrongness shapes:
- **No-cost residuals** (OP06-038, OP12-018, OP12-098): plain double-apply, same class the sweep fixed elsewhere.
- **Cost-gated boosts** (the other 7): the printed boost requires paying the clause cost — but `attackFlow.ts:364` applies `counterEventBoost` **free and unconditionally** on play, and then the costed clause applies it AGAIN if paid. These should have `counterEventBoost = 0` with the boost living only in the costed clause (playability is preserved via `isCounterEventPlayable` Path B — `rules/legality.ts:281-295` — for `counter_event`-tagged cards with a defensive power_buff clause).

### Deterministic repro (counter window via real PLAY_COUNTER reducer)
```
F4 OP12-018 played as counter:
   pendingAttack.counterBoost=2000 (→ defending leader)
   + char powerModifierThisBattle=2000
```
Printed: ONE +2000 to one of your Characters. Engine applies it twice, to two different instances.

### 🆕 Extra data bug found during this repro (OP12-018, marked human-reviewed)
Printed: "Then, **you may rest 1 of your DON!!. If you do**, give opp Leader and all their Characters −1000." The spec's two −1000 clauses (`all_opp_characters`, `opp_leader`) carry **no cost and no condition** → the rider fires for free. Separate from the double-apply; logged here for the fix pass.

### Risk
- 10 cards with inflated counter math (up to +4000 phantom power and/or free riders) — directly decides battles. Also: 5 of the 10 are `human-reviewed`, so the sweep's normalization rule was not applied consistently even to reviewed cards.

### Proposed generic data normalization rule (no mass-edit until owner approves)
For every card with `effectTags` containing `counter_event`:
1. Unconditional printed base boost → `counterEventBoost = N`; NO unconditional defensive `power_buff` on_play clause may coexist.
2. Cost-gated printed boost → `counterEventBoost = 0` (or null); boost lives ONLY in the costed clause.
3. Conditional "additional +N" riders stay as conditional clauses (V0 caveat: their target resolver may not bind to the same instance `counterBoost` hit — known V0 target-choice limitation, already logged in BUGS_FOUND.md).
4. Enforce with a data-invariant test: the scan "boost>0 AND unconditional defensive on_play power_buff" must return 0 rows (scan in Appendix B; returns exactly the 10 above today).
- Each of the 10 gets an individual read of printed text before editing (5 are human-reviewed; auto/flagged ones get full review). **No bulk flip of provenance labels.**

### Files likely touched
- `shared/data/cards.json` (10 cards, individually reviewed)
- New data-invariant test file under `shared/engine-v2/__tests__/`

### Tests needed
- Invariant test above.
- Per-card: OP01-118 full counter-window play → exactly +2000 once, 2 DON returned once, 1 draw (this card sits at the intersection of Findings 1 and 4 — fixing it validates both).

---

## Finding 5 — Test suite health

**Verdict: ✅ VERIFIED TRUE on all four sub-claims.** Full run: `Test Files 92 failed | 288 passed | 1 skipped — Tests 18 failed | 1816 passed | 2 skipped`.
**STATUS: ✅ FIXED 2026-06-11 (F8A-F5, owner-approved).** The commit gate is now **fully green**: `npm test` → 1115 passed / 0 failed / 2 skipped. Changes: (1) `vitest.config.ts` created — scopes vitest to `shared/engine-v2` + `shared/server` + `shared/simulation` + `shared/sim` + `src`, excludes Playwright `e2e/**` (those run only via `npm run test:e2e`), `testTimeout: 30s` for the legitimately-slow determinism tests (assertions untouched); (2) V1 dead-engine suite excluded from the gate, NOT deleted — runnable via new `npm run test:v1-legacy` (`vitest.v1legacy.config.ts`, header documents the 13 known reds as the Phase 4 port-to-V2 queue; engine-v2 is the source of truth); (3) EB01-019 V2 per-card test updated to post-F4 modeling (ONE searcher_peek clause; the +4000 asserted behaviorally through the counter window via `counterEventBoost` — exactly once). **Gate commands:** `npm test` (engine/unit, expect green — commit gate) · `npm run test:v1-legacy` (legacy V1, expect 13 reds = port queue) · `npm run test:e2e` (Playwright, needs built app/browsers) · `npm run build` (tsc + vite — currently RED from 2 pre-existing committed errors in `src/dev/DevGameSandbox.tsx`, unmodified since commit `b592799`, unrelated to F8A; needs its own fix approval).

### Classification of the 92 failing files / 18 failing tests
| Class | Count | Cause | Real bug? |
|---|---|---|---|
| Playwright specs swept by vitest | ~73 files (`e2e/**/*.spec.ts`) | No `vitest.config.ts` exists and `vite.config.ts` has no `test` block → vitest's default include `**/*.{test,spec}.*` collects Playwright files, which throw at import | ❌ infra noise |
| Determinism tests | 2 | Pass in isolation (9.4 s) with `--testTimeout=120000`; fail only against the 5 s default under full-suite load | ❌ config |
| V1 legacy card tests | 16 tests / 6 files (EB01-001/-020/-021/-028/-053, EB02-039) | Dead-engine drift: specs evolved for V2 (e.g. filter key `minCost` — V1's `matchesFilter` at `shared/engine/effectSpec/runner-v2.ts:358+` only reads `costMin`; engine-v2 handles the alias at `registry/handlers/filter.ts:82-84`). V1 no longer powers the sim post-cutover | ❌ for the live sim; ⚠️ suite hygiene |
| EB01-019 (V1 + V2 files) | 7 tests | Stale vs the uncommitted counter sweep — the V2 per-card semantic test still asserts the removed two-clause shape | ⚠️ must be updated WITH the sweep commit |

### Recommended gate before any commit (owner to approve)
1. Add `vitest.config.ts`: include `shared/**` + `src/**` tests, exclude `e2e/**` (Playwright runs via `playwright.config.ts` / `npm run test:e2e`), `testTimeout: 30000`.
2. Rule: `npx vitest run` fully green is the commit gate (matches the TRACK_STATE standing rule, which the current working tree violates).
3. V1 suite (`shared/engine/__tests__/`) — owner decision, two options, **no deletion** (NO-SHORTCUTS rule):
   - (a) Port-then-retire per the Phase 4 plan already in TRACK_STATE (each V1 per-card test becomes a V2 semantic test, validating parity), or
   - (b) explicitly exclude `shared/engine/__tests__` from the default vitest run with a tracked TODO, keeping them runnable on demand.
4. The EB01-019 V2 test update is part of the counter-sweep changeset, not a separate fix.

---

## Suggested priority order (for owner approval — nothing started)
1. **F2** (one-line fix, biggest blast radius, trivially testable)
2. **F4** (10 cards, unblocks committing the in-flight sweep with green tests)
3. **F1** (largest data transform; script + per-card review; sequence pattern proven)
4. **F3** (engine feature work with a V1 reference implementation; needs the pendingAttack counter design)
5. **F5** (config + gate; cheap, could also land first since it's zero-risk)

---

## Appendix A — probe scripts (verbatim, re-runnable)

`npx tsx /tmp/f8a_probe.mts` from the repo root:

```ts
/* F-8A triage probe — deterministic repros, read-only against live engine-v2. */
import { readFileSync } from 'node:fs';

const ROOT = '/Users/minamakar/Developer/optcgsandbox';
const { registerAllHandlers } = await import(`${ROOT}/shared/engine-v2/registry/handlers/index.js`);
const { registerAllReducers } = await import(`${ROOT}/shared/engine-v2/reducers/index.js`);
const { EffectDispatcher } = await import(`${ROOT}/shared/engine-v2/effects/EffectDispatcher.js`);
const { applyAction } = await import(`${ROOT}/shared/engine-v2/reducers/applyAction.js`);
const fixtures = await import(`${ROOT}/shared/engine-v2/__tests__/cards/_fixtures.js`);

registerAllReducers();
registerAllHandlers();

const cards = JSON.parse(readFileSync(`${ROOT}/shared/data/cards.json`, 'utf8'));
const byId: Record<string, any> = {};
for (const c of cards) byId[c.id] = c;

const mkLeader = (id: string, power = 5000): any => ({
  id, name: id, kind: 'leader', colors: ['red'], cost: null, power,
  counterValue: null, traits: [], keywords: [], effectTags: [], life: 5,
});
const mkChar = (id: string, power: number, cost = 3, keywords: string[] = []): any => ({
  id, name: id, kind: 'character', colors: ['red'], cost, power,
  counterValue: 1000, traits: [], keywords, effectTags: [],
});

// ════ F1a — OP01-118 cost double-pay (repayable cost) ════
{
  const built = (fixtures as any).buildState({ leaderA: mkLeader('__L1'), donInCostA: 10 });
  const s = built.state;
  s.cardLibrary['OP01-118'] = byId['OP01-118'];
  const ev = (fixtures as any).makeInst('OP01-118', 'A');
  s.instances[ev.instanceId] = ev;
  const before = s.players.A.donCostArea.length;
  const next = EffectDispatcher.dispatch(s, { sourceInstanceId: ev.instanceId, controller: 'A' }, 'on_play');
  console.log(`F1a OP01-118 (printed: DON!!−2): DON returned = ${before - next.players.A.donCostArea.length}  [expect 2; bug if 4]`);
}

// ════ F1b — EB03-001 Vivi (non-repayable restSelf → clause 2 lost) ════
{
  const built = (fixtures as any).buildState({
    leaderA: { ...byId['EB03-001'], life: 4 },
    charsB: [mkChar('__OPP1', 5000)],
  });
  const s = built.state;
  const next = EffectDispatcher.dispatch(s, { sourceInstanceId: built.leaderInstA.instanceId, controller: 'A' }, 'activate_main');
  const fired = (next.history as any[]).filter((h) => h.type === 'CLAUSE_FIRED').map((h) => h.actionKind);
  console.log(`F1b EB03-001 (printed: rest leader → −2000 THEN keyword): fired=${JSON.stringify(fired)}  [expect both; bug if give_keyword missing], leader rested=${next.players.A.leader.rested}`);
}

// ════ F2 — attached DON counted for DEFENDER on opponent's turn ════
{
  const built = (fixtures as any).buildState({ leaderA: mkLeader('__ATK', 5000), leaderB: mkLeader('__DEF', 5000) });
  const s = built.state;
  s.activePlayer = 'A';
  built.leaderInstB.attachedDon.push('don-synth-1');
  s.cardLibrary['__VAN'] = (fixtures as any).VANILLA_FILLER ?? mkChar('__VAN', 3000);
  for (let i = 0; i < 2; i++) {
    const li = (fixtures as any).makeInst('__VAN', 'B');
    s.instances[li.instanceId] = li;
    s.players.B.life.push(li.instanceId);
  }
  const lifeBefore = s.players.B.life.length;
  let st = applyAction(s, 'A', { type: 'DECLARE_ATTACK', attackerInstanceId: built.leaderInstA.instanceId, targetInstanceId: built.leaderInstB.instanceId }, { checkInvariants: false }).state;
  st = applyAction(st, 'B', { type: 'SKIP_BLOCKER' }, { checkInvariants: false }).state;
  st = applyAction(st, 'B', { type: 'SKIP_COUNTER' }, { checkInvariants: false }).state;
  const dmg = (st.history as any[]).filter((h) => h.type === 'DAMAGE_RESOLVED').pop();
  console.log(`F2 5000 attacker vs 5000 defender leader holding 1 attached DON (opponent's turn): attackerPower=${dmg?.attackerPower} targetPower=${dmg?.targetPower}; B life ${lifeBefore}→${st.players.B.life.length}  [CR §6-5-5-2: DON bonus is owner's-turn-only → target should be 5000 and lose 1 life; bug if 6000 / no damage]`);
}

// ════ F3 — double_attack: leader hit should flip 2 life ════
{
  const built = (fixtures as any).buildState({
    leaderA: mkLeader('__ATK2', 5000),
    leaderB: mkLeader('__DEF2', 5000),
    charsA: [mkChar('__DA', 7000, 5, ['double_attack'])],
  });
  const s = built.state;
  s.activePlayer = 'A';
  const atk = built.fieldA[0];
  atk.summoningSick = false;
  s.cardLibrary['__VAN2'] = mkChar('__VAN2', 3000);
  for (let i = 0; i < 3; i++) {
    const li = (fixtures as any).makeInst('__VAN2', 'B');
    s.instances[li.instanceId] = li;
    s.players.B.life.push(li.instanceId);
  }
  const lifeBefore = s.players.B.life.length;
  let st = applyAction(s, 'A', { type: 'DECLARE_ATTACK', attackerInstanceId: atk.instanceId, targetInstanceId: built.leaderInstB.instanceId }, { checkInvariants: false }).state;
  st = applyAction(st, 'B', { type: 'SKIP_BLOCKER' }, { checkInvariants: false }).state;
  st = applyAction(st, 'B', { type: 'SKIP_COUNTER' }, { checkInvariants: false }).state;
  console.log(`F3 double_attack 7000 vs leader 5000: B life ${lifeBefore}→${st.players.B.life.length}  [CR §7-1-4-1-1-3: should lose 2; bug if 1]`);
}

// ════ F4 — OP12-018 residual counter double-apply ════
{
  console.log(`F4 OP12-018 text: ${byId['OP12-018'].effectText}`);
  console.log(`F4 OP12-018 boost=${byId['OP12-018'].counterEventBoost} clauses=${JSON.stringify(byId['OP12-018'].effectSpecV2.clauses.map((c: any) => [c.trigger, c.action.kind, c.action.magnitude, c.target?.kind, c.condition?.type ?? null]))}`);
  const built = (fixtures as any).buildState({
    leaderA: mkLeader('__ATK3', 5000),
    leaderB: mkLeader('__DEF3', 5000),
    charsB: [mkChar('__BCHAR', 4000)],
    donInCostB: 10,
  });
  const s = built.state;
  s.activePlayer = 'A';
  s.cardLibrary['OP12-018'] = byId['OP12-018'];
  const ce = (fixtures as any).makeInst('OP12-018', 'B');
  s.instances[ce.instanceId] = ce;
  s.players.B.hand.push(ce.instanceId);
  s.cardLibrary['__VAN3'] = mkChar('__VAN3', 3000);
  const li = (fixtures as any).makeInst('__VAN3', 'B');
  s.instances[li.instanceId] = li;
  s.players.B.life.push(li.instanceId);
  let st = applyAction(s, 'A', { type: 'DECLARE_ATTACK', attackerInstanceId: built.leaderInstA.instanceId, targetInstanceId: built.leaderInstB.instanceId }, { checkInvariants: false }).state;
  st = applyAction(st, 'B', { type: 'SKIP_BLOCKER' }, { checkInvariants: false }).state;
  st = applyAction(st, 'B', { type: 'PLAY_COUNTER', instanceId: ce.instanceId }, { checkInvariants: false }).state;
  const pa = st.pending?.kind === 'attack' ? (st.pending as any).pendingAttack : null;
  const bchar = st.players.B.field[0];
  const charMods = JSON.stringify({ oneShot: bchar?.powerModifierOneShot, battle: bchar?.powerModifierThisBattle });
  console.log(`F4 OP12-018 played as counter: pendingAttack.counterBoost=${pa?.counterBoost} (applies to DEFENDING LEADER) + char power mods=${charMods}  [printed: ONE +2000 to one of your characters; bug if both applied]`);
}
```

Observed output (2026-06-11, current working tree):
```
F1a OP01-118 (printed: DON!!−2): DON returned = 4  [expect 2; bug if 4]
F1b EB03-001 (printed: rest leader → −2000 THEN keyword): fired=["power_buff"]  [expect both; bug if give_keyword missing], leader rested=true
F2 5000 attacker vs 5000 defender leader holding 1 attached DON (opponent's turn): attackerPower=5000 targetPower=6000; B life 2→2
F3 double_attack 7000 vs leader 5000: B life 3→2  [should lose 2]
F4 OP12-018 played as counter: pendingAttack.counterBoost=2000 + char power mods={"battle":2000}
```

## Appendix B — data scans (python3, repo root)

Duplicate-cost groups (Finding 1):
```python
import json
wt = json.load(open('shared/data/cards.json'))
NONREPAY = {'restSelf', 'trashSelf', 'returnSelfChar'}
dup = []
for c in wt:
    groups = {}
    for x in (c.get('effectSpecV2') or {}).get('clauses', []):
        if x.get('cost'):
            key = (x.get('trigger'), json.dumps(x['cost'], sort_keys=True))
            groups.setdefault(key, []).append(x)
    for (trig, cost), cls in groups.items():
        if len(cls) > 1:
            kinds = set(json.loads(cost).keys()) - {'bind'}
            dup.append((c['id'], 'SILENT_SKIP' if kinds & NONREPAY else 'DOUBLE_CHARGE'))
# → 105 unique cards; 86 DOUBLE_CHARGE / 21 SILENT_SKIP groups
```

Residual counter double-applies (Finding 4):
```python
import json
wt = {c['id']: c for c in json.load(open('shared/data/cards.json'))}
for k, c in wt.items():
    boost = c.get('counterEventBoost') or 0
    if boost <= 0: continue
    for cl in (c.get('effectSpecV2') or {}).get('clauses', []):
        if cl.get('trigger') == 'on_play' and cl['action'].get('kind') == 'power_buff' \
           and not cl.get('condition') \
           and (cl.get('target') or {}).get('kind') in ('your_leader', 'your_character', 'your_leader_or_character', 'self'):
            print(k, boost, cl['action'].get('magnitude'), cl.get('cost'))
# → exactly the 10 cards in the Finding 4 table
```

---

*End of F-8A triage. STOPPED as instructed — no fixes applied, awaiting owner priority approval.*
