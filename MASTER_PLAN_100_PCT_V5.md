# Master Plan v5: 100000000% on 100-scope

Absorbs round-4 cert findings on top of v4. Carries forward all v4/v3/v2/v1 content. Sections marked **NEW(v5)** below.

Commit baseline: `a1bc66c` on `main`. Working tree clean.

A3 (counter-window) CLOSED in round 2. A4 (text faithfulness) CLOSED in round 4. Remaining open axes: A1 (engine handlers), A2 (continuous), A5 (adversarial).

---

## All v4 sections retained verbatim. Amendments + additions below.

---

## **AMENDED(v5)** II28. DON-detach sites — complete enumeration

Round-4 cert found v4's "ALL" claim incomplete. True enumeration of every site that splices/removes a CardInstance from a zone with possible attached DON:

### II28a. runner-v2.ts (action handlers, V2 path)
- L774: `add_to_opp_life_top` opp-field detach
- L918: `bottom_of_deck_to_opp_deck`
- L957: `exile` field branch (corrected from v3 mislabel)
- L962: `exile` stage branch (added v4)
- L1217: `removal_ko`
- L1262: `removal_bounce`
- **NEW(v5)** L1510: `bottom_of_deck_self` action — currently NO DON drain at all (baseline leak), needs both `attachedDon` AND `attachedDonRested` drain to `donRested`

### II28b. replacements-v2.ts (cost-payment paths)
**NEW(v5)** sites that splice from field but currently NO attachedDon drain:
- L340: `trashSelf` cost (EB01-013 Hiyori, EB01-042 Scarlet)
- L356: `koSelfCharacter` cost (no 100-scope user)
- L424: `bottomOfDeckSelf` cost field branch (no 100-scope user; legacy)
- L431: `bottomOfDeckSelf` cost stage branch (EB01-030 Loguetown — stage)
- L472: `bottomOfDeckOwnChar` cost (EB01-011 Mini-Merry — targets another own char with potential DON)

**Fix per site:** before `field.splice(idx, 1)` or `pl.stage = null`, add:
```
while (removed.attachedDon.length > 0) pl.donRested.push(removed.attachedDon.shift()!);
while ((removed.attachedDonRested ?? []).length > 0) pl.donRested.push(removed.attachedDonRested.shift()!);
```

### II28c. templates.ts (legacy v1 handlers, still dispatched via dispatch.ts:42)
**NEW(v5)** for completeness (v1 path is dormant for verified human-reviewed cards but tagged as out-of-scope unless needed):
- L92: legacy `removal_ko`
- L109: legacy `removal_bounce`
- L373: legacy `exile`
- L379: legacy variant

Fix only if any 100-scope card falls back to v1 path. (All 100-scope cards are verified → V1 path short-circuited at dispatch.ts:200-205 → not in scope for this fix.)

---

## **AMENDED(v5)** II31. Read-side migration — corrected enumeration

### II31a. `effectivePower` helpers (CORRECTED v5)

- **Site 1:** `applyAction.ts:892-899` ✓ (v4 correct)
- **Site 2:** `runner-v2.ts:339-347` ✓ (v4 correct)
- **Site 3:** `HardAi.ts:264` (definition) + readers at **L198, L233, L240, L250** — these are POWER reads, NOT cost reads as v4 mis-stated
- **Site 4:** `MediumAi.ts:138` (definition) + readers at **L83, L84** — POWER reads, not cost

All AI sites read effectivePower; migration handled via the helper definition update. v4's mislabel doesn't change the fix — migrating the helper covers all consumers.

### II31b. `effectiveCost` migration (CORRECTED v5)

Helper: `runner-v2.ts:351-353` — migrate to read both halves.

**Inline reads** (NOT in AI files; AI doesn't read costModifier directly):
- `runner-v2.ts:380, 384, 388, 392 (if exists), 395` — via helper, auto-migrate
- `runner-v2.ts:430` — INLINE; migrate
- `replacements-v2.ts:143, 147, 176, 180, 317, 321, 368, 372` — INLINE; migrate each
- `continuous-v2.ts:300, 304` — INLINE in filter logic; migrate
- `templates.ts:129` — INLINE; migrate
- `turn.ts:175` — WRITE site `delete inst.costModifier`; change to `delete inst.costModifierOneShot`

### II31c. `instHasImmunity` helper

**NEW(v5)** explicit semantics:
- Signature: `instHasImmunity(inst, againstTag?): boolean`
- Returns `true` if EITHER `inst.immunityOneShot?.against` OR `inst.immunityContinuous?.against` matches `againstTag` (or matches "any" if no tag passed)
- For two `{against: string}` objects, merge is OR — any matching half returns true
- Consumers: currently NONE in production (pre-existing dead-code; no 100-scope card uses immunity action). Helper reserved for future use.

### II31d. `instAttackLocked` helper

**NEW(v5)** explicit semantics:
- Signature: `instAttackLocked(inst): boolean`
- Returns `true` if `inst.attackLockedOneShot?.until` OR `inst.attackLockedContinuous === true`
- **Consumer fact-check (v5 correction):** `legality.ts` has ZERO `attackLocked` reads (grep confirms). The flag has NO engine consumer in production. v4 mis-claimed legality.ts as consumer.
- **Fix in v5:** the attack-lock has no current consumer in 100-scope. Plan extension: ADD a consumer at `legality.ts` attack-eligibility check (around line 200-220) — `if (instAttackLocked(inst)) skip emit ATTACK`. Required if any 100-scope card uses `attack_lock_until_phase` action.
- Verify 100-scope usage: grep cards.json for `attack_lock_until_phase`. If zero, defer wiring.

### II31e. Test migration list (EXPANDED v5)

**v4 listed:**
- `actionGroup2.test.ts:64, 65, 74` (basePowerOverride one-shot)
- `actionGroup2.test.ts:94, 95` (costModifier one-shot)
- `actionGroup2.test.ts:128, 129, 174` (attackLocked one-shot)
- `actionGroup3.test.ts:133` (immunity one-shot)
- `effects.test.ts:348, 349, 351` (costModifier one-shot)
- `continuous.test.ts:117, 128, 149, 165, 189` (continuous variants)
- `EB01-046.test.ts:58, 81` (costModifier)
- `EB01-042.test.ts:93, 101` (costModifier)

**NEW(v5) additions:**
- `effects.test.ts:231, 233, 248, 253, 254, 277, 294, 295, 310, 360, 367, 369` (powerModifier one-shot reads — 12 sites)
- `actionGroup2.test.ts:167` (powerModifier one-shot path)
- `actionGroup3.test.ts:140, 141, 144` (grantedKeywords one-shot)
- `continuous.test.ts:118, 139, 175, 187, 188` (sibling assertions to v4's list)
- `actionGroup2.test.ts:136, 137, 175, 177` (restLocked boolean → restLockedUntilTurn numeric)
- `cards/EB02-011.test.ts:80` (restLocked → restLockedUntilTurn)
- `cards/EB02-015.test.ts:61` (same)
- `cards/EB02-021.test.ts:60` (same)
- `cards/EB01-061.test.ts:78` (basePowerOverride one-shot)
- `cards/EB01-048.test.ts:86, 87` (costModifier one-shot + endTurn-clears)

Migration rule per site:
- One-shot write paths (give_keyword, power_buff, removal_cost_reduce, set_base_power_copy_from_target, etc.) → assert against `*OneShot` field
- Continuous write paths (continuous self_power_buff, aura_power_buff, etc.) → assert against `*Continuous` field
- restLocked tests → assert `restLockedUntilTurn` value (turn N + 2)

---

## **NEW(v5)** II32. WRITE-side migration for state-shape splits

v4 enumerated READ sites; v5 enumerates WRITE sites. Every existing write to a flat split field must change to the appropriate one-shot or continuous half.

### II32a. continuous-v2.ts — ALL writes are CONTINUOUS
- L82 (self_power_buff): `powerModifier += delta` → `powerModifierContinuous += delta`
- L99 (aura_power_buff): same migration
- L111-112 (cost_modifier continuous variant): `costModifier` → `costModifierContinuous`
- L131-132 (aura_cost_modifier): same
- L140-141 (grant_immunity continuous): `immunity` → `immunityContinuous`
- L166-168 + 178 + 186-188 (set_base_power continuous variants): `baseOverride` typo → `basePowerOverrideContinuous` (also fixes II2b typo)
- L218-221 (aura_counter_buff): `counterBonus` retained (continuous-only field, no one-shot collision)
- L244-247 (aura_grant_immunity): `immunity` → `immunityContinuous`
- L250-253 (grant_keyword_to_self): `grantedKeywords` → `grantedKeywordsContinuous`
- L265-268 (attack_lock continuous): `attackLocked` → `attackLockedContinuous`
- L274 (cost_modifier sibling): `costModifier` → `costModifierContinuous`

### II32b. runner-v2.ts — ALL writes are ONE-SHOT
- L985-1000 (one-shot power_buff): `powerModifier` → `powerModifierOneShot`; `powerModifierExpiresInTurns` retained
- L1035-1040 + L1058 (set_base_power one-shot): `basePowerOverride` → `basePowerOverrideOneShot`; add `basePowerOverrideExpiresInTurns` if duration tracked
- L1071-1076 + L1085-1090 (removal_cost_reduce, removal_cost_increase): `costModifier` → `costModifierOneShot`
- L1134-1139 (attack_lock one-shot): `attackLocked` → `attackLockedOneShot`
- L1365-1370 (grant_immunity one-shot): `immunity` → `immunityOneShot`
- L1379-1392 (give_keyword): writes to `grantedKeywordsOneShot[]` array of `{keyword, until}` per v3 I2
- L1612-1617 (set_base_power_copy_from_target): `basePowerOverride` → `basePowerOverrideOneShot`

### II32c. templates.ts — ALL writes are ONE-SHOT (V1 path, dormant for verified V2 cards)
- L129-135 (cost_modifier template): `costModifier` → `costModifierOneShot`

---

## **NEW(v5)** II33. `attack_lock_until_phase` consumer wiring (CONDITIONAL)

If grep of cards.json confirms NO 100-scope card uses `attack_lock_until_phase`, defer this wiring. If any does:
- Add to `legality.ts` (after II31d's `instAttackLocked` helper is in place)
- Add to attack-eligibility check at legality.ts:200-220 area
- Update tests to verify the lock prevents attack emission

---

## IV. TEST COVERAGE (carried + expanded per II31e)

---

## V. EXECUTION ORDER (carried from v4)

---

## VI. CR ORDERING (carried from v3)

---

## VII. DEFERRALS (carried from v3)

---

End of v5 master plan.
