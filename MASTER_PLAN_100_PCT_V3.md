# Master Plan v3: 100000000% on 100-scope

Absorbs all round-1 + round-2 cert findings. Builds on v2; new sections marked **NEW** below.

Commit baseline: `a1bc66c` on `main`. Working tree clean.

---

## I. ENGINE STATE-SHAPE CHANGES

(All v2 Section I items I1-I6 retained verbatim.)

### **NEW** I7. Split `basePowerOverride` into one-shot + continuous
- **File:** `shared/engine/GameState.ts` (CardInstance)
- **Why:** A2 round-2 — same one-shot/continuous storage collision as powerModifier.
- **Fix:**
  - Add `basePowerOverrideOneShot?: number` (set by one-shot `set_base_power`/`set_base_power_copy_from_target`)
  - Add `basePowerOverrideContinuous?: number` (set by continuous `aura_set_base_power`, `self_set_base_power`, `aura_set_base_power_copy_from_leader`)
  - Effective base power = `basePowerOverrideOneShot ?? basePowerOverrideContinuous ?? card.power`
  - One-shot expires per `basePowerOverrideExpiresInTurns` (mirror powerModifierExpiresInTurns)

### **NEW** I8. Split `costModifier` into one-shot + continuous
- **File:** `shared/engine/GameState.ts` (CardInstance)
- **Why:** A2 round-2 — one-shot `removal_cost_reduce` writes same field as continuous handlers (continuous-v2.ts:111, 131, 218, 274).
- **Fix:**
  - Add `costModifierOneShot?: number`
  - Add `costModifierContinuous?: number`
  - `effectiveCost(inst, card) = card.cost + (costModifierOneShot ?? 0) + (costModifierContinuous ?? 0)`
  - One-shot expires per `costModifierExpiresInTurns`

### **NEW** I9. Split `immunity` into one-shot + continuous
- **File:** `shared/engine/GameState.ts` (CardInstance)
- **Fix:**
  - Add `immunityOneShot?: { against?: string[]; until?: 'this_turn' | 'permanent' }`
  - Add `immunityContinuous?: { against?: string[] }`
  - Helper `instHasImmunity(inst, againstTag)` checks both

### **NEW** I10. Split `attackLocked` into one-shot + continuous
- **File:** `shared/engine/GameState.ts` (CardInstance)
- **Fix:**
  - Add `attackLockedOneShot?: { until?: 'this_turn' | 'permanent' }`
  - Add `attackLockedContinuous?: boolean`
  - Helper `instAttackLocked(inst)` checks both

---

## II. ENGINE BUG FIXES

(All v2 Section II items II1-II27 retained, with the following amendments + new items.)

### II2 (AMENDED): `set_base_power_copy_from_target` writes one-shot field
- **File:** `shared/engine/effectSpec/runner-v2.ts:1599-1620`
- **Fix:** write `dest.basePowerOverrideOneShot = effectivePower(state, srcInst)` (using new I7 field)
- `effectivePower` reads precedence: one-shot > continuous > card.power
- `endTurn` clears `basePowerOverrideOneShot` when expiry hits 0

### **NEW** II2b. Fix continuous-v2 `baseOverride` typo
- **File:** `shared/engine/effectSpec/continuous-v2.ts:166, 167, 168, 178, 186, 187, 188`
- **Bug:** writes to phantom field `baseOverride` instead of `basePowerOverride`/`basePowerOverrideContinuous`
- **Fix:** change all 7 writes to `inst.basePowerOverrideContinuous = bp` (after I7 split). No 100-scope continuous card uses `aura_set_base_power*` today, but the typo is real and would break any future user.

### II7 (AMENDED): correct affected-card list + per-clause rule
- **File:** `shared/engine/applyAction.ts:184 activateMain`
- **Bug:** pre-rests source before clause cost-check; cost.restSelf can't pay
- **Fix:** Remove pre-fire `inst.rested = true` at line 184. Determine post-fire rest per CLAUSE:
  - For each fired clause: if `clause.cost?.restSelf === true`, rest happens via payCost (no extra action)
  - If clause has NO `cost.restSelf` AND source is character or stage (not leader): rest source post-fire
- **Affected cards (CORRECTED list — cards with activate_main but NO `cost.restSelf` in clause):** EB01-007 Yamato, EB01-013 Kouzuki Hiyori (has trashSelf, not restSelf), EB01-030 Loguetown (has bottomOfDeckSelf), EB01-040 Kyros (has flipLife), EB01-042 Scarlet (has trashSelf), EB02-006 Yamato (no cost), EB02-010 Monkey.D.Luffy (has donCost)
- Cards WITH `cost.restSelf` (already paid via payCost, don't need post-fire rest): EB01-011 Mini-Merry, EB01-016 Bingoh, EB01-044 Funkfreed, EB01-048 Laboon, EB02-002 Sabo, EB02-009 Thousand Sunny, EB02-025 Donquixote Rosinante

### **NEW** II28. Extend ALL 5 DON-detach sites to drain `attachedDonRested`
- **Files:** `shared/engine/effectSpec/runner-v2.ts:774, 918, 957, 1217, 1262`
- **Why:** A1 round-2 — current code only drains `attachedDon`; new I5 field `attachedDonRested` is also detached DON and must follow CR §6-5-5-4 (all detached DON → `donRested`)
- **Fix:** After each existing `while (removed.attachedDon.length > 0) ...donRested.push(removed.attachedDon.shift())`, add a parallel:
  ```
  while ((removed.attachedDonRested ?? []).length > 0)
    targetSide.donRested.push(removed.attachedDonRested.shift()!);
  ```
- Sites:
  - L774: `add_to_opp_life_top` opp-field detach
  - L918: `bottom_of_deck_to_opp_deck` detach
  - L957: `rest_target` no-op (target stays on field; verify this site really detaches — if not, skip)
  - L1217: `removal_ko` detach
  - L1262: `removal_bounce` detach

### **NEW** II29. `transfer_attached_don` explicit dual-iteration
- **File:** `shared/engine/effectSpec/runner-v2.ts:1535`
- **Fix:** When moving DON from source to target, iterate BOTH `sourceInst.attachedDon` AND `sourceInst.attachedDonRested`. Preserve rested-state on target:
  - If pulled from `sourceInst.attachedDon`: push to `targetInst.attachedDon`
  - If pulled from `sourceInst.attachedDonRested`: push to `targetInst.attachedDonRested`
- V0 deterministic: prefer active first (pull from `attachedDon`), then rested

### II21 (AMENDED): expanded reset list + recursion bound
- **File:** continuous-v2.ts (new `applyAllContinuousV2`)
- **Reset list (continuous-driven fields ONLY):**
  - `powerModifierContinuous = 0`
  - `grantedKeywordsContinuous = []`
  - `counterBonus = 0`
  - `costModifierContinuous = 0`  **(NEW)**
  - `basePowerOverrideContinuous = undefined`  **(NEW)**
  - `immunityContinuous = undefined`  **(NEW)**
  - `attackLockedContinuous = false`  **(NEW)**
  - `damageImmunityAttribute = undefined` (only continuous use; no one-shot collision)
- **Preserve (one-shot fields untouched):**
  - `powerModifierOneShot`, `grantedKeywordsOneShot`, `costModifierOneShot`, `basePowerOverrideOneShot`, `immunityOneShot`, `attackLockedOneShot`, `restLockedUntilTurn`, `powerModifierExpiresInTurns`, `costModifierExpiresInTurns`, `basePowerOverrideExpiresInTurns`
- **Recursion bound:** `applyAllContinuousV2` MUST NOT call any action handler that itself calls `applyAllContinuousV2`. Guard via `state.continuousApplyDepth` counter; bail if > 1. Cascading state mutations (e.g., on_play → play_for_free → on_play) accumulate state changes; continuous is applied at the OUTER call site, not recursively.

### II23 (AMENDED): bounce reset list also clears OPT tags
- **File:** `runner-v2.ts:1253-1283 removal_bounce`
- **Fix:** ADD `inst.perTurn.effectsUsed = []` to the reset list (was missing — instanceId is preserved, so stale OPT tags survive bounce+replay)
- Full reset (all fields):
  - `powerModifierOneShot = 0`, `powerModifierContinuous = 0`, `powerModifierExpiresInTurns = undefined`
  - `grantedKeywordsOneShot = []`, `grantedKeywordsContinuous = []`
  - `basePowerOverrideOneShot = undefined`, `basePowerOverrideContinuous = undefined`, `basePowerOverrideExpiresInTurns = undefined`
  - `restLockedUntilTurn = undefined`
  - `lastBouncedColors = undefined`
  - `counterBonus = 0`
  - `attachedDonRested = []` (already drained via II28)
  - `attachedDon = []` (already drained)
  - `costModifierOneShot = 0`, `costModifierContinuous = 0`
  - `immunityOneShot = undefined`, `immunityContinuous = undefined`
  - `attackLockedOneShot = undefined`, `attackLockedContinuous = false`
  - `damageImmunityAttribute = undefined`
  - `effectsNegated = undefined`
  - `endOfTurnTrash = undefined`
  - `perTurn.effectsUsed = []`  **(NEW)**
- Preserve: `summoningSick = false`, `rested = false` (set by existing bounce code)

### I3 (AMENDED): `restLockedUntilTurn = state.turn + 2`
- **File:** `runner-v2.ts:1144-1156 rest_lock_until_phase`
- **Bug fix:** v2 used `state.turn + 1` which clears the lock at start of own's next refresh. Per CR "cannot become active during your opp's next refresh phase" — needs to survive THROUGH opp's refresh AND own's next refresh.
- **Fix:** Write `restLockedUntilTurn = state.turn + 2`. Refresh-phase guard at turn.ts:52-61: `if (state.turn < (inst.restLockedUntilTurn ?? 0)) skip; else unrested`. With turn+2:
  - Lock set on own's turn N
  - Opp's turn N+1: opp refreshes (state.turn=N+1 < N+2 → skip if same side; but opp's refresh is on opp's side instances only — N/A for own char)
  - Own's turn N+2: own refreshes (state.turn=N+2; N+2 < N+2 is false → unrested)
- Actually verify the math vs. each card text:
  - EB02-011 Arlong text: "cannot be rested until end of opp's next turn" — lock during opp turn = N+1; expires after opp's turn ends. Lock should clear by start of own turn N+2. State.turn at start of own turn = N+2. Condition `N+2 < N+2 = false` → unrest. ✓
  - EB02-015 Bonney text: "will not become active in opp's next Refresh Phase" — opp's refresh happens at start of opp turn (state.turn=N+1). At that point N+1 < N+2 → skip unrest. ✓ Then on own's turn N+2 refresh, N+2 < N+2 = false → unrest. ✓
  - EB02-021 Gum-Gum text: "will not become active in YOUR next Refresh Phase" — own's next refresh = N+2. N+2 < N+2 = false → unrest immediately. **BUG.** Need state.turn + 3 for own-targeting locks, or special-case based on target controller.
- **Fix:** at write-time in `rest_lock_until_phase`, determine `restLockedUntilTurn` based on target's controller:
  - If target is OPP char: `state.turn + 2` (locks through opp's refresh, frees on own's next refresh — wait that's wrong too)
  - Re-think: refresh fires for activePlayer at start of their turn. Lock should skip the OPPONENT-CONTROLLED-CHAR's next refresh.
  - Simpler model: `restLockedUntilTurn` is "lock active through and including refresh of turn N". Refresh at turn N+1 checks `state.turn <= restLockedUntilTurn`. After refresh of N+1, lock auto-clears at end of refresh.
- **Revised fix:** use `<=` instead of `<` in refresh guard. Write `restLockedUntilTurn = state.turn + 2` for opp targets, `state.turn + 2` for own targets. Refresh guard: `if (state.turn <= (inst.restLockedUntilTurn ?? -1)) skip unrest`. Lock expires AFTER the refresh at the named turn.

### **NEW** II30. Strip spurious `'trigger'` from `effectTags` on 8 characters
- **File:** `shared/data/cards.json`
- **Why:** A4 round-2 — `applyAction.ts:772` reads `lifeCard.effectTags.includes('trigger')` to gate the life-card trigger_window. These 8 cards print no `[Trigger]` but carry the tag, opening phantom windows when flipped from life.
- **Cards (verified by spec read):** EB01-022 Inazuma, EB01-024 Hamlet, EB01-034 Ms. Wednesday, EB01-037 Mr. 9, EB01-058 Mont Blanc Cricket, EB02-005 Fake Straw Hat Crew, EB02-023 Crocodile, EB02-035 Sanji & Pudding
- **Fix:** Remove `'trigger'` from `effectTags` array on each card.
- Also strip from EB01-021 Hannyabal for consistency (leader, dormant for life-flip but tag is wrong).

---

## III. CARD SPEC FIXES

(All v2 Section III items retained.)

### III4 (AMENDED): full strip list
Add to v2's strip list:
- 8 character cards: EB01-022, EB01-024, EB01-034, EB01-037, EB01-058, EB02-005, EB02-023, EB02-035 — strip `'trigger'` from `effectTags` (II30)
- Optionally EB01-021 Hannyabal — strip `'trigger'` from effectTags (cosmetic)

---

## IV. TEST COVERAGE

(All v2 Section IV retained.)

Add bug-regression tests for:
- Detach sites drain `attachedDonRested` (test bounce / KO / opp-life-add / opp-deck-bottom of a char with rested DON)
- transfer_attached_don preserves rested-state (EB02-009 Thousand Sunny with rested DON on leader)
- restLockedUntilTurn off-by-one fix: EB02-021 Gum-Gum Giant Pistol locks own SHC char; verify char stays rested through own's next refresh
- continuous-v2 baseOverride → basePowerOverrideContinuous typo fix
- Bounce clears `perTurn.effectsUsed` (instanceId-preserved replay fires on_play)
- 8 character cards stripped of effectTags `'trigger'`: flip from life, assert no trigger_window opens
- One-shot field collisions for basePowerOverride / costModifier / immunity / attackLocked: write one-shot, trigger continuous re-application, assert one-shot survives

---

## V. EXECUTION ORDER + GATES

(All v2 Section V gates retained.)

Dependency order updated:
1. V2 (state shape) — includes new I7/I8/I9/I10 splits
2. V3 (engine fixes) — II2b (typo) BEFORE II21 (continuous wiring); II28/II29 BEFORE II23 (bounce); II30 BEFORE life-flip tests
3. V4 (card spec) — III4 amended list
4. V5+ test/full-suite/typecheck/cert/commit gates

---

## VI. CR ORDERING (retained from v2)

---

## VII. DEFERRALS

(All v2 Section VII retained.)

---

End of v3 master plan.
