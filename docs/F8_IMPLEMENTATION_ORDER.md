# F-8 Final Synthesis — Implementation Order

**Owner question:** "What is the SMALLEST sequence of generic fixes that turns this into a genuinely playable local game?"

**Constraint:** No new visuals before narrative/gameplay clarity unless required. No card-specific logic. No engine semantic changes — engine state mutations are already correct; only narrative/UI/feedback layer needs work.

**Authoritative inputs:** `docs/F8_EFFECT_FAMILY_MATRIX.md` (Step A), `docs/F8_CORPUS_COMPATIBILITY.md` (Step B), `docs/F8_GAMEPLAY_FLOW_AUDIT.md` (Step C), `docs/F8_STATE_EXPLAINABILITY.md` (Step E), `docs/F8_MANUAL_FAILURE_SYNTHESIS.md` (Step F). All findings cite file:line.

---

## Answer: Smallest viable sequence

**5 fixes turn this into a playable, understandable game** (the "MVP narrative" set). Everything beyond #5 is polish.

The 5 fixes in dependency order:

1. **Action-clause Target Picker** (Pattern A) — unblocks "up to 1" target choice for ~638 clauses
2. **Searcher Peek UI** (Pattern A) — unblocks 183 searcher clauses
3. **POWER_MODIFIED standalone beat** (Pattern B) — answers "why is combat 0?"
4. **KO source attribution + DRAW + LIFE_TO_HAND + DON_ATTACHED + DISCARD + MILL beats** (Pattern B bundle) — answers "what just happened?" for opp/effect mutations
5. **Why-illegal toast** (Pattern C) — answers "why won't this play?"

After #5: WHAT/WHY/WHO is answerable for every common gameplay moment. Reorder (39 clauses), buff-expired indicator, stage-replaced beat, and visual polish are deferred.

---

## Top 10 ranked fixes

| Rank | Name | Why it matters | Clause coverage | Improvement | Dependency | Risk | Touch surface |
|---|---|---|---|---|---|---|---|
| 1 | **Action-clause Target Picker** | "I couldn't choose anything." Largest single playability win. | ~638 clauses (removal_ko + removal_bounce + power_buff + rest_target + set_active + give_don_to_target) | Resolves complaints #1, #5. Eliminates auto-target frustration across 5 effect families. | None (foundational) | LOW — extends existing `PendingTargetPick` (already used by `attack_target_pick`). | Engine: `state/types.ts` (extend PendingTargetPick variant), `protocol/actions.ts` (RESOLVE_ACTION_TARGET_PICK), `registry/handlers/actions.ts` (split at `ctx.controller === A`). UI: new `TargetPickPrompt.tsx`. Beat: none new — uses POWER_MODIFIED/KOD/BOUNCED already. Tests: 1 e2e per family (~5 tests). |
| 2 | **Searcher Peek UI** | Largest-frequency family (322 firings/1000 games). Cards silently play themselves today. | 183 clauses | Resolves complaint #1 fully. | After #1 (reuses the Pattern A precedent). | LOW — design already exists in reverted F-7z Part A; owner saw it work. | Engine: `state/types.ts` (PendingSearcherPeek), `protocol/actions.ts` (RESOLVE_SEARCHER_PEEK), `registry/handlers/actions3.ts` (split), `reducers/choiceResolve.ts` (reducer). UI: new `SearcherPeekPrompt.tsx`. Beat: SEARCHER_RESULT already exists. Tests: 6 e2e (match / no-match / Choose-None / hidden-info / chain / null). |
| 3 | **POWER_MODIFIED standalone beat** | "Why is combat 0?" Cannot be answered today when debuff fired before combat. | 412 power_buff clauses | Resolves #4 and #8(b). | None | LOW — `beatFor.ts` already has `powerModSourceName` field; just needs standalone beat when source is non-combat. | UI: `beatFor.ts` add POWER_MODIFIED BeatKind + case; `PresentationQueue.tsx` add duration entry. Engine: none. Tests: 2 e2e (pre-combat debuff → combat shows 0 with source). |
| 4 | **KO source attribution + 5 new beat kinds** (DRAW, LIFE_TO_HAND, DON_ATTACHED, DISCARD, MILL) | "What just happened?" Closes 5 of the silent-mutation gaps. | DRAW: 272 effect-draws; LIFE_TO_HAND: 33; DON_ATTACHED: 85; DISCARD: ~28; MILL: 53. Plus KO source for all effect-driven KOs. | Resolves #2, #7, #8(a), #9b. | None | MEDIUM — needs engine to emit `cause` field on history events for clean attribution. Bigger because 5 events to wire, but each is mechanical. | Engine: history-event shape (add `cause: InstanceId` to draw/discard/mill/don_give/life_to_hand/ko). UI: `beatFor.ts` 5 new beat kinds + cases; `PresentationQueue.tsx` 5 duration entries. Tests: 5 e2e (one per beat kind). |
| 5 | **Why-illegal toast** | "Why won't this play?" — biggest cognitive friction. | every illegal tap | Resolves #10. | None | MEDIUM — needs `legality.ts` to return reason strings (today returns Action[] or boolean). Touches a hot path. | Engine: `rules/legality.ts` returns `{ allowed: boolean; reason?: string }`. UI: new toast hook on illegal-tap. Tests: 1 e2e per illegality reason (cost / phase / once_per_turn / target). |
| 6 | **BOUNCED + BLOCKED attribution enrichment** | "Why did my card go back?" / "Blocked by what?" | BOUNCED: 75 clauses; BLOCKED: every blocked attack | Resolves #3 fully. | None — reuses existing `scanCombatChain` utility. | LOW — UI-only. | UI: `beatFor.ts` BOUNCED + BLOCKED cases enriched. Tests: 2 e2e. |
| 7 | **REST_TARGET + UNREST_TARGET + STAGE_REPLACED beats** | "My character is now rested — by what?" / "Stage just changed?" | rest: 127; unrest: 86 (set_active); stage: low | Edge-case polish; finishes the silent-mutation cleanup. | None | LOW | UI: 3 new beat kinds + cases. Tests: 3 e2e. |
| 8 | **NO_VALID_TARGET prominence** | "Effect text said X but nothing happened" when no target exists. | partial #9b | Resolves remaining #9b. | None | LOW — beat exists, needs longer duration + clearer text. | UI: tune `PresentationQueue.tsx` DUR entry; enrich beat subText. Tests: 1 e2e. |
| 9 | **Reorder UI + engine completion** | V0 stub does nothing visible (39 clauses). Engine has to be COMPLETED, not just split. | 39 | Resolves #9a; heaviest single fix. | After #1 (reuses Pattern A) and #2 (UI pattern established). | MEDIUM-HIGH — engine logic needs to apply the reorder permutation; not trivial. | Engine: `actions3.ts:1129` rewrite (currently a stub). New `PendingReorder` + `RESOLVE_REORDER`. UI: drag-reorder Prompt. Tests: 3 e2e. |
| 10 | **Buff-expired indicator at end of turn** | "Where did my buff go?" — breaks mental model at turn end. | rare but affects every multi-turn buff | LOW-impact polish; defer. | After continuous-effect manager refactor. | HIGH — continuous-effect manager doesn't emit expiry events today. | Engine: ContinuousManager change. UI: BUFF_EXPIRED beat. Defer. |

---

## Implementation patterns (3 only)

**Pattern A — Generic Pending + Prompt** (#1, #2, #9)

```
1. Add Pending<X> interface to shared/engine-v2/state/types.ts
2. Add RESOLVE_<X> action to shared/engine-v2/protocol/actions.ts
3. Split handler at ctx.controller === A in registry/handlers/*.ts:
     human → create pending; AI → keep deterministic auto-resolve.
4. Add reducer to shared/engine-v2/reducers/choiceResolve.ts.
5. Add src/store/game.ts auto-resolve loop break-out.
6. Add new src/components/<X>Prompt.tsx reading generic engine fields only.
7. Mount in src/components/PlayfieldStage.tsx.
8. Add e2e tests verifying open / valid pick / invalid pick / choose-none / hidden-info / resume.
```

Constants per family: pending field names (lookedAtInstanceIds / candidateIds / etc.), pick limit semantics, valid-vs-invalid display rules. NO card-specific code anywhere in Pattern A.

**Pattern B — Beat kind add or enrich** (#3, #4, #6, #7, #8)

```
1. Add BeatKind variant in src/gameLog/beatFor.ts:13-26.
2. Add case mapping in beatFor() returning { kind, primaryInstanceId, subText, ... }.
3. Add duration in PresentationQueue.tsx:30-44 DUR map.
4. (If new) ensure engine emits the history event with required attribution fields.
5. Add 1 e2e test confirming the beat surfaces on the deterministic trigger.
```

**Pattern C — Legality reason exposure** (#5)

```
1. Change legality.ts return shape: boolean → { allowed: boolean; reason?: string }.
2. Wire reason through legalActions array to UI.
3. Add toast hook: on illegal-tap, fire toast with reason.
4. Add 1 e2e per reason class (cost / phase / once_per_turn / target).
```

---

## Smallest viable sequence — defended

If owner wants "playable + understandable + legally clear" with minimum work:

**Fixes #1 + #2 + #3 + #5 = MVP.** Four fixes. Two engine pending splits (Pattern A), one beat kind add (Pattern B partial), one legality refactor (Pattern C).

After these four, the four CRITICAL complaints (#1, #4, #5, #10) are resolved. Game is playable end-to-end with comprehensible narrative.

Fix #4 (bundle of 5 beat kinds + KO attribution) is the difference between "playable" and "polished." Recommend bundling it with #1-3 anyway because the marginal cost is low and the experience uplift is large.

**Recommended MVP cut: fixes #1 + #2 + #3 + #4 + #5 = 5 fixes.**

Defer #6-#10. Revisit after manual playtest of MVP.

---

## File list BEFORE edits (per fix, by pattern)

**Pattern A trio (#1, #2, #9):**

- `shared/engine-v2/state/types.ts` (extend PendingState union, add PendingTargetPick action-clause variant, add PendingSearcherPeek, add PendingReorder; extend Phase enum)
- `shared/engine-v2/protocol/actions.ts` (add RESOLVE_ACTION_TARGET_PICK, RESOLVE_SEARCHER_PEEK, RESOLVE_REORDER)
- `shared/engine-v2/registry/handlers/actions.ts` (split removal_ko, removal_bounce, give_power, rest_target, set_active, give_don_to_target handlers at `ctx.controller === A`)
- `shared/engine-v2/registry/handlers/actions3.ts` (split searcher_peek; rewrite peek_and_reorder_* from V0 stub to real reorder)
- `shared/engine-v2/reducers/choiceResolve.ts` (add 3 reducers)
- `src/store/game.ts` (add 3 auto-resolve break-out cases)
- `src/components/TargetPickPrompt.tsx` (NEW — generic action-target picker)
- `src/components/SearcherPeekPrompt.tsx` (NEW — same pattern as reverted F-7z Part A)
- `src/components/ReorderPrompt.tsx` (NEW — drag-handles)
- `src/components/PlayfieldStage.tsx` (mount 3 new prompts)

**Pattern B bundle (#3, #4, #6, #7, #8):**

- `src/gameLog/beatFor.ts` (add 9 BeatKind variants: POWER_MODIFIED, DRAW_FROM_EFFECT, LIFE_TO_HAND, DON_ATTACHED, DISCARD_FROM_HAND, MILL_SELF, REST_TARGET, UNREST_TARGET, STAGE_REPLACED; enrich BOUNCED + BLOCKED + KOD + NO_VALID_TARGET cases)
- `src/gameLog/PresentationQueue.tsx:30-44` (add 9 DUR entries)
- `shared/engine-v2/registry/handlers/actions.ts` (add `cause: InstanceId` to history events for DRAW / LIFE_TO_HAND / DON / DISCARD / MILL / KO; mechanical change)
- `shared/engine-v2/reducers/attackFlow.ts` (KO event during combat gets `cause: combat` to distinguish from effect-KO)

**Pattern C (#5):**

- `shared/engine-v2/rules/legality.ts` (change return shape to `{ allowed; reason? }`)
- `src/online/legalActions.ts` (propagate reason)
- `src/components/PlayfieldStage.tsx` (add illegal-tap hook + toast)
- `src/components/IllegalTapToast.tsx` (NEW — generic)

**Tests (all patterns):**

- `e2e/local-ai/effect-card-proof.spec.ts` (extend with ~14 new CARDs — 5 for Pattern A families, 9 for Pattern B beats; family-level only, no card-specific assertions)

---

## Risk analysis

| Fix | Risk class | Why | Mitigation |
|---|---|---|---|
| #1 Target Picker | LOW | Extends existing PendingTargetPick. AI path preserved by `ctx.controller === A` split. | E2E covers each of 5 families; legacy AI auto-resolve tests stay passing. |
| #2 Searcher Peek | LOW | Pattern already designed in reverted F-7z; owner saw it work end-to-end. | Reuse the F-7z Part A code with the same shape; re-add SEARCHER_RESULT beat path. |
| #3 POWER_MODIFIED beat | LOW | UI-only change to beatFor + PresentationQueue. | E2E: pre-combat debuff → COMBAT_RESULT still shows correct math + new standalone beat earlier. |
| #4 Beat bundle (KO/DRAW/etc.) | MEDIUM | 9 new beat kinds + engine history event shape changes (adds `cause` field). | Roll out beats incrementally; engine `cause` field is additive (optional) — no breaking change. |
| #5 Why-illegal toast | MEDIUM | `legality.ts` is a hot path returning Action[] — return-shape change ripples. | Keep legacy boolean check, add optional `reason` field — non-breaking. |
| #6 BOUNCED/BLOCKED enrichment | LOW | UI-only. | E2E: combat with blocker → BLOCKED beat includes blocker card. |
| #7 REST/UNREST/STAGE beats | LOW | UI-only. | E2E one per beat. |
| #8 NO_VALID_TARGET prominence | LOW | UI-only tuning. | E2E unchanged. |
| #9 Reorder | MEDIUM-HIGH | Engine has to be completed (not just split). V0 stub does nothing today; correctness matters. | Implement engine first, prove with unit test; then build UI; then e2e. |
| #10 Buff-expired | HIGH | ContinuousManager doesn't emit expiry events today — refactor needed. | DEFER. |

---

## What stays out of scope

- **Render hierarchy / z-stack polish** (Step D — deliberately skipped). Reconsider after MVP.
- **Combat sideways-card layout fix** (was F-7z Part B). Visual; no comprehension blocker.
- **Opponent hand fan rendering** (was F-7z Part D). Hand SIZE is already visible.
- **Fixed scalable board layout** (was F-7z Part E). Polish.
- **Per-card semantic e2e** (one test per searcher/bounce/etc card). Generic family tests suffice — Step B Top systemic gaps shows the family-level approach unlocks all cards.

---

## STOP

No code yet. This report is the audit + plan. Awaiting owner approval to proceed with the MVP cut (#1 → #2 → #3 → #4 → #5).

Once approved, the plan is to implement in dependency order, with permission-first relay before EACH fix and AFTER each fix:

1. Relay-back: "Implementing fix #N. Files: X. Risk: Y. May I proceed?"
2. Wait for "ok"
3. Implement + e2e
4. Report results; ask permission for fix #N+1.

Each pattern is the same shape repeated. No card-specific logic anywhere.
