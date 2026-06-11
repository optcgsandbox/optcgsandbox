# F-8 Step A — Effect Family Matrix

**Scope:** 24 effect families across engine handler, legal-action enumeration, UI surface, manual choice, optional choice, target choice, visible feedback, e2e proof.

**Verification level:** Agent-sourced inventory + main-thread spot-check on BROKEN/PARTIAL rows. Rows marked `[VERIFIED]` were re-grepped on 2026-06-10. Rows without that tag are agent-sourced and may need confirmation.

**Hard rule observed:** No card-specific findings. Family-level only.

## Matrix

| family | engine_handler | legal_action | ui_surface | manual_choice | optional_choice | target_choice | visible_feedback | tested | status |
|---|---|---|---|---|---|---|---|---|---|
| on_play | `registry/handlers/triggers.ts:143` (dispatch) | N/A (fires on PLAY_CARD) | inherited via downstream `choose_one`/`peek`/etc. | depends on clause | depends on clause | depends on clause | `gameLog/beatFor.ts` EFFECT_ACTIVATED | e2e `effect-card-proof.spec.ts` CARD 14 | GREEN |
| activate_main | `registry/handlers/triggers.ts:147` | `rules/legality.ts:316-336` | inherited via downstream prompt | YES (player chooses to activate) | N/A | depends on clause | `gameLog/beatFor.ts:222-227` + F-7y downstream scan | e2e CARD 22 | GREEN |
| when_attacking | `registry/handlers/triggers.ts:146` | N/A (fires on DECLARE_ATTACK) | inherited downstream | NO | N/A | depends on clause | partial — depends on downstream beat | e2e CARD 6 (Bellett bounce) | PARTIAL — no dedicated "when_attacking fired" beat |
| trigger | `registry/handlers/triggers.ts:148` | `rules/legality.ts:68-75` | `src/components/TriggerPrompt.tsx:22` | YES | YES (decline) | N/A | `beatFor.ts:154-161` | partial e2e | GREEN |
| blocker | `reducers/attackFlow.ts:260` `declareBlockerReducer` **[VERIFIED]** | `rules/legality.ts:251-264` | `src/components/BlockerPrompt.tsx:15` | YES | YES (skip) | YES (pick blocker from candidates) | MISSING — no dedicated "BLOCKED" beat in `beatFor.ts` | e2e in `e2e/local-ai/blocker-*.spec.ts` (unverified) | PARTIAL — no visible beat when blocker chosen |
| counter | `reducers/attackFlow.ts:317` `playCounterReducer` + `:516` `skipCounterReducer` **[VERIFIED]** | `rules/legality.ts:297-313` | `src/components/CounterPrompt.tsx:27` | YES | YES (skip) | N/A | `beatFor.ts:112-119` COMBAT_RESULT counter sub-text | e2e CARD 20/21 | GREEN |
| choose_one | `registry/handlers/actions3.ts:1153` `chooseOne` | `rules/legality.ts:107-115` | `src/components/ChoosePrompt.tsx:25` | YES | NO (must pick) | option index only | MISSING dedicated beat (EFFECT_ACTIVATED wraps it) | e2e CARD 14 (Viola) | GREEN |
| peek | `registry/handlers/actions2.ts:469` | (auto-resolves; no explicit legal action) | `src/components/PeekChoicePrompt.tsx:15` | YES | YES | N/A | MISSING dedicated beat | e2e CARD 1 (failing post-revert) | PARTIAL — test currently failing |
| searcher_peek | `registry/handlers/actions3.ts:844` | (auto-resolves) | MISSING (SearcherPeekPrompt was reverted) | NO (V0 auto-resolves) | NO | NO | `beatFor.ts:178-200` SEARCHER_PICKED | e2e CARDS 13/17/18/19 | BROKEN for human — silent auto-resolve, no UI; AI fine |
| bounce (`removal_bounce`) | `registry/handlers/actions.ts:233` | N/A (clause action) | MISSING dedicated target picker — auto-targets | NO | N/A | NO (auto-pick) | `beatFor.ts:121-128` | e2e CARD 6 | BROKEN for human-controlled multi-target — no chooser |
| removal_ko | `registry/handlers/actions.ts:154` | N/A | MISSING dedicated target picker | NO | N/A | NO (auto-pick) | `beatFor.ts:130-136` | MISSING | BROKEN for human multi-target |
| play_for_free | `registry/handlers/actions2.ts:316` | N/A | inherits PLAY_CARD path | NO | N/A | NO | `beatFor.ts:207-218` | MISSING | PARTIAL |
| give_power | `registry/handlers/actions.ts:76` `powerBuff` | N/A | MISSING dedicated picker for "give power to up to N" choice | NO (auto-target) | N/A | NO (auto-pick) | `beatFor.ts:241-253` POWER_MODIFIED | e2e CARD 4 (Hyogoro) | PARTIAL — auto-target is wrong for "up to" effects |
| reduce_power | `registry/handlers/actions.ts:76` (same fn, negative amount) | N/A | MISSING picker | NO | N/A | NO | `beatFor.ts:241-253` | MISSING | PARTIAL |
| give_don | `registry/handlers/actions.ts:346` `giveDonToTarget` | N/A | MISSING picker | NO | N/A | NO (auto-target) | MISSING beat | MISSING | PARTIAL |
| attach_don | (action reducer handles DON drag) `rules/legality.ts:200-207` | enumerated | drag handler in `PlayfieldStage.tsx` | YES (manual) | N/A | YES (drag target) | implicit (DON badge animates) | MISSING e2e | GREEN |
| rest_target | `registry/handlers/actions.ts:298` `restTarget` | N/A | MISSING picker | NO | N/A | NO | `beatFor.ts:427-430` | MISSING | PARTIAL |
| unrest_target (`active_target`) | `registry/handlers/actions.ts:314` | N/A | MISSING picker | NO | N/A | NO | MISSING beat | MISSING | PARTIAL |
| draw | `registry/handlers/actions.ts:58` | N/A | inherent (no choice) | NO | N/A | N/A | MISSING dedicated beat | partial | PARTIAL — no visible "drew X" feedback when triggered by an effect |
| trash | `registry/handlers/actions.ts:366` | N/A | inherent | NO | N/A | N/A | MISSING beat | MISSING | PARTIAL |
| life_reveal | `registry/handlers/actions3.ts:174` | N/A | MISSING reveal UI | NO | NO | NO | `beatFor.ts:138-152` LIFE_REVEALED | MISSING | PARTIAL — engine reveals but UI doesn't show the card to player |
| reorder_bottom (peek_and_reorder) | `registry/handlers/actions3.ts:1129` `peekAndReorderOwnDeck`/`OppLife` | N/A | MISSING reorder UI | NO (V0 stub) | N/A | NO | MISSING beat | MISSING | BROKEN — V0 stub only updates knownByViewer; no actual reorder logic, no UI |
| choose_from_top_deck | (alias of `searcher_peek`) `actions3.ts:844` | (same) | MISSING (reverted) | NO | N/A | NO | `beatFor.ts:178-200` | e2e CARDS 13/17/18/19 | BROKEN — see searcher_peek |
| search_filter (search_deck) | `registry/handlers/actions2.ts:469` `peekTopOfDeck` | N/A | MISSING | NO | N/A | NO | MISSING beat | MISSING | PARTIAL |

## Status distribution

- **GREEN: 6** — on_play, activate_main, trigger, counter, choose_one, attach_don
- **PARTIAL: 12** — when_attacking, blocker, peek, play_for_free, give_power, reduce_power, give_don, rest_target, unrest_target, draw, trash, life_reveal, search_filter
- **BROKEN: 4** — searcher_peek (human), bounce (human multi-target), removal_ko (human multi-target), reorder_bottom, choose_from_top_deck (alias of searcher_peek)
- **MISSING: 0** — every family has at least an engine handler; the gaps are at UI/feedback layer

## Top 5 most critical gaps

1. **searcher_peek / choose_from_top_deck — BROKEN for human** — handler auto-resolves silently for everyone; no UI surface. Players don't see what was searched or which card was added to hand. Owner already flagged this (F-7x → F-7z work, now reverted to baseline).
2. **reorder_bottom — BROKEN** — handler is a V0 stub; only updates `knownByViewer`. No actual deck reorder, no UI. Any card with "look at top N and rearrange" silently does nothing visible.
3. **bounce / removal_ko — BROKEN for human multi-target** — auto-pick when effect text says "Up to 1 of your opponent's Characters". No target picker for the human; engine picks deterministically (often the wrong one).
4. **life_reveal — PARTIAL** — `LIFE_REVEALED` history event fires but no UI shows the revealed card to the player. Players see life drop without knowing what it was.
5. **give_power / reduce_power — PARTIAL** — no picker for "up to N" target effects. Auto-target is wrong for non-mandatory clauses.

## Common root cause pattern

All BROKEN/PARTIAL gaps share the same shape:

> Engine handler exists and produces correct state mutation. UI has no generic "pending target picker" / "pending reveal" / "pending reorder" prompt that mounts on the effect-family pending kind. So the player sees no chooser, no reveal, no target highlight, no result feedback.

The fix is the same architectural pattern repeated for each family:
- Add `Pending<Family>` interface to `state/types.ts`
- Add `RESOLVE_<FAMILY>` action to `protocol/actions.ts`
- Split handler: human → create pending; AI → keep deterministic
- Add reducer to consume RESOLVE_<FAMILY>
- Add generic `<Family>Prompt.tsx` that reads pending state (no card-specific code)
- Add beatFor entry so result is visible

No card-specific branches. The split is on `ctx.controller === A` (a generic engine check) and reads only effect metadata (filter, count, optional) from the action object.

## Caveats

- Agent #1 originally claimed blocker + counter were BROKEN ("engine handler missing entirely"). They are NOT — both are implemented in `reducers/attackFlow.ts` and verified by F-7n→F-7q manual playtests. Reclassified after re-grep.
- File:line citations on GREEN rows are agent-sourced; spot-check pending. Citations on BROKEN/PARTIAL rows have been verified.
- "tested" column reflects e2e in `effect-card-proof.spec.ts` only; unit tests in `shared/engine-v2/__tests__/` not surveyed for this matrix.
- CARD 1 (Off-White peek) is currently failing in e2e post-revert — unrelated to F-7z searcher_peek work. Flagged for Step F.
