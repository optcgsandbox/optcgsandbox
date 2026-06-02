# Master Plan v2: 100000000% on 100-scope (EB01-001..EB01-061 + EB02-001..EB02-039)

Absorbs all 30 cert findings (round-1 verification) + the 50+ original audit findings into one document. Every fix cites file:line. Every fix has a test case.

Commit baseline: `a1bc66c` on `main`. Working tree clean.

---

## I. ENGINE STATE-SHAPE CHANGES (foundational; everything else depends on these)

### I1. Split `powerModifier` into continuous + one-shot
- **File:** `shared/engine/GameState.ts:73-80` (CardInstance)
- **Why:** continuous re-application must reset its own contribution without wiping one-shot `power_buff` writes from on_play/when_attacking/activate_main (A2 cert).
- **Fix:**
  - Add `powerModifierOneShot?: number` (persists across continuous ticks; expires per existing `powerModifierExpiresInTurns`)
  - Rename current `powerModifier?: number` → `powerModifierContinuous?: number` (reset+rebuilt every tick)
  - `effectivePower` (applyAction.ts:892, runner-v2.ts:339) sums BOTH fields with `card.power + DON*1000`
  - One-shot `power_buff` (runner-v2.ts:985-1000) writes `powerModifierOneShot`
  - Continuous `self_power_buff` / `aura_power_buff` (continuous-v2.ts:82, 99) write `powerModifierContinuous`

### I2. Split `grantedKeywords` into continuous + one-shot
- **File:** `shared/engine/GameState.ts:110` (CardInstance)
- **Why:** same as I1 but for keywords; A5 cert + Q5 (bounce+replay leaves stale grantedKeywords).
- **Fix:**
  - Add `grantedKeywordsOneShot?: Array<{ keyword: string; until: 'this_turn' | 'permanent' }>`
  - Rename current `grantedKeywords?: string[]` → `grantedKeywordsContinuous?: string[]` (rebuilt per tick)
  - Helper `instHasKeyword(inst, card, kw)`: `card.keywords.includes(kw) || (inst.grantedKeywordsContinuous ?? []).includes(kw) || (inst.grantedKeywordsOneShot ?? []).some(g => g.keyword === kw)`
  - One-shot `give_keyword` (runner-v2.ts:1379) writes to `grantedKeywordsOneShot` with `until` from `action.duration`
  - Continuous `grant_keyword_to_self` / `aura_grant_keyword` (continuous-v2.ts:148-160, 250) write to `grantedKeywordsContinuous`
  - `endTurn` clears `grantedKeywordsOneShot` entries with `until === 'this_turn'`

### I3. `restLocked` → turn-number countdown
- **File:** `shared/engine/GameState.ts:94` (CardInstance)
- **Why:** A1 cert — `Phase` typing doesn't fit "decrement until expiry".
- **Fix:**
  - Replace `restLocked?: boolean` with `restLockedUntilTurn?: number` (absolute turn number; lock active while `state.turn < restLockedUntilTurn`)
  - `rest_lock_until_phase` action (runner-v2.ts:1144-1156) writes `restLockedUntilTurn = state.turn + 1` (locks through opp's next refresh)
  - Refresh phase (turn.ts:52-61): `if (state.turn < (inst.restLockedUntilTurn ?? 0)) skip rested-clear; else inst.rested = false`
  - endTurn cleanup: when `state.turn >= restLockedUntilTurn`, delete the field

### I4. Turn-scoped armed replacements
- **Files:** `shared/engine/GameState.ts:255-261` (PendingAttack + PlayerZones)
- **Why:** A3 cert — EB02-030 says "this turn"; battle-scoped clears too soon.
- **Fix:**
  - New type `ArmedReplacement = { replacement: ReplacementEffectV2; sourceInstanceId: string; controller: PlayerId }`
  - Add `armedReplacementsThisTurn?: ArmedReplacement[]` to PlayerZones (turn-scoped)
  - Add `armedReplacements?: ArmedReplacement[]` to PendingAttack (battle-scoped, redundant with turn-scoped but kept for ordering clarity)
  - `endTurn` clears `armedReplacementsThisTurn` for both players

### I5. Per-attached-DON rested state
- **File:** `shared/engine/GameState.ts` (CardInstance)
- **Why:** A1 cert — `transfer_attached_don` rested-state preservation gap.
- **Fix:**
  - Add `attachedDonRested?: string[]` parallel to `attachedDon`
  - `give_don_to_target` (runner-v2.ts:1293-1314) on `rested:true`: source from `me.donRested`, target's `attachedDonRested.push(donId)`
  - `give_don_to_target` on `rested:false`: source from `me.donCostArea`, target's `attachedDon.push(donId)`
  - `transfer_attached_don` (runner-v2.ts:1535) preserves rested-state across move
  - ALL detach sites must route to correct destination (donRested for ALL detached DON per CR §6-5-5-4)
  - `effectivePower` reads `(attachedDon.length + attachedDonRested.length) * 1000`

### I6. Cumulative DON-returned counter
- **File:** `shared/engine/GameState.ts` (PlayerZones)
- **Why:** A5 cert / Q4 — EB02-035 text is cumulative per-turn.
- **Fix:**
  - Add `donReturnedThisTurn?: number` to PlayerZones; cleared at endTurn AFTER at_end_of_turn_self broadcast
  - `payClauseCost` increments when paying `cost.donCostReturnToDeck > 0`
  - `return_opp_don_to_deck` action (runner-v2.ts:1342) increments OPP's counter
  - `if_don_returned_count_min` condition (runner-v2.ts:185) reads `state.players[controller].donReturnedThisTurn ?? 0`

---

## II. ENGINE BUG FIXES

### II1. `attack_redirect_to_target` field name
- **File:** `shared/engine/effectSpec/runner-v2.ts:1525`
- **Fix:** `state.pendingAttack.targetInstanceId = targets[0]` (was `defenderInstanceId`)

### II2. `set_base_power_copy_from_target` → wire + clear
- **Fix:**
  - `runner-v2.ts:1599-1620`: write `dest.basePowerOverride = effectivePower(state, srcInst)` (text says "the selected Character's POWER" = effective)
  - `applyAction.ts:892` + `runner-v2.ts:339` `effectivePower`: read `(inst.basePowerOverride ?? card.power) + attachedDon*1000 + powerModifierOneShot + powerModifierContinuous`
  - `endTurn` (turn.ts): clear `basePowerOverride` when duration was `this_turn`

### II3. `aura_counter_buff` resolver wire-up
- **Files:** `applyAction.ts:594`, `continuous-v2.ts:224`
- **Fix:** `applyAction.ts:594` reads `(card.counterValue ?? 0) + (inst.counterBonus ?? 0)`
- **Note:** `counterBonus` must be in II21's reset list

### II4. Counter-window general dispatch (closes 7 of 8 broken counter events)
- **Files:** `applyAction.ts:561-603 playCounter`, `rules/legality.ts:276-282`
- **Fix:**
  - `legality.ts:276-282`: emit PLAY_COUNTER if `(counterEventBoost > 0) || (effectSpecV2.clauses has on_play trigger) || (effectSpecV2.replacements non-empty)`, AND defender can pay `card.cost`
  - `playCounter`:
    1. Always pay `card.cost` from `p.donCostArea`
    2. If `counterEventBoost > 0`: add to `pendingAttack.counterBoost`
    3. Move event hand→trash FIRST (so fireV2Effects sees post-trash state but event inst still exists in `state.instances`)
    4. If clauses with `on_play` exist: call `fireV2Effects(next, instanceId, 'on_play', player)` directly (zone-agnostic)
    5. If `replacements` exist: build ArmedReplacement entries; push to BOTH `state.players[player].armedReplacementsThisTurn` AND `state.pendingAttack.armedReplacements`

### II5. `resolveDamage` consults armed replacements (LIFO)
- **File:** `applyAction.ts:626-676 resolveDamage`
- **Fix:** Before checking defender's own replacements, build merged LIFO list:
  ```
  merged = [
    ...(pendingAttack.armedReplacements ?? []).reverse(),
    ...(players[defenderCtrl].armedReplacementsThisTurn ?? []).reverse(),
    ...(defenderCard.effectSpecV2?.replacements ?? [])
  ]
  ```
- Pass to `tryApplyReplacement` with `source: 'battle'`. First whenSource-matching entry wins.
- On `replaced: true`, skip KO + skip `on_any_char_ko` broadcast (per CR §8-1-3-4 the KO didn't happen)

### II6. Cleanup at every `pendingAttack = null` site
- **File:** `applyAction.ts`
- **Sites (verified):** lines 633, 671, 726, 766, 807 (flipLifeCards), 816 (life flip completion)
- **Fix:** before each null-assignment, defensively clear `next.pendingAttack.armedReplacements = undefined` (GC handles object death, but explicit aids future readers)
- **Note:** `armedReplacementsThisTurn` (PlayerZones) is NOT cleared here — only at endTurn

### II7. ACTIVATE_MAIN cost-order fix
- **File:** `applyAction.ts:184 activateMain`
- **Fix:** Remove the pre-fire `inst.rested = true` at line 184. Let `cost.restSelf` rest the source via `payClauseCost`. For cards with activate_main but no `cost.restSelf`, add a POST-fire rest step (after `fireEffects` returns successfully).
- **Affected:** EB01-011, EB01-016, EB01-044, EB01-048, EB02-002, EB02-009, EB02-025 (7 cards)

### II8. OPT push AFTER success (Bug A+B)
- **Files:** `migration-v2.ts:67-73`, `runner-v2.ts:1697-1701`, `runner-v2.ts:1750-1755`
- **Fix:** Move `inst.perTurn.effectsUsed.push(tag)` to AFTER condition+cost+action success. Mirror `tryApplyReplacement` at replacements-v2.ts:96-101.

### II9. `fireV2Effects` raw idx (Bug G)
- **File:** `migration-v2.ts:61, 65`
- **Fix:** Iterate ALL clauses with raw idx; inner trigger check filters non-matching.

### II10. `play_for_free` fires played card's `on_play`
- **File:** `runner-v2.ts:1437-1456`
- **Fix:** After `me.field.push(inst)` for characters, call `fireV2Effects(state, inst.instanceId, 'on_play', ctx.controller)`. Stages: same on stage-on-play path.
- **Affected:** ~14 cards in 100-scope

### II11. Field-cap enforcement
- **Files:** `runner-v2.ts:843` (searcher_peek playInsteadOfHand), `runner-v2.ts:1450` (play_for_free), `runner-v2.ts:1664` (reveal_top_and_conditional_play)
- **Fix:** Before push, check `me.field.length >= 5` (RULES.MAX_CHARACTERS_ON_FIELD). If at cap, skip play silently (V0 — no UI for replace-target choice).

### II12. Bottom-of-deck costs detach DON
- **Files:** `replacements-v2.ts:418-435 bottomOfDeckSelf`, `replacements-v2.ts:470-473 bottomOfDeckOwnChar`
- **Fix:** Before moving inst to deck:
  ```
  while (inst.attachedDon.length > 0) me.donRested.push(inst.attachedDon.shift());
  while ((inst.attachedDonRested ?? []).length > 0) me.donRested.push(inst.attachedDonRested.shift());
  ```

### II13. Effect-driven `draw` triggers deck-out
- **File:** `runner-v2.ts:711-717 draw`
- **Fix:** If `n > me.deck.length`, set `state.result = { loser: ctx.controller, reason: 'deck_out' }` after partial draw.

### II14. `if_own_don_le_opp` counts attached DON
- **File:** `runner-v2.ts:86-87`
- **Fix:** `totalDon(side) = donCostArea.length + donRested.length + sum((inst.attachedDon.length ?? 0) + (inst.attachedDonRested.length ?? 0) for leader+field+stage)`. Compare totals.

### II15. EB01-020 Chambres sequence atomicity
- **File:** `shared/data/cards.json` EB01-020 spec
- **Fix:** Add clause-level condition `if_own_chars_min n:1` so play_for_free sub-action only fires when there's a char to bounce. (Plan v1 already had this.)

### II16. `discard_from_hand` V0 deterministic policy
- **File:** `runner-v2.ts:1458`
- **Fix:** Pick the HIGHEST-cost card in hand (least useful for current turn). Document V0 policy.

### II17. `choose_one` V0 deterministic policy (already correct — document)
- **File:** `runner-v2.ts:1637-1647`
- **Fix:** Picks options[0]. Document explicitly; UI hook reserved.

### II18. Stub action documentation
- `peek_and_reorder_*` (runner-v2.ts:803-828): V0 = keep current deck order (legal "any order" choice). Already correct semantically; document.
- `turn_all_own_life_face_down` (runner-v2.ts:798): clears `me.lifeFaceUp = {}`. Add `lifeFaceUp` to `viewForPlayer` redaction logic so face-up state IS visible to UI.

### II19. `bottom_of_deck_from_hand` V0 deterministic policy
- **File:** `runner-v2.ts:906`
- **Fix:** Pick the HIGHEST-cost N hand cards. Document.

### II20. Trash-iteration order standardization
- **Files:** `runner-v2.ts:929 recursion`, `runner-v2.ts:1418-1432 play_for_free from:trash`
- **Fix:** Both NEWEST-first (player intuition: most recently trashed = most salient).

### II21. Continuous effects production wiring (BIG)
- **Design:** Add `applyAllContinuousV2(state): GameState` in `continuous-v2.ts`:
  1. For every instance (leader+field+stage both sides), RESET all continuous-mirrored fields: `powerModifierContinuous=0`, `grantedKeywordsContinuous=[]`, `counterBonus=0`, `costModifier=0` (continuous-driven part), `basePowerOverride=undefined` (if continuous-only), `immunity=undefined`, `attackLocked=undefined`, `damageImmunityAttribute=undefined`. Preserve `powerModifierOneShot`, `grantedKeywordsOneShot`, `restLockedUntilTurn`.
  2. Iterate all such instances; for each, call `applyContinuousEffectsV2ToInstance` to re-apply.
  3. Return state.
- **Call-site enumeration (after each state-mutating action that could change continuous-eligible state):**
  - `applyAction.ts:201` (post-ACTIVATE_MAIN)
  - `applyAction.ts:358` (post-event-PLAY_CARD)
  - `applyAction.ts:371` (post-character-PLAY_CARD)
  - `applyAction.ts:426` (post-PLAY_STAGE)
  - `applyAction.ts:495` (post-when_attacking fire)
  - `applyAction.ts:534` (post-DECLARE_BLOCKER)
  - `applyAction.ts:603` (post-playCounter, after II4)
  - `applyAction.ts:712` (post-on_any_char_ko broadcast)
  - `applyAction.ts:728` (post-resolveDamage end)
  - `runner-v2.ts:1187` (post-removal_ko)
  - `runner-v2.ts:1283` (post-removal_bounce)
  - `runner-v2.ts:1311` (post-give_don_to_target)
  - `runner-v2.ts:1343` (post-return_opp_don_to_deck)
  - `runner-v2.ts:1391` (post-give_keyword)
  - `runner-v2.ts:1456` (post-play_for_free)
  - `runner-v2.ts:1535` (post-transfer_attached_don)
  - `runner-v2.ts:1647` (post-choose_one resolution)
  - `turn.ts:38` (post-refresh)
  - `turn.ts:65` (post-draw)
  - `turn.ts:85` (post-don)
  - `turn.ts:215` (post-pendingEndOfTurn drain)
- **CRITICAL:** `effectivePower` does NOT call `applyAllContinuousV2`. It stays pure. Callers refresh before reading.

### II22. Granted-keyword consumption sites use helper
- **Files:** `legality.ts:212` (rush check), `legality.ts:233` (rush_character), `legality.ts:261` (blocker), `applyAction.ts:521` (blocker), `applyAction.ts:648` (double_attack), `applyAction.ts:650` (banish)
- **Fix:** Replace every `card.keywords.includes(kw)` with `instHasKeyword(inst, card, kw)` (from I2).

### II23. Bounce clears stale instance flags
- **File:** `runner-v2.ts:1253-1283 removal_bounce`
- **Fix:** On the bounced inst, reset:
  - `powerModifierOneShot = 0`, `powerModifierContinuous = 0`, `powerModifierExpiresInTurns = undefined`
  - `grantedKeywordsOneShot = []`, `grantedKeywordsContinuous = []`
  - `basePowerOverride = undefined`
  - `restLockedUntilTurn = undefined`
  - `lastBouncedColors = undefined`
  - `counterBonus = 0`
  - `attachedDonRested = []` (DON already drained to donRested via existing logic)
  - `costModifier = 0`
- **Preserve:** `summoningSick = false`, `rested = false`, `attachedDon = []` (already handled by existing code).

### II24. Turn-player-first broadcast ordering
- **File:** `runner-v2.ts:1717-1724 broadcastTriggerToBothFields`
- **Fix:**
  ```
  state = broadcastTriggerToOwnField(state, trigger, state.activePlayer);
  state = broadcastTriggerToOwnField(state, trigger, OTHER[state.activePlayer]);
  ```
  (was `'A'` then `'B'`)

### II25. endTurn ordering
- **File:** `turn.ts:132-226 endTurn`
- **Fix:** Reorder so triggers see end-of-turn state BEFORE cleanup:
  1. Push `TURN_ENDED` event (already line 193)
  2. publishTrigger at_end_of_turn_self + at_end_of_turn (already 196-197)
  3. Drain `pendingEndOfTurn` (already 203-217)
  4. broadcastTriggerToOwnField at_end_of_turn_self (already 218)
  5. broadcastTriggerToBothFields at_end_of_turn (already 221)
  6. **(MOVED LATER)** Clear `nextPlayCostModifier`, prune `lifeFaceUp` orphans (was lines 180-191; move below)
  7. **(NEW)** Clear `grantedKeywordsOneShot[*].until === 'this_turn'` on all field instances both sides
  8. **(NEW)** Clear `basePowerOverride` (when duration was this_turn)
  9. **(NEW)** Clear `armedReplacementsThisTurn` on both players
  10. **(NEW)** Clear `donReturnedThisTurn` on both players
  11. tickPower (decrement `powerModifierExpiresInTurns`, clear when 0)
  12. Clear all `perTurn.effectsUsed` for active player's field+leader+stage (already at 137-148; KEEP at end)
  13. Flip `activePlayer` (already 205)

### II26. EB02-010 Luffy cost type
- **File:** `shared/data/cards.json` EB02-010
- **Fix:** Change clause cost from `donCost:2` → `donCostReturnToDeck:2` (per CR §10-2-10 `[DON!!−X]` returns to deck).

### II27. EB01-019 + EB01-028 redundant clause removal
- **File:** `shared/data/cards.json`
- **Fix:** Remove the `power_buff this_battle` clause from EB01-019 + EB01-028. The `counterEventBoost` field IS the boost mechanism (applied in II4 via hardcoded `pendingAttack.counterBoost += boost`). Keep their OTHER clauses (searcher_peek for 019, removal_bounce for 028) — those fire via fireV2Effects in II4.

---

## III. CARD SPEC FIXES

### III1. EB01-053 Gastino → `choose_one`
- Wrap clause action in `choose_one` with two `add_to_opp_life_top` options (top + bottom). V0 picks options[0].

### III2. EB01-056 Flampe → `cost.lifeToHandPosition`
- **Files:** `shared/data/cards.json` EB01-056, `shared/engine/effectSpec/types-v2.ts EffectCostV2`, `shared/engine/effectSpec/replacements-v2.ts:437` (payCost lifeToHand)
- Add field `lifeToHandPosition?: 'top' | 'bottom'`; payCost reads it; default 'top'.

### III3. 6 "auto" clauses → human-reviewed
- EB02-008, EB02-014, EB02-016, EB02-018, EB02-026, EB02-038 — flip clause-level `verified:"auto"` → `"human-reviewed"`. Spec verified clean.

### III4. Spurious keyword strips
- EB01-014 Sanji: remove `'activate_main'` (text has no [Activate: Main])
- EB01-045 Brook: remove `'rush'` (rush is conditional via on_play give_keyword)
- EB02-006 Yamato: remove `'rush'` (rush conditional via activate_main give_keyword)
- EB02-012 Gaimon: remove `'blocker'` (blocker conditional via continuous on Sarfunkel)
- EB02-018 Buggy: remove `'double_attack'` (DA granted to LEADER per text, not Buggy)
- EB02-019 Zoro: remove `'rush'` (rush_character via continuous)
- EB02-033 Klabautermann: remove `'blocker'` (conditional via continuous on Merry Go)
- 9 counter events with spurious `'activate_main'`: review each + strip — EB01-039, EB01-051, EB01-060, EB02-007, EB02-008, EB02-020, EB02-021, EB02-031, EB02-039

---

## IV. TEST COVERAGE — ALL 100 EXISTING TEST FILES

For each of the 100 existing test files in `shared/engine/__tests__/cards/`, ADD dispatch-pipeline test cases per card category:

- **B1** Characters with on_play: PLAY_CARD via `applyAction`, assert observable state matches text
- **B2** activate_main cards: ACTIVATE_MAIN
- **B3** when_attacking cards: ATTACK from controller's side
- **B4** on_opp_attack cards: opp ATTACK, assert defender's clause fires (via broadcast)
- **B5** Counter events: PLAY_COUNTER (after II4 wired); assert cost paid + clause effect + boost (if any)
- **B6** Continuous-bearing cards: place on field, set conditions, call `applyAllContinuousV2`, assert continuous applied + downstream consumed (e.g., blocker eligible, power buffed); flip condition, re-apply, assert removed
- **B7** on_ko cards: KO via battle and via removal_ko effect; assert on_ko fires both paths
- **B8** at_end_of_turn_self: endTurn, assert fires
- **B9** Vanillas: PLAY_CARD, assert stat correctness + no side-effect

Plus 30+ bug-regression test cases covering the new fixes:
- OPT-not-consumed-on-condition-false (5 cards)
- OPT-not-consumed-on-cost-unpayable (6 cards)
- restLocked survives refresh, expires correctly
- basePowerOverride wired through effectivePower
- aura_counter_buff increases counterValue
- counter-window dispatches clauses for null-boost events
- armedReplacements turn-scoped (EB02-030 across multiple attacks)
- play_for_free fires sub-on_play
- field-cap on play_for_free
- bottomOfDeck detaches DON
- effect-driven draw deck-out
- if_own_don_le_opp counts attached
- give_don_to_target sources from donRested when rested:true
- bounce clears stale flags
- turn-player-first broadcast order
- endTurn ordering: at_end_of_turn_self sees pre-cleanup state
- continuous re-application doesn't wipe one-shot
- granted-keyword honored at all consumption sites

---

## V. EXECUTION ORDER + GATES

1. **V1** Write all new tests first (Section IV) → run → expect documented bug failures.
2. **V2** Apply Section I (state shape) as ONE coherent change.
3. **V3** Apply Section II in dependency order: II21 (continuous wiring) BEFORE II22 (consumer reads); II4 BEFORE II5 (counter dispatch before resolveDamage consult); II23 BEFORE II25 (bounce clear before endTurn ordering).
4. **V4** Apply Section III (JSON edits).
5. **V5** Run all new tests → expect 100% green. Any red surfaces new drift; fix in-place; loop.
6. **V6** Run existing 745+ suite → zero regression. Update minimally if existing tests depended on a bug.
7. **V7** `tsc --noEmit` → clean.
8. **V8** Re-launch 5 cert agents fed v2 plan + new code state. Each MUST return CLOSED.
9. **V9** Commit + push ONLY if all gates green.
10. **V10** Re-audit after push — if ANY agent returns ANY finding, re-enter fix loop. No claim-of-done until clean.

---

## VI. CR ORDERING POLICY (DOCUMENTED)

- Multi-armed replacements: LIFO (last-played first per CR §10-3). Defender chooses first whenSource-matching entry. V0 deterministic = first LIFO match.
- Simultaneous broadcasts on both sides: turn-player first per CR §10-1-5.
- at_end_of_turn ordering: triggers fire BEFORE per-turn cleanup so they see end-of-turn state.
- Continuous re-application: every state-mutating action recomputes continuous before next pure read.
- DON detachment on host leave: ALL detached DON returns to `donRested` per CR §6-5-5-4 regardless of prior active/rested state (rested status is reset by detach).

---

## VII. WHAT THIS PLAN EXPLICITLY DEFERS

- AI/UI choice for player decisions (V0 deterministic across the board)
- Cards outside the 100-scope
- Engine perf
- Multi-counter chain interactions beyond LIFO ordering policy
- Game-end states beyond deck-out

---

End of v2 master plan.
