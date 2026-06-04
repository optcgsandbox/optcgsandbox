# BUGS_FOUND — Phase 4 + 5 per-card audit log

Append-only log of spec / engine gaps surfaced during the per-card and cross-card audits.

**Format per entry:**
- Card ID (+ name) that surfaced the gap
- Date surfaced
- Gap class (spec gap / engine gap / handler missing / wrong magnitude / etc.)
- Printed text
- Actual spec / engine implementation file:line
- Cross-card impact (how many other cards use the same primitive — `python3 -c '...'` against cards.json)
- Action: **spec gaps may be fixed during audit; engine gaps are LOGGED ONLY** and queued for the post-audit engine-fix pass.

---

## EB01-001 — Kouzuki Oden (leader)

**Surfaced:** 2026-06-02 during Phase 4 audit (card #1).

### Spec gap (FIXED in cards.json during audit)
- **Printed:** "All of your {Land of Wano} type Character cards **without a Counter** have a +1000 Counter, according to the rules."
- **Spec at `shared/data/cards.json` EB01-001 `effectSpecV2.continuous[0].action.filter`:** originally `{ trait: 'Land of Wano', kind: 'character' }`.
- **Missing:** the "without a Counter" restriction (counter chip = 0/null).
- **Fix applied to cards.json:** added `counterValueMax: 0` to the filter. New filter: `{ trait: 'Land of Wano', kind: 'character', counterValueMax: 0 }`.

### Engine gap (LOGGED, NOT FIXED)
- **Required:** `CardFilter` (`shared/engine-v2/registry/handlers/filter.ts:17-44`) needs `counterValueMin` / `counterValueMax` fields + matching logic in `matchesCardFilter`.
- **Current state:** no such fields. The spec edit above is INERT until the engine learns to honor it.
- **Engine workaround currently in place:** the `auraCounterBuff` handler at `shared/engine-v2/registry/handlers/continuous.ts:315-333` has an intrinsic check that skips targets where `card.counterValue > 0`. This compensates for the missing filter support, so EB01-001 actually plays correctly today.
- **Why this is a gap anyway:** the engine intrinsic is a shortcut — printed restrictions belong in the spec's filter. Future cards using `aura_counter_buff` for OTHER restrictions (or other handlers using counter filters) would need the proper filter support.
- **Cross-card impact:** only 1 card uses `aura_counter_buff` today (EB01-001 itself, confirmed via python3 against cards.json earlier this session). Engine fix is low-risk but waits until the post-audit pass per protocol.

### Audit verdict
- **EB01-001 plays correctly in the live app** because the handler intrinsic compensates for the missing filter support.
- **Spec is now correct** (counterValueMax: 0 added).
- **Engine fix queued** for post-audit pass (add `counterValueMin`/`counterValueMax` to `CardFilter`).

---

## EB01-002 — Izo (character)

**Surfaced:** 2026-06-02 during Phase 4 audit (card #2).

### Engine gap (LOGGED, NOT FIXED)
- **Required:** target resolver for `opp_leader_or_character` (and the wider class of `*_or_character` resolvers) should support PLAYER CHOICE among the candidates via PendingTargetPick — per printed "give up to 1 of your opponent's Leader or Character cards" the active player picks the target.
- **Current state:** the V2 resolver at `shared/engine-v2/registry/handlers/targets.ts:193` (and sibling `your_leader_or_character` at line 191) is a V0 deterministic implementation — picks the leader first when both leader and characters qualify. Other deterministic-V0 resolvers exist in V2 with the same pattern (`opp_character`, `your_character`, etc.). Active player gets no choice.
- **Cross-card impact:** every card using `opp_leader_or_character`, `your_leader_or_character`, and similar choose-among-many target kinds. Need full count when the post-audit pass runs.
- **Workaround in tests:** assert the debuff landed on EITHER the leader OR opp char (the union), not on a specific index. Tests document V2's actual deterministic behavior.

### Spec verification
- All 7 primitives confirmed registered for EB01-002 (on_play / on_opp_attack triggers, give_don_to_target / power_buff actions, if_leader_has_trait condition, discardHand cost, your_leader_or_character / opp_leader_or_character targets).
- Spec accurately encodes printed text — clause 1 give-DON-to-friendly, clause 2 OPT trash-1 + Wano/Whitebeard OR + opp-leader-or-char -2000 power this_turn.
- No spec gap found.

### Audit verdict
- EB01-002 plays correctly today; the only deviation from printed text is the deterministic V0 target choice (always picks leader).
- Engine fix queued for post-audit pass (PendingTargetPick wiring for player choice).

---

## EB01-004 — Koza (character)

**Surfaced:** 2026-06-02 during Phase 4 audit (card #3 in cards.json zero-index, card #4 in 1-based count).

### Engine gap (LOGGED, NOT FIXED)
- **Required:** the `selfPowerCost` cost handler must apply a `this_turn` power debuff to the controller's leader equal to the cost magnitude. Per printed "give your 1 active Leader −5000 power during this turn: Give up to 1 of your opponent's Characters −3000 power during this turn" — paying the cost means the leader has -5000 power for the rest of this turn.
- **Current state:** `selfPowerCost` at `shared/engine-v2/registry/handlers/costs2.ts:428-435` is a V0 no-op — `canPay()` returns true unconditionally, `pay()` returns state unchanged. No leader debuff is applied.
- **Cross-card impact:** every card using `selfPowerCost` as a cost. Need full count when the post-audit pass runs.
- **Engine fix shape:** in `pay`, read the cost magnitude, write `controller.leader.powerModifierOneShot -= magnitude` and set `powerModifierExpiresInTurns = 0` (this_turn). canPay should also check the controller has an active leader (always true in OPTCG since each side has exactly 1 leader, but worth enforcing for clarity).

### Spec verification
- 5-axis check on EB01-004 spec: trigger `when_attacking` ✓, cost `selfPowerCost: 5000` ✓, action `power_buff -3000 this_turn` ✓, target `opp_character` ✓.
- Spec accurately encodes printed text. No spec gap.

### Audit verdict
- EB01-004 partially plays today: the -3000 opp char debuff fires correctly when there's an opp char target.
- The leader -5000 cost is NOT applied (V0 no-op). This is a real card-playability gap — opponent effectively gets the -3000 debuff for free.
- Engine fix queued for post-audit pass.

---

## EB01-009 — Just Shut Up and Come with Us!!!! (event)

**Surfaced:** 2026-06-02 during Phase 4 audit (card #9).

### Engine gap A (LOGGED): searcher_peek leftover placement
- **Required:** per printed "place the rest at the bottom of your deck in any order", un-picked top-5 cards go to the BOTTOM of the deck.
- **Current state:** `searcher_peek` handler at `shared/engine-v2/registry/handlers/actions3.ts:728-731` places leftover via `pl.deck.unshift(leftover[i]!)` — that's TOP placement, not BOTTOM.
- **Cross-card impact:** every card with action.kind `searcher_peek`. Per earlier python3 count this session, ~182 cards use searcher_peek.
- **Engine fix shape:** swap `pl.deck.unshift` for `pl.deck.push` to place leftovers at bottom in original order. Or replace with `pl.deck.push(...leftover)` for simplicity.

### Engine gap B (LOGGED): legality of effect-only counter events
- **Required:** per printed "[Counter] Look at 5 cards from the top of your deck..." the event is playable during counter_window. Printed [Counter] tag = counter-window playable, regardless of whether the event grants a power boost.
- **Current state:** `shared/engine-v2/rules/legality.ts:277-281` enumerates PLAY_COUNTER only for events where `counterEventBoost > 0`. EB01-009 has `counterEventBoost: null` → not enumerated → cannot be played in counter_window. In main phase: `legality.ts:190-194` correctly excludes `[Counter]` events. Net: EB01-009 cannot be played at all.
- **Cross-card impact:** every [Counter] event whose printed effect is non-boost (the effect happens at play, no +N power). Need to count when post-audit pass runs.
- **Engine fix shape:** in `counterActions`, also enumerate events whose `effectText.startsWith('[Counter]')` even when boost is 0 — they're playable for their effect.

### Spec verification
- 5-axis check on EB01-009 spec: trigger on_play / action searcher_peek with lookCount:5 addCount:1 filter{trait:Animal, costMax:3, kind:character} playInsteadOfHand:true.
- Spec faithfully encodes the search-and-play half. No spec gap.
- Spec does NOT encode the bottom-of-deck-leftover semantic explicitly — that's an action-handler-level behavior. Same applies to the [Counter] keyword which is conveyed by the printed text + legality enumeration.

### Audit verdict
- EB01-009 is NOT playable in counter_window today (Engine Gap B). It can also not be played in main phase. The card is currently unplayable.
- Even if played (via direct dispatch), the leftover-to-bottom semantic is not honored (Engine Gap A).
- Both engine fixes queued for post-audit pass.

---

## EB01-010 — There's No Way You Could Defeat Me!! (counter event)

**Surfaced:** 2026-06-02 during Phase 4 audit (card #10).

### Engine gap — re-reference EB01-009 Engine Gap B
- Same root cause: effect-only [Counter] event with no `counterEventBoost` not enumerated in `counterActions` at `legality.ts:277-281`. EB01-010 is unplayable today.

### Spec verification
- 5-axis: clause on_play / removal_ko / target opp_character filter basePowerMax:6000.
- Spec accurately encodes printed text.

### Audit verdict
- Card not playable in counter_window per legality gap; if dispatched directly the removal_ko action correctly KOs a base-power-6000-or-less opp char.
- Engine fix queued (with EB01-009).

---

## EB01-013 — Kouzuki Hiyori (character)

**Surfaced:** 2026-06-02 during Phase 4 audit (card #13).

### Engine gap A (LOGGED): play_for_free target resolution
- **Required:** per printed "Play up to 1 {Land of Wano} type Character card with a cost of 5 or less other than [Kouzuki Hiyori] from your hand" — the engine must find matching hand cards based on the filter and play one.
- **Current state:** `play_for_free` handler at `shared/engine-v2/registry/handlers/actions2.ts:209-253` iterates the `targets` parameter — it does NOT internally resolve from controller.hand using `action.filter`. The clause has no target.kind, so targets is empty when dispatched via `sequence`. Net: play_for_free executes with no targets, plays nothing.
- **Cross-card impact:** every card using `play_for_free` inside a `sequence` or as a clause action without a target resolver supplying targets. Per earlier python3 count, ~184 cards use play_for_free.
- **Engine fix shape:** make `play_for_free` read `action.filter` and resolve `controller.hand` matches internally up to `action.count` (with player choice in non-V0). For deterministic V0, pick the first match.

### Spec verification
- 5-axis: clause activate_main / cost trashSelf / action sequence [play_for_free, draw 1] / opt:true.
- Spec accurately encodes printed text; play_for_free filter has {trait, costMax, nameExcludes, kind}. trashSelf cost is correct.
- No spec gap.

### Audit verdict
- EB01-013 partially plays: trashSelf cost works; sequence runs; draw 1 sub-action works.
- play_for_free sub-action is inert (no targets passed). The card effectively only trashes itself + draws — printed "play a Wano cost-5" never happens.
- Engine fix queued.

---

## EB01-014 — Sanji (character)

**Surfaced:** 2026-06-02 during Phase 4 audit (card #14).

### Engine gap (LOGGED): continuous handlers' readMagnitude doesn't resolve formula magnitudes
- **Required:** per printed "This Character gains +1000 power for every 3 of your rested DON!! cards" — magnitude is a `per_count` formula reading `own_rested_don_count` / 3 * 1000.
- **Current state:** `readMagnitude` at `shared/engine-v2/registry/handlers/continuous.ts:55-61` only returns numbers; for object-shaped magnitudes (formulas) it returns 0. The `self_power_buff` continuous handler at `continuous.ts:126-133` calls `readMagnitude(eff.action)` so it ALWAYS adds 0. Sanji gets +0 power regardless of rested DON count.
- **The clause-level dispatcher's `resolveMagnitude`** at `shared/engine-v2/registry/handlers/formula.ts:67-95` DOES handle formulas (literal, match_opp_don, read_state, per_count). The continuous-side `readMagnitude` doesn't share that resolution.
- **Cross-card impact:** every continuous-handler card whose magnitude is a formula. Includes self_power_buff, aura_power_buff, opp_aura_power_buff, aura_counter_buff, aura_cost_modifier, etc. when used with per_count / read_state magnitudes. Need full count when post-audit pass runs.
- **Engine fix shape:** in continuous handlers, swap `readMagnitude(eff.action)` for a formula-aware path that calls `resolveMagnitude(state, ctx, action.magnitude, fallback)` from `formula.ts`. Or: extend `readMagnitude` to dispatch object-shaped magnitudes through `resolveMagnitude`.

### Spec verification
- 5-axis: continuous with condition AND(if_attached_don_min 1, is_own_turn), action self_power_buff with per_count magnitude.
- Spec accurately encodes printed text.

### Audit verdict
- Sanji's [DON!! x1][Your Turn] gate works correctly. But the +1000-per-3-rested-DON computation returns 0 (engine gap). Sanji is effectively a vanilla 5000-power character today.
- Engine fix queued.


---

## EB01-019 — Off-White (event) [re-ref of EB01-009]

**Surfaced:** 2026-06-02 during Phase 4 audit (card #19).

### Engine gap (RE-REF): searcher_peek leftover goes to TOP not BOTTOM
- **Required:** printed "Then, place the rest at the bottom of your deck in any order" — non-picked peeked cards must go to BOTTOM of deck.
- **Current state:** `searcher_peek` at `shared/engine-v2/registry/handlers/actions3.ts:802-804` does `for (let i = leftover.length - 1; i >= 0; i--) pl.deck.unshift(leftover[i])` — unshifts to the TOP. Wrong for Off-White and every other "place the rest on the bottom" searcher.
- **Same gap was logged under EB01-009.** Off-White is a second hit; logging here for blast-radius tracking only.

### Spec verification
- 5-axis: two clauses, both trigger:on_play. Clause 1 = power_buff +4000 this_battle to your_leader_or_character. Clause 2 = searcher_peek lookCount:3 addCount:1 filter {trait:'Donquixote Pirates', kind:'character'}.
- Counter-event legality satisfied: `effectTags: ['counter_event', ...]` + `counterEventBoost: 4000`.
- Spec accurately encodes printed text.

### Audit verdict
- Off-White's +4000 buff + DP-character reveal work today via dispatcher.
- Leftover ordering wrong (top instead of bottom). Engine fix queued.

---

## EB01-020 — Chambres (event)

**Surfaced:** 2026-06-02 during Phase 4 audit (card #20).

### Engine gap (LOGGED): play_for_free in a sequence ignores colorMustDifferFromLastBounced and reuses parent-clause targets
- **Required:** printed "return 1 of your Characters ... and play up to 1 Character card with a cost of 2 or less from your hand that is a different color than the returned Character" — the play_for_free sub-action must (a) iterate the controller's hand and (b) honor `colorMustDifferFromLastBounced:true` plus `costMax:2` against each candidate.
- **Current state:** `play_for_free` at `shared/engine-v2/registry/handlers/actions2.ts:211-265` only iterates `targets` (the array passed in by the parent dispatcher) and the comment at `actions2.ts:208-210` explicitly admits "Filter params (colorMustDifferFromLastBounced, nameMatchesLastDiscarded, uniqueByName) are V0 best-effort — gate via resolved target list". In a `sequence` the parent target was `your_character` (the bounce target). After `removal_bounce` moves that instance into hand, `play_for_free` sees it in hand and replays it — re-introducing the same green character despite the printed "different color" restriction. Net effect: Chambres bounces a character and immediately replays it for free, regardless of color matching.
- **Related to EB01-013** (play_for_free in sequence has no own-zone iteration), but distinct in that EB01-020 specifically depends on the colorMustDifferFromLastBounced filter being applied.
- **Engine fix shape:** play_for_free must (1) when no explicit targets are provided (or when running inside a sequence after removal_bounce), iterate its `from` zone (hand/trash) filtering against the action's own filter object, and (2) honor colorMustDifferFromLastBounced by reading state.history for the most recent `CARD_BOUNCED` event from this resolution and comparing colors.

### Spec verification
- 5-axis: clause on_play, condition if_leader_has_trait Supernovas, action sequence [removal_bounce, play_for_free filter{costMax:2, kind:'character'} colorMustDifferFromLastBounced:true], target your_character.
- Spec accurately encodes printed text.

### Audit verdict
- Condition gate works; removal_bounce fires correctly.
- play_for_free re-plays the bounced character (engine gap). Net behavior of Chambres in app today: free in-place "refresh" of one of your characters, not a tempo swing.
- Engine fix queued.

---

## EB01-021 — Hannyabal (leader) [SPEC FIX APPLIED + engine gap LOGGED]

**Surfaced:** 2026-06-02 during Phase 4 audit (card #21).
**Spec fix re-applied:** 2026-06-02 second-pass audit (Rule 2 strict).

### Spec fix applied (Rule 2)
- **Was:** `cost: { returnSelfChar: { filter:{ trait:'Impel Down', costMin:2 } } }`. The `returnSelfChar` primitive (`costs2.ts:257-282`) bounces the SOURCE instance — but Hannyabal IS the leader source, so the cost can never pay.
- **Now:** `cost: { returnOwnCharFilter: { filter:{ trait:'Impel Down', costMin:2 } } }`. This primitive name correctly encodes printed text "return 1 of your CHARACTERS (selected by filter) — non-self".

### Engine gap (LOGGED): returnOwnCharFilter cost primitive not registered
- **Required:** post spec-fix, the spec now references `returnOwnCharFilter` which would (canPay) iterate `pl.field` for `matchesCardFilter(filter)`, and (pay) require a target pick (PendingTargetPick) for the bounce victim, then move that instance to hand. For V0 deterministic mode pick the first matching instance.
- **Current state:** no `returnOwnCharFilter` handler is registered. `CostPayer.canPay` at `CostPayer.ts:20` throws `RegistryValidationError` when encountering this cost key.
- **Sister primitive that already exists:** `restOwnCharFilter` at `costs2.ts:445` (rest one of your own filtered chars as cost). Same iteration shape; engine just needs the bounce-flavor variant.
- **Engine fix shape:** clone `restOwnCharFilter` to a new `returnOwnCharFilter` handler that, in `pay`, splices the matching field instance into `pl.hand` instead of marking it rested. Register the handler in `costs2.ts` registry block.

### Audit verdict
- Spec is now faithful to printed text.
- Hannyabal's End-of-Turn ability remains a no-op at runtime until the engine adds `returnOwnCharFilter`. He plays as a vanilla 5000-power leader today.

---

## EB01-027 — Mr.1 (Daz.Bonez) [re-ref of EB01-014]

**Surfaced:** 2026-06-02 during Phase 4 audit (card #27).

### Engine gap (RE-REF): continuous handlers' readMagnitude doesn't resolve formula magnitudes
- **Required:** printed "this Character gains +1000 power for every 2 Events in your trash" — magnitude is a `per_count` formula reading `own_trash_event_count` / 2 * 1000.
- **Current state:** same gap as EB01-014. `readMagnitude` at `shared/engine-v2/registry/handlers/continuous.ts:55-61` returns 0 for object-shaped magnitudes. Mr.1's continuous self_power_buff is +0 today.
- **Cross-card impact:** continues to widen the EB01-014 bucket; logged here for blast-radius tracking.

### Spec verification
- 5-axis: continuous condition if_leader_has_type 'Baroque Works', action self_power_buff magnitude{per_count, own_trash_event_count, /2, *1000}. On-play clause sequence [draw 2, discard_from_hand 1] works.
- Spec accurately encodes printed text.

### Audit verdict
- on_play sequence (draw 2 + discard 1) works.
- Continuous +1000-per-2-events buff is 0 (formula magnitude gap). Mr.1 plays as a vanilla 6000-power character.

---

## EB01-028 — Gum-Gum Champion Rifle (event) [SPEC FIX APPLIED]

**Surfaced:** 2026-06-02 during Phase 4 audit (card #28).

### Spec fix applied
- **Was:** `clauses[1].target.filter = { rested: false }`.
- **Now:** `clauses[1].target.filter = { active: true }`.
- **Why:** `shared/engine-v2/registry/handlers/filter.ts:111-113` reads `filter.rested:true` ("must be rested") and `filter.active:true` ("must be active"). `rested:false` is a no-op (the engine never inspects the `false` case). Printed text says "active Characters" → correct expression is `active:true`. Without fix, the engine bounced rested opp chars too. Same pattern lives on OP01-086.clauses[1].target.filter; will be fixed when that card is audited.

### Spec verification (post-fix)
- 5-axis: two on_play clauses both gated by if_leader_has_trait Impel Down. (1) power_buff +2000 this_battle target your_leader_or_character. (2) removal_bounce target opp_character filter{active:true}.
- counter_event legality wired (effectTags + counterEventBoost:2000).

### Audit verdict
- After spec fix: rested opp chars correctly excluded from bounce. Counter event functions as printed when leader has Impel Down.

---

## EB01-029 — Sorry. I'm a Goner. (event) [SPEC FIX APPLIED + engine gap LOGGED]

**Surfaced:** 2026-06-02 during Phase 4 audit (card #29).

### Engine gap (LOGGED): revealMatchesFilter falls back to the action object as filter, polluting kind check
- **Required:** `reveal_top_then_if_cost_min` with `minCost:4` should match a revealed character of cost 4 (per printed "If the revealed card has a cost of 4 or more").
- **Current state:** `revealMatchesFilter` at `shared/engine-v2/registry/handlers/actions3.ts:838-839` does `const filter = (action.filter is object) ? action.filter : action`. When action has no `filter` key it FALLS BACK TO THE ACTION ITSELF — and the action's own `kind:'reveal_top_then_if_cost_min'` is then read as a card-kind filter (line 842: `if (filter['kind'] !== undefined && card.kind !== filter['kind']) return false;`). Card kind is 'character' so check fails → matches=false → thenAction never fires.
- **Engine fix shape:** in `revealMatchesFilter`, never fall back to the action object — when no filter key is present, use an empty filter object `{}` and read action-level fields (minCost, maxCost) directly. Or simply guard the kind check to skip when filter === action.

### Spec fix applied
- **Was:** `action: { kind:'reveal_top_then_if_cost_min', minCost:4, thenAction:{kind:'removal_bounce'} }`.
- **Now:** added `filter: { minCost: 4 }` alongside the existing `minCost:4`. With explicit filter, engine path (line 839) uses filter, not action, so kind check is skipped.

### Spec verification (post-fix)
- 5-axis: clause on_play / action reveal_top_then_if_cost_min filter{minCost:4} minCost:4 thenAction:removal_bounce / target your_character. Matches printed.

### Audit verdict
- After spec fix: cost-4 reveal triggers bounce; cost-3 reveal does not. Logged engine gap for end-of-audit fix.

---

## EB01-031 — Kalifa (character)

**Surfaced:** 2026-06-02 during Phase 4 audit (card #31).

### Engine gaps (LOGGED)
1. **recursion action ignores its own filter and requires targets from outside.** Handler at `shared/engine-v2/registry/handlers/actions2.ts:72-86` only iterates the `targets` arg. Kalifa's spec carries the filter ON THE ACTION (no `clause.target`) so the dispatcher resolves zero targets and recursion does nothing.
2. **`own_trash_card` target resolver returns max 1 regardless of `target.count`.** `targets.ts:148-159` returns on first match. Even if the spec added `target:{kind:'own_trash_card', filter:..., count:2}`, the resolver would yield at most one. Sister resolvers that support count are missing for trash.

### Spec verification
- 5-axis: on_play / if_leader_has_trait Water Seven / donCostReturnToDeck:1 / recursion magnitude:2 filter{costMax:4, kind:'character'}. The `action.filter` and `action.magnitude` semantics match printed text — encoding via `action.filter` (vs `clause.target`) is the spec choice but only works if recursion-handler self-resolves the filter.

### Audit verdict
- Cost and condition wire. Action is a no-op today (no targets passed). Kalifa's printed "add up to 2 Character cards from your trash" never executes.

---

## EB01-033 — Blueno (purple) (character) [re-ref of EB01-013/020]

**Surfaced:** 2026-06-02 during Phase 4 audit (card #33).

### Engine gap (RE-REF): play_for_free requires targets from outside; can't self-iterate `from` zone by filter
- **Required:** printed "play up to 1 {Water Seven} type Character card with a cost of 5 other than [Blueno] from your hand or trash" — the handler should iterate hand+trash filtered by trait+costMin+costMax+nameExcludes+kind.
- **Current state:** `play_for_free` at `actions2.ts:211-265` iterates the `targets` arg only. Kalifa-style structure: spec carries `from:'hand_or_trash'` + `filter:{...}` on the action; no `clause.target`. targets=[] → no play. Same root as EB01-013 (sequence with play_for_free) and EB01-020 (color-must-differ), but here it's a standalone clause.

### Spec verification
- 5-axis: clause on_play / Water Seven gate / donCostReturnToDeck:1 / play_for_free from:'hand_or_trash' filter{Water Seven, costMin:5, costMax:5, nameExcludes:Blueno, kind:character}. Matches printed.

### Audit verdict
- Cost + condition wire; action is a no-op. Engine fix queued (same one that fixes EB01-013 and EB01-020).

---

## EB01-038 — Oh Come My Way ([Counter] event)

**Surfaced:** 2026-06-02 during Phase 4 audit (card #38).

### Engine gap (LOGGED): [Counter] events with counterEventBoost:null are not playable as counters
- **Required:** printed "[Counter] DON!! −1 ...: If your Leader's type includes "Baroque Works", select 1 of your Characters. Change the attack target to the selected Character." is a [Counter] event with no power boost — the counter-payment IS the redirect, not a stat bump.
- **Current state:** `shared/engine-v2/rules/legality.ts:277-281` permits counter play only when `counterEventBoost > 0`. EB01-038 has `counterEventBoost:null` → legality gate refuses to allow it during the counter step. The card cannot enter play during opponent's attack today.
- **Engine fix shape:** the counter-event legality check should permit any event tagged `effectTags:'counter_event'` regardless of `counterEventBoost`. The +power boost is one OF the counter benefits, not a prerequisite for playing the event as a counter.

### Spec verification
- 5-axis: on_play / Baroque Works gate / donCostReturnToDeck:1 / attack_redirect_to_target / your_character.
- Spec is faithful to the action mechanics. The legality concern is parallel (event can't be played as counter today).

### Audit verdict
- Action body (attack redirect) would work IF the card were playable, but it cannot enter the counter step. Engine fix queued.

---

## EB01-043 — Spandine (character) [re-ref of EB01-013/020/033]

**Surfaced:** 2026-06-02 during Phase 4 audit (card #43).

### Engine gap (RE-REF): play_for_free in clause without target ignores action.filter
- Same root cause as EB01-013/020/033. Spec carries filter on action; play_for_free needs targets from outside; clause has no `target`. Cost (`bottomOfDeckFromTrashFilter`) iterates trash with its own filter and works. Action (`play_for_free from:'trash' filter{typeIncludes:CP, costMax:4, nameExcludes:Spandine, kind:character} rested:true`) is a no-op.

### Audit verdict
- Cost works; action no-ops. Engine fix queued.

---

## EB01-046 — Brook (Straw Hat) (character)

**Surfaced:** 2026-06-02 during Phase 4 audit (card #46).

### Engine gap (LOGGED): sequence handler ignores sub-action target fields
- **Required:** printed "[On Play] Give up to 1 of your opponent's Characters −1 cost during this turn. Then, K.O. up to 1 of your opponent's Characters with a cost of 0." — the two sub-actions naturally have DIFFERENT target filters (any opp char vs cost-0 opp char). The spec correctly encodes each sub-action with its own `target: {kind:'opp_character', filter:{...}}` field.
- **Current state:** `sequence` handler at `shared/engine-v2/registry/handlers/actions2.ts:55-66` does `next = handler(next, ctx, sub, targets)` — passing the PARENT clause's targets to each sub-action. The sub-action's own `target` field is not read. EB01-046's parent clause has NO `target`, so each sub-action receives an empty target array. Both removal_cost_reduce and removal_ko silently no-op.
- **Engine fix shape:** the sequence handler should, for each sub-action carrying a `target` field, call the appropriate resolver (`targetResolvers.get(sub.target.kind)`) to compute per-sub-action targets, then pass those instead of the parent targets. Fall back to parent targets when sub-action has no `target`.

### Spec verification
- 5-axis: two clauses (on_play + when_attacking), each = sequence [removal_cost_reduce -1 this_turn target opp_character, removal_ko target opp_character costMax:0]. Matches printed text.

### Audit verdict
- Both removal sub-actions no-op today. Brook fires no effect on either trigger.
- Engine fix queued.

---

## EB01-053 — Gastino (character) [SPEC FIX APPLIED]

**Surfaced:** 2026-06-02 during Phase 4 audit (card #53).

### Spec fix applied
- **Was:** `action: { kind: 'add_to_opp_life_top', faceUp: true, position: 'bottom' }` with no `from` field.
- **Now:** added `from: 'target'`.
- **Why:** `shared/engine-v2/registry/handlers/actions3.ts:143-179` defaults `from` to `'top_of_deck'` (line 145). Gastino's printed text "Place up to 1 of your opponent's Characters ... at the top or bottom of your opponent's Life cards" sources from a target — not from opp's deck. The handler picks the target only when `from !== 'top_of_deck'` (any other value triggers `targets.length > 0` branch). Without `from`, the spec silently misfired (drained opp deck into opp life rather than placing the targeted char).
- **Sister cards with same defect:** EB02-057 (`add_to_opp_life_top faceUp:true`) and OP04-097 (`add_to_opp_life_top faceUp:true position:top`) — fix when audited.

### Spec verification (post-fix)
- 5-axis: on_play / add_to_opp_life_top faceUp:true position:bottom from:'target' / target opp_character costMax:3.

### Audit verdict
- After fix: targeted cost-≤3 opp char correctly transitions from B.field → B.life.

---

## EB01-059 + EB01-060 — trash_own_life_until semantic mismatch

**Surfaced:** 2026-06-02 during Phase 4 audit (cards #59, #60).

### Engine gap (LOGGED): trash_own_life_until handler reads `n` as count-to-trash; printed text wants target-remaining
- **Required (printed):** EB01-059 "trash cards from the top of your Life cards until you have 1 Life card." Same on EB01-060. With spec `n:1` the intended semantic is "leave 1 life remaining". Trimming 4 life down to 1 = trash 3 from top.
- **Current state:** `shared/engine-v2/registry/handlers/actions3.ts:208-221` interprets `n` as the COUNT of cards to trash from the top. Handler name `trash_own_life_until` is misleading. Inline comment at lines 209-212 acknowledges a previous wrong-direction interpretation (trimmed to zero) but the corrected semantic ("trash N") still contradicts the printed text for these two cards.
- **Engine fix shape:** either (a) split into two actions — `trash_own_life_count` (current behavior) and `trash_own_life_until_remaining` (new, trims to remaining N); (b) read a sentinel field on the action (`mode:'until_remaining'` vs `mode:'count'`); or (c) match printed semantic everywhere (count-down to remaining N). Sister cards: only two known (EB01-059, EB01-060) — narrow blast radius for now but check incoming sets.

### Spec verification
- 5-axis (both cards): two on_play clauses each — first does the printed action (KO or play_for_free), second is `trash_own_life_until n:1`. Spec is faithful to printed text IF "n" is read as target-remaining. Under current engine semantics it under-trashes.

### Audit verdict
- Each card's second clause off-by-target today. The KO half of EB01-059 fires; the play_for_free half of EB01-060 is blocked by the previously-logged play_for_free no-target gap.

---

## EB02-041 — Merry Go (stage) [SPEC FIX APPLIED]

**Surfaced:** 2026-06-02 during Phase 4 audit (card #102).

### Spec fix applied
- **Was:** `action: { kind:'removal_cost_reduce', magnitude:-2, duration:'opp_next_turn' }` (verified:'flagged' + existing auditNote).
- **Now:** `action: { kind:'give_cost_buff', magnitude:2, duration:'opp_next_turn' }`.
- **Why:** `removal_cost_reduce` handler at `shared/engine-v2/registry/handlers/actions3.ts:397-411` clamps the magnitude to negative via `-Math.abs(raw)` — so `magnitude:-2` resolves to a cost decrease of -2. Printed text says "gains +2 cost", which requires cost INCREASE. `give_cost_buff` at `actions3.ts:369-379` applies the literal positive magnitude. Existing auditNote in spec already flagged this needed `give_cost_buff +2`.

### Spec verification (post-fix)
- 5-axis: clause 2 = activate_main / if_own_don_le_opp / restSelf / give_cost_buff magnitude:2 duration:opp_next_turn / your_character SH.

### Audit verdict
- Behavior now matches printed text. Engine handlers all registered.

---

## rest_lock_until_phase — refresh phase ignores restLockedUntilTurn

**Surfaced:** 2026-06-03 during EB02-021 audit. Cross-applies to EB02-011, EB02-015.

### Engine gap (LOGGED)
- **Action handler:** `shared/engine-v2/registry/handlers/actions3.ts:599-606` (`restLockUntilPhase`) sets `inst.restLockedUntilTurn = state.turn` and IGNORES the `until` field passed by the spec.
- **Refresh phase:** `shared/engine-v2/phases/PhaseScheduler.ts:121-125` (`enterRefresh`) unconditionally flips `inst.rested = false` for all active-player chars — does NOT check `restLockedUntilTurn`.
- **Net behavior:** the action sets a flag but the refresh phase doesn't honor it. End-to-end "char skips next refresh" never happens for any card using `rest_lock_until_phase`.

### Duration enum gap
- `EffectDuration` enum (`shared/engine-v2/state/types.ts:34-39`) lacks `own_next_refresh_end`. Cards like EB02-021 printed text says "your next Refresh Phase" (own player), but spec uses `opp_next_end_phase` (closest valid enum) which would normally describe a different timing window. Engine ignores it either way.

### Required engine fix
- (a) Refresh phase must honor `restLockedUntilTurn` — skip un-resting locked instances.
- (b) Action handler must compute the correct expiry turn from the `until` field (read enum value, store absolute target turn).
- (c) Add `own_next_refresh_end` to `EffectDuration` enum for cards where the lock targets own's refresh, not opp's.

### Affected cards (incomplete; audit-in-progress)
- EB02-011 Arlong (lock on opp char until opp's next refresh)
- EB02-015 Jewelry Bonney (lock on opp char until opp's next refresh — also has separate sub-action target gap)
- EB02-021 Gum-Gum Giant Pistol (lock on own char until own's next refresh — enum mismatch + refresh-skip gap)

### Test status
- Tests assert `restLockedUntilTurn` is defined post-dispatch (the flag IS set). End-to-end refresh-skip behavior is NOT asserted — would require an `it.fails` test driving the phase transition and confirming the char remains rested. Not added yet.

---

## opp_discard_from_hand — V0 deterministic head-of-hand vs printed "opp chooses"

**Surfaced:** 2026-06-03 during EB02-045 audit.

### Engine gap (LOGGED)
- **Handler:** `shared/engine-v2/registry/handlers/actions.ts:343-359` (`discardOppHand`, registered as `discard_opp_hand` and aliased as `opp_discard_from_hand`).
- **Current V0 behavior:** shifts N cards from the HEAD of opp's hand and pushes them to opp's trash. Deterministic, not opp-chosen.
- **Printed semantic:** "your opponent trashes 1 card from their hand" (e.g. EB02-045 2nd choose option, OP05-101 Jack, OP04-097, etc.) — opp CHOOSES which card to discard.
- **Comment in code:** the handler explicitly acknowledges "(V0: discards from the head of opp's hand deterministically; full player-choice routing arrives with PendingDiscard wiring in Phase 3)" at actions.ts:340-342.

### Required engine fix
- Wire a `PendingDiscard` pending state that suspends resolution to opp's controller. opp picks which N to discard, then state resumes.

### Affected cards (incomplete; audit-in-progress)
- EB02-045 Trafalgar Law (choose_one option 2 includes opp_discard_from_hand 1)
- Likely many others across sets — needs survey when full discardOppHand consumers are catalogued.

### Test status
- Spec axis is correct (`opp_discard_from_hand`) — auditNote on EB02-045 was over-flagging the spec; the gap is engine-side, logged here. Per-card tests assert opp.hand.length decreases by N post-dispatch (which the V0 handler satisfies); they do NOT assert opp-choice routing.

---

## Compound-cost clauses — cost paid per clause instead of shared across compound effect

**Surfaced:** 2026-06-03 during EB02-052 Enel audit.

### Engine / spec gap (LOGGED)
- **Printed pattern:** "[Trigger] You may trash 1 card from your hand: do A. Then, do B." — OPTCG colon syntax means pay-1-cost UNLOCKS the compound effect (A + B), not pay-once-per-effect.
- **Current spec encoding:** the compound effect is split into two top-level clauses, each carrying its own `cost: { discardHand: 1 }`. The engine resolves each clause's cost gate independently. Net result: player must discard 2 cards (one per clause) to fire both effects — vs printed semantics of discard 1 to fire both.
- **Why the spec is split:** the `sequence` action handler (`shared/engine-v2/registry/handlers/actions2.ts:55-66`) executes sub-actions in order but does NOT honor per-sub-action `condition` gates. Cards like Enel need conditional sub-effects (effect B fires only when life ≤ 1) which sequence can't express today.

### Required engine fix
- (a) Add conditional sub-action support to `sequence` (read `sub.condition` per entry, skip if false).
- (b) OR add a shared-cost clause group primitive — multiple actions under one cost gate.
- Either lets EB02-052-class cards collapse to a single-clause with sequence sub-actions, paying cost once.

### Affected cards (incomplete; audit-in-progress)
- EB02-052 Enel (when_attacking compound — life-add gated by `if_own_life_max:1`, then +1000 power)
- Likely others with "You may X: do A. Then, do B." patterns across sets.

### Test status
- Per-card tests for now assert each clause's individual behavior under the V0 split-cost encoding. End-to-end "pay 1 once for compound" semantic is NOT asserted.

---

## EB02-053 — Myskina Olga (character) [SPEC FIX APPLIED]

**Surfaced:** 2026-06-03 during Phase 4 audit (EB02-053).

### Spec fix applied
- **Was:** 2 clauses (on_play + on_ko) each with `action.kind: 'peek_and_reorder_opp_life'` — opp-only. Root flagged + auditNote: "peek_and_reorder_opp_life only opp side; text gives choice of own or opp life".
- **Now:** 2 clauses each with `action.kind: 'choose_one'` + 2 options [peek_and_reorder_own_life count:1, peek_and_reorder_opp_life count:1]. Root + clauses + options now `verified: 'human-reviewed'`. auditNote removed.
- **Why:** Printed text says "Look at up to 1 card from the top of YOUR OR your opponent's Life cards" — the OR is a player choice. `choose_one` is the canonical engine primitive to express that branch. Both target handlers (`peek_and_reorder_own_life`, `peek_and_reorder_opp_life`) are already registered at `shared/engine-v2/registry/handlers/actions3.ts:974-987`.

### Spec verification (post-fix)
- 5-axis: on_play / on_ko clauses each: choose_one[own_life peek 1, opp_life peek 1]. Player picks side via RESOLVE_CHOOSE_ONE; handler exposes top 1 card to viewer's knownByViewer (reorder pending arrives with Phase-3 wiring).

### Audit verdict
- Spec now matches printed semantics. Engine handlers all in place.
