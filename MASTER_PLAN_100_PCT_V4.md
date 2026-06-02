# Master Plan v4: 100000000% on 100-scope

Absorbs all round-3 cert findings on top of v3. Carries forward all v3 / v2 / v1 content. Sections marked **NEW(v4)** below.

Commit baseline: `a1bc66c` on `main`. Working tree clean.

---

## All v3 sections retained verbatim. Amendments + additions below.

---

## **AMENDED(v4)** I3. `restLockedUntilTurn` arithmetic

- **File:** `runner-v2.ts:1144-1156 rest_lock_until_phase`
- **Single rule (resolves v3 "Re-think" ambiguity):**
  - Write `restLockedUntilTurn = state.turn + 2` for ALL targets regardless of controller
  - Refresh-phase guard at turn.ts:52-61: `if (state.turn <= (inst.restLockedUntilTurn ?? -1)) skip rested-clear`
  - Walk-through confirmed for EB02-011 Arlong (opp target), EB02-015 Bonney (opp target), EB02-021 Gum-Gum (own target) — all 3 lock through the printed-text refresh and clear at the next one

---

## **AMENDED(v4)** II7. ACTIVATE_MAIN cost order — ALL kinds rest

- **File:** `applyAction.ts:184 activateMain`
- **Rule (resolves leader-exclusion bug):**
  - Remove pre-fire `inst.rested = true` at line 184
  - POST-fire rest applies to ALL source kinds (character, stage, leader) if no clause had `cost.restSelf`
  - Per OPTCG §10-3-3, [Activate:Main] rests the source regardless of kind (leaders included)
- **Corrected affected card list (cards with activate_main + NO `cost.restSelf` on their clause):**
  - EB01-007 Yamato (character)
  - EB01-013 Hiyori (character; uses trashSelf cost, not restSelf — source is trashed anyway, but post-fire-rest is moot)
  - EB01-030 Loguetown (event; bottomOfDeckSelf cost — source leaves field, rest moot)
  - EB01-040 Kyros (leader; uses flipLife cost — leader MUST rest post-fire)
  - EB01-042 Scarlet (character; trashSelf cost — moot)
  - EB02-006 Yamato (character; no cost — MUST rest post-fire)
  - EB02-010 Luffy (leader; donCost or donCostReturnToDeck per II26 — MUST rest post-fire)
- **Detection rule:** post-fire rest fires once per ACTIVATE_MAIN invocation when NO clause that fired had `cost.restSelf:true`. Idempotent (already-rested = no-op).

---

## **AMENDED(v4)** II28. ALL DON-detach sites drain `attachedDonRested`

- **Files:** `runner-v2.ts:774, 918, 957, 962, 1217, 1262`
- **Correction:** v3 mislabeled L957 as `rest_target` — actual code at L957-958 is `exile` FIELD branch. v3 also missed L962-963 which is `exile` STAGE branch.
- **Verified site list (via sed):**
  - L774: `add_to_opp_life_top` opp-field detach (`opp.donRested.push`)
  - L918: `bottom_of_deck_to_opp_deck` detach (`opp.donRested.push`)
  - L957: `exile` field branch (`pl.donRested.push`)
  - **L962: `exile` stage branch (`pl.donRested.push`)** **NEW(v4)**
  - L1217: `removal_ko` detach
  - L1262: `removal_bounce` detach
- **Fix per site:** after each existing `while (removed.attachedDon.length > 0) ...donRested.push(removed.attachedDon.shift())`, add a parallel drain of `attachedDonRested`.

---

## **AMENDED(v4)** I3 internal inconsistency resolved
(See AMENDED I3 above — single rule, no per-controller branching.)

---

## **NEW(v4)** II31. Read-side migration for I7-I10 splits

The state-shape splits (I7 basePowerOverride, I8 costModifier, I9 immunity, I10 attackLocked) define WRITE sites. v4 enumerates EVERY read site that must migrate.

### II31a. `effectivePower` helpers

- **Site 1:** `applyAction.ts:892-899` — current reads `card.power + attachedDon*1000 + powerModifier`
  - **Fix:** `(inst.basePowerOverrideOneShot ?? inst.basePowerOverrideContinuous ?? card.power) + attachedDon*1000 + (inst.powerModifierOneShot ?? 0) + (inst.powerModifierContinuous ?? 0)`
- **Site 2:** `runner-v2.ts:339-347` — same shape, same fix
- **Site 3:** `HardAi.ts:264` — duplicated helper for AI scoring; same fix
- **Site 4:** `MediumAi.ts:138` — same

### II31b. `effectiveCost` migration

- **Helper:** `runner-v2.ts:351-353` — `card.cost + (inst.costModifier ?? 0)` → `card.cost + (inst.costModifierOneShot ?? 0) + (inst.costModifierContinuous ?? 0)`
- **Inline reads (~14 sites total):**
  - `runner-v2.ts:380` (`effectiveCost` caller — auto-migrated via helper)
  - `runner-v2.ts:384` (same)
  - `runner-v2.ts:388` (same)
  - `runner-v2.ts:392` (same — if exists; verify)
  - `runner-v2.ts:395` (same)
  - `runner-v2.ts:430` — **INLINE** `card.cost + (inst.costModifier ?? 0)`; migrate
  - `replacements-v2.ts:143, 147, 176, 180, 317, 321, 368, 372` — **INLINE** reads; migrate each
  - `continuous-v2.ts:300, 304` — **INLINE** reads in filter logic; migrate
  - `templates.ts:129` — **INLINE** `inst.costModifier ?? 0`; migrate
  - `HardAi.ts:198, 233, 240, 250, 264` — AI cost reads; migrate
  - `MediumAi.ts:83, 84, 138` — same
  - `turn.ts:175` — **WRITE site** `delete inst.costModifier`; change to `delete inst.costModifierOneShot` (when expiry hits); `costModifierContinuous` is reset via II21 recompute, not deleted at endTurn

### II31c. `instHasImmunity` helper migration

- New helper: `instHasImmunity(inst, againstTag?): boolean` checks both `immunityOneShot` and `immunityContinuous`
- Consumers (currently none in production per round-1 audit, but reserved for future use):
  - `removal_ko` consult — add check via helper
  - `removal_bounce` consult — add check via helper

### II31d. `instAttackLocked` helper migration

- New helper: `instAttackLocked(inst): boolean` checks both halves
- Consumer: `legality.ts` attack-eligibility (currently reads `inst.attackLocked` flag if it exists; migrate to helper)

### II31e. Test migration

Existing tests reading flat fields will fail post-split. Migrate each to use the new field name:

- **`effectSpecV2.actionGroup2.test.ts:64-65`** — `basePowerOverride` → `basePowerOverrideOneShot`
- **`effectSpecV2.actionGroup2.test.ts:74`** — same
- **`effectSpecV2.actionGroup2.test.ts:94-95`** — `costModifier` → `costModifierOneShot`
- **`effectSpecV2.actionGroup2.test.ts:128-129, 174`** — `attackLocked` → `attackLockedOneShot`
- **`effectSpecV2.actionGroup3.test.ts:133`** — `immunity` → `immunityOneShot`
- **`effects.test.ts:348-349, 351`** — `costModifier` → `costModifierOneShot`
- **`effectSpecV2.continuous.test.ts:117, 128, 149, 165, 189`** — `costModifier`/`basePowerOverride`/etc. used in CONTINUOUS test paths → migrate to the `*Continuous` variants
- **`cards/EB01-046.test.ts:58, 81`** — `costModifier` references
- **`cards/EB01-042.test.ts:93, 101`** — same

---

## **NEW(v4)** III5. Strip `'trigger'` from `keywords` array (in addition to effectTags)

v3 III4 strips `'trigger'` from `effectTags` on 8 cards. v3 omitted `keywords`. Per A4 round-3 cert, the same 9 cards (including EB01-021 Hannyabal as leader for cleanliness) ALSO carry `'trigger'` in `keywords`:

- **File:** `shared/data/cards.json`
- **Cards to strip `'trigger'` from BOTH `effectTags` AND `keywords`:**
  - EB01-021 Hannyabal (leader)
  - EB01-022 Inazuma
  - EB01-024 Hamlet
  - EB01-034 Ms. Wednesday
  - EB01-037 Mr. 9
  - EB01-058 Mont Blanc Cricket
  - EB02-005 Fake Straw Hat Crew
  - EB02-023 Crocodile
  - EB02-035 Sanji & Pudding

---

## **NEW(v4)** III6. Specify array for v2/v3 keyword strips

v3 III4 said "remove from keywords" but didn't disambiguate `keywords` vs `effectTags` per card. Per A4 round-3 cert, the engine-consumed bugs live in `keywords` (legality.ts:212 reads `keywords.includes('rush')`; applyAction.ts:159 reads `keywords.includes('activate_main')`).

- **Strip from `keywords` (engine-consumed):**
  - EB01-014 Sanji: remove `'activate_main'` (text has no `[Activate: Main]`)
  - EB01-045 Brook: remove `'rush'` from `keywords` (rush is conditional via on_play give_keyword)
  - EB02-006 Yamato: remove `'rush'` from `keywords`
  - EB02-012 Gaimon: remove `'blocker'` from `keywords`
  - EB02-018 Buggy: remove `'double_attack'` from `keywords` (DA granted to LEADER, not Buggy)
  - EB02-019 Zoro: remove `'rush'` from `keywords` (rush_character via continuous; separate keyword)
  - EB02-033 Klabautermann: remove `'blocker'` from `keywords`
- **Also strip from `effectTags`** (cosmetic — `effectTags` is a categorization hint; not generally engine-consumed for these keywords)

---

## **NEW(v4)** III7. Strip spurious `activate_main` from counter events

Per A4 round-3 cert, 9 counter events have `keywords: ['activate_main']` but print `[Main]` (event-play, not `[Activate: Main]`). Engine doesn't iterate events for ACTIVATE_MAIN (legality.ts:310-321 is leader/field/stage only), so engine-non-impact. Cosmetic faithfulness fix:

- **Strip `'activate_main'` from `keywords` on (verify each effectText doesn't contain `[Activate: Main]`):**
  - EB01-039 Conquerer of Three Worlds Ragnaraku
  - EB01-051 Finger Pistol
  - EB01-060 Did Someone Say...Kami?
  - EB02-007 Cloven Rose Blizzard
  - EB02-008 The Peak
  - EB02-020 We Are!
  - EB02-021 Gum-Gum Giant Pistol
  - EB02-031 Hope
  - EB02-039 GERMA 66

---

## **NEW(v4)** III8. EB02-019 keyword reconciliation

Per A4 round-3 cert: EB02-019 Zoro `keywords: ['on_play', 'rush']` but the conditional grant uses keyword `'rush_character'` (limited rush — can attack chars only). Engine treats `rush` and `rush_character` as DISTINCT (legality.ts:212 checks rush; legality.ts:233 checks rush_character).

- **Fix:** III4/III6 already strips `'rush'` from EB02-019. The continuous grants `rush_character` correctly via continuous-v2.ts handlers (after II21 wires `applyAllContinuousV2`). Once III6 + II21 land, EB02-019 has NO printed-rush AND CONDITIONAL rush_character. Matches text.

---

## **NEW(v4)** III9. EB01-053 Gastino choose_one option ordering

Per A4 round-3 cert: V0 deterministic picks `options[0]`. v3 III1 didn't specify whether top or bottom comes first.

- **Decision:** `options[0] = bottom` (more disruptive — delayed life loss for opp). `options[1] = top` (faster but less disruptive).
- **Rationale:** matches the engine's current hardcoded `position:"bottom"` — preserves observable behavior + lets future UI pick option[1] for top.

---

## IV. TEST COVERAGE (CARRIED FROM v3)

Plus new v4-specific regression tests:
- L957 + L962 exile sites drain `attachedDonRested`
- Leader ACTIVATE_MAIN rests post-fire (EB01-040 Kyros + EB02-010 Luffy)
- I7-I10 read-side: dispatch tests pass after migration
- 9 cards with `'trigger'` stripped from both effectTags + keywords: flip from life, assert no trigger_window
- EB02-019 has `rush_character` granted via continuous when opp has 2+ chars, NOT printed `rush`
- EB01-053 deterministic `position:"bottom"` outcome preserved post-choose_one wrap

---

## V. EXECUTION ORDER + GATES (CARRIED FROM v3)

Dependency order updated:
1. State-shape splits (v3 I1-I10) — ALL splits first, before any read-side migration
2. Read-side migration (II31a/b/c/d) — must follow shape splits
3. Test migration (II31e) — must follow shape splits; tests then validate
4. Engine bug fixes in dependency order (typos → counter-window → continuous → granted-keyword → etc.)
5. Card spec fixes (III)
6. Full new + existing test run; iterate to green
7. Cert agents x5 against new code
8. Commit + push only if all gates green

---

## VI. CR ORDERING (CARRIED FROM v3)

---

## VII. DEFERRALS (CARRIED FROM v3)

---

End of v4 master plan.
