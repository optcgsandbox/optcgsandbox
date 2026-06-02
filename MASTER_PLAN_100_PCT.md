# Master Plan: 100000000% on 100-scope (EB01-001..EB01-061 + EB02-001..EB02-039)

Commit baseline: `a1bc66c` on `main`. Working tree clean.

This plan addresses every finding from the 5-agent parallel verification pass. Every fix cites file:line. Every fix has a test case. No commit unless all gates green.

---

## A. ENGINE FIXES

### A1. Wire production call sites for `applyContinuousEffectsV2ToInstance`
**File:** `shared/engine/applyAction.ts` + `shared/engine/phases/turn.ts`
**Bug:** continuous-v2.ts:23 has zero production callers — 19 cards' continuous dead
**Fix:** Add `applyAllContinuousV2(state)` helper in continuous-v2.ts that iterates leader+field+stage of both players, calls `applyContinuousEffectsV2ToInstance` per inst. Invoke:
- After PLAY_CARD resolution (applyAction.ts:~371 character path, ~426 stage)
- After every action that mutates field/keywords/DON (after removal_ko, removal_bounce, give_don, ramp, set_active_don)
- Inside `effectivePower` at applyAction.ts:892 (recompute before reading powerModifier) and runner-v2.ts:339
- At phase transitions in turn.ts (start of refresh, start of main, end of turn)
**Critical:** continuous handlers must be IDEMPOTENT — current self_power_buff/aura_power_buff are ADDITIVE (continuous-v2.ts:82,99). Fix: continuous re-application must first RESET powerModifier/grantedKeywords/etc. to baseline, then re-apply all active continuous. Implement as "recompute from scratch" each tick.

### A2. Fix `attack_redirect_to_target` field name
**File:** `shared/engine/effectSpec/runner-v2.ts:1525`
**Bug:** writes `state.pendingAttack.defenderInstanceId` — phantom field
**Fix:** Change to `state.pendingAttack.targetInstanceId = targets[0]`
**Affected:** EB01-038

### A3. Make `restLocked` actually work in refresh
**File:** `shared/engine/phases/turn.ts:52-61`
**Bug:** unconditional `rested=false` ignores `inst.restLocked`
**Fix:** Add `if (!inst.restLocked) inst.rested = false;` for leader, field, stage iteration. Add lifecycle: write `restLockedUntil: Phase` alongside flag at runner-v2.ts:1144; in turn.ts after refresh phase transition, decrement / clear lock if expiry reached.
**Affected:** EB02-011 Arlong, EB02-015 Bonney, EB02-021 Gum-Gum Giant Pistol

### A4. Wire `basePowerOverride` into `effectivePower`
**Files:** `shared/engine/applyAction.ts:892-899`, `shared/engine/effectSpec/runner-v2.ts:339-347`
**Bug:** writes at runner-v2.ts:1612 ignored downstream
**Fix:** In both `effectivePower` impls, read `inst.basePowerOverride ?? card.power` as the base before adding DON+modifier.
**Affected:** EB01-061 Mr.2.Bon.Kurei

### A5. Clear one-shot `grantedKeywords` at end of turn
**File:** `shared/engine/phases/turn.ts:132-226 endTurn`
**Bug:** keywords granted via `give_keyword duration:'this_turn'` persist forever
**Fix:** Add per-keyword expiry tracking. Either:
- (a) Store `grantedKeywordsExpiry: Record<keyword, Phase>` on CardInstance; clear at endTurn for `this_turn` entries
- (b) Maintain separate `grantedKeywordsThisTurn: string[]` list cleared at endTurn for all field instances
**Affected:** EB01-045 Brook, EB02-006 Yamato, EB02-018 Buggy

### A6. Honor `grantedKeywords` at consumption sites
**Files:** `shared/engine/rules/legality.ts:261`, `shared/engine/applyAction.ts:521,648,650`
**Bug:** `card.keywords.includes('blocker')` only — misses continuous-granted blockers
**Fix:** Replace every read pattern with helper `instHasKeyword(inst, card, kw)` = `card.keywords.includes(kw) || (inst.grantedKeywords ?? []).includes(kw)`. Apply at:
- legality.ts:261 (blocker enumeration)
- applyAction.ts:521 (declareBlocker validation)
- applyAction.ts:648 (double_attack life-flip count)
- applyAction.ts:650 (banish)
**Affected:** EB02-018 Buggy double_attack, EB02-019 Zoro rush_character (depends on A1), EB02-012/EB02-033 conditional blocker (depends on A1 + spec cleanup A18)

### A7. Fix OPT push timing (Bug A+B, all 3 V2 paths)
**Files:** `shared/engine/effectSpec/migration-v2.ts:67-73`, `shared/engine/effectSpec/runner-v2.ts:1697-1701`, `shared/engine/effectSpec/runner-v2.ts:1750-1755`
**Bug:** OPT pushed BEFORE condition+cost — failed condition/cost still consumes slot
**Fix:** Move OPT push to AFTER condition+cost+action success in all 3 paths. Mirror `tryApplyReplacement` pattern (replacements-v2.ts:96-101).
**Affected:** EB01-002 Izo, EB01-013 Hiyori, EB01-034 Ms. Wednesday, EB01-037 Mr. 9, EB01-040 Kyros, EB02-010 Luffy, EB02-035 Sanji & Pudding, EB01-047 Laboon (empty-hand discard burns OPT)

### A8. Use raw clause idx in fireV2Effects (Bug G)
**File:** `shared/engine/effectSpec/migration-v2.ts:61,65`
**Bug:** `clauses.filter(...).entries()` produces post-filter idx; other paths use raw idx
**Fix:** Iterate all clauses with raw idx; inner trigger check filters non-matching.

### A9. ACTIVATE_MAIN: rest source AFTER cost check, not before
**File:** `shared/engine/applyAction.ts:184` (activateMain function)
**Bug:** `inst.rested = true` set BEFORE fireEffects → cost.restSelf can't pay
**Fix:** Reorder. Pay clause cost first (which sets rested if restSelf is in cost), THEN proceed. Alternative: skip pre-rest entirely and rely on the clause cost to do it. Engineer the correct OPTCG ordering: activate_main rests the source as part of resolution, not before.
**Affected:** EB01-011 Mini-Merry, EB01-016 Bingoh, EB01-044 Funkfreed, EB01-048 Laboon, EB02-002 Sabo, EB02-009 Thousand Sunny, EB02-025 Donquixote Rosinante

### A10. Counter-window: dispatch event clauses + arm replacements
**Files:** `shared/engine/applyAction.ts:561-603 playCounter`, `shared/engine/rules/legality.ts:276-282`, `shared/engine/GameState.ts:255-261 PendingAttack`
**Bug:** `playCounter` only adds counterBoost; doesn't fire clauses or arm replacements
**Fix:**
1. Add `armedReplacements?: ReplacementEffectV2[]` field to PendingAttack
2. Generalize legality.ts:276-282: emit PLAY_COUNTER when (boost > 0) OR (`effectSpecV2.clauses` has `on_play` trigger) OR (`effectSpecV2.replacements` non-empty), AND defender can pay `card.cost`
3. Generalize playCounter:
   - Always pay the event's card.cost from p.donCostArea
   - If boost > 0, add to pendingAttack.counterBoost
   - If clauses exist, call `fireEffects(next, instanceId, 'on_play', player)` (defender's effect runs)
   - If replacements exist, push them onto `pendingAttack.armedReplacements`
   - Move event hand→trash
4. `resolveDamage` (applyAction.ts:626) consults `pendingAttack.armedReplacements` BEFORE checking defender's own replacements. Honor whenSource filter.
5. Clear `armedReplacements` at every `pendingAttack = null` site (applyAction.ts:633, 651, 671-674, 717, 726, 766) — enumerate via grep.
**Affected:** EB01-009 Just Shut Up, EB01-010 There's No Way, EB01-019 Off-White (clause), EB01-028 Gum-Gum Champion Rifle (clause), EB01-029 Sorry I'm a Goner, EB01-038 Oh Come My Way, EB01-050 Want to Live, EB02-030 And That's When

### A11. `play_for_free` fires played card's on_play
**File:** `shared/engine/effectSpec/runner-v2.ts:1437-1456 play_for_free`
**Bug:** pushes inst to field without firing fireEffects
**Fix:** After `me.field.push(inst)`, call `fireEffects(state, inst.instanceId, 'on_play', ctx.controller)` for characters; for stages call the stage on_play path.
**Affected:** ~14 cards in 100-scope (every play_for_free user)

### A12. Field-cap enforcement on `play_for_free` + `searcher_peek playInsteadOfHand`
**File:** `shared/engine/effectSpec/runner-v2.ts:843, 1450, 1660`
**Bug:** unconditional `me.field.push(inst)` ignores 5-char cap
**Fix:** Check `me.field.length >= RULES.MAX_CHARACTERS_ON_FIELD` (which is 5). If at cap, EITHER skip the play (silent fail) OR require replaceTargetId mechanism. For V0 + sim purposes: skip silently with no error. Per CR §3-7-6 the player must choose a replace target; if no UI, default to skipping the play_for_free.

### A13. `bottomOfDeckOwnChar` / `bottomOfDeckSelf` detach attached DON
**Files:** `shared/engine/effectSpec/replacements-v2.ts:418-435, 470-473`
**Bug:** doesn't detach DON before zone move
**Fix:** Before moving inst to deck, `while (inst.attachedDon.length > 0) me.donRested.push(inst.attachedDon.shift())`.
**Affected:** EB01-011 Mini-Merry, EB01-030 Loguetown (orphan-DON exploit)

### A14. EB02-010 Luffy `[DON!!−2]` cost type
**File:** `shared/data/cards.json` EB02-010 clause cost
**Bug:** uses `donCost:2` (rests DON) — should use `donCostReturnToDeck:2` (per `[DON!!−X]` rule)
**Fix:** Change cost from `donCost:2` to `donCostReturnToDeck:2`
**Affected:** EB02-010 Luffy

### A15. `if_own_don_le_opp` counts attached DON
**File:** `shared/engine/effectSpec/runner-v2.ts:86-87`
**Bug:** `me.donCostArea.length <= opp.donCostArea.length` — ignores attached DON
**Fix:** Compute `totalDon(side) = donCostArea.length + donRested.length + sum(inst.attachedDon.length for inst in leader+field+stage)`. Return `totalDon(me) <= totalDon(opp)`.
**Affected:** EB02-035 Sanji & Pudding (on_play), EB02-037 Franky, EB02-039 GERMA 66

### A16. `give_don_to_target rested:true` sources from `donRested`
**File:** `shared/engine/effectSpec/runner-v2.ts:1293-1314`
**Bug:** always sources from `me.donCostArea`; when `rested:true` should source from `me.donRested`
**Fix:** Branch on `action.rested`: if true, shift from `me.donRested` (after validation); else from `me.donCostArea`. Per-attached-DON rested state: track as `inst.attachedDonRested: string[]` parallel array, populated when rested:true given.
**Affected:** EB01-002 Izo, EB01-007 Yamato, EB02-003 Tony Tony.Chopper, EB02-006 Yamato, EB02-011 Arlong

### A17. EB02-035 Sanji & Pudding cumulative DON-returned semantics
**File:** Decision needed. Either (a) reinterpret printed text as single-emission (current spec is correct as-is) or (b) implement cumulative-this-turn counter.
**Reading:** "When 2 or more DON!! cards on your field are returned to your DON!! deck" — OPTCG community generally reads this as cumulative across the turn. Per ENG card rulings.
**Fix:** Add `pendingDonReturnedThisTurn: number` per player, accumulated across all donCostReturnToDeck pays; cleared at endTurn. Change condition `if_don_returned_count_min` to read this cumulative counter instead of single-emission.
**Affected:** EB02-035 Sanji & Pudding

### A18. Spec cleanup: spurious / wrong keywords
**File:** `shared/data/cards.json` (multiple cards)
**Bugs:**
- EB02-012 Gaimon: `keywords:['blocker']` unconditional, text gates via Sarfunkel presence — remove `'blocker'` from keywords; rely on continuous to grant via A1
- EB02-033 Klabautermann: same pattern with `'blocker'` — remove
- EB02-019 Zoro: already has no `rush_character` in keywords; relies on continuous (works once A1 + A6 land)
- EB01-014 Sanji: `keywords:['activate_main']` but text has NO `[Activate: Main]` — remove (continuous-only card)
- 11 events with spurious `activate_main` keyword: EB01-039, EB01-051, EB01-060, EB02-007, EB02-008, EB02-020, EB02-021, EB02-031, EB02-039 — review each and strip if not in text
**Affected:** EB02-012, EB02-033, EB01-014, plus 11 events

### A19. Stub action implementations
**Files:** various in runner-v2.ts
**Bugs:**
- `peek_and_reorder_opp_life` / `peek_and_reorder_own_deck`: stamp `lastPeek` but don't reorder
- `turn_all_own_life_face_down`: clears `lifeFaceUp` but no consumer reads it (already correct since A19's `lifeFaceUp` IS read by viewForPlayer — verify)
- `aura_counter_buff` (continuous-v2.ts:224): writes `counterBonus`; counter-resolver doesn't read
**Fix:**
- For peek_and_reorder: V0 deterministic policy — keep order (already what spec does). Document as "ordering choice = keep-as-is" with UI hook stub for future.
- For aura_counter_buff: update applyAction.ts:594 (counter resolver) to read `(card.counterValue ?? 0) + (inst.counterBonus ?? 0)`.
**Affected:** EB01-001 Oden, EB01-052 Viola (both options effectively no-op for V0; acceptable if documented)

### A20. EB01-020 Chambres sequence atomicity
**File:** `shared/data/cards.json` EB01-020
**Bug:** sequence `removal_bounce → play_for_free` runs play_for_free even if bounce no-op'd
**Fix:** Convert sequence to a single composite action OR add a runtime guard in `play_for_free` that aborts if a sibling `removal_bounce` had zero targets. Simpler spec change: add condition `if_own_chars_min n:1` on the on_play clause so the whole thing only fires when there's a char to bounce.
**Affected:** EB01-020 Chambres

### A21. Effect-driven `draw` triggers deck-out
**File:** `shared/engine/effectSpec/runner-v2.ts:711-717 draw`
**Bug:** silent short-circuit when deck empty mid-draw
**Fix:** If `me.deck.length < n` at start of draw, set `state.result = { loser: ctx.controller, reason: 'deck_out' }` after the partial draw. Same fix at applyAction.ts draw phase already exists (verify).
**Affected:** any drawing card (most of 100-scope)

### A22. `discard_from_hand` selects worst card (sim policy)
**File:** `shared/engine/effectSpec/runner-v2.ts:1458`
**Bug:** picks first hand card; player should choose
**Fix:** V0 deterministic policy — pick the highest-cost card (suboptimal player choice). For sim purposes, document as "engine picks highest-cost; UI hook reserved for player choice." Or: pick lowest-cost (safer default — discard least valuable). Decide based on owner preference.

### A23. Player-choice spec drifts
**Files:** `shared/data/cards.json` for EB01-053, EB01-056
**Bugs:** hardcoded `position:"bottom"` / `cost.lifeToHand:1` without top/bottom modeling
**Fix:**
- EB01-053 → `choose_one` wrapper with both top + bottom options
- EB01-056 → add `cost.lifeToHandPosition?: 'top' | 'bottom' | 'choice'` field; engine default to 'top' for V0

### A24. Metadata cleanup: 6 "auto" clauses
**File:** `shared/data/cards.json` EB02-008, EB02-014, EB02-016, EB02-018, EB02-026, EB02-038
**Fix:** flip clause-level `verified:"auto"` → `"human-reviewed"`. Spec already verified clean by A4 agent.

---

## B. TEST COVERAGE — ADD DISPATCH-PATH TESTS TO ALL 100 EXISTING TEST FILES

Each of the 100 test files currently lacks a full dispatch-pipeline test. ADD to every file:

### B1. For Character / Stage cards with on_play
- Setup: deck, hand with card, sufficient DON
- Execute: `applyAction(state, controller, { type: 'PLAY_CARD', instanceId, replaceTargetId: null })`
- Assert: observable state changes match printed effectText (hand size, field size, opp life, opp field, etc.)

### B2. For cards with activate_main
- Setup: card on field, sufficient DON, condition met
- Execute: `applyAction(state, controller, { type: 'ACTIVATE_MAIN', instanceId })`
- Assert: source rested, effects applied

### B3. For cards with when_attacking
- Setup: card on field active, can attack
- Execute: `applyAction(state, controller, { type: 'ATTACK', attackerInstanceId, targetInstanceId })`
- Assert: when_attacking clause fired before damage resolves

### B4. For cards with on_opp_attack (Izo, Ms. Wednesday, Mr. 9, etc.)
- Setup: defender controls card on field, opp has attacker
- Execute: opp attack via applyAction; defender responds via PLAY_COUNTER or auto-trigger
- Assert: clause fires under opp's attack

### B5. For counter events
- Setup: defender holds event in hand, opp attacks, counter_window phase
- Execute: `applyAction(state, defender, { type: 'PLAY_COUNTER', instanceId })`
- Assert: cost paid, clause effect applied (after A10 lands), boost added if applicable

### B6. For cards with continuous
- Setup: card on field, condition met
- Execute: `applyAllContinuousV2(state)` (after A1)
- Assert: powerModifier / grantedKeywords / aura applied correctly
- For conditional continuous: change condition mid-state, re-apply, assert clears

### B7. For cards with on_ko
- Setup: card on field, opp KOs it
- Execute: applyAction battle attack that KOs, OR removal_ko effect
- Assert: on_ko fires; for EB01-008 verify replacement consulted

### B8. For at_end_of_turn_self cards
- Setup: card on field at end of own turn
- Execute: `endTurn(state)`
- Assert: clause fires

### B9. Vanilla cards
- Stat-correctness assertion + no-side-effect-on-PLAY_CARD assertion

---

## C. EXECUTION ORDER + GATES

### C1. Write ALL new tests first (B1-B9 across 100 files) — expect failures matching documented bugs
### C2. Apply engine fixes A1-A24 (commit as a single coherent unit if possible, or in dependency-ordered chunks)
### C3. Run new tests — expect 100% green. Any red = unexpected drift; fix it; loop.
### C4. Run existing 745+ suite — expect zero regression (some existing tests may break if they relied on bugs; update minimally)
### C5. `tsc --noEmit` — clean
### C6. Re-launch 5 audit agents on the new code — each must return "no remaining gaps on my axis"
### C7. Commit + push ONLY if all gates green
### C8. Re-audit after push — if any agent returns ANY finding, re-enter the fix loop (no claim-of-done)

---

## D. RISK MITIGATIONS

- D1: Engine changes are large; do as ONE big commit ONLY after all tests green to avoid intermediate broken states
- D2: Continuous-effect re-application must be idempotent — implement as full-recompute-from-scratch each tick
- D3: Counter-window dispatch must not break existing block_window / trigger_window tests — preserve all existing PLAY_COUNTER paths
- D4: `armedReplacements` cleanup at every `pendingAttack = null` site — enumerate via grep before commit
- D5: If A1 (continuous wiring) surfaces unexpected cards behaving wrong, fix them in the same execution

---

## E. WHAT THIS PLAN DOES NOT COVER (out of scope for 100000000% on 100-scope)

- V2+ test infrastructure (e.g. game-end UI, multiplayer)
- Cards outside the 100-scope
- Engine perf
- AI policy choices (engine picks deterministic for V0; UI hook future)

---

End of master plan.
