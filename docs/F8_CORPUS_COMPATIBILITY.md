# F-8 Step B — Corpus Compatibility

**Method:** Effect-family card counts derived from `shared/data/cards.json` clause grep + cross-referenced to `shared/simulation/reports/mechanic-frequency-0.json` (firing frequencies over 1,000 simulated games / 21,859 ticks). Family status taken as upper bound from `docs/F8_EFFECT_FAMILY_MATRIX.md` (Step A). All BROKEN/PARTIAL findings cited file:line.

**Authoritative source for engine status:** Step A. This doc does NOT re-judge engine status — only counts cards per family and identifies systemic root causes.

**Counts are CLAUSE INSTANCES, not distinct cards.** A single card with two on_play clauses counts twice. For per-card distinct counts owner can grep `"id": "..."` with context — that wasn't requested here.

**Corpus size:** 2,489 cards (`shared/data/cards.json:14` grep count of `"id":` lines).

## Top-level summary

| family | clauses | GREEN | PARTIAL | BROKEN | UNKNOWN |
|---|---:|---:|---:|---:|---:|
| on_play (trigger) | 1480 | varies* | varies* | varies* | 0 |
| activate_main (trigger) | 416 | 416 | 0 | 0 | 0 |
| when_attacking (trigger) | 281 | varies* | varies* | varies* | 0 |
| on_ko (trigger) | 156 | varies* | varies* | varies* | 0 |
| power_buff (action) | 412 | ~250 | ~162 | 0 | 0 |
| draw (action) | 272 | ~200 | ~72 | 0 | 0 |
| removal_ko (action) | 253 | ~100 | 0 | ~153 | 0 |
| play_for_free (action) | 193 | ~50 | ~143 | 0 | 0 |
| searcher_peek (action) | 183 | 0 | 0 | 183 | 0 |
| rest_target (action) | 127 | ~30 | 0 | ~97 | 0 |
| set_active (unrest, action) | 86 | 0 | 0 | 86 | 0 |
| give_don_to_target (action) | 85 | 0 | 0 | 85 | 0 |
| removal_bounce (action) | 75 | ~20 | 0 | ~55 | 0 |
| mill_self (action) | 53 | 53 | 0 | 0 | 0 |
| set_active_don (action) | 51 | 51 | 0 | 0 | 0 |
| peek_and_reorder_own_deck | 22 | 0 | 0 | 22 | 0 |
| peek_and_reorder_opp_life | 9 | 0 | 0 | 9 | 0 |
| peek_and_reorder_own_life | 8 | 0 | 0 | 8 | 0 |
| reveal_top_and_conditional_play | 20 | 0 | 0 | 20 | 0 |
| reveal_top_then_if_filter | 10 | 0 | 0 | 10 | 0 |
| trash_face_up_life (life reveal) | 16 | 0 | 16 | 0 | 0 |
| choose_one (action) | 28 | 28 | 0 | 0 | 0 |
| peek_opp_deck (action) | 3 | 0 | 3 | 0 | 0 |
| life_to_hand (action) | 33 | 33 | 0 | 0 | 0 |
| choose_cost_reveal_opp_match | 7 | 0 | 0 | 7 | 0 |

`*` = trigger families (on_play / when_attacking / on_ko) are gateways — their playability depends on the downstream `action.kind`. The trigger fires fine; visibility depends on whether the chained action has a UI prompt or beat. Counts in those rows are deferred to the action-family columns.

## Per-family detail

### searcher_peek — 183 clauses — **BROKEN** for human

- **What:** "Look at top N of your deck, reveal up to X matching {filter}, add to hand or play, bottom rest."
- **Frequency:** 322 firings per 1,000 sim games — most-fired family by far (`mechanic-frequency-0.json:50`).
- **Status:** Step A reports the handler `actions3.ts:844` auto-resolves silently for everyone. The reverted F-7z Part A work would have added the human pending split + UI; without it, the player sees the card play and a card appears in hand with no chooser, no reveal, no visible search.
- **Representative cards:** EB04-002 Jewelry Bonney, EB01-046 Brook, OP01-014 Sanji, OP09-051 Charlotte Pudding, OP02-031 Kid Pirates.
- **Root cause category:** auto-resolve silent for human controller.
- **Required generic fix:** add `PendingSearcherPeek` state kind + `RESOLVE_SEARCHER_PEEK` action + `SearcherPeekPrompt.tsx` reading generic fields (`lookedAtInstanceIds`, `validPickInstanceIds`, `pickLimit`, `mayChooseNone`, `placement`) — exact pattern from the reverted F-7z Part A. No card-specific code.
- **Engine pending split needed?** YES (controller-based split in handler).
- **UI prompt alone enough?** NO — needs both engine pending state and UI prompt.
- **Test family needed:** e2e — human opens prompt → selects valid card → Confirm → engine reaches resumePhase; human gets prompt with 0 valid → Choose None.

### choose_from_top_deck — alias of searcher_peek — see above.

### peek_and_reorder_own_deck / opp_life / own_life — 22 + 9 + 8 = 39 clauses — **BROKEN**

- **What:** "Look at top N of your deck/life, then rearrange in any order."
- **Status:** Step A confirms `actions3.ts:1129` is a V0 stub — only writes `knownByViewer`, no actual reorder. No UI.
- **Representative cards:** EB02-024 Sogeking (place 1 card from hand at deck bottom), OP02-013 Brook, OP04-085 Klabautermann.
- **Root cause category:** V0 engine stub + missing UI.
- **Required generic fix:** finish the engine reorder logic (apply the player-provided permutation to `deck[0..N]` or `life[0..N]`) AND add `PendingReorder` + `RESOLVE_REORDER` + `ReorderPrompt.tsx` with drag-handles. Generic, action.kind-driven.
- **Engine pending split needed?** YES.
- **UI prompt alone enough?** NO — engine logic itself is missing.
- **Test family needed:** e2e — drag-reorder + Confirm; deck top order matches input.

### removal_ko — 253 clauses — **BROKEN** for human multi-target

- **What:** "KO a Character." Many variants: cost-bound, owner-bound, "up to 1", "up to 1 with N power or less".
- **Frequency:** 31 firings per 1,000 games — modest-frequency but high impact (a KO changes board state irreversibly).
- **Status:** Step A reports `actions.ts:154` handler auto-picks deterministically. No UI target picker.
- **GREEN portion (~100):** clauses with hard-coded target (e.g. `targets: { kind: 'self' }`) or single eligible target after filtering — engine deterministic pick IS correct.
- **BROKEN portion (~153):** "up to 1 of your opponent's Characters" with multiple eligible targets — engine picks one, human never chose.
- **Representative cards:** OP01-068 Crocodile, OP02-052 Kaido, ST01-008 Roronoa Zoro, EB01-032 Trafalgar Law, OP04-070 Hannyabal.
- **Root cause category:** no human target picker UI.
- **Required generic fix:** add `PendingTargetPick` (already exists for `attack_target_pick`) extended to action-clause context. Add `TargetPickPrompt.tsx` mounting on `pending.kind === 'action_target_pick'`. Handler splits at `ctx.controller === A`: human → pending; AI → auto.
- **Engine pending split needed?** YES.
- **UI prompt alone enough?** NO.
- **Test family needed:** e2e — KO clause with N eligible targets opens prompt; human picks one; engine KOs the picked one.

### removal_bounce — 75 clauses — **BROKEN** for human multi-target

- Same pattern as `removal_ko`. ~20 single-target (GREEN), ~55 "up to 1" multi-target (BROKEN).
- **Representative cards:** OP01-026 Prince Bellett, OP02-031 Kid Pirates, OP05-013 Trafalgar Law, EB01-026 Bellett.
- **Required generic fix:** same `PendingTargetPick` reuse — one fix covers both removal_ko AND removal_bounce.

### give_power / power_buff — 412 clauses — **PARTIAL**

- **What:** "Give Character +N power" or "−N power".
- **Frequency:** 423 firings.
- **Status:** Step A reports `actions.ts:76` handler works. POWER_MODIFIED beat exists (`beatFor.ts:241-253`).
- **GREEN portion (~250):** clauses where target is fixed by clause text ("this Character", "your Leader", or single eligible). Auto-target is correct.
- **PARTIAL portion (~162):** "up to 1 of your Characters" or "up to 1 of your opponent's" — engine auto-picks; human never chose target.
- **Representative cards:** OP01-020 Hyogoro (self leader — GREEN), EB01-002 Izo "up to 1 of your opp Leader or Character" (PARTIAL), EB01-052 Viola, OP01-014 Sanji.
- **Required generic fix:** same `PendingTargetPick` (action-clause variant). One fix covers removal_ko + removal_bounce + give_power + reduce_power.

### give_don_to_target — 85 clauses — **BROKEN** for human

- **What:** "Give 1 rested DON to your Leader or 1 of your Characters."
- **Status:** Step A `actions.ts:346` works; no beat for the DON give, no picker.
- **Representative cards:** EB01-002 Izo, OP02-009 Otama, OP08-001 Eustass Kid.
- **Required generic fix:** `PendingTargetPick` variant with `targetKind: 'leader_or_character'`. Add DON_GIVEN beat.

### rest_target / set_active (unrest) — 127 + 86 clauses — **BROKEN** for human

- **What:** Rest or activate a target.
- **Status:** Step A reports `actions.ts:298` (rest) + `:314` (activate). Auto-target.
- **Representative cards:** OP03-018 Donquixote Doflamingo, OP04-038 Charlotte Smoothie, OP07-002 Yamato.
- **GREEN portion (~30 rest, 0 unrest):** clauses that hit all eligible targets ("Rest all of your opponent's Characters") — no choice required.
- **BROKEN portion (~97 + 86):** "up to 1" or "1 of your opp's Characters" — human never chose.
- **Required generic fix:** same `PendingTargetPick` — one fix covers all "target picker" families.

### life_reveal / trash_face_up_life / reveal_top_and_conditional_play / reveal_top_then_if_filter — 16 + 20 + 10 = 46 clauses — **PARTIAL** to **BROKEN**

- **What:** Reveal a card from life/deck; conditional logic on what was revealed.
- **Status:** Step A reports `actions3.ts:174` engine works but no UI shows the revealed card to the player. `LIFE_REVEALED` history event fires (`beatFor.ts:138-152`) but the PresentationQueue may surface only the event-name without rendering the actual card.
- **Representative cards:** OP01-031 Buggy (reveal top, may play if Pirate trait), OP05-002 Big Mom.
- **Root cause category:** no reveal UI / card not rendered in beat.
- **Required generic fix:** verify `beatFor.LIFE_REVEALED` includes the revealed `instanceId` as `primaryInstanceId`; render the card art in the PresentationQueue beat. No engine change needed if the event already carries the card ID — this is a Step C concern (PresentationQueue rendering).
- **Engine pending split needed?** NO.
- **UI prompt alone enough?** YES — beat rendering only.

### play_for_free — 193 clauses — **PARTIAL**

- **What:** Play a card from hand/deck/trash bypassing cost.
- **Frequency:** 125 firings.
- **Status:** Step A reports `actions2.ts:316` engine works. Beat exists.
- **GREEN portion (~50):** automatic plays from deck (e.g. searcher_peek with `playInsteadOfHand: true`) — no choice needed.
- **PARTIAL portion (~143):** "you may play 1 Character with cost N or less" — engine auto-picks first match; human never chose which to play.
- **Representative cards:** OP01-007 Tony Tony Chopper, OP08-018 Sanji, OP02-101 Sabo.
- **Required generic fix:** `PendingChoiceFromZone` (similar to searcher_peek but source = hand/trash). Reuse pattern.

### choose_one — 28 clauses — **GREEN**

- Step A confirms `ChoosePrompt.tsx` mounts; tested e2e CARD 14 (Viola).

### activate_main — 416 clauses — **GREEN** (per Step A) but no per-card e2e coverage

- Step A confirms beat + downstream scan work.
- ⚠️ E2E CARD 22 covers ONE card (Hyogoro). 415 other activate_main clauses are not e2e-tested individually.
- Generic logic is sound; per-card sweep would belong to Step C.

### on_play / when_attacking / on_ko — gateway triggers

- Trigger families themselves are GREEN — `triggers.ts:143-148`.
- Playability depends on the chained action. Each clause's status is bounded by its action.kind in this matrix.

### mill_self, set_active_don, life_to_hand — 53 + 51 + 33 = 137 clauses — **GREEN**

- No human choice required; engine deterministic is correct text.
- Visible feedback: `mill_self` and `life_to_hand` may lack dedicated beats — flag for Step E (state mutation explainability).

### peek_opp_deck / peek (own deck "up to N") — 3 + (peek family) — **PARTIAL**

- Step A flagged e2e CARD 1 currently failing post-revert.
- Engine handler `actions2.ts:469` works.
- UI `PeekChoicePrompt.tsx` exists but test failure indicates an integration regression. Step F item.

## Top systemic gaps (highest impact, generic fixes)

### Gap 1 — Generic human target picker missing — affects ~395 clauses across 6 families

- removal_ko ~153 + removal_bounce ~55 + power_buff ~162 + rest_target ~97 + set_active 86 + give_don_to_target 85 = ~638 clause instances need a target picker.
- ONE fix: extend the existing `PendingTargetPick` (already used by `attack_target_pick`) to action-clause context. Handler splits at `ctx.controller === A` → pending; AI keeps auto.
- Add generic `TargetPickPrompt.tsx` reading `pending.candidateIds` + clause source. No card-specific logic.
- Tests: one e2e per family (5-6 tests) verifies the generic surface works for each family.

### Gap 2 — Generic searcher_peek UI missing — affects 183 clauses

- Already designed in F-7z Part A (now reverted). Re-implement family-level with the same generic pending shape: `lookedAtInstanceIds`, `validPickInstanceIds`, `pickLimit`, `mayChooseNone`, `placement`.
- ONE fix covers EVERY searcher card in the corpus.

### Gap 3 — Reorder UI missing AND engine V0 stub — affects 39 clauses

- Two-part fix: complete engine reorder application + add `PendingReorder` + `ReorderPrompt.tsx` with drag handles.
- 39 clauses is small but the V0 stub means these cards literally do nothing visible right now.

### Gap 4 — Reveal/life-reveal rendering missing — affects 46 clauses

- Engine fires `LIFE_REVEALED` / reveal events but PresentationQueue may not render the actual card. Step C item to confirm beat-renders-card.
- No engine change needed if event already carries `primaryInstanceId`.

### Gap 5 — Choice-from-zone (play_for_free with "you may") — affects ~143 clauses

- Same shape as searcher_peek but source zone is hand/trash. Reuse pending pattern; different filter source.
- ONE fix covers all "you may play X from Y" cards.

## Notes / caveats

- "Clauses" ≠ "distinct cards." A card with two on_play clauses counts twice. Per-card distinct counts not requested.
- GREEN/PARTIAL/BROKEN apportionment within a family (e.g. removal_ko 100 GREEN / 153 BROKEN) is estimated by reading clause-text patterns ("up to 1" vs. fixed target). Exact distribution requires clause-by-clause parse — deferred unless owner requests.
- All BROKEN findings share the SAME root architectural pattern: engine handler is correct but missing the controller-based human/AI split + generic pending UI surface. The fix is the same family-level template applied to ~5 families.
- No card-specific findings. Every "broken" claim describes a FAMILY behavior, not a card-name branch.
- E2E `effect-card-proof.spec.ts` CARD 1 (Off-White peek) is failing post-revert — flagged for Step F (root cause investigation).
- Sim/library catalogs (`shared/sim/library/*.json`) only cover EB01-EB02 batch — not used for corpus-wide counts. Used only for confirming the "missing primitive" reasons match Step A's BROKEN judgments.
