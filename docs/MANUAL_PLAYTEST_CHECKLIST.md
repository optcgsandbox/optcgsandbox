# Manual Playtest Checklist — F-7o Private Alpha Lock

**Purpose:** owner-driven verification that the game *feels right to play*. Engine + server + harness all pass automated specs (28 server vitests; 17/18 + 18/18 soaks across phases; 14/14 local reactive + combat-smoke as of 2026-06-09). What remains untested is the human experience: clarity, responsiveness, "did I just lose a turn?", "what button do I click?". This doc exists so the owner can walk a structured pass, classify every issue, and exit alpha only when the criteria in §D are met.

**Authoritative for current shipped state.** Engine paths cited inline with `file:line`. Anything not cited is owner-reported. Do NOT add fixes here — issues feed into a separate triage list per §C.

**Build under test:**
- Online H-vs-H: `http://localhost:5174/?online=1` (lobby route, gated in `src/App.tsx:34`).
- Local vs-AI: `http://localhost:5174/` (default route, mode switcher in `src/App.tsx:95-113`).
- Build start: `npm run dev` (project root).

**Owner identity for two-tab online runs:** use Browser A (e.g. Chrome) and Browser B (e.g. Firefox profile or incognito) so cookies don't collide. The lobby fields are `data-testid="online-session-id"` + `data-testid="online-color-select"` + `data-testid="online-find-match"` (`src/online/OnlineLobby.tsx:81,90,105`).

---

## A. ONLINE — HUMAN VS HUMAN

| # | Item | Repro | Expected | Pass / Fail | Subsystem if failed |
|---|---|---|---|---|---|
| A1 | Find match works | Both browsers open `/?online=1`. Browser A: type any session ID, pick a color, click **Find Match**. Browser B: type *the same* session ID, pick a different color, click **Find Match**. | Both `data-testid="online-phase"` flip to `connected` within 15s. `online-board-phase` reads `main` for the active side. | ☐ | `worker/Matchmaker.ts` + `src/online/useOnlineMatch.ts` |
| A2 | Turn ending feels responsive | Active side: scroll the grouped action panel to the **Turn** section, click **END_TURN**. | Within ~500ms the panel updates: active side flips to opp; phase reads `main` for opponent's turn. No "thinking…" lag > 1s. | ☐ | `MatchSession.applyPlayerAction` + `OnlinePlayfield` re-render |
| A3 | END_TURN obvious | Inspect the action panel on first opportunity. | END_TURN sits under its own labelled **Turn** group section (BUG-009.A fix: `src/online/OnlinePlayfield.tsx` grouped action panel). Not lost in a flat row. | ☐ | `src/online/labelAction.ts` `actionGroup` classifier |
| A4 | Character attack works | After T2, on the active side with a non-summoning-sick character, click DECLARE_ATTACK against opp leader. | Both tabs flip to `block_window` (`online-board-phase` reads `block_window`). Opp tab shows pending banner. | ☐ | `attackFlow` reducers + pending projection |
| A5 | Leader attack works | First turn opportunity, click DECLARE_ATTACK with own leader → opp leader. | Same as A4 — both tabs reach `block_window`. | ☐ | Same path; verified online by `shared/server/__tests__/blockerCounter.online.test.ts` |
| A6 | Can play character cards | Hand has an affordable character. Click its `online-action-N` PLAY_CARD button. | Character moves from hand to field; cost paid; DON moves to `donRested`. Active tab shows the new field card. | ☐ | `mainPhase.playCardReducer` + projection |
| A7 | Can play event cards | Hand has an affordable event. Click PLAY_CARD. | Event resolves and lands in trash (or its effect window opens). No stuck pending. | ☐ | `mainPhase.playCardReducer` + event effect spec V2 |
| A8 | Can activate effects | Field has a character/leader with `[Activate: Main]` and the OPT slot free. Click ACTIVATE_MAIN. | Effect fires per card text; OPT counter records use; no double-fire on second click. | ☐ | `activateMain` enumeration in `legality.ts` + `effects/` |
| A9 | Can attach DON | Active main phase, click ATTACH_DON. | One `donCostArea` instance moves to leader.attachedDon (or selected character). `donConservation` invariant holds (total 10). | ☐ | F-7k BUG-002 path; `shared/server/relinkInstances.ts` |
| A10 | Blocker window appears | Defender has a `[Blocker]` character on field. Attacker declares attack. | Defender's tab shows `online-pending-banner` with "BLOCK STEP — choose blocker or skip" (BUG-009.B fix: `src/online/OnlinePlayfield.tsx:246-261`). Reactive group shows the DECLARE_BLOCKER button. | ☐ | `OnlinePlayfield.PendingBanner` + grouped actions |
| A11 | Can actually choose blocker | Within block_window, click the DECLARE_BLOCKER button for the blocker character. | Attack's pending target redirects to blocker; blocker rests; phase advances to `counter_window`. | ☐ | `attackFlow.declareBlockerReducer` |
| A12 | Counter window appears | After SKIP_BLOCKER or DECLARE_BLOCKER + redirect, phase becomes `counter_window`. | Defender's banner reads "COUNTER STEP — play counters or skip". PLAY_COUNTER buttons appear under **Counter Response** group. | ☐ | `OnlinePlayfield.PendingBanner` + `actionGroup` |
| A13 | Can actually choose counter | Hand has counter-event or character with counterValue. Click its PLAY_COUNTER. | counterBoost in projection increases by the counter amount; can stack a second counter; SKIP_COUNTER finishes the step. | ☐ | `attackFlow.playCounterReducer` |
| A14 | Trigger window appears | Attack reduces a player's life and the flipped life card has `effectSpecV2.clauses[*].trigger === 'trigger'`. (Corpus cards: OP01-009 Carrot, OP05-109 Pagaya, OP13-106 Conney — only 3 cards.) | Controller of the flipped life sees a TRIGGER banner + RESOLVE_TRIGGER buttons. | ☐ | `triggerWindow` phase + `RESOLVE_TRIGGER` legality |
| A15 | Can activate trigger | Click "Activate" branch of RESOLVE_TRIGGER. | Effect fires per the trigger clause (e.g. Carrot's `play_self_from_life`). Pending clears. Damage resolves or is replaced per card text. | ☐ | `shared/server/__tests__/triggerWindow.online.test.ts` 5 scenarios |
| A16 | Damage/life feels understandable | After attack resolves successfully, inspect life counts on both tabs. | Defender's life count visibly decreases by 1 (assuming no save). Field rest/un-rest matches expectations. No phantom life. | ☐ | `resolveDamage` in `attackFlow` |
| A17 | Win/loss state obvious | Drive a match to completion (concede or natural). | `online-board-phase` flips to indicate result. Banner/screen makes loser and reason clear. | ☐ | Result projection — verify the online UI surfaces `state.result.{loser, reason}` |
| A18 | KO cards don't shift weirdly | KO a defender via attack with counter math. | Field collapses cleanly: KO'd card moves to trash, remaining cards don't jump positions or duplicate. | ☐ | `OnlinePlayfield` field render order (BUG-009.G area) |
| A19 | No missing buttons | At every action point, every `legalActions` entry should be clickable. Specifically: when projection has 30+ legal actions (T2-3), make sure the panel scrolls. | Every `legalAction` from the server appears as `online-action-N` in the grouped panel. No actions silently dropped. | ☐ | `OnlinePlayfield` `GroupedActions` rendering |
| A20 | No soft-lock | Play 3–5 full games attempting all of A4–A15 paths. | Game never stalls. No tab needs Reload. No "nothing is clickable" state. | ☐ | Whole stack |

**Recommended online test order:** A1 → A3 → A2 → A9 → A6 → A7 → A8 → A4 → A10 → A11 → A12 → A13 → A5 → A14 → A15 → A16 → A18 → A17 → A19 → A20. (Setup → quick wins → reactive coverage → match-end.)

---

## B. LOCAL VS AI

Same UI surface for the playfield (`src/components/PlayfieldStage.tsx`) but the AI drives the opponent seat. Mode switcher is in the header (Easy / Medium / Hard). Default `vs-easy` (`src/store/game.ts:475`).

| # | Item | Repro | Expected | Pass / Fail | Subsystem if failed |
|---|---|---|---|---|---|
| B1 | Setup flow drives | Open `/`. Click both dice buttons until rolls non-tie. Pick "Go First" or wait for AI auto-fire (`FirstPlayerChoicePrompt.tsx:58-61`). Click "Keep" mulligan. | Reach `T1 · main`. Header status shows current phase + AI indicator when AI thinks. | ☐ | `DiceRollPrompt` + `FirstPlayerChoicePrompt` + `MulliganPrompt` + `PlayfieldStage` |
| B2 | Blocker prompt appears | Play a `[Blocker]` character (e.g. OP01-014 Jinbe). End turn. AI attacks. | `BlockerPrompt` modal (bottom-anchored, "Blocker Step" heading, "Block · {name}" buttons) renders. AttackResolutionOverlay also visible behind it. | ☐ | `src/components/BlockerPrompt.tsx` (Phase D) |
| B3 | Can choose blocker locally | Click "Block · {name}". | Attack redirects to blocker; blocker rests; phase advances to `counter_window`. AttackResolutionOverlay updates. | ☐ | `BlockerPrompt` → `dispatch({type:'DECLARE_BLOCKER'})` → `attackFlow` |
| B4 | Skip Blocker works locally | At block_window, click "Skip Blocker". | Phase advances to `counter_window` with no redirect. | ☐ | Phase A path |
| B5 | Counter prompt usable | At counter_window with a counter card in hand, tap the card (HandFan), then click "PLAY COUNTER" in CardDetailModal. | counterBoost increments; AttackResolutionOverlay's badge updates; can SKIP_COUNTER to finish. | ☐ | `CardDetailModal` PLAY_COUNTER path |
| B6 | Trigger prompt usable | Take leader damage with a trigger card on top of life (Carrot OP01-009 etc — easy to seed manually via console with `?test=1`). | `TriggerPrompt` modal opens with Activate enabled (Phase C re-enable: `TriggerPrompt.tsx:51-52`). | ☐ | `TriggerPrompt` |
| B7 | Activate trigger fires effect | At trigger_window, click "Activate". | Effect resolves per card spec; pending clears; damage path completes correctly. | ☐ | Engine `triggerWindow` reducers |
| B8 | AI resumes after response | Pick any reactive (B3/B4/B5/B6/B7). | Within ~500ms the AI continues its turn — attacks/effects proceed, eventually END_TURN, A's main returns. No deadlock. | ☐ | `runAiTurn` re-entry guard (`store/game.ts:694-726`) gated by `aiPaused` |
| B9 | No silent auto-skips | Watch carefully: every reactive window where you have a real choice should *show a prompt*. The AI should NOT silently take the choice for you. | Prompt appears every time DECLARE_BLOCKER or PLAY_COUNTER or RESOLVE_TRIGGER is available. Pre-BUG-010 the engine silently auto-skipped — fixed in Phase A/B at `store/game.ts:341-385`. | ☐ | Phase A/B narrowed yield |
| B10 | Human feels in control | Play 3–5 full local games on Medium difficulty. | At every decision point the human has a clear visible choice. No turn happens "to" the human. End-of-turn discard for hand >10 surfaces a prompt. | ☐ | Whole local UI |

**Recommended local test order:** B1 → B4 → B2 → B3 → B8 → B5 → B6 → B7 → B9 → B10.

---

## C. BUG TRIAGE RULE

Every issue the owner notes during A or B above MUST be classified before any fix discussion. Add a row to a separate triage list (do not edit the checklist — that's for repeat passes).

| Class | Definition | Owner | Examples |
|---|---|---|---|
| 1. real gameplay bug | Engine or reducer produces an outcome that violates CR rules or `effectSpecV2` for the card. Reproducible deterministically. | Backend Architect | Wrong damage math; KO'd card stays on field; counter doesn't add power. |
| 2. UX clarity issue | Engine correct, but the human couldn't tell what to do or what happened. | UX Architect | "I didn't realize the block_window opened"; "I didn't see the trigger prompt"; "the END_TURN button looked the same as PLAY_CARD". |
| 3. expectation mismatch / OPTCG rule | Owner expected different behavior, but the engine matches official OPTCG rules / CR / Bandai FAQs. | (none — close, link CR section) | "Block should grant +1000 power" (no — that's only [On Block]). |
| 4. test-only stale harness | A test's assertion was written against the OLD silent-auto-skip behavior or other deprecated path. | Code Reviewer | The BUG-010 follow-up that updated `core-combat-smoke` + `multi-turn-smoke`. |
| 5. engine/server defect | Server-side projection, MatchSession state machine, or worker DO behaves incorrectly under concurrency / load. | Backend Architect | Tab reload loses pending state; opponent_left fires on intentional reload; matchmaker pairs wrong session IDs. |

**Triage discipline:** every owner-reported issue gets exactly ONE classification. No "both 1 and 2". If unclear, default to 2 (UX clarity) and revisit after a fix attempt. Class 3 closes the report — no fix. Class 1+5 go to BUG-011+ in `docs/GAMEPLAY_BUGLOG.md`. Class 2 goes to a new UX punch-list. Class 4 goes straight to harness update with no production code touch.

---

## D. PRIVATE ALPHA EXIT CRITERIA

`PRIVATE_ALPHA_READY` is locked only when ALL of the following hold:

1. **Owner manually confirms core gameplay feels correct.** All section A items A1–A20 marked Pass, plus all section B items B1–B10 marked Pass, on a fresh build, across at least one full pass per item.
2. **No blocker / counter / trigger confusion.** Specifically: A10–A15 + B2–B7 all Pass with the owner reporting "obvious where to click" — class-2 UX clarity issues at zero.
3. **No stuck turns.** Across all match attempts in §A and §B, zero soft-lock (A20, B10). If even one soft-lock occurred, do NOT lock alpha — file a class-1 or class-5 bug first.
4. **No missing UI for legal actions.** Every `legalAction` the server emits has a clickable surface (A19). No silent skips locally (B9). Verified by playing through several attack and effect cycles.
5. **No gameplay-breaking bug in 5+ full games.** Owner completes at least 5 full matches (online + local mix). Any class-1 or class-5 finding bumps `PRIVATE_ALPHA_READY` back to `BLOCKED` until resolved + re-verified.
6. **Triage list is current.** Every owner observation from §A/§B is recorded with a class per §C. Open class-1, class-2, class-5 items have either an owner-approved fix in progress or an owner-approved "ship anyway" note.

When all six hold, update `docs/PRIVATE_ALPHA_READINESS.md` "Verdict" line to `PRIVATE_ALPHA_READY` with the date of the final confirming playtest.

If any one criterion fails after a fix cycle, restart §A or §B from item 1. No partial credit.
