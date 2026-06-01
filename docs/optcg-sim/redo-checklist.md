# Cards 1-100 — 100000% Redo Checklist

**Mandate** (from owner, 2026-06-01): Every card in this range plays 100000% per its printed effectText. Binary: works fully per text, or doesn't. No "V0 limitation" notes. No `auditNote` tags left behind. No throughput-over-correctness trades. Done right ONCE.

**Scope**: 100 cards, EB01-001 → EB02-039 (inclusive). Listed below.

## How each card is verified

For EACH card, in order:

1. Read printed `effectText` from `shared/data/cards.json`.
2. Parse every clause/condition/cost/action/target/duration/trigger.
3. Trace every verb/keyword/trigger through the engine and cite `file:line` for the handler.
4. If any gap (action no-op, trigger unwired, condition wrong, target wrong, cost wrong, timing wrong, duration not tracked, semantics drift) → **FIX engine + spec**, never silence it with auditNote or test workaround.
5. Write per-card play-test under `shared/engine/__tests__/cards/<ID>.test.ts` that exercises the FULL DISPATCH PATH (game-flow driven where the gap is in dispatch, not just direct `applyActionV2` calls when those skip OPT/condition gates).
6. Run that card's test + `npx vitest run` full suite. Both must be green.
7. Self-check: "Is this card 100000% per printed text?" → If NO, keep fixing.
8. Commit per card.

## Foundation work (built BEFORE the card-by-card pass)

These structural gaps span multiple cards. Build them once, then every card benefits.

- [ ] **F1**: Generic reactive-trigger broadcaster. Today only `at_end_of_turn_self` (`shared/engine/phases/turn.ts:208-211`) dispatches spec clauses to field cards. The 7 `publishTrigger` sites in `applyAction.ts:372,497,734,735` + `phases/turn.ts:52,206,207` need parallel broadcast hooks for: `on_opp_attack`, `on_life_changed`, `on_damage_taken`, `at_opp_refresh`, `on_opp_play_character`, `at_end_of_turn` (opp side).
- [ ] **F2**: Add missing reactive triggers to `EffectTriggerV2` + dispatch:
  - `at_any_ko` — fires for EVERY removal_ko (EB01-047 Laboon).
  - `on_own_don_returned` already in EffectTriggerV2 but not wired to dispatch on `donCostReturnToDeck` cost payment or `return_don_to_deck` action; wire it (EB02-035 Sanji & Pudding).
  - `on_opp_char_bounced_by_me` — fires when this player's effect bounces an opp char (EB02-023 Crocodile).
- [ ] **F3**: Battle-KO replacement hook. `would_be_ko` replacement currently only fires from `removal_ko` action (`runner-v2.ts` around 1080). Battle resolution (find via grep on `pendingAttack`/power-compare) needs the same hook so cards saying "K.O.'d in battle" (EB02-030) work.
- [ ] **F4**: Battle-KO source attribution. To distinguish "K.O.'d by an effect" (EB01-008 LittleOars Jr text) vs "K.O.'d in battle" (EB02-030), the trigger broadcast needs to carry a `source: 'effect' | 'battle'` payload and the replacement clause needs to gate on it. Add a `triggerSource` discriminator on replacements; default behaviour stays current.
- [ ] **F5**: Counter-event timing gate. Events with `[Counter]` keyword must ONLY play during opp's attack counter step. Today nothing in `applyAction.ts` gates event-play by phase/counter-step. Wire a counter-step legality check.
- [ ] **F6**: `flipLife` cost should actually flip face-up, not trash. Today `replacements-v2.ts:230-233` trashes the life card. Add per-life face-state (`life: Array<{ id, faceUp }>` or parallel set), keep API back-compat for callers that read `life.length`.
- [ ] **F7**: `peek_and_reorder_*` actions (`runner-v2.ts:740-744`) are no-ops. Add deterministic V0 implementation (seeded shuffle? owner-defined reorder hook? simplest: leave order untouched but mark cards "peeked" so AI/UI can reorder later — for now, no-op IS correct if no card NEEDS the reorder semantics. Verify no card in scope depends on actual reorder; if yes, implement.).
- [ ] **F8**: `turn_all_own_life_face_down` (`runner-v2.ts:736-738`) needs life face-state from F6. Implement after F6.
- [ ] **F9**: Limited-rush keyword (`rush_vs_characters` from EB02-019 Zoro) — attack-legality (find summoning-sick check site) must permit char-target attack on first turn when this keyword is present and opp has ≥2 chars.
- [ ] **F10**: `if_only_chars_with_trait` (EB02-010 G/P Luffy) — verify it correctly handles "zero chars" edge case (does "only SHC chars" mean "no non-SHC chars on field, including when field is empty"?). Cite OPTCG rule.
- [ ] **F11**: `transfer_attached_don` source flexibility (EB02-009 Thousand Sunny) — `fromKind: 'your_leader'` is hardcoded; text "any of your currently given DON" should allow source from leader, char, OR stage. Add `fromKind: 'any_own'`.
- [ ] **F12**: "The selected Character" target continuity across multi-clause effects (EB02-021 Gum-Gum Giant Pistol, similar). When clause 2 says "the selected Character" referring to clause 1's target, ensure same instance is used. Add a clause-chain target memo or collapse into sequence with shared target.
- [ ] **F13**: Counter-event `counterEventBoost` field — verify it's read by counter-step engine when present.
- [ ] **F14**: `if_attached_don_min` is global `if_don_min` look-alike confusion — already fixed for EB01-006, EB01-026, but audit every spec for the same bug.
- [ ] **F15**: `give_don_to_target rested:true` — already fixed once. Audit all uses to confirm semantics match printed "give rested DON" text.

## Per-card 100000% criteria

### 1. EB01-001 — Kouzuki Oden (leader, power 5000)

Printed text:
> All of your {Land of Wano} type Character cards without a Counter have a +1000 Counter, according to the rules.
        [DON!! x1] [When Attacking] If you have a {Land of Wano} type Character with a cost of 5 or more, this Leader gains +1000 power until the start of your next turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 2. EB01-002 — Izo (character, cost 5, power 7000)

Printed text:
> [On Play] Give up to 1 rested DON!! card to your Leader or 1 of your Characters.[On Your Opponent's Attack] [Once Per Turn] You may trash 1 card from your hand: If your Leader has the {Land of Wano} or {Whitebeard Pirates} type, give up to 1 of your opponent's Leader or Character cards −2000 power during this turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 3. EB01-003 — Kid & Killer (character, cost 4, power 5000)

Printed text:
> [Rush] (This card can attack on the turn in which it is played.)
        [When Attacking] If your opponent has 2 or less Life cards, this Character gains +2000 power during this turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 4. EB01-004 — Koza (character, cost 2, power 3000)

Printed text:
> [When Attacking] You may give your 1 active Leader −5000 power during this turn: Give up to 1 of your opponent's Characters −3000 power during this turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 5. EB01-005 — Doma (character, cost 1, power 3000)

Printed text:
> -

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 6. EB01-006 — Tony Tony.Chopper (character, cost 3, power 4000)

Printed text:
> [Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)[DON!! x2] [When Attacking] Give up to 1 of your opponent's Characters −3000 power during this turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 7. EB01-007 — Yamato (character, cost 5, power 5000)

Printed text:
> [Activate: Main] [Once Per Turn] Give up to 1 rested DON!! card to your Leader or 1 of your Characters.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 8. EB01-008 — LittleOars Jr. (character, cost 6, power 7000)

Printed text:
> [Once Per Turn] If this Character would be K.O.'d by an effect, you may trash 1 Event or Stage card from your hand instead.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 9. EB01-009 — Just Shut Up and Come with Us!!!! (event, cost 1)

Printed text:
> [Counter] Look at 5 cards from the top of your deck and play up to 1 {Animal} type Character card with a cost of 3 or less. Then, place the rest at the bottom of your deck in any order.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 10. EB01-010 — There's No Way You Could Defeat Me!! (event, cost 3)

Printed text:
> [Counter] K.O. up to 1 of your opponent's Characters with 6000 base power or less.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 11. EB01-011 — Mini-Merry (stage, cost 1)

Printed text:
> [Activate: Main] You may rest this card and place 1 of your Characters with 1000 base power at the bottom of your deck: Draw 1 card.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 12. EB01-012 — Cavendish (character, cost 5, power 6000)

Printed text:
> [On Play]/[When Attacking] If your Leader has the {Supernovas} type and you have no other [Cavendish] Characters, set up to 2 of your DON!! cards as active.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 13. EB01-013 — Kouzuki Hiyori (character, cost 4, power 0)

Printed text:
> [Activate: Main] You may trash this Character: Play up to 1 {Land of Wano} type Character card with a cost of 5 or less other than [Kouzuki Hiyori] from your hand. Then, draw 1 card.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 14. EB01-014 — Sanji (character, cost 4, power 5000)

Printed text:
> [DON!! x1] [Your Turn] This Character gains +1000 power for every 3 of your rested DON!! cards.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 15. EB01-015 — Scratchmen Apoo (character, cost 1, power 1000)

Printed text:
> [On Play] Rest up to 1 of your opponent's Characters with a cost of 2 or less.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 16. EB01-016 — Bingoh (character, cost 1, power 0)

Printed text:
> [Activate: Main] You may rest this Character: K.O. up to 1 of your opponent's rested Characters with a cost of 1 or less.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 17. EB01-017 — Blueno (character, cost 2, power 2000)

Printed text:
> [Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 18. EB01-018 — Mountain God (character, cost 5, power 7000)

Printed text:
> -

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 19. EB01-019 — Off-White (event, cost 2)

Printed text:
> [Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle. Then, look at 3 cards from the top of your deck; reveal up to 1 {Donquixote Pirates} type Character card and add it to your hand. Then, place the rest at the bottom of your deck in any order.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 20. EB01-020 — Chambres (event, cost 1)

Printed text:
> [Main] If your Leader has the {Supernovas} type, return 1 of your Characters to the owner's hand, and play up to 1 Character card with a cost of 2 or less from your hand that is a different color than the returned Character.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 21. EB01-021 — Hannyabal (leader, power 5000)

Printed text:
> [End of Your Turn] You may return 1 of your {Impel Down} type Characters with a cost of 2 or more to the owner's hand: Add up to 1 DON!! card from your DON!! deck and set it as active.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 22. EB01-022 — Inazuma (character, cost 6, power 7000)

Printed text:
> [End of Your Turn] If you have 2 or less cards in your hand, draw 2 cards.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 23. EB01-023 — Edward Weevil (character, cost 4, power 8000)

Printed text:
> [On Play] Draw 1 card.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 24. EB01-024 — Hamlet (character, cost 3, power 4000)

Printed text:
> If you have 4 or less cards in your hand, all of your {SMILE} type Characters gain +1000 power.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 25. EB01-025 — Fourtricks (character, cost 3, power 5000)

Printed text:
> -

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 26. EB01-026 — Prince Bellett (character, cost 2, power 2000)

Printed text:
> [DON!! x1] [When Attacking] If you have 1 or less cards in your hand, return up to 1 Character with a cost of 3 or less to the owner's hand.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 27. EB01-027 — Mr.1(Daz.Bonez) (character, cost 5, power 6000)

Printed text:
> If your Leader's type includes "Baroque Works", this Character gains +1000 power for every 2 Events in your trash.
        [On Play] Draw 2 cards and trash 1 card from your hand.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 28. EB01-028 — Gum-Gum Champion Rifle (event, cost 1)

Printed text:
> [Counter] If your Leader has the {Impel Down} type, up to 1 of your Leader or Character cards gains +2000 power during this battle. Then, your opponent returns 1 of their active Characters to the owner's hand.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 29. EB01-029 — Sorry. I'm a Goner. (event, cost 1)

Printed text:
> [Counter] Reveal 1 card from the top of your deck. If the revealed card has a cost of 4 or more, return up to 1 of your Characters to the owner's hand. Then, place the revealed card at the bottom of your deck.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 30. EB01-030 — Loguetown (stage, cost 2)

Printed text:
> [Activate: Main] You may place this card and 1 card from your hand at the bottom of your deck in any order: Draw 2 cards.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 31. EB01-031 — Kalifa (character, cost 5, power 5000)

Printed text:
> [On Play] DON!! −1 (You may return the specified number of DON!! cards from your field to your DON!! deck.): If your Leader has the {Water Seven} type, add up to 2 Character cards with a cost of 4 or less from your trash to your hand.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 32. EB01-032 — Army Wolves (character, cost 5, power 7000)

Printed text:
> -

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 33. EB01-033 — Blueno (character, cost 4, power 5000)

Printed text:
> [On Play] DON!! −1 (You may return the specified number of DON!! cards from your field to your DON!! deck.): If your Leader has the {Water Seven} type, play up to 1 {Water Seven} type Character card with a cost of 5 other than [Blueno] from your hand or trash.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 34. EB01-034 — Ms. Wednesday (character, cost 3, power 4000)

Printed text:
> [Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)
        [On Your Opponent's Attack] [Once Per Turn] DON!! −1 (You may return the specified number of DON!! cards from your field to your DON!! deck.): If your Leader's type includes "Baroque Works", add up to 1 DON!! card from your DON!! deck and set it as active.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 35. EB01-035 — Ms. Monday (character, cost 3, power 5000)

Printed text:
> [On Play] If your Leader's type includes "Baroque Works", up to 1 of your Leader or Character cards gains +1000 power during this turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 36. EB01-036 — Minochihuahua (character, cost 4, power 5000)

Printed text:
> [Rush] (This card can attack on the turn in which it is played.)
        [On K.O.] If your Leader has the {Impel Down} type, add up to 1 DON!! card from your DON!! deck and rest it.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 37. EB01-037 — Mr. 9 (character, cost 3, power 4000)

Printed text:
> [On Your Opponent's Attack] [Once Per Turn] DON!! −1 (You may return the specified number of DON!! cards from your field to your DON!! deck.): K.O. up to 1 of your opponent's Characters with a cost of 2 or less.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 38. EB01-038 — Oh Come My Way (event, cost 1)

Printed text:
> [Counter] DON!! −1 (You may return the specified number of DON!! cards from your field to your DON!! deck.): If your Leader's type includes "Baroque Works", select 1 of your Characters. Change the attack target to the selected Character.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 39. EB01-039 — Conquerer of Three Worlds Ragnaraku (event, cost 5)

Printed text:
> [Main] DON!! −1 (You may return the specified number of DON!! cards from your field to your DON!! deck.): K.O. up to 1 of your opponent's Characters with a cost of 8 or less.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 40. EB01-040 — Kyros (leader, power 5000)

Printed text:
> [Activate: Main] [Once Per Turn] You may turn 1 card from the top of your Life cards face-up: K.O. up to 1 of your opponent's Characters with a cost of 0.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 41. EB01-041 — Crocus (character, cost 6, power 8000)

Printed text:
> -

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 42. EB01-042 — Scarlet (character, cost 2, power 0)

Printed text:
> [Activate: Main] You may trash this Character: Play up to 1 {Dressrosa} type Character card with a cost of 3 or less other than [Scarlet] from your hand rested. Then, give up to 1 of your opponent's Characters −2 cost during this turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 43. EB01-043 — Spandine (character, cost 3, power 2000)

Printed text:
> [On Play] You may place 3 cards with a type including "CP" from your trash at the bottom of your deck in any order: Play up to 1 Character card with a type including "CP" and a cost of 4 or less other than [Spandine] from your trash rested.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 44. EB01-044 — Funkfreed (character, cost 1, power 1000)

Printed text:
> [Activate: Main] You may rest this Character: Up to 1 of your [Spandam] Characters gains +3000 power during this turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 45. EB01-045 — Brook (character, cost 3, power 4000)

Printed text:
> [On Play] If your opponent has a Character with a cost of 0, this Character gains [Rush] during this turn.
        (This card can attack on the turn in which it is played.)

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 46. EB01-046 — Brook (character, cost 3, power 4000)

Printed text:
> [On Play]/[When Attacking] Give up to 1 of your opponent's Characters −1 cost during this turn. Then, K.O. up to 1 of your opponent's Characters with a cost of 0.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 47. EB01-047 — Laboon (character, cost 2, power 4000)

Printed text:
> [Once Per Turn] When a Character is K.O.'d, draw 1 card and trash 1 card from your hand.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 48. EB01-048 — Laboon (character, cost 4, power 5000)

Printed text:
> [Activate: Main] You may rest this Character: Give up to 1 of your opponent's Characters −4 cost during this turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 49. EB01-049 — T-Bone (character, cost 5, power 5000)

Printed text:
> [On Play] K.O. up to 1 of your opponent's Characters with a cost of 2 or less.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 50. EB01-050 — ...I Want to Live!! (event, cost 3)

Printed text:
> [Counter] If you have 30 or more cards in your trash, add up to 1 card from the top of your deck to the top of your Life cards.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 51. EB01-051 — Finger Pistol (event, cost 4)

Printed text:
> [Main] You may trash 2 cards from the top of your deck: K.O. up to 1 of your opponent's Characters with a cost of 5 or less.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 52. EB01-052 — Viola (character, cost 2, power 0)

Printed text:
> [Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)
        [On Play] Choose one:
        • Look at all of your opponent's Life cards and place them back in their Life area in any order.
        • Turn all of your Life cards face-down.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 53. EB01-053 — Gastino (character, cost 3, power 5000)

Printed text:
> [On Play] Place up to 1 of your opponent's Characters with a cost of 3 or less at the top or bottom of your opponent's Life cards face-up.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 54. EB01-054 — Gan.Fall (character, cost 3, power 4000)

Printed text:
> [Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)
        [On Play] If your opponent has 1 or less Life cards, K.O. up to 1 of your opponent's Characters with a cost of 3 or less.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 55. EB01-055 — Charlotte Compote (character, cost 7, power 9000)

Printed text:
> -

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 56. EB01-056 — Charlotte Flampe (character, cost 1, power 1000)

Printed text:
> [On Play] You may add 1 card from the top or bottom of your Life cards to your hand: Draw 1 card.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 57. EB01-057 — Shirahoshi (character, cost 2, power 0)

Printed text:
> When this Character is K.O.'d by your opponent's effect, add up to 1 card from the top of your deck to the top of your Life cards.
        [Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 58. EB01-058 — Mont Blanc Cricket (character, cost 2, power 3000)

Printed text:
> [DON!! x1] [Your Turn] If you have 2 or less Life cards, this Character gains +2000 power.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 59. EB01-059 — Kingdom Come (event, cost 6)

Printed text:
> [Main] K.O. up to 1 of your opponent's Characters. Then, trash cards from the top of your Life cards until you have 1 Life card.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 60. EB01-060 — Did Someone Say...Kami? (event, cost 4)

Printed text:
> [Main] Play up to 1 [Enel] with a cost of 7 or less from your hand or trash. Then, trash cards from the top of your Life cards until you have 1 Life card.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 61. EB01-061 — Mr.2.Bon.Kurei(Bentham) (character, cost 4, power 1000)

Printed text:
> [On Play] Add up to 1 DON!! card from your DON!! deck and set it as active.
        [When Attacking] Select up to 1 of your opponent's Characters. This Character's base power becomes the same as the selected Character's power during this turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 62. EB02-001 — Karoo (character, cost 5, power 7000)

Printed text:
> -

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 63. EB02-002 — Sabo (character, cost 4, power 5000)

Printed text:
> [Activate: Main] You may rest this Character: Up to 1 of your {Revolutionary Army} type Characters other than [Sabo] gains +2000 power during this turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 64. EB02-003 — Tony Tony.Chopper (character, cost 3, power 3000)

Printed text:
> [DON!! x2] [Opponent's Turn] This Character gains +2000 power.
        [On Play] If your Leader has the {Straw Hat Crew} type, give up to 1 rested DON!! card to your Leader or 1 of your Characters.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 65. EB02-004 — Don Accino (character, cost 8, power 10000)

Printed text:
> -

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 66. EB02-005 — Fake Straw Hat Crew (character, cost 2, power 3000)

Printed text:
> [Your Turn] This Character gains +2000 power.
        [Opponent's Turn] Give this Character −2000 power.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 67. EB02-006 — Yamato (character, cost 6, power 7000)

Printed text:
> [Activate: Main] [Once Per Turn] If your Leader has the {Land of Wano} type or is [Portgas.D.Ace], give up to 1 rested DON!! card to 1 of your Leader. Then, this Character gains [Rush] during this turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 68. EB02-007 — Cloven Rose Blizzard (event, cost 3)

Printed text:
> [Main] Up to a total of 3 of your Leader and Character cards gain +1000 power during this turn. Then, K.O. up to 1 of your opponent's Characters with 3000 power or less.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 69. EB02-008 — The Peak (event, cost 2)

Printed text:
> [Main] Look at 4 cards from the top of your deck; reveal up to 1 card with a cost of 4 or more and add it to your hand. Then, place the rest at the bottom of your deck in any order.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 70. EB02-009 — Thousand Sunny (stage, cost 2)

Printed text:
> [Activate: Main] You may rest this Stage: Give up to 1 of your currently given DON!! cards to 1 of your {Straw Hat Crew} type Characters.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 71. EB02-010 — Monkey.D.Luffy (leader, power 5000)

Printed text:
> [Activate: Main] [Once Per Turn] DON!! −2: If the only Characters on your field are {Straw Hat Crew} type Characters, set up to 2 of your DON!! cards as active. Then, this Leader gains +1000 power until the end of your opponent's next turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 72. EB02-011 — Arlong (character, cost 3, power 4000)

Printed text:
> [On Play] If your Leader has the {Fish-Man} or {East Blue} type, give up to 1 rested DON!! card to 1 of your Leader. Then, up to 1 of your opponent's Characters with a cost of 5 or less cannot be rested until the end of your opponent's next turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 73. EB02-012 — Gaimon (character, cost 1, power 1000)

Printed text:
> If you have a [Sarfunkel], this Character gains [Blocker].

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 74. EB02-013 — Carrot (character, cost 1, power 0)

Printed text:
> [On Play] If you have 3 or more DON!! cards on your field, look at 7 cards from the top of your deck; reveal up to 1 [Zou] and add it to your hand. Then, place the rest at the bottom of your deck in any order and play up to 1 [Zou] from your hand.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 75. EB02-014 — Sarfunkel (character, cost 2, power 0)

Printed text:
> [On Play] Play up to 1 [Gaimon] from your hand.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 76. EB02-015 — Jewelry Bonney (character, cost 7, power 7000)

Printed text:
> [On Play] Up to 1 of your opponent's rested Characters will not become active in your opponent's next Refresh Phase. Then, set up to 1 of your DON!! cards as active at the end of this turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 77. EB02-016 — Chopperman (character, cost 5, power 6000)

Printed text:
> Also treat this card's name as [Tony Tony.Chopper] according to the rules.
        [On Play] Play up to 1 {Animal} type Character card with a cost of 3 or less from your hand.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 78. EB02-017 — Nami (character, cost 1, power 2000)

Printed text:
> [On Play] Look at 5 cards from the top of your deck; reveal up to 1 {Straw Hat Crew} type card other than [Nami] and add it to your hand. Then, place the rest at the bottom of your deck in any order.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 79. EB02-018 — Buggy (character, cost 4, power 6000)

Printed text:
> [On Play] If you have no other [Buggy] Characters, up to 1 of your Leader gains [Double Attack] during this turn.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 80. EB02-019 — Roronoa Zoro (character, cost 4, power 5000)

Printed text:
> If your opponent has 2 or more Characters, this Character can attack Characters on the turn in which it is played.
        [On Play] If your Leader has the {Straw Hat Crew} type, rest up to 1 of your opponent's Characters with a cost of 4 or less.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 81. EB02-020 — We Are! (event, cost 2)

Printed text:
> [Main] Look at 4 cards from the top of your deck; reveal up to 1 card with a cost of 4 or more and add it to your hand. Then, place the rest at the bottom of your deck in any order.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 82. EB02-021 — Gum-Gum Giant Pistol (event, cost 3)

Printed text:
> [Main] Up to 1 of your {Straw Hat Crew} type Characters gains +6000 power during this turn. Then, the selected Character will not become active in your next Refresh Phase.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 83. EB02-022 — Usopp (character, cost 4, power 5000)

Printed text:
> [On Play] If you have 2 or less Characters with 5000 power or more, play up to 1 Character card with 6000 power or less and no base effect from your hand.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 84. EB02-023 — Crocodile (character, cost 4, power 5000)

Printed text:
> [Your Turn] [Once Per Turn] When your opponent's Character is returned to the owner's hand by your effect, look at 3 cards from the top of your deck and place them at the top or bottom of the deck in any order.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 85. EB02-024 — Sogeking (character, cost 4, power 5000)

Printed text:
> Also treat this card's name as [Usopp] according to the rules.
        [On Play] Draw 2 cards and place 2 cards from your hand at the bottom of your deck in any order. Then, return up to 1 Character with a cost of 1 or less to the owner's hand.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 86. EB02-025 — Donquixote Rosinante (character, cost 2, power 3000)

Printed text:
> [Activate: Main] You may rest 1 of your DON!! cards and this Character: If your Leader is [Donquixote Rosinante], look at 5 cards from the top of your deck; play up to 1 Character card with a cost of 2 or less rested. Then, place the rest at the bottom of your deck in any order.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 87. EB02-026 — Nefeltari Vivi (character, cost 3, power 2000)

Printed text:
> [On Play] If your Leader is multicolored and you have 5 or less cards in your hand, draw 2 cards.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 88. EB02-027 — Vista (character, cost 4, power 5000)

Printed text:
> [On Play] Place up to 1 of your opponent's Characters with 1000 power or less at the bottom of the owner's deck.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 89. EB02-028 — Portgas.D.Ace (character, cost 5, power 5000)

Printed text:
> [On Play] If your Leader's type includes "Whitebeard Pirates", look at 5 cards from the top of your deck; reveal up to 1 Character card with a cost of 2 and add it to your hand. Then, place the rest at the bottom of your deck in any order and play up to 1 Character card with a cost of 2 from your hand rested.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 90. EB02-029 — Grandpa Ryu (character, cost 3, power 5000)

Printed text:
> -

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 91. EB02-030 — And That's When Somebody Makes Fun of Their Friend's Dream!!!! (event, cost 2)

Printed text:
> [Counter] If any of your Characters would be K.O.'d in battle during this turn, you may trash 1 card from your hand instead.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 92. EB02-031 — Hope (event, cost 2)

Printed text:
> [Main] Look at 4 cards from the top of your deck; reveal up to 1 card with a cost of 4 or more and add it to your hand. Then, place the rest at the bottom of your deck in any order.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 93. EB02-032 — Iceburg (character, cost 1, power 0)

Printed text:
> [On Play] If you have 3 or more DON!! cards on your field, look at 7 cards from the top of your deck; reveal up to 1 [Galley-La Company] and add it to your hand. Then, place the rest at the bottom of your deck in any order and play up to 1 [Galley-La Company] from your hand.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 94. EB02-033 — Klabautermann (character, cost 1, power 0)

Printed text:
> If you have [Merry Go] on your field, this Character gains [Blocker].

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 95. EB02-034 — Komei (character, cost 4, power 6000)

Printed text:
> -

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 96. EB02-035 — Sanji & Pudding (character, cost 5, power 7000)

Printed text:
> [Your Turn] [Once Per Turn] When 2 or more DON!! cards on your field are returned to your DON!! deck, add up to 1 DON!! card from your DON!! deck and set it as active.
        [On Play] If the number of DON!! cards on your field is equal to or less than the number on your opponent's field, draw 1 card.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 97. EB02-036 — Nico Robin (character, cost 3, power 2000)

Printed text:
> [Blocker]
        [On K.O.] DON!! −1: Look at 3 cards from the top of your deck; reveal up to 1 {Straw Hat Crew} type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 98. EB02-037 — Franky (character, cost 3, power 4000)

Printed text:
> [On Play]/[When Attacking] If your Leader has the {Straw Hat Crew} type and the number of DON!! cards on your field is equal to or less than the number on your opponent's field, add up to 1 DON!! card from your DON!! deck and rest it.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 99. EB02-038 — Magellan (character, cost 3, power 4000)

Printed text:
> [On Play] Play up to 1 {Impel Down} type Character card with a cost of 2 or less from your hand.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

### 100. EB02-039 — GERMA 66 (event, cost 4)

Printed text:
> [Main] You may trash 1 {GERMA 66} type Character card with 4000 power or less from your hand: If the number of DON!! cards on your field is equal to or less than the number on your opponent's field, play up to 1 Character card with 5000 to 7000 power and the same card name as the trashed card from your trash.

Verification:
- [ ] All clauses present in spec and faithful to text
- [ ] Every action verb maps to a real engine handler that does what text says
- [ ] Every trigger is wired (use F1/F2 if reactive)
- [ ] Every condition / cost / target / duration matches text
- [ ] Test exercises full dispatch path (not just direct handler call) where relevant
- [ ] Suite + per-card test green
- [ ] No `auditNote` left in spec
- [ ] Self-check 100000% ✓

