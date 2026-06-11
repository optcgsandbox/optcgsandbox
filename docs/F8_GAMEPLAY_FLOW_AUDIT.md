# F-8 Step C — Gameplay Flow Audit (Local vs-AI)

**Method:** Read every prompt component (`src/components/*Prompt.tsx`), the cinematic queue (`src/gameLog/PresentationQueue.tsx:1-80`), the beat mapper (`src/gameLog/beatFor.ts:1-50`), the game store's local-AI auto-resolve loop (`src/store/game.ts:425-645`), and the engine action handlers (`shared/engine-v2/registry/handlers/*`, `shared/engine-v2/reducers/attackFlow.ts`). Cross-referenced with Step A (effect family matrix) and Step B (corpus compatibility).

**Authoritative facts:**

- **13 cinematic beat kinds** total (`beatFor.ts:13-26`): CARD_PLAYED, ATTACK_DECLARED, BLOCKED, COUNTERED, BOUNCED, KOD, LIFE_LOST, TRIGGER_ACTIVATED, EFFECT_ACTIVATED, NO_VALID_TARGET, SEARCHER_RESULT, COMBAT_RESULT, GAME_OVER.
- **9 reactive prompts** (`src/components/*Prompt.tsx`): Dice, FirstPlayerChoice, Mulligan, Trigger, Blocker, Counter, Choose, PeekChoice, DiscardChoice.
- **Silent history events** (engine emits, no beat): DRAW (`beatFor.ts:1-8` explicit comment "DRAW, DON attach, internal CLAUSE_FIRED — return null"), DON_ATTACHED, POWER_MODIFIED (folded inside COMBAT_RESULT only), REST_TARGET/UNREST_TARGET, TRASH_CARDS (non-KO), LIFE_REVEALED (no standalone beat), PHASE_CHANGE, TURN_START, MULLIGAN_TAKEN, DICE_ROLLED.

**Lens:** can the player ask "what happened? / why? / what do I click? / why did combat fail?" at any moment? If yes for any single phase = FAIL.

---

## Per-phase audit

### 1. MATCH START

| Aspect | Observation |
|---|---|
| A. Player sees | Bootstrap loads; PlayfieldStage renders empty board with leader cards. |
| B. Animation | None — instant load. |
| C. Text/feedback | None — no "Match started" indicator. |
| D. Interaction | Wait for dice roll prompt. |
| E. Silent | Deck shuffle, hand deal (5 cards), life deal (4-5 cards from deck). |
| F. Confuse | Player may not realize life cards came from deck. |
| G. Missing UI | No "shuffle" animation, no "dealing life" animation. |
| H. Root cause | No beat kind for LIFE_CARDS_DEALT, CARDS_DRAWN (setup). |
| I. Severity | **LOW** (polish only — once game starts player understands). |

### 2. DICE ROLL

| Aspect | Observation |
|---|---|
| A. Player sees | `DiceRollPrompt.tsx` mounts with two dice buttons. |
| B. Animation | Dice roll animation (per memory `optcgsandbox_f7n_to_f7q_combat_ux.md`). |
| C. Text/feedback | "You rolled X / Opponent rolled Y". |
| D. Interaction | Tap to roll. |
| E. Silent | Nothing. |
| F. Confuse | None. |
| G. Missing UI | None. |
| H. Root cause | N/A. |
| I. Severity | **GREEN**. |

### 3. FIRST PLAYER CHOICE

| Aspect | Observation |
|---|---|
| A. Player sees | `FirstPlayerChoicePrompt.tsx` — winner picks "I go first" or "Opponent goes first". |
| B. Animation | Static prompt. |
| C. Text/feedback | Choice acknowledged. |
| D. Interaction | Tap one option. |
| E. Silent | Phase transition to mulligan. |
| F. Confuse | None. |
| G. Missing UI | None. |
| H. Root cause | N/A. |
| I. Severity | **GREEN**. |

### 4. MULLIGAN

| Aspect | Observation |
|---|---|
| A. Player sees | `MulliganPrompt.tsx` shows hand + Keep / Mulligan buttons. |
| B. Animation | Hand shows; on mulligan, cards return to deck + new hand fans out. |
| C. Text/feedback | Hand visible; outcome reflected in board. |
| D. Interaction | Keep or Mulligan once. |
| E. Silent | Opponent's mulligan decision (only "they kept" or "they mulliganed" indicator). |
| F. Confuse | If both mulligan, does opponent see new hand size? Not visible from local. |
| G. Missing UI | No "Opponent mulliganed" beat. |
| H. Root cause | No MULLIGAN_TAKEN beat kind. |
| I. Severity | **LOW** (rare; one-shot at start). |

### 5. DRAW (per turn)

| Aspect | Observation |
|---|---|
| A. Player sees | Card slides from deck into hand (UI animation in PlayfieldStage). |
| B. Animation | Card animates from deck pile to hand fan. |
| C. Text/feedback | None — silent. The new card just appears in hand. |
| D. Interaction | None — automatic. |
| E. Silent | "Why did I draw?" "Whose turn started?" — phase transition is silent. |
| F. Confuse | Effect-triggered draws (e.g. searcher_peek with no match) just show hand size +1 with no explanation. |
| G. Missing UI | No DRAW beat. `beatFor.ts:1-8` comment explicitly says "DRAW → null". |
| H. Root cause | Owner direction F-7q "I do NOT want extra spam." Trade-off bites when effect causes draw. |
| I. Severity | **HIGH** for effect-triggered draws (Step B: 272 draw clauses); **MEDIUM** for turn-start draw (player knows it's their turn). |

### 6. DON

| Aspect | Observation |
|---|---|
| A. Player sees | DON deck shows two DON cards animate to the DON area. |
| B. Animation | DON animation (per F-7v polish work). |
| C. Text/feedback | DON count visible in HUD. |
| D. Interaction | None — automatic. |
| E. Silent | Where DON came from (deck) is implied. |
| F. Confuse | Effect-attached DON (`give_don_to_target`, 85 clauses) silent — DON moves from pool to a Character without any beat. |
| G. Missing UI | No DON_ATTACHED beat. No DON_GIVEN beat. |
| H. Root cause | Beat-spam aversion (F-7q). |
| I. Severity | **HIGH** for effect-attached DON; **LOW** for phase DON (visible animation). |

### 7. MAIN

| Aspect | Observation |
|---|---|
| A. Player sees | Hand, DON, board, leader. |
| B. Animation | Static. |
| C. Text/feedback | Card cost dots, legality dim/bright. |
| D. Interaction | Tap card to play; long-press to inspect; drag DON to attach. |
| E. Silent | Why some cards are dimmed (legality reason) is implicit — no tooltip. |
| F. Confuse | "Why can't I play this?" — no answer surfaced in UI. (Step A: legality reasons live in `rules/legality.ts:107-336` but never get rendered.) |
| G. Missing UI | "Why illegal" tooltip / inspector. |
| H. Root cause | Legality returns Action[]; UI maps allowed actions but doesn't expose "not allowed because: cost / phase / once_per_turn". |
| I. Severity | **MEDIUM** (player can usually figure it out from cost dots). |

### 8. PLAY CARD

| Aspect | Observation |
|---|---|
| A. Player sees | Card moves from hand to field; CARD_PLAYED beat fires (1700ms, `PresentationQueue.tsx:30`). |
| B. Animation | Card travels + center-screen "You Played X" beat with card reveal. |
| C. Text/feedback | Beat text + card name. |
| D. Interaction | None during beat unless on_play opens a prompt. |
| E. Silent | Cost paid (DON spends animate but no beat); summoning sickness applied silently. |
| F. Confuse | None for the play itself. |
| G. Missing UI | None. |
| I. Severity | **GREEN**. |

### 9. ON PLAY

| Aspect | Observation |
|---|---|
| A. Player sees | EFFECT_ACTIVATED beat fires (`beatFor.ts:222-227`, 1500ms). F-7w added human-readable subText. F-7y added downstream result-line scan (`beatFor.ts:379-404`). |
| B. Animation | Beat then downstream prompt or auto-resolve. |
| C. Text/feedback | "Played X — drew 2 cards" etc. (when downstream scan finds a result). |
| D. Interaction | Depends on clause (choose_one → ChoosePrompt; searcher_peek → silent auto; bounce → silent auto). |
| E. Silent | searcher_peek silent (Step A: BROKEN). Bounce/KO/power_buff with "up to" silent (Step B: ~638 clauses). |
| F. Confuse | "I played a searcher and got a card I didn't pick" — biggest single confusion. |
| G. Missing UI | Generic Target Picker (~638 clauses), Searcher UI (183 clauses), Reorder UI (39), Reveal UI (46), Choice-from-zone (143). |
| H. Root cause | Handlers auto-resolve for `ctx.controller === A` — no human/AI split. |
| I. Severity | **CRITICAL** — biggest single source of "what just happened?" |

### 10. CHOOSE / TARGET

| Aspect | Observation |
|---|---|
| A. Player sees | When clause is `choose_one`, `ChoosePrompt.tsx:25` mounts (z-[70]). When `peek`, `PeekChoicePrompt.tsx:15`. |
| B. Animation | Prompt fades in. |
| C. Text/feedback | Options shown; depends on clause `subText`. |
| D. Interaction | Tap option. |
| E. Silent | When clause needs target choice (removal_ko "up to 1") — NO UI mounts; engine picks. |
| F. Confuse | Inconsistent UX: choose_one prompts; target picks don't. |
| G. Missing UI | TargetPickPrompt (action-clause variant). |
| H. Root cause | Engine doesn't open `PendingTargetPick` for action clauses (only for `attack_target_pick`). |
| I. Severity | **CRITICAL** — Step B: ~638 clauses affected. |

### 11. ACTIVATE MAIN

| Aspect | Observation |
|---|---|
| A. Player sees | Activate button on Leader/Character/Stage when legal (legality.ts:316-336). On tap, EFFECT_ACTIVATED beat fires with downstream result line (F-7y). |
| B. Animation | Beat. |
| C. Text/feedback | "Activated X — gave Leader +2000 power" (F-7y downstream scan). |
| D. Interaction | Tap activate-main button. |
| E. Silent | If clause has target choice, same gap as ON PLAY. |
| F. Confuse | None for the activate itself; gap is in downstream effects. |
| G. Missing UI | (same as ON PLAY) |
| I. Severity | **PARTIAL** — activate path is GREEN, downstream-effect gap mirrors ON PLAY. |

### 12. ATTACK DECLARE

| Aspect | Observation |
|---|---|
| A. Player sees | Tap attacker (rested) → tap target. `attack_target_pick` pending opens if multiple targets (`PendingTargetPick`, `BlockerPrompt.tsx`-adjacent flow). |
| B. Animation | ATTACK_DECLARED beat (1300ms). |
| C. Text/feedback | "You attack Leader" / "You attack X". |
| D. Interaction | Tap attacker + tap target. |
| E. Silent | Power values not displayed during declare (only during COMBAT_RESULT). |
| F. Confuse | None at declare. |
| G. Missing UI | Pre-attack power preview (attacker power vs target power) would help. |
| I. Severity | **GREEN** (declare itself). |

### 13. BLOCKER

| Aspect | Observation |
|---|---|
| A. Player sees | `BlockerPrompt.tsx:15` mounts (Step A verified). Player picks blocker or skips. |
| B. Animation | BLOCKED beat fires if a blocker chosen (`beatFor.ts:106`). |
| C. Text/feedback | "Blocked by X". |
| D. Interaction | Tap blocker candidate or Skip. |
| E. Silent | When player has no eligible blocker, prompt may or may not mount (need to verify). |
| F. Confuse | If multiple blockers eligible, picker UI works (verified F-7n-q). |
| G. Missing UI | "No eligible blocker" auto-skip message if applicable. |
| I. Severity | **GREEN** for the choice; **MEDIUM** for the auto-skip case. |

### 14. COUNTER

| Aspect | Observation |
|---|---|
| A. Player sees | `CounterPrompt.tsx:27` mounts. F-7y reduced selected-tile scale (0.85 → 0.62) for layout. |
| B. Animation | COUNTERED beat fires per counter played (`beatFor.ts:114`, 1300ms). COMBAT_RESULT later. |
| C. Text/feedback | "You countered +N" or "Opponent countered +N". |
| D. Interaction | Tap counter event from hand or Skip. |
| E. Silent | Counter character keyword (from hand, automatic +N from each counter symbol) — Step A: GREEN with F-7y polish. |
| F. Confuse | F-7y polish (CARD 20) confirms "no counter" sub-text when none used. |
| G. Missing UI | None for V0; eventual chain visualization for multi-counter turns. |
| I. Severity | **GREEN**. |

### 15. TRIGGER

| Aspect | Observation |
|---|---|
| A. Player sees | `TriggerPrompt.tsx:22` mounts when a life card has [Trigger]. TRIGGER_ACTIVATED beat (`beatFor.ts:158`, 2000ms). |
| B. Animation | Life card flips face up; beat plays. |
| C. Text/feedback | "Trigger: X". |
| D. Interaction | Activate or Decline. |
| E. Silent | Card identity is revealed even on Decline — this matches OPTCG rules (the life is revealed when checked). |
| F. Confuse | None. |
| G. Missing UI | None. |
| I. Severity | **GREEN**. |

### 16. DAMAGE / LIFE

| Aspect | Observation |
|---|---|
| A. Player sees | COMBAT_RESULT beat (1700ms) with attacker/target card visuals + power numbers (F-7s/F-7w). If damage dealt, LIFE_LOST beat (1800ms) follows. |
| B. Animation | Power numbers, then life card moves to hand (or top of life stack). |
| C. Text/feedback | Power math visible. F-7w dual-card visuals. F-7y "no blocker / no counter" sub-text. |
| D. Interaction | None. |
| E. Silent | If attack fails, the "why" — POWER_MODIFIED inside combat now surfaced (powerModSourceName / powerModDirection on COMBAT_RESULT). Outside combat power changes have NO standalone beat. |
| F. Confuse | "Why is power 0?" answered IF the debuff happened during combat (powerModSourceName). NOT answered if power was debuffed in a prior phase. |
| G. Missing UI | POWER_MODIFIED standalone beat for non-combat debuffs. |
| I. Severity | **MEDIUM** (combat itself is GREEN; non-combat power changes are silent). |

### 17. KO

| Aspect | Observation |
|---|---|
| A. Player sees | KOD beat fires (`beatFor.ts:132`, 1700ms) with card visual. |
| B. Animation | Card travels to trash. |
| C. Text/feedback | "X KO'd". |
| D. Interaction | None. |
| E. Silent | Cause of KO (which card / clause caused it). |
| F. Confuse | "Why did my character KO?" — if from combat, obvious. If from a clause (`removal_ko`), the source isn't named in the beat. |
| G. Missing UI | KO source attribution in beat subText. |
| H. Root cause | KOD beat (`beatFor.ts:130-136`) doesn't track cause history. F-7x added similar attribution for searcher; KO needs same. |
| I. Severity | **HIGH** (gameplay-critical attribution). |

### 18. BOUNCE / TRASH

| Aspect | Observation |
|---|---|
| A. Player sees | BOUNCED beat (`beatFor.ts:123`, 2000ms) for source → hand. TRASH has no beat. |
| B. Animation | Bounce card moves to hand. Trash silent. |
| C. Text/feedback | "X bounced" but no source attribution. |
| D. Interaction | None. |
| E. Silent | Trash (mill/discard from effect) silent — no MILL_RESULT / DISCARD_BY_OPP beat. |
| F. Confuse | "I had a card in hand; now it's in trash. Why?" — opponent discard effects (6 firings/1000 games, Step B) silent. |
| G. Missing UI | DISCARD_BY_OPP beat, MILL_SELF beat. |
| H. Root cause | No beat for trash actions. |
| I. Severity | **HIGH** for opponent-caused discard; **MEDIUM** for self-mill. |

### 19. END TURN

| Aspect | Observation |
|---|---|
| A. Player sees | "End Turn" button. On tap, turn passes. |
| B. Animation | Brief turn-pass indicator (per F-7q work). |
| C. Text/feedback | "Opponent's Turn" label. |
| D. Interaction | Tap End Turn. |
| E. Silent | End-of-turn cleanup (`self_trash_at_end_of_turn`, 4 firings) silent. Continuous effect expiry silent. |
| F. Confuse | "Where did my +2000 buff go?" — buff expires at end of turn silently. |
| G. Missing UI | END_OF_TURN_CLEANUP beat (or per-buff-expired beat). |
| H. Root cause | No event emitted for buff expiry. |
| I. Severity | **MEDIUM** (rare situation but breaks mental model). |

### 20. GAME END

| Aspect | Observation |
|---|---|
| A. Player sees | GAME_OVER beat (`beatFor.ts:165`, 2500ms) with winner/loser. |
| B. Animation | Card + result. |
| C. Text/feedback | "You Won" / "You Lost". |
| D. Interaction | Return to home / play again. |
| E. Silent | Final board state cleared. |
| F. Confuse | None. |
| G. Missing UI | Post-game summary (which effects fired most, etc.) — POLISH only. |
| I. Severity | **GREEN**. |

---

## Opponent visibility

Owner asked: "Can player understand opponent's draw / hand growth / play from hand / add to hand / trash / bounce / DON attach / activate effects / life movement?"

| Opponent action | Visible? | Beat | Notes |
|---|---|---|---|
| Draw (turn start) | Implicit (hand size grows) | NO | No DRAW beat. |
| Hand growth from effect (searcher) | **NO** | SEARCHER_RESULT exists but only fires when human controller resolved; for opponent's searcher, the engine auto-resolves but beat may or may not fire (need verify in code). Per `beatFor.ts:178-200` SEARCHER_RESULT does fire for opp too, but for opp the picked card identity may be hidden — Step E item. |
| Play from hand | **YES** | CARD_PLAYED | "Opponent Played X" — works. |
| Add to hand (non-searcher) | **NO** | none | Life → hand, bounce → opp hand: silent. |
| Trash | **NO** | none | Mill / discard from effect silent. |
| Bounce (opp own char back to opp hand) | **YES** | BOUNCED | works. |
| DON attach | **PARTIAL** | none for effect-attach | Phase-DON visible; effect-attach via `give_don_to_target` silent. |
| Activate effects | **YES** | EFFECT_ACTIVATED | F-7t added; F-7w made human-readable. |
| Life movement | **PARTIAL** | LIFE_LOST + TRIGGER_ACTIVATED | LIFE_LOST hides primaryInstanceId for opponent's life per `beatFor.ts` LIFE_LOST controller-check (per memory). Reveal events silent. |

---

## Lens questions (owner-specified)

### Q1. Why does local gameplay still feel "glitchy" despite passing tests?

Tests verify ENGINE state mutations are correct. They do NOT verify the PLAYER experiences a coherent narrative. Specifically:

1. **Engine auto-resolves human searcher_peek silently** — `actions3.ts:844`. Tests pass because the state mutation is correct; the player saw nothing.
2. **Auto-target for "up to 1" effects** — `actions.ts:154, 233, 76, 298, 346`. Engine picks deterministically; player never chose.
3. **Beat-kind coverage gaps** — only 13 beat kinds exist (`beatFor.ts:13-26`). DRAW, DON attach, POWER_MODIFIED (outside combat), REST_TARGET, LIFE_REVEALED, TRASH all return null. Step B totals: 272 + 85 + 412 + 127 + 46 + various = ~942 clause instances that mutate state with NO standalone beat.
4. **PresentationQueue yields to interactive prompts** (`PresentationQueue.tsx:55-72`) — when an interactive prompt mounts, beats DRAIN. Good in principle; bad when the player wanted to see the result of the action that opened the prompt.
5. **No "why illegal" tooltip** — legality reasons exist (`rules/legality.ts`) but aren't surfaced. Player taps a card, nothing happens, no explanation.

Net effect: gameplay is mechanically correct but narratively silent for ~30% of the corpus.

### Q2. Five UX failures that most damage playability

1. **Searcher silently auto-resolves for human** — 183 clauses, every single Bonney/Moda/searcher card. (Step B Gap 2.)
2. **Auto-target for "up to 1" clauses** — ~638 clauses across removal_ko / removal_bounce / power_buff / rest_target / set_active / give_don_to_target. Player never chose. (Step B Gap 1.)
3. **No KO source attribution** — KOD beat doesn't name the clause/card that caused the KO. Combat KOs are obvious; effect KOs are not.
4. **No DRAW beat** — effect-triggered draws (Izo, etc.) silently add cards to hand. Player thinks card came from somewhere else.
5. **No "why illegal" feedback** — player taps illegal card / illegal target, sees nothing. No tooltip, no shake, no toast.

### Q3. Smallest generic fixes in correct order

1. **Add `PendingTargetPick` (action-clause variant) + `TargetPickPrompt.tsx`** — fixes #2 above; unlocks ~638 clauses. ONE generic fix.
2. **Add `PendingSearcherPeek` + `SearcherPeekPrompt.tsx`** — fixes #1 above; unlocks 183 clauses. ONE generic fix (the F-7z Part A pattern, now reverted, owner already saw the design).
3. **Add KO_SOURCE attribution to KOD beat** — Single beatFor change; reuses existing scanCombatChain / scanEffectResults pattern.
4. **Add EFFECT_DREW / DRAW_FROM_EFFECT beat** — single beat kind addition. Only fires when DRAW event has a `cause` field (not for phase-draw).
5. **Add "why illegal" toast on illegal-tap** — surfacing legality.ts reasons through a new UI hook. No engine change.

### Q4. What should be fixed BEFORE new visuals?

The above 5 fixes (engine pending splits + beat additions + legality toast). Until those land, no new visual polish helps because the underlying narrative is silent.

### Q5. What should be deferred?

- Render hierarchy / z-stack polish (Step D) — deferred until interactions resolve.
- Combat sideways-card layout — visual but doesn't change comprehension.
- Opponent hand fan rendering — important but no comprehension blocker; opp hand size is already visible.
- Post-game summary, mulligan history, dice animation polish — all polish.
- Per-card semantic e2e (e.g. one test per searcher card) — generic family tests suffice.

---

## Top 10 issues ranked

| Rank | Issue | Severity | Affected clauses | Fix kind | Step ref |
|---|---|---|---|---|---|
| 1 | searcher_peek silent auto-resolve for human | CRITICAL | 183 | Engine split + UI prompt | A, B Gap 2 |
| 2 | No target picker for "up to 1" action clauses | CRITICAL | ~638 | Engine split + UI prompt | A, B Gap 1 |
| 3 | No reorder UI + engine V0 stub | CRITICAL | 39 | Engine completion + UI prompt | A, B Gap 3 |
| 4 | No KO source attribution | HIGH | all effect-driven KOs | beatFor enrichment | C-17 |
| 5 | No DRAW beat for effect-triggered draws | HIGH | 272 effect-draws | New beat kind | C-5 |
| 6 | No reveal UI (life_reveal, reveal_top variants) | HIGH | 46 | beatFor enrichment OR new prompt | A, B Gap 4 |
| 7 | No "why illegal" feedback | HIGH | every illegal tap | New UI hook | C-7 |
| 8 | No DON_ATTACHED beat for effect-attached DON | HIGH | 85 | New beat kind | C-6 |
| 9 | No discard / mill / opp-discard beat | HIGH | ~28 | New beat kind | C-18 |
| 10 | No buff-expired indicator at end of turn | MEDIUM | rare but breaks mental model | New beat kind | C-19 |

## Dependency map

```
[1] searcher_peek UI    →  needs    [Generic Pending kind pattern established]
[2] target picker UI    →  needs    [Generic Pending kind pattern established]
[3] reorder UI          →  needs    [#1 or #2 pattern; engine reorder logic]
[4] KO attribution      →  needs    [beatFor causal-scan; already exists for combat]
[5] DRAW beat           →  needs    [DRAW history event carries `cause` field — engine change]
[6] reveal UI           →  needs    [beat already has card field; just render it]
[7] why-illegal toast   →  needs    [legality.ts to return reason strings — engine change]
[8] DON_ATTACHED beat   →  needs    [new beat kind only]
[9] discard/mill beat   →  needs    [new beat kind only]
[10] buff-expired beat  →  needs    [continuous-manager emits expiry event]
```

Pattern A: **Generic `Pending<X>` + `<X>Prompt.tsx` pair** — applies to #1, #2, #3, #6 (reveal variant).
Pattern B: **beatFor enrichment** — applies to #4, #5 (after engine change), #6 (display), #8, #9, #10.
Pattern C: **Legality reason exposure** — applies to #7.

Three patterns repeated; ~10 implementation tasks; zero card-specific code.

## Recommended implementation order

1. **Establish the generic `PendingTargetPick` action-clause variant** (covers #2 — biggest impact, ~638 clauses). This sets the precedent.
2. **Apply same pattern to `PendingSearcherPeek`** (covers #1 — 183 clauses).
3. **Add KO source attribution** (covers #4 — quick win, reuses existing scan utilities).
4. **Add DRAW beat with `cause`** (covers #5 — quick win once engine emits cause).
5. **Reveal UI rendering** (covers #6 — beatFor enrichment, no engine change).
6. **Why-illegal toast** (covers #7 — UI hook).
7. **DON_ATTACHED + discard/mill beats** (covers #8, #9 — new beat kinds only).
8. **Reorder UI + engine completion** (covers #3 — heaviest single fix).
9. **Buff-expired beat** (covers #10 — needs continuous-manager change; defer).

Stop point per owner directive. Steps D / E / F next; final synthesis after that.
