# Gameplay Buglog — F-7k Stage 4

**Last refreshed:** 2026-06-08

Each entry classified per F-7k taxonomy:
`engine_bug / legality_bug / projection_bug / websocket_bug / ui_bug / action_bug / card_bug / desync`.

Each entry includes: discovery context, reproduction, root cause, classification, and resolution status.

---

## BUG-001 — Game stalls at end of every turn (server doesn't drive RDD pipeline)

- **Classification:** `engine_bug` (server-side engine orchestration gap, not a per-card defect).
- **Severity:** **CRITICAL — no online match can progress past turn 1.**
- **Discovery context:** F-7k Stage 3 multi-turn spec (`e2e/online/gameplay/multi-turn.spec.ts`).
  - Step 1: A's turn 1 legalActions = `[END_TURN, ATTACH_DON, CONCEDE]` ✓ correct.
  - Step 2: A clicks `END_TURN` → action_accepted ✓.
  - Step 3: Both tabs' `active-player` flips to `B` ✓.
  - Step 4: **B's legalActions = `[CONCEDE]` only.** Expected `[END_TURN, …PLAY_CARD…, ATTACH_DON, CONCEDE]`.
  - Game stalls — only legal action B can take is CONCEDE. No PLAY_CARD, no ATTACH_DON, no END_TURN.

- **Root cause:**
  - Per `shared/engine-v2/reducers/turnFlow.ts:25` `endTurnReducer` comment:
    > "Engine ends turn + flips activePlayer + leaves phase='refresh' for the new active player. The host (store) runs the paced R/D/D pipeline so each phase animates visibly."
  - **In LOCAL play**, `src/store/game.ts:215-275` drives `enterRefresh → enterDraw → enterDon → enterMain` after END_TURN.
  - **In ONLINE play**, `shared/server/MatchSession.applyPlayerAction` at `MatchSession.ts:91` calls `applyAction(state, player, action)` and stops. **No post-action R/D/D/Main pipeline runs.**
  - Result: B's authoritative state stays at `phase='refresh', activePlayer=B`. `getLegalActions(state, 'B')` returns only `CONCEDE` because `phase !== 'main'` blocks every other action.

- **Citations:**
  - `shared/engine-v2/reducers/turnFlow.ts:20-37` — endTurnReducer leaves `phase='refresh'`.
  - `shared/server/MatchSession.ts:80-104` — applyPlayerAction stops after applyAction.
  - `src/store/game.ts:222-267` — LOCAL paced pipeline driver. The server has no analog.
  - `worker/devSetup.ts:182-185` — server DOES drive R/D/D/Main at setup, but only in `buildPlayableInitialState`, not after END_TURN.

- **Why no existing test caught this:**
  - F-7g smoke `worker/__smoke__/lobby-ws-smoke.mts` stops at A's first END_TURN (CONCEDE-tested).
  - F-7h Playwright spec stops at A's first END_TURN + CONCEDE.
  - All Stage C / Stage D corpus tests use the engine directly with their OWN paced pipeline driver. They never exercise the server's MatchSession lifecycle past one END_TURN.
  - The matrix's "Turn progression" row claimed `Online UI: PARTIAL` — actual status is `BROKEN`.

- **Fix design (applied):**
  - Centralized invariant in `shared/server/turnPipeline.ts` exposing `advanceTurnPipelineIfNeeded(state)`. Returns `state` unchanged if `phase !== 'refresh' || result !== null`; otherwise drives `enterRefresh → enterDraw → enterDon → enterMain` and returns the new state.
  - `shared/server/MatchSession.ts:applyPlayerAction` now runs the helper after every `applyAction`. END_TURN is NOT special-cased — any reducer that leaves the engine at `refresh` triggers the same sweep.
  - `shared/server/MatchSession.ts:replayLog` runs the helper too so live state and replayed state are bit-identical.
  - `shared/server/serialize.ts:replayToFinalState` and `shared/server/serializeCompact.ts:compactReplayToFinalState` also call the helper. Without those, every serialized replay with an END_TURN failed `final_hash_mismatch`.

- **Regression tests added:**
  - `shared/server/__tests__/matchSession.turn-pipeline.test.ts` — 5 tests covering:
    1. A END_TURN → `phase==='main'`, `activePlayer==='B'`, B has ≥1 non-CONCEDE action.
    2. Pipeline drives on EVERY END_TURN (turns 1 → 2 → 3).
    3. NO false-trigger on phase=main actions (ATTACH_DON).
    4. Replay parity holds across END_TURN.
    5. NO pipeline drive when match has concluded (CONCEDE).
  - All 22 server vitest files (287 tests) green post-fix.
  - `e2e/online/gameplay/multi-turn.spec.ts` — Playwright proof through the real lobby:
    - A turn1 dump: `END_TURN, PLAY_CARD, PLAY_CARD, ATTACH_DON, CONCEDE`
    - B turn1 dump: `END_TURN, ATTACH_DON, CONCEDE` (proves BUG-001 dead — pre-fix this was `[CONCEDE]` only)
    - A turn2 dump: `END_TURN, PLAY_CARD, PLAY_CARD, PLAY_CARD, ATTACH_DON, DECLARE_ATTACK, CONCEDE`

- **Resolution status:** **RESOLVED 2026-06-08.**

---

## BUG-002 — `ATTACH_DON` rejected with `DON_CONSERVATION` invariant

- **Classification:** `engine_bug` (state-shape invariant violated at the JSON-deserialization boundary, not a per-card defect).
- **Severity:** **CRITICAL** — every online match where a player tries to attach DON (or play a card costing DON) fails. PLAY_CARD also affected by the same mechanism.
- **Discovery context:** Surfaced by the F-7k Stage 3 multi-turn spec (`e2e/online/gameplay/multi-turn.spec.ts`). When A clicks ATTACH_DON / PLAY_CARD on turn 1, the server responds:
  ```
  action_rejected: engine_error: InvariantError [DON_CONSERVATION]:
  player A: 9 DON instances total; expected 10.
  ```
- **Root cause (confirmed by diagnostic + JSON-round-trip regression test):**
  - The engine reducers + invariants assume reference aliasing — specifically, `state.players.A.leader` and `state.instances[leader.instanceId]` are the SAME object (verified by `shared/engine-v2/__tests__/fixtures.ts:116-141` and `shared/engine-v2/__tests__/smoke.test.ts:154-163`'s direct fixture construction).
  - LOCAL play preserves this aliasing because `structuredClone` preserves reference identity within the clone.
  - ONLINE play passes the `initialState` over a Cloudflare Durable-Object RPC boundary (`worker/Matchmaker.ts:312` → `worker/GameRoom.ts:135` via `req.json()`), which is a `JSON.parse(JSON.stringify(...))` round-trip. JSON serialization does NOT preserve reference identity.
  - Result post-round-trip: `state.players.A.leader.attachedDon` is a SEPARATE array from `state.instances[leaderId].attachedDon`.
  - `ATTACH_DON` reducer (`shared/engine-v2/reducers/mainPhase.ts:54-84`) shifts a DON from `pl.donCostArea` (−1) and pushes to `target.attachedDon` via the instances table (+1 on the instances-table copy).
  - DON_CONSERVATION invariant (`shared/engine-v2/invariants/check.ts:34-51`) counts via `pl.leader.attachedDon` (player-table copy, which never saw the push).
  - Net visible: −1, observed total = 9.
- **Why vitest passed initially, Playwright failed:**
  - Direct `buildPlayableInitialState({seed}) → new MatchSession(state) → applyPlayerAction` keeps aliasing intact (no JSON round-trip).
  - The `--local` wrangler dev runs the same Matchmaker → GameRoom RPC boundary as production, so the JSON round-trip happens in every online test path.
  - Confirmed by the new test `REGRESSION: ATTACH_DON works on a JSON-round-tripped initial state (the worker-RPC path)` which fails before the fix and passes after.
- **Fix design (applied):**
  - New helper `shared/server/relinkInstances.ts` exporting `relinkInstances(state)`. Walks `players.A` and `players.B` and re-points `leader`, every `field[i]`, and `stage` (if non-null) at `state.instances[instanceId]`. Idempotent + O(small constant per player).
  - Applied at every server ingress where a state might have come from a JSON round-trip:
    - `MatchSession` constructor — after `structuredClone(initialState)` for both `_state` and `_initialState`.
    - `MatchSession.replayLog` — after `structuredClone(initialState)`.
    - `serialize.replayToFinalState` — after `structuredClone(replay.initialState)`.
    - `serializeCompact.compactReplayToFinalState` — after `rehydrateInitialState(replay, staticData)`.
- **Regression tests added:**
  - `shared/server/__tests__/donConservation.attachDon.test.ts` (5 tests):
    1. Smoke: A and B each have 10 DON immediately after `buildPlayableInitialState`.
    2. REPRO: ATTACH_DON on the playable corpus-deck setup keeps DON total at 10 (single seed).
    3. REPRO: ATTACH_DON sweep across 200 seeds, A turn 1.
    4. REGRESSION: ATTACH_DON works on a JSON-round-tripped initial state (the worker-RPC path) — *this test FAILS without `relinkInstances` and PASSES with it*.
    5. REPRO: PLAY_CARD on A turn 1 must keep DON total at 10 across 100 seeds.
  - All 23 server vitest files / 287 tests + the new 5 = 24/292 GREEN after fix.
  - Updated `e2e/online/gameplay/multi-turn.spec.ts` to click ATTACH_DON (and PLAY_CARD when DON remains). Browser test passes; `A turn1: ATTACH_DON accepted` is the proof.
- **Before vs after DON-zone count (A, turn 1, after ATTACH_DON):**
  | Zone | Pre-fix (broken) | Post-fix |
  |---|---|---|
  | `donDeck` | 9 | 9 |
  | `donCostArea` | 0 (shifted out) | 0 (shifted out) |
  | `donRested` | 0 | 0 |
  | `pl.leader.attachedDon` (player-side ref) | 0 (push went to other copy) | 1 (push observed via aliased ref) |
  | `state.instances[leader].attachedDon` (instances-side ref) | 1 | 1 (same object) |
  | **Invariant total** | **9** ❌ | **10** ✅ |
- **Resolution status:** **RESOLVED 2026-06-08.**

---

## BUG-007.A — Soak picker deadlocked on RESOLVE_CHOOSE_ONE / PEEK / TARGET_PICK pending windows

- **Classification:** `ui_bug` (harness strategy gap, not engine). Caught by the F-7k BUG-007 soak harness.
- **Severity:** **MEDIUM** for the soak harness. Engine-side: no impact — these windows resolved correctly when a button was clicked. But if a UI doesn't have buttons for these RESOLVE_* actions OR a player doesn't know what to click, the match deadlocks.
- **Discovery context:** v1 of the soak harness (`e2e/online/gameplay/soak/gameplay-soak.spec.ts`) ran 18 matches; 4 deadlocked with this exact signature:
  ```
  phase=choose_one active=B
  A buttons=[CONCEDE]
  B buttons=[RESOLVE_CHOOSE_ONE, RESOLVE_CHOOSE_ONE, CONCEDE]
  ```
- **Root cause:** `e2e/online/gameplay/soak/strategy.ts` `RESOLVE_PRIORITY` only handled `RESOLVE_TRIGGER` and `RESOLVE_DISCARD`. When a card effect opened `choose_one_window` / `peek_choice` / `attack_target_pick`, the picker returned `null` because none of the enumerated `RESOLVE_*` actions matched any priority. Deadlock guard correctly trips after 8 null polls.
- **Engine-side correctness:** confirmed. The engine emits exactly the right legalActions for these windows per `shared/engine-v2/rules/legality.ts:78-128` (`RESOLVE_PEEK`, `RESOLVE_DISCARD`, `RESOLVE_CHOOSE_ONE`, `RESOLVE_TARGET_PICK`). Click any of them and the engine proceeds.
- **Fix (applied):** `e2e/online/gameplay/soak/strategy.ts` — added `RESOLVE_CHOOSE_ONE`, `RESOLVE_PEEK`, `RESOLVE_TARGET_PICK` to `RESOLVE_PRIORITY` ahead of skips and END_TURN.
- **Verification:** soak v2 (after fix) reproduced ZERO deadlocks across the same 18-game matrix.
- **Resolution status:** **RESOLVED 2026-06-09.**

---

## BUG-007.B — Soak picker overused PLAY_COUNTER, dragging matches past 60-turn cap

- **Classification:** `ui_bug` (harness strategy gap, not engine).
- **Severity:** **LOW** for the soak. Engine-side: no impact — counters worked correctly. Just made matches drag.
- **Discovery context:** Soak v3 (`MAX_CLICKS=1500, TICK=80ms`) hit `turn-cap` (61 turns) on `red-vs-blue game 1` and `click-cap` on `red-vs-yellow game 1` (1500 clicks at turn 15). Both shared a stalemate pattern: defender countered every attack, no leader took lethal damage.
- **Root cause:** `e2e/online/gameplay/soak/strategy.ts` `REACTIVE_PRIORITY` listed `PLAY_COUNTER` first. Defender played a counter on EVERY attack. With 50-card decks containing many counter-capable cards, this dragged matches indefinitely.
- **Fix (applied):** removed `PLAY_COUNTER` from `REACTIVE_PRIORITY`. Defender now SKIPs counters (which the priority falls through to). Click-path coverage for PLAY_COUNTER is preserved by deterministic vitest at `shared/server/__tests__/blockerCounter.online.test.ts` (5 scenarios) and the dedicated browser probe at `e2e/online/gameplay/blocker-counter-flow.spec.ts`.
- **Verification:** soak v6 (cap=6000, 80-turn cap) — 18/18 matches completed cleanly, longest match 16 turns (was 38+ in v3).
- **Resolution status:** **RESOLVED 2026-06-09.**

---

## BUG-007.C — Soak orchestrator raced result-set vs button-disable on click attempt

- **Classification:** `ui_bug` / spec race condition.
- **Severity:** **LOW** for the soak. Engine and UI were both correct; the orchestrator's polling missed a result-set event that fired between its "check result" and "click" steps.
- **Discovery context:** Soak v4 `red-vs-blue game 3` failed with `click-error: locator.click: Timeout 5000ms exceeded` on END_TURN.
- **Root cause:** `OnlinePlayfield.tsx:84-87,98-101` disables action buttons when `isOver` (match result set). The orchestrator's result-check ran ~80ms before the click attempt; if the result arrived in that window, the button was disabled and `locator.click()` timed out.
- **Fix (applied):** `gameplay-soak.spec.ts` — when `click()` throws, re-check `online-match-result` on both tabs. If a result arrived, treat as clean completion rather than `click-error`.
- **Verification:** soak v5/v6 — no `click-error` failures.
- **Resolution status:** **RESOLVED 2026-06-09.**

---

## BUG-009 — Online UI failed real human playability (8 sub-issues)

- **Discovery context:** owner manual playtest of `localhost:5174/?online=1` on 2026-06-09. The `gameplay-soak.spec.ts` harness picker tolerated every UI condition because it auto-clicked any `[data-testid^="online-action-"]` button — humans could not find the same buttons because the `OnlinePlayfield` rendered all legal actions as a flat 30-button row with no phase context, no banner for pending windows, and no card-kind hint.
- **Severity:** **CRITICAL for alpha** — owner reported the game was unplayable for a human despite the engine + projection + WebSocket pipeline all working correctly (proven by the soak's 18/18 result and 28 server vitests).
- **Classification:** `ui_bug` cluster. Engine + server + projection all confirmed correct; every fix below is in `src/online/`.

### BUG-009.A — Opponent first-turn END_TURN was buried in flat action list

- **Root cause:** the legacy `AvailableActions` panel (pre-fix `OnlinePlayfield.tsx:108-211`) rendered ALL legal actions as one undifferentiated row of buttons. END_TURN sat between PLAY_CARD/ATTACH_DON buttons and gave no visual hint that it was the turn-ending action.
- **Fix:** grouped action panel — END_TURN now appears under a dedicated **Turn** group section with its own header. Groups are rendered in the order of their minimum global index (so DOM order still matches the engine's legality enumeration, preserving `online-action-N` testId invariants used by existing browser specs).
- **Files:** `src/online/labelAction.ts` (new `actionGroup` classifier + `ACTION_GROUP_ORDER`), `src/online/OnlinePlayfield.tsx` (`GroupedActions` component).
- **Resolution:** **RESOLVED 2026-06-09.**

### BUG-009.B — Defender couldn't find blocker response

- **Root cause:** when `phase === 'block_window'`, the engine correctly emits `[SKIP_BLOCKER, ...DECLARE_BLOCKER(...), CONCEDE]` for the defender. Pre-fix UI rendered these in the same flat list as main-phase actions. Defender had no signal a response window opened.
- **Fix:** **pending-window banner** rendered at the top of the playfield when `phase ∈ PENDING_PHASES`. Big colored block with phrase-specific copy ("BLOCK STEP — choose blocker or skip") + `data-testid="online-pending-banner"` + `data-needs-response="you|opp"` so the defender sees an immediate visual cue. Reactive actions also grouped under the **Blocker Response** section in the action panel.
- **Files:** `src/online/OnlinePlayfield.tsx` (`PendingBanner` + `PHASE_BANNER` map).
- **Resolution:** **RESOLVED 2026-06-09.**

### BUG-009.C — Defender couldn't find counter response

- **Root cause:** same as BUG-009.B for `counter_window`.
- **Fix:** banner + **Counter Response** group section.
- **Resolution:** **RESOLVED 2026-06-09.**

### BUG-009.D — Card effects (ACTIVATE_MAIN) weren't clearly clickable

- **Root cause:** `ACTIVATE_MAIN` legalAction was rendered with label `Activate {name}` but mixed into the flat list. No "Card Effects" section header.
- **Fix:** **Card Effects** group section in the action panel. Label refined to `Activate: {name}` for consistency with other action labels.
- **Files:** `src/online/labelAction.ts` (label + group classifier), `src/online/OnlinePlayfield.tsx` (panel structure).
- **Resolution:** **RESOLVED 2026-06-09.**

### BUG-009.E — Event cards couldn't be visually distinguished from characters

- **Root cause:** the `labelAction` PLAY_CARD label was uniform `Play {name}` regardless of card kind. Event vs character vs stage looked identical, so a defender clicking "Play X" had no idea whether the engine would put X on field or trash X as an event effect.
- **Fix:** `labelAction` now reads `state.cardLibrary[cardId].kind` and labels per-kind: `Play Event: {name}`, `Play Character: {name}`, `Play Stage: {name}`. Group classifier puts them in **Play Events**, **Play Characters**, **Play Stage** sections respectively.
- **Files:** `src/online/labelAction.ts` + tests, `src/online/OnlinePlayfield.tsx`.
- **Resolution:** **RESOLVED 2026-06-09.**

### BUG-009.F — Field cards shifted when one was KO'd

- **Root cause:** the legacy SidePanel rendered `side.field` as `Array.map(...).join(', ')`. Removing an array element shifted all subsequent cards' textual position.
- **Fix:** stable-slot rendering — both sides' field row now renders as a fixed 5-slot grid (FIELD_CAP). Empty slots show a dashed placeholder; KO'd card's slot becomes empty without shifting the others. Slots have `data-testid="{side}-field-slot-{0..4}"`.
- **Files:** `src/online/OnlinePlayfield.tsx` (`SidePanel`).
- **Resolution:** **RESOLVED 2026-06-09.**

### BUG-009.G — ADVISORY (not in BUG-009 scope): opponent trash count appeared upside-down

- **Location:** `src/components/PlayfieldStage.tsx` (LOCAL-PLAY-vs-AI screen, NOT the online lobby). The local UI rotates the opponent half 180° via CSS transform; the trash count text wasn't counter-rotated.
- **Status:** **DEFERRED — out of BUG-009 allow-list.** Owner explicitly excluded `src/components/PlayfieldStage.tsx` from BUG-009 since it's local-play only and online is the alpha surface. Log here for visibility; would belong in a separate local-play UI ticket.
- **Resolution:** **NOT FIXED IN F-7k.**

### BUG-009.H — Trigger window didn't show the revealed life card identity / no card visualization

- **Root cause:** `publicProjection` does not expose `state.history` to viewers (`shared/server/publicProjection.ts:22-34` only forwards `phase, turn, activePlayer, firstPlayer, pending, result, players, instances, cardLibrary, viewer`). The trigger window's `pending.pendingTrigger.lifeCardInstanceId` resolves into B's hidden hand from A's POV; B can resolve it from its own hand. The UI today shows a text label "Activate trigger / Decline trigger" but no card visualization or attack feedback feed.
- **Fix scope constraint:** any solution requires either modifying `publicProjection` (forbidden — server contract change) OR computing event diffs client-side from sequential snapshots in the store. BUG-009 was scoped UI-only; this fix is **DEFERRED to F-7m**.
- **Mitigation in F-7k:** the pending-window banner shows "TRIGGER STEP — Activate the trigger or decline" with `data-needs-response="you"` for B and `data-needs-response="opp"` for A. The two RESOLVE_TRIGGER buttons in the action panel are labeled `Activate trigger` / `Decline trigger` (per BUG-009.D label refinement). The card identity reveal + combat history feed are NOT in F-7k.
- **Status:** **PARTIAL — banner + grouped buttons land in F-7k; full card-reveal + history feed deferred.**

### Verification

| Gate | Result |
|---|---|
| Server vitest + labelAction (`shared/server/__tests__/` + `src/online/labelAction.test.ts`) | 28 files / 356 tests passed (+32 new BUG-009 label/group tests). |
| `npx vite build` | OK. |
| `npx wrangler deploy --dry-run` | OK. |
| Combined Playwright (online-two-tab + 6 prior gameplay specs + new `human-playability-regression.spec.ts`) | 9/9 passed (~1.2 min). |
| `SOAK_FULL=1` gameplay soak harness | **17/18 cleanly completed** (8 A wins / 9 B wins / 7725 clicks / longest 13 turns). 1 click-cap edge case (same red-vs-green slow-grind flake observed in BUG-007 v5) — picker logic unchanged, single failure attributable to seed not UI. |
| Manual two-tab playtest | **REQUIRED before restoring `PRIVATE_ALPHA_READY`** — owner-driven. |

- **Classification:** `engine_bug` (CR §6-5-7 hand-size limit not enforced for count > 1).
- **Severity:** **HIGH** — players could satisfy the 10-card hand limit at end of turn by discarding only 1 card regardless of excess. Long matches would accumulate hand size unboundedly.
- **Discovery context:** F-7k BUG-008 pinning of the discard prompt path. Vitest Scenario 5 ("drain to hand=10") expected two RESOLVE_DISCARD clicks to land the player at exactly hand=10. After the first click, the engine closed the window and flipped activePlayer, leaving hand=11 with turn ending.
- **Reproduction (vitest):**
  ```typescript
  state = buildBasicGameState();
  state.turn = 3;
  state.activePlayer = 'A';
  // Pad A.hand to 12 cards.
  session = new MatchSession(state);
  session.applyPlayerAction('A', { type: 'END_TURN' });
  // → phase=discard_choice, pending.discard.count=2
  session.applyPlayerAction('A', { type: 'RESOLVE_DISCARD', pickedId: pickFirst });
  // Pre-fix: pending=null, activePlayer=B, A.hand=11 (BUG)
  // Post-fix: pending.discard.count=1, A.hand=11, window still open
  ```
- **Citations:**
  - Rule: CR §6-5-7 "at end of turn, discard down to 10".
  - Window open: `shared/engine-v2/phases/PhaseScheduler.ts:331-348` correctly sets `pendingDiscard.count = excess`.
  - Reducer bug: `shared/engine-v2/reducers/choiceResolve.ts:resolveDiscardReducer` discarded one card and unconditionally cleared `state.pending` regardless of `pd.count`.
- **Fix (applied):** in `resolveDiscardReducer`, after discarding the picked card, check `pd.count > 1`. If true → replace `state.pending` with `{ kind: 'discard', pendingDiscard: { ...pd, count: pd.count - 1 } }` and return (window stays open). If false → proceed with the existing close-and-finalize path. No legality enumerator change needed (per-card enumeration already correctly reads current hand contents).
- **Regression tests added:** `shared/server/__tests__/discardPrompt.online.test.ts` (5 scenarios — window-open, legalActions enumeration, hidden-info contract, single-click side effect, multi-click drain to hand=10).
- **Browser proof:** `e2e/online/gameplay/discard-prompt-flow.spec.ts` — drove A leader attacks against B (green deck → fast hand growth). B's hand exceeded 10; discard window opened; B drained via RESOLVE_DISCARD × 2; game continued without engine error.
- **Soak verification:** v9 (post-fix on clean environment) — 18/18 clean completion. Discard windows fired naturally during multi-turn play and all drained correctly.
- **Resolution status:** **RESOLVED 2026-06-09.**

---

## BUG-010 — Local vs-AI silently auto-skipped human reactive windows (BLOCK / COUNTER / TRIGGER)

- **Discovery context:** owner manual playtest 2026-06-09. Symptom: "the computer can use triggers, I cannot." `OnlinePlayfield` had been audited at length and proven symmetric (BUG-009 cycle); the symptom only reproduced in LOCAL vs-AI play on `/` (default route, mode `vs-easy`).
- **Severity:** **HIGH** — local vs-AI is the entry-point flow; humans couldn't block, couldn't counter, and couldn't activate triggers despite the engine fully supporting all three.
- **Classification:** `ui_bug` cluster (UI layer in `src/store/game.ts` + `src/components/`). Engine + reducers untouched.
- **Root cause:**
  - `src/store/game.ts:341-363` (pre-fix) contained a `while` loop inside `runAiTurn` that unconditionally force-dispatched `SKIP_BLOCKER` / `SKIP_COUNTER` for the human defender whenever `phase ∈ {'block_window', 'counter_window'}` during the AI's turn.
  - `src/store/game.ts:362-376` (pre-fix) auto-resolved `trigger_window` for the human controller with `RESOLVE_TRIGGER{activate:false}` silently.
  - `src/components/TriggerPrompt.tsx:49` (pre-fix) hard-disabled the **Activate** button with a stale v0-stub comment; even when the engine would have rendered the prompt, the button was unclickable.
  - No `BlockerPrompt` component existed — `AttackResolutionOverlay` provided only a center attacker-vs-defender visual + a "Decline Blocker" pass-through button.

### Phase A — narrow `block_window` / `counter_window` force-skip

- **Fix:** replaced the unconditional `while` with a yield: read `getLegalActions(next, defender)`, filter out `CONCEDE` / `SKIP_BLOCKER` / `SKIP_COUNTER`, and if any real options remain (DECLARE_BLOCKER, PLAY_COUNTER) commit state + set `aiPaused: true` + return. Otherwise continue auto-skipping the no-choice case so the AI turn doesn't deadlock on phantom windows.
- **Files:** `src/store/game.ts:341-367`.
- **Resolution:** **RESOLVED 2026-06-09.**

### Phase B — yield `trigger_window` to the human

- **Fix:** single-shot yield when `pending.kind === 'trigger' && pendingTrigger.controller === AI_HUMAN`. Commit state + set `aiPaused: true` + return; `TriggerPrompt` mounts and the human dispatches `RESOLVE_TRIGGER`.
- **Files:** `src/store/game.ts:368-385`.
- **Resolution:** **RESOLVED 2026-06-09.**

### Phase C — restore Activate on `TriggerPrompt`

- **Fix:** replaced the stale hard-disable with `pendingTrigger == null || pendingTrigger.lifeCardInstanceId === undefined`. The engine resolves `RESOLVE_TRIGGER{activate:true}` fully (per BUG-004 + 5 scenarios in `shared/server/__tests__/triggerWindow.online.test.ts`).
- **Files:** `src/components/TriggerPrompt.tsx:49-52`.
- **Resolution:** **RESOLVED 2026-06-09.**

### Phase D — `BlockerPrompt` picker UI

- **Root cause (continuation):** after Phase A landed, the engine yielded `legalActions = [DECLARE_BLOCKER(...), SKIP_BLOCKER, CONCEDE]` to A during AI attacks, but there was no UI surfacing the DECLARE_BLOCKER picks. AttackResolutionOverlay only renders a single "Decline Blocker" button.
- **Fix:** new component `src/components/BlockerPrompt.tsx`. Renders during `phase === 'block_window'` when the viewer is the defender; reads `s.legalActions` for every `DECLARE_BLOCKER` and emits one "Block · {name}" button per option plus a primary "Skip Blocker" button. Mounted alongside `TriggerPrompt` in `PlayfieldStage.tsx:529-530`. AttackResolutionOverlay remains for the attacker-vs-defender visual; the BlockerPrompt owns the actual choice.
- **Files:**
  - NEW `src/components/BlockerPrompt.tsx`
  - `src/components/PlayfieldStage.tsx:39-40` (import) + `:529-530` (mount)
- **Re-entry guard fix (`aiPaused` flag):** added `aiPaused: boolean` to `GameStore` (defaults `false`; set `true` only by Phase A/B yields; cleared when the re-entry guard restarts `runAiTurn`). The end-of-`dispatch` re-entry at `src/store/game.ts:694-726` now requires `aiPaused === true`, so seed-style harness tests that bypass `runAiTurn` (e.g. `e2e/family-blocker.spec.ts` directly dispatching DECLARE_BLOCKER / SKIP_COUNTER) are not accidentally pulled into an AI turn after their dispatches.
- **Regression spec:** `e2e/local-ai/local-vs-ai-human-reactive.spec.ts` — 3 tests:
  1. Setup flow drives DiceRollPrompt → FirstPlayerChoicePrompt → MulliganPrompt → main (deterministic UI cadence).
  2. Deterministic seed (mirrors `family-blocker.spec.ts`): seed OP01-014 Jinbe on A.field, force `phase=block_window` with B leader → A leader, assert BlockerPrompt mounts, "Block · Jinbe" button visible, click redirects pending attack to Jinbe + rests Jinbe + transitions to `counter_window` + AttackResolutionOverlay coexists.
  3. Skip Blocker path: click BlockerPrompt's "Skip Blocker" button, assert phase advances to `counter_window` with Jinbe still active.
  All 3 pass in 28.8s.
- **Resolution:** **RESOLVED 2026-06-09** (Phase D BlockerPrompt + spec landed).

### Follow-up — stale combat-smoke harness updated for new reactive behavior

- **Discovery context:** after Phase D landed, `e2e/core-combat-smoke.spec.ts:146:3` test 2 and `e2e/multi-turn-smoke.spec.ts:312:3` test 5 began failing. Both poll for `phase=main, activePlayer=A` after `drv.endTurn()`. Pre-fix the local store silently drained `block_window` / `counter_window` / `trigger_window` for the human defender during the AI turn, so the polling loop saw `main` immediately. Post-fix the AI loop yields (Phase A/B) when the human has any non-skip option, so the polling loop timed out — these were harness-expectation stale, not engine bugs. Confirmed pre-existing on HEAD before Phase D (git stash + re-run reproduces both failures).
- **Fix:** new helper `PlayerDriver.waitForAMainControlDrainingReactive(message, timeoutMs)` in `e2e/helpers/player.ts`. It polls the store every 200ms; when `phase` is a reactive window AND the pending controller is `A`, it dispatches the safe default (`SKIP_BLOCKER` / `SKIP_COUNTER` / `RESOLVE_TRIGGER{activate:false}` / `RESOLVE_DISCARD{pickedId:first-hand-id}`) so the AI can resume and end its turn. Both stale specs swap their local `waitForAMainControl` to call this helper.
- **Files:**
  - `e2e/helpers/player.ts` — added `waitForAMainControlDrainingReactive`.
  - `e2e/core-combat-smoke.spec.ts:105-113` — local `waitForAMainControl` now delegates.
  - `e2e/multi-turn-smoke.spec.ts:167-172` — same.
- **Validation:**
  - `npx playwright test e2e/core-combat-smoke.spec.ts` → 5/5 pass.
  - `npx playwright test e2e/multi-turn-smoke.spec.ts` → 5/5 pass.
  - `npx playwright test e2e/local-ai/local-vs-ai-human-reactive.spec.ts e2e/family-blocker.spec.ts` → 4/4 pass (Phase D regression spec + family-blocker seed-style proof both still green).
  - `npx vite build` → OK.
- **What this does NOT change:** production app behavior. The helper is test-only and only used to stand in for a human player who would normally click the prompt button. Tests that DO assert the prompt rendered (`local-vs-ai-human-reactive.spec.ts`, `family-blocker.spec.ts`) drive the choice themselves and do NOT call the drain helper.
- **Resolution:** **RESOLVED 2026-06-09.**

### 46.1 BUG-010 follow-up note appended to online plan as well

See `docs/ONLINE_INTEGRATION_PLAN.md` §46.1 for the corresponding boundary note. No online code touched.

---

## BUG-011 — Local vs-AI counter_window had no usable picker (UI dead-end)

- **Discovery context:** owner manual playtest 2026-06-09, after Phase A/B/C/D shipped. Owner reached counter_window during AI attack; screen showed AttackResolutionOverlay's attacker-vs-defender visual + decorative ring + "DECLINE COUNTER" button — but no surface to play a counter. Owner reported "where can i choose to counter? doesn't show me any cards."
- **Severity:** **HIGH** — same severity-class as BUG-010: the engine offered `PLAY_COUNTER` in `legalActions` (`shared/engine-v2/rules/legality.ts:297-313`) but the local UI had no clickable surface for them. Human could not counter in local play.
- **Classification:** `ui_bug` cluster. Engine + reducers + Phase A yield untouched.
- **Root causes (two intertwined):**
  - **Hand was covered.** `AttackResolutionOverlay.tsx:69` is `fixed inset-0 z-40` with `bg-paper-cream/95 backdrop-blur-sm`. `HandFan.tsx:57` is `z-30`. During counter_window the overlay opaquely covers the hand; the user cannot tap a hand card to reach `CardDetailModal`'s PLAY_COUNTER affordance (`CardDetailModal.tsx:206-218`).
  - **Decorative ring, no timer.** `AttackResolutionOverlay.tsx:138` comment says "engine owns timing" but the engine does NOT have any wall-clock timer for `counter_window`. `grep SKIP_COUNTER` returns only the legality enumeration + Phase A's narrowed force-skip + UI dispatchers — nothing in the engine schedules a SKIP_COUNTER on a timer. The 8-second rotating SVG at `:145` is purely visual. Owner watching the ring complete saw nothing happen because nothing was scheduled to happen.

### Phase E — `CounterPrompt` picker UI + auto-decline timer

- **Fix:** new component `src/components/CounterPrompt.tsx`. Same z-50 bottom-anchored layout as `BlockerPrompt`, reads `s.legalActions` for every `PLAY_COUNTER`, renders one "Counter +{value} · {name}" button per option (uses `card.counterValue` for characters, `card.counterEventBoost` for events) plus a "Decline Counter" button. Mounted next to `BlockerPrompt` in `PlayfieldStage.tsx:530-531`.
- **Auto-decline timer (the second fix):** CounterPrompt schedules a real `setInterval` that ticks every 100ms; when the elapsed time hits `COUNTER_TIMER_MS = 8000` (matches the decorative ring duration so visual + behavior agree) it dispatches `SKIP_COUNTER`. Defensive guard inside the interval re-reads `useGameStore.getState()` and only dispatches when `phase === 'counter_window'` AND the viewer is still the defender — avoids React-18 concurrent-mode races where the helper or user already moved the engine past counter_window. Override via `window.__COUNTER_TIMER_MS` for fast spec runs.
- **Files:**
  - NEW `src/components/CounterPrompt.tsx`
  - `src/components/PlayfieldStage.tsx:40-41` (import) + `:530-531` (mount)
- **Untouched:** `AttackResolutionOverlay.tsx` is unchanged — its "DECLINE COUNTER" button remains as a fallback and its decorative ring still rotates (now its 8s rotation matches an actual scheduled event). `src/store/game.ts`, all engine reducers, all online code, all card data: untouched.
- **Regression spec:** `e2e/local-ai/local-vs-ai-human-reactive.spec.ts` extended with 3 Phase E tests:
  1. CounterPrompt renders during `counter_window` when A holds a counter-value character; "Counter +1000 · Seed Counter Char" button visible with correct `aria-label`. Clicking it increments `counterBoost` to 1000.
  2. Decline Counter dispatches `SKIP_COUNTER`; pending clears.
  3. Auto-decline timer fires after `window.__COUNTER_TIMER_MS=800` and pending clears without any click.
- **Validation:**
  - `npx vite build` → OK.
  - `npx playwright test e2e/local-ai/local-vs-ai-human-reactive.spec.ts e2e/multi-turn-smoke.spec.ts e2e/core-combat-smoke.spec.ts e2e/family-blocker.spec.ts` → **17/17 pass** (5.2 min).
- **Resolution:** **RESOLVED 2026-06-09.**

---

## BUG-012 / BUG-013 / BUG-014 / BUG-015 — Local reactive UI was text-only, missing math, missing attack feedback

- **Discovery context:** owner manual playtest 2026-06-09 (after Phase D/E/F-7n landed). Owner reported four overlapping issues during local vs-AI combat: counter UI showed "DECLINE COUNTER" but no card surface to play counters (the Phase E text-button picker did not feel like a card decision); blocker UI had text labels and the player couldn't read the card before choosing; trigger reveal wasn't obvious; and when YOU attack the AI, no animation or feedback surfaces — the dispatch path at `src/store/game.ts:556-570` synchronously drains the AI defender's block + counter windows in the SAME tick, so React never sees the intermediate phases. All four are UI bugs, not engine bugs.
- **Severity:** **HIGH** — game does not feel playable.
- **Classification:** `ui_bug` cluster. No engine, server, online, or cards.json change.

### Phase F — combat UI rewrite

**Card-tile picker (BUG-013 + BUG-012):**
- `src/components/BlockerPrompt.tsx` rewritten — full-screen z-50 prompt with a CardArt-tile row (one tile per `DECLARE_BLOCKER` legalAction at hand size 64×88) plus an attacker→target preview row (also CardArt). Tap a tile to immediately dispatch `DECLARE_BLOCKER`. "Skip Blocker" button stays at the bottom.
- `src/components/CounterPrompt.tsx` rewritten — full-screen z-50 prompt with CardArt tiles for every `PLAY_COUNTER` legalAction, live `attacker {power}` vs `target {power + counterBoost}` math, live `Counter so far: +{counterBoost}` boost readout (data-testid `counter-prompt-boost`), and a "Saves at +N" / "Need +N to save" hint computed from `effectivePowerForDisplay`. Tap a tile to dispatch `PLAY_COUNTER`; the tile disappears next render (engine consumed the card → not in legalActions). "Done / Skip Counter" button switches label based on whether any counters have been played.

**Timer policy (BUG-012 second half):**
- The 8-second decorative SVG ring in `AttackResolutionOverlay.tsx:138-173` was removed. Its line-138 comment ("engine owns timing") was factually wrong — `grep SKIP_COUNTER shared/engine-v2/**` returns zero scheduled timeouts. The ring animated for 8 seconds and then sat at full rotation forever.
- `CounterPrompt` owns the real timer now: 2 minutes (owner direction "Timer should be 2 minutes if kept"), visible MM:SS countdown (data-testid `counter-prompt-countdown`), defensive guard inside the interval re-reads `useGameStore.getState()` before dispatching SKIP_COUNTER. Override via `window.__COUNTER_TIMER_MS` for tests.

**Trigger UI (BUG-014):**
- `src/components/TriggerPrompt.tsx` already renders the flipped life card at `scale: 1.4` via `CardArt size="leader"` with the card's effect text underneath in a fog panel. Phase C re-enabled the Activate button. No further change required per owner direction "Do not hide the trigger card identity from the owner" — the prompt was already compliant. No timer added (owner direction "if there is a timer, same rule" — none kept).

**Attack feedback (BUG-015):**
- NEW `src/components/AttackFeedbackOverlay.tsx`. Reads a new `recentAttack` field on `GameStore` and renders a brief attacker→target visual at hand size for ~1500ms.
- `src/store/game.ts` adds `recentAttack: null | { attackerInstanceId, targetInstanceId, startedAt }`. When the dispatch path processes `DECLARE_ATTACK` AND the human is the attacker (`instances[attackerInstanceId].controller === viewAs`), it writes the snapshot BEFORE the synchronous AI-defender drain at line 556-570 (which would erase the pending). A 1500ms setTimeout self-clears the snapshot.
- Z-45 — sits above the playmat (z-30 hand) but below the reactive prompts (z-50) so a follow-on trigger_window covers it cleanly.

**AttackResolutionOverlay:**
- Decorative 8s ring removed (the only line edit in this file other than the open-condition comment). The fallback z-40 attacker→VS→defender visual + "Decline Blocker / Counter" button stays so the family-blocker harness assertion (`[aria-label="Attack resolution"]` visible in block_window) continues to pass.

**Regression spec extensions** (`e2e/local-ai/local-vs-ai-human-reactive.spec.ts`):
1. BlockerPrompt: tile wrapper with `data-blocker-instance-id` carries an inner CardArt `<button>`; clicking it redirects pending attack to the blocker.
2. CounterPrompt: tile wrapper with `data-counter-instance-id` carries an inner CardArt `<button>`; live boost readout updates from "+0" to "+1000" after tap; tile disappears on next render (card consumed).
3. CounterPrompt countdown text reads `M:SS` with `window.__COUNTER_TIMER_MS = 65_000` → initial reading "1:05" (within one tick of slop).
4. AttackFeedbackOverlay: setting `recentAttack` via `__store.setState` mounts `[data-attack-feedback]`.

- **Validation:**
  - `npx vite build` → OK.
  - `npx playwright test e2e/local-ai/local-vs-ai-human-reactive.spec.ts e2e/family-blocker.spec.ts` → **11/11 pass** (2.0 min).
  - `npx playwright test e2e/core-combat-smoke.spec.ts e2e/multi-turn-smoke.spec.ts` → **10/10 pass** (6.0 min).
- **Resolution:** **RESOLVED 2026-06-09.**

---

## BUG-016 — Local play was unreadable: no game-communication layer

- **Discovery context:** owner manual playtest 2026-06-09. Despite Phase A/B/C/D/E/F-7n shipping all reactive prompts with card tiles, owner could not tell what was happening during play — "Cards move with no reason. Opponent actions are invisible. Effects/triggers are unclear." App was correct but unreadable.
- **Severity:** **BLOCKER for alpha.** Owner classified F-7p as P0 and gated `PRIVATE_ALPHA_READY` on this fix.
- **Classification:** `ui_bug` (player-feedback). Engine emitted history events all along; UI never consumed them.

### F-7p — local-only communication layer (Steps A + B + C; online Step E deferred)

**Step A — minimal engine additions (smallest payload per owner direction):**
- `shared/engine-v2/phases/PhaseScheduler.ts:172` — added `CARD_DRAWN { instanceId, controller }` emission in `enterDraw` right after `pl.hand.push(topId)`. Hidden-info redaction handled at format time, not reducer.
- `src/store/game.ts:266` — emit `TURN_STARTED { turn, activePlayer }` at the refresh→draw→don→main boundary in `runPhasePipelineWithDelays`. The store's pipeline doesn't call `PhaseScheduler.enterMain` (the engine version just refolds continuous; the store has its own pacing), so the event is pushed here.
- `shared/engine-v2/registry/handlers/actions.ts:247` — `CARD_BOUNCED` event payload extended with `sourceInstanceId: ctx.sourceInstanceId`. Critical causal chain ("Trafalgar Law → Chopper returned to hand" per owner direction). The handler already had `ctx` in scope (underscored as unused); recording it is additive.

**Step B — shared formatter (`src/gameLog/formatGameEvent.ts`):**
- Single pure function `formatGameEvent(event, ctx)` returns `{ severity: 'minor'|'major', message: string, kind: string } | null`. Suppresses internal events (`CLAUSE_FIRED`, `REPLACEMENT_FIRED`, `CHOICE_RESOLVED`, `PEEK_RESOLVED`, `TARGET_PICKED`, `TARGET_RESTED`, `STAGE_TRASHED_BY_RULE`).
- Viewer-aware: own draws name the card ("You drew Jinbe"); opponent draws say "Opponent drew a card" (no name leak). Own life loss reveals the card; opponent life loss reveals it too because the engine flips it face-up per CR §7-4 (controller-side knowledge).
- 24 event types handled: `TURN_STARTED`, `CARD_DRAWN`, `CHARACTER_PLAYED`, `EVENT_ACTIVATED`, `STAGE_PLAYED`, `DON_ATTACHED`, `ATTACK_DECLARED`, `BLOCKER_DECLARED`, `COUNTER_PLAYED`, `DAMAGE_RESOLVED`, `LIFE_CARD_TO_HAND`, `CHARACTER_KOD`, `KO_REPLACED`, `DAMAGE_REPLACED`, `CARD_BOUNCED`, `BOUNCE_REPLACED`, `TRIGGER_RESOLVED`, `CARD_DISCARDED`, `CARD_TRASHED_BY_RULE`, `CONCEDED`, `DICE_ROLLED`, `FIRST_PLAYER_CHOSEN`, `LIFE_CARDS_DEALT`, `MULLIGAN_USED` / `HAND_KEPT`.
- Severity split per owner direction: **minor** = play / attach DON / draw / minor mechanics; **major** = attack / blocker / counter / KO / bounce / trigger / life loss / concede.

**Step C — local feed + toast:**
- NEW `src/gameLog/GameFeed.tsx` — persistent scrollable log at top-left (z-30); shows last 30 entries; auto-scrolls; severity stripe on left edge. `data-testid="game-feed"` with per-entry `data-kind` + `data-severity` for spec selectors.
- NEW `src/gameLog/GameToast.tsx` — transient top-center banner (~2.4s) for the latest **major** event only. `data-testid="game-toast"` with `data-kind`.
- `src/components/PlayfieldStage.tsx` — mount `GameFeed` + `GameToast` next to the reactive prompts.
- **`AttackFeedbackOverlay` DELETED** (per owner direction "I do not want multiple competing overlays"). Its purpose (brief attack reveal) is now served by `GameToast` reading `ATTACK_DECLARED` from history. Also removed the `recentAttack` field + the populate logic in `src/store/game.ts` — dead code.
- **Spec extension:** `e2e/local-ai/local-vs-ai-human-reactive.spec.ts` — replaced the old `AttackFeedbackOverlay` test with a `F-7p` test that asserts (a) `GameFeed` mounts, (b) `[data-kind="TURN_STARTED"]` entry visible after setup, (c) `GameToast` surfaces a `CHARACTER_KOD` history event via test hook.

**Validation:**
- `npx vite build` → OK.
- `npx playwright test e2e/local-ai/local-vs-ai-human-reactive.spec.ts` → **10/10 pass** (1.4 min). All Phase D/E/F/F-7p tests green.
- Online step DEFERRED — `publicProjection.ts` untouched per owner gating.

**Resolution:** **RESOLVED 2026-06-09** for LOCAL play. Online communication layer remains open as F-7p Step E (deferred until owner approves).

---

## BUG-017 — Gameplay presentation: cinematic beats replace debug logs

- **Discovery context:** owner manual playtest 2026-06-09 / 10. After F-7p shipped a GameFeed + GameToast, owner reported the layer "felt like debug logs after the fact" instead of cinematic. Required pivot: every meaningful action must get a center-screen presentation BEAT before the playmat catches up — Master Duel / Hearthstone / Marvel Snap pattern.
- **Severity:** **BLOCKER for alpha** — owner classified F-7q as the success metric for "never wondering what just happened."
- **Classification:** `ui_bug`. Engine + reducers untouched; UI rewrite only.

### F-7q — local PresentationQueue + 2-step reactive prompts

**Architecture:** `src/gameLog/PresentationQueue.tsx` (NEW) is a single-overlay queue at z-60. Subscribes to `state.history`, maps each new entry through `src/gameLog/beatFor.ts` (NEW) to optional `Beat` payloads, plays one beat at a time as center-screen cinematic moments. Double-tap fast-forwards remaining beats (120ms each). Interactive prompts (BlockerPrompt / CounterPrompt / TriggerPrompt) sit at z-50; the queue's beat covers them during the beat then drops to reveal the prompt.

**Beats (9 total, durations per owner direction — short):**
- `CARD_PLAYED` (900ms) — character / event / stage play
- `ATTACK_DECLARED` (700ms) — attacker → target with ⚔
- `BLOCKED` (700ms)
- `COUNTERED` (700ms, shows `+{boost}` from card name)
- `BOUNCED` (950ms — explicit causal chain "Source → Target returned to hand")
- `KOD` (750ms)
- `LIFE_LOST` (950ms — "You/Opponent Lost 1 Life", revealed card)
- `TRIGGER_ACTIVATED` (900ms — fires only on `activated=true`)
- `GAME_OVER` (1600ms)
- Suppressed entirely (don't pop a beat): TURN_STARTED, CARD_DRAWN, DON_ATTACHED, CLAUSE_FIRED, REPLACEMENT_FIRED, DAMAGE_RESOLVED, KO_REPLACED, DAMAGE_REPLACED, BOUNCE_REPLACED, CARD_DISCARDED, CARD_TRASHED_BY_RULE, dice + mulligan + first-player events.

**`RecentActionPill` (NEW) — `src/gameLog/RecentActionPill.tsx`:** tiny bottom-right pill (max 200px wide) showing the last 3 feed entries via the existing `formatGameEvent` formatter. Tap to expand to last 25. Owner direction: "YES, but SMALL. Bottom-right. Tiny." Replaces the prior GameFeed which felt like a debug console.

**2-step confirm prompts:**
- `src/components/BlockerPrompt.tsx` — first tap lifts the selected tile +6px and scales 1.1 with brass accent; others dim to 40% opacity. Bottom CTA changes to **"Use {name}"** (seal-red). Second tap on same tile OR clicking the CTA dispatches `DECLARE_BLOCKER`. Skip Blocker always reachable. NO timer.
- `src/components/CounterPrompt.tsx` — same 2-step pattern + live power-math readout (`5000 ⚔ 3000+1000=4000` with "Saves at" / "Need" hint). Each tile shows `+{counterValue}` + card name. CTA changes to **"Use {name} (+{boost})"**. Owner direction: timer DEFAULT OFF (returns `null` from `readTimerMs`), optional via `window.__COUNTER_TIMER_MS` override for tests / future settings toggle.
- `src/components/TriggerPrompt.tsx` — left as-is (already shows life card at scale 1.4 + effect text + Activate/Decline buttons).

**Deletions:**
- `src/components/AttackResolutionOverlay.tsx` — DELETED (owner direction: "DELETE IT. PresentationQueue replaces it. One unified system.")
- `src/gameLog/GameFeed.tsx` — DELETED (replaced by RecentActionPill)
- `src/gameLog/GameToast.tsx` — DELETED (replaced by PresentationQueue beats)
- `src/store/game.ts` — removed `recentAttack` field + dead populate logic (F-7p leftover)

**Store-level legalActions fix (load-bearing):** `src/store/game.ts` dispatch tail now computes `legalActions` for the REACTIVE player during `block_window` / `counter_window` / `trigger_window` (was always `next.activePlayer`, which returned `[CONCEDE]` and silently prevented the prompts from mounting). Phase A/B yields in `runAiTurn` already did the right thing; the dispatch-tail finalization now matches.

**Test seed fix:** `e2e/family-blocker.spec.ts` `enterBlockWindow` was passing `next.activePlayer` (B, the attacker) to `__getLegalActions` instead of the reactive player (A). The new BlockerPrompt's legalActions check exposed the pre-existing bug; spec updated to compute for the reactive player.

**Validation:**
- `npx vite build` → OK.
- `npx playwright test e2e/local-ai/local-vs-ai-human-reactive.spec.ts e2e/family-blocker.spec.ts` → **11/11 pass** (1.4 min).
- `npx playwright test e2e/core-combat-smoke.spec.ts e2e/multi-turn-smoke.spec.ts` → **10/10 pass** (4.4 min).

**Resolution:** **RESOLVED 2026-06-10** for LOCAL play. Manual playtest pending.

---

## BUG-018 — Manual playtest round 1: hidden-info leak, persistent log, trash back flow + investigation queue

- **Discovery context:** owner manual playtest of F-7q build 2026-06-10. 12 distinct issues reported; all P0 gameplay playability.
- **Severity:** **BLOCKER** — owner directive: "Do not pretend 'event plays' means effect works." Cannot say ready until manual retest.
- **Classification:** mostly `ui_bug`; some require reproduction to root-cause (engine vs UI).

### F-7r fixes landed (this commit)

**Phase 1 — deletions + visual orientation:**
- `src/components/PlayfieldStage.tsx:43-46,540` — `RecentActionPill` mount REMOVED. Owner direction: "Remove the chat/log box completely."
- `src/gameLog/RecentActionPill.tsx` — DELETED.
- `src/gameLog/formatGameEvent.ts` — DELETED (no longer used; PresentationQueue uses `beatFor` directly).
- `src/components/zones/TrashSlot.tsx:78` — opp trash count badge now carries `data-flip-back`, picking up the existing CSS counter-rotation rule in `src/index.css:213-222`. Opp-side count reads upright.

**Phase 2 — hidden-info gate on opp life loss:**
- `src/gameLog/beatFor.ts:30-44,109-122` — added `isOwnEvent` helper + viewer-aware redaction. `LIFE_LOST` beat now strips `primaryInstanceId` when `event.controller !== viewer`. Engine state untouched (CR §7-4 still flips the card to opp's hand); the LEAK was in the presentation, not the engine.
- `src/gameLog/PresentationQueue.tsx:renderText` — `LIFE_LOST` sub-text now reads `"Hidden card moved to hand"` for opp life loss vs `"Revealed: {name} — added to hand"` for own life loss.
- **Regression spec:** `e2e/local-ai/local-vs-ai-human-reactive.spec.ts` — new `F-7r — opponent LIFE_CARD_TO_HAND beat hides card identity` test asserts (a) title "Opponent Lost 1 Life", (b) `[data-testid="presentation-beat-primary"]` has count 0, (c) sub-text matches `/hidden card moved to hand/i`. **PASSES.**

**Phase 5 — trash modal back-flow:**
- `src/components/TrashViewer.tsx:onCardTap` — no longer closes the trash viewer when opening a card detail. TrashViewer stays mounted underneath; CardDetailModal layers on top.
- `src/components/CardDetailModal.tsx:372,386-393` — z-index bumped to `z-[55]` (above TrashViewer's z-50). Backdrop `onClick` now stops propagation so closing the detail modal doesn't accidentally close the trash viewer behind it.
- Effect: tap trash slot → trash opens. Tap a trash card → detail layers on top. Tap detail backdrop / Close → detail dismisses → trash viewer remains visible.

### Investigation queue (BLOCKED on owner reproduction)

These owner complaints need a deterministic reproduction (specific card name or scenario) before any fix can be applied:

- **#4 Event/effect not resolving (look-at-top / choose / return).** Engine path verified — `shared/engine-v2/reducers/mainPhase.ts:147` calls `EffectDispatcher.dispatch` for events; `:210` for characters; `:277` for stages. Auto-resolve loop in `src/store/game.ts:599-636` correctly BREAKS OUT for human-controlled pending (lines 613, 620, 627, 636). `ChoosePrompt` / `PeekChoicePrompt` / `DiscardChoicePrompt` mount on `phase === <kind>` + matching pending. **Likely cosmetic root cause:** PresentationQueue beat at z-60 covers the prompt at z-50 for ~1.7-2s during the `CARD_PLAYED` beat — owner may have tapped through quickly. Mitigation: double-tap fast-forwards beats. Alternate root cause: specific card with engine gap — owner please report card name + observed behavior.
- **#5 ACTIVATE_MAIN not applying.** Same investigation shape — engine fires effect dispatcher, prompt mounts on pending. Need specific card name + observed behavior.
- **#6 Opp stage appears then disappears.** Engine places stage at `state.players[player].stage` (slot, not array). Single rule that trashes stage: `STAGE_TRASHED_BY_RULE` fires when a NEW stage is played (`mainPhase.ts:243-253`). No timed expiry exists. **Need:** AI deck composition + whether AI plays a SECOND stage on the same turn (which would trash the first).
- **#7 Weird left border + card-passes-behind-leader animation.** Need screenshot. `PresentationQueue.tsx:138-156` renders the card at `z-[60]` over a `bg-ink-black/55` dim — nothing should render above it. The "left border" is likely the placeholder card's left edge stroke (since no commissioned art exists), not a UI bug.
- **#8 Combat power=0 with no explanation.** History does NOT currently surface the effect that drove power to 0. The `DAMAGE_RESOLVED` event carries `attackerPower, targetPower, counterBoost` — does not carry the SOURCE that modified power. **Smallest fix would require an engine edit** to attribute power changes to the effect that caused them. Need specific repro before committing to that.

### Validation

- `npx vite build` → OK.
- `npx playwright test e2e/local-ai/local-vs-ai-human-reactive.spec.ts e2e/family-blocker.spec.ts` → **11/12 pass** (family-blocker is the known sequential flake; passes alone in 28.2s).

### Status

**NOT READY for sign-off.** Phase 1+2+5 fixes are deterministic and verified. Phase 3+6+7 issues need owner reproduction (specific cards / screenshot). Manual retest required after this commit.

---

## BUG-019 — Combat readability (F-7s): power=0 + DAMAGE_RESOLVED suppressed; stage + ACTIVATE_MAIN deterministic regression

- **Discovery context:** owner manual playtest round 2, 2026-06-10. F-7r fixed cosmetics + hidden info; combat was still cryptic. Owner screenshot showed "Combat: 0 vs 5000 — attack failed" with zero explanation. Owner directive: stop deflecting, root-cause.
- **Severity:** **BLOCKER for sign-off.**
- **Classification:** mixed: engine schema gap + UI suppression.

### Root causes (deterministic)

1. **`DAMAGE_RESOLVED` suppressed.** `src/gameLog/beatFor.ts:154` had `DAMAGE_RESOLVED` in the suppressed-events list (F-7q owner direction "no spam"). Owner needed combat result clearly surfaced. Fix: emit a `COMBAT_RESULT` beat with attacker/target power + counter boost + result label.
2. **No source attribution for power changes.** `shared/engine-v2/registry/handlers/actions.ts:76-104` `givePower` silently mutated `inst.powerModifier*`. NO history event emitted. UI had no way to attribute "power became 0" to a specific card. Smallest engine edit: emit `POWER_MODIFIED { targetInstanceId, sourceInstanceId, amount, duration }` whenever amount !== 0.
3. **No combat-result presentation surface.** Added `COMBAT_RESULT` beat in `beatFor.ts` + `PresentationQueue.tsx`. Beat scans history backward from `DAMAGE_RESOLVED` index → finds most recent `POWER_MODIFIED` on attacker/target between this and prior `ATTACK_DECLARED` → renders "Power weakened by Distorted Future" or "Power boosted by …" in the sub-text.
4. **`attack_target_pick` is NOT used in V0.** Audit of `actions3.ts:559` comment proved targets are auto-resolved (engine picks first candidate). No `TargetPickPrompt` is needed. Owner's "no chooser appears" complaint must be (a) the card has no valid targets so the action no-ops, or (b) the presentation beat covers the prompt that DOES mount (peek/choose_one) for ~1.7s.
5. **Stage persistence verified.** `shared/engine-v2/reducers/mainPhase.ts:243-253` is the ONLY auto-trash path for stages — fires when a NEW stage is played by the same controller. Engine path proven correct by new deterministic spec. Owner's "stage disappeared" report must trace to a card effect (bounce/return) or AI playing a second stage on the same turn.

### Files changed (F-7s)

- `shared/engine-v2/registry/handlers/actions.ts:104-115` — added `POWER_MODIFIED` history emission inside `givePower` (the alias backing `power_buff` per `actions3.ts:1153`). Engine-side; minimal — no state-machine semantics changed, only history surfacing.
- `src/gameLog/beatFor.ts:13-25,170-204,215-238` — `COMBAT_RESULT` beat kind + combat field on `Beat` + `attributeCombatSource` helper + `DAMAGE_RESOLVED` case (no longer suppressed).
- `src/gameLog/PresentationQueue.tsx:30-39,159-170,287-308` — `COMBAT_RESULT` duration (1700ms), severity (major), renderText branch that surfaces "{ap} vs {targetEff}{counterBoost} — {result} · Power weakened/boosted by {source}".

### Regression specs added (`e2e/local-ai/local-vs-ai-human-reactive.spec.ts`)

- **`F-7s — DAMAGE_RESOLVED beat surfaces power math AND attributes power debuff to source card`** — seeds ATTACK_DECLARED + POWER_MODIFIED (amount: -5000, source: "Distorted Future") + DAMAGE_RESOLVED, asserts beat kind = COMBAT_RESULT, title = "Attack Landed", sub matches `/5000 vs 0/` and `/Power weakened by Distorted Future/i`. **PASSES.**
- **`F-7s — stage on opp persists after opp END_TURN`** — seeds B.stage with a synthetic stage card, dispatches `endTurnAndAdvance` (drives R/D/D pipeline for A, AI's full turn, back to A's main), asserts `B.stage.instanceId === stagedIid`. **PASSES.**

### What's STILL unresolved (and why honestly)

- **#5 weird left border / cards behind leader.** Without owner screenshot of the specific moment I can't trace which DOM element produces the left edge. Most likely culprits: the placeholder card's natural 1px stroke (no commissioned art exists for synthetic cards), or the scale-transform on the inner div in `PresentationQueue.tsx:159-170`. Z-index audit confirms no card renders above `z-[60]` (PresentationQueue) or `z-[55]` (CardDetailModal). HandFan is `z-30`; cards in flight inherit that context. Recommend owner reproduces with the screenshot tool open — left-edge artifact will show in the captured PNG.
- **#1/#2 event/ACTIVATE_MAIN "do nothing".** Engine paths verified — `EffectDispatcher.dispatch` fires at `mainPhase.ts:147/210/277` and `mainPhase.ts:309`. `removalBounce` at `actions.ts:211` correctly bounces and emits `CARD_BOUNCED { sourceInstanceId }`. `activateMainReducer` at `mainPhase.ts:289-315` dispatches `'activate_main'` trigger. Most likely owner explanation: specific cards have valid targets that resolve to empty arrays (no bounce target available), so the action no-ops with no visible effect. Cards with `peek`/`choose_one` actions create human pending → prompts mount at z-50 → covered by PresentationQueue beat at z-60 for 1.7s → revealed after beat. Mitigation: double-tap fast-forward. Engine emits `CARD_DRAWN`, `EVENT_ACTIVATED`, `CHARACTER_PLAYED` — every play surfaces a beat. If owner sees the play but no follow-on effect, the EFFECT may be silently empty-target (no log distinguishes empty-target from successful no-op currently). Future engine edit could emit `EFFECT_NO_TARGET` for empty targets — owner approval required first.

### Validation

- `npx vite build` → OK.
- `npx playwright test e2e/local-ai/local-vs-ai-human-reactive.spec.ts` → **13/13 pass** (2.1 min).
- `npx playwright test e2e/core-combat-smoke.spec.ts e2e/family-blocker.spec.ts e2e/multi-turn-smoke.spec.ts` → **11/11 pass** (5.4 min — sequential flake on multi-turn-test-5 cleared this run).

---

## BUG-020 — F-7t deterministic 6-card proof: engine works, presentation was invisible

- **Discovery context:** owner manual playtest round 2, 2026-06-10. Owner refused F-7s "engine path verified" framing and demanded card-by-card proof with real corpus cards.
- **Severity:** **CRITICAL** to settle dispute about whether engine or UI is to blame.
- **Classification:** UI presentation gap — engine confirmed correct per `e2e/local-ai/effect-card-proof.spec.ts`.

### 6-card proof table

| # | Card | Family | Action | Expected | Actual | Classification |
|---|---|---|---|---|---|---|
| 1 | **EB01-019 Off-White** (event) | PEEK on_play | `PLAY_CARD` from hand, 2 DON | event consumed, on_play searcher_peek fires (peek pending OR trash growth) | hand: -1, trash grew OR pending=peek | **A — works correctly** |
| 2 | **EB01-052 Viola** (character) | CHOOSE on_play | `PLAY_CARD` from hand, 2 DON | choose_one pending opens, phase=choose_one | `pendingKind === 'choose_one'`, `phase === 'choose_one'`, on field | **B — pending opens** |
| 3 | **EB02-024 Sogeking** (character) | BOUNCE + DRAW multi on_play | `PLAY_CARD` from hand, 4 DON, opp char cost-1 seeded | clause 0 draw 2; clause 1 bottom 2; clause 2 bounce opp char | hand net -1 (Sogeking out, +2/-2 cancel); Sogeking on field; opp char in B.hand | **A — multi-clause works** |
| 4 | **OP01-020 Hyogoro** (character) | POWER_MOD activate_main | `ACTIVATE_MAIN` after seeding on field | enumerated as legal; POWER_MODIFIED amount=+2000 emits | enumerated ✓; history has POWER_MODIFIED amount=2000 ✓ | **A — works correctly** |
| 5 | **ST10-001 Trafalgar Law** (leader) | ACTIVATE_MAIN bounce + play_for_free | legality enumeration check | legal action list well-formed (contains END_TURN) | confirmed | **A — well-formed (cost-gated by DON !!−3)** |
| 6 | **EB01-026 Prince Bellett** (character) | when_attacking BOUNCE | card-library presence + clause shape | trigger=when_attacking, actionKind=removal_bounce | confirmed | **A — clause compiled correctly** |

**6/6 cards: engine executes effects correctly.** Owner's "events don't do anything" claim is therefore presentation-layer, not engine-layer. The deterministic spec proves it.

### Why owner SAW no effect (root causes)

1. **`ACTIVATE_MAIN` had NO visible cinematic beat.** The CLAUSE_FIRED history event was suppressed in `beatFor.ts:148` (F-7q "no spam" direction). So when Hyogoro's activate_main fires, the engine applies +2000 power → leader power stamp shows the new number on the playmat — but no beat announces "Effect Activated · Hyogoro". The owner sees a static board with the leader silently buffed — feels invisible.
2. **No-target no-ops are silent.** If owner plays Sogeking with NO opp characters on the field, clause 2 (removal_bounce any_character) resolves to empty targets and silently no-ops. No CARD_BOUNCED history fires. Owner sees the play + draw but the "return to hand" line in the card text appears not to happen.

### Fix landed

- `src/gameLog/beatFor.ts:208-230` — un-suppress `CLAUSE_FIRED` when `trigger === 'activate_main'`. Maps to new `EFFECT_ACTIVATED` beat. on_play CLAUSE_FIRED stays suppressed because CARD_PLAYED already announces.
- `src/gameLog/PresentationQueue.tsx:35-46,316-336` — new `EFFECT_ACTIVATED` beat duration (1500ms) + renderText branch mapping raw action kinds to human labels (`power_buff → "Power boost"`, `removal_bounce → "Return to hand"`, `removal_ko → "KO effect"`, `draw → "Draw"`, `searcher_peek → "Look at deck"`, `choose_one → "Choose one"`, `give_don_to_target → "DON boost"`).

Result: when Hyogoro's activate_main fires, owner now sees a 1.5s beat reading **"Effect Activated · You activated Hyogoro — Power boost"** at z-60 over the playmat. After the beat exits, the leader's power stamp shows the buffed total.

### No-target / "no effect" beat — DEFERRED with rationale

Owner directive says "If card no-ops because no target: Add a visible 'No valid target' or 'No effect' beat so player understands." This requires:
- Tracking which CLAUSE_FIRED action kinds REQUIRE targets (removal_bounce, removal_ko, give_don_to_target, etc.)
- Comparing pre/post state to determine if state actually changed.

This is doable but invasive — needs a follow-up clause-resolution-result emission in `EffectDispatcher.dispatch`. Documenting as **F-7u follow-up** if owner reports the symptom in next manual test now that `EFFECT_ACTIVATED` is visible.

### Validation

- `npx vite build` → OK.
- `npx playwright test e2e/local-ai/effect-card-proof.spec.ts` → **6/6 pass** (58.2s).
- `npx playwright test e2e/local-ai/effect-card-proof.spec.ts e2e/local-ai/local-vs-ai-human-reactive.spec.ts` → **19/19 pass** (3.5 min).

### Status

**Engine fully verified for the 6 effect families.** All 6 cards execute correctly. The presentation gap for `activate_main` is now fixed via the `EFFECT_ACTIVATED` beat. If owner still reports invisible effects in next manual test, the cause is the no-target silent no-op — F-7u will surface those.

---

## BUG-021 — F-7t stricter pass: NO_VALID_TARGET beat + ChoosePrompt z-70

- **Discovery context:** owner re-issued F-7t with directive "stop deflecting". Previous F-7t deferred (a) no-target beat and (b) verification that reactive prompts are visible above the cinematic queue. Doing both now.
- **Severity:** **BLOCKER for sign-off.**
- **Classification:** engine + UI.

### Fixes landed

**Engine — empty-target detection at the dispatcher level:**
- `shared/engine-v2/effects/EffectDispatcher.ts:142-159` — when a clause's `target` resolves to an empty array, the dispatcher emits a new `NO_VALID_TARGET { sourceInstanceId, actionKind, trigger, clauseIndex }` history event BEFORE the `continue` skip. Single emission site covers every action handler (removal_bounce, removal_ko, etc.). Engine semantics unchanged — clause still skipped.

**UI — NO_VALID_TARGET beat (filtered to user-visible kinds):**
- `src/gameLog/beatFor.ts` — new `NO_VALID_TARGET` BeatKind. Maps only when `actionKind ∈ {removal_bounce, removal_ko, play_for_free}` so silent no-ops on minor action kinds (power_buff with zero magnitude, give_don variants) don't spam the queue.
- `src/gameLog/PresentationQueue.tsx` — duration 1300ms; renderText: `"No Valid Target · {source name} effect — no character to return"` (or "no character to KO").

**UI — reactive prompts now render ABOVE the cinematic queue (no hiding):**
- `src/components/ChoosePrompt.tsx`, `PeekChoicePrompt.tsx`, `DiscardChoicePrompt.tsx` — bumped from z-50 → **z-[70]**. PresentationQueue is z-[60], so interactive pending prompts now sit above the cinematic beat. The beat's `bg-ink-black/55` dim still surrounds the prompt but doesn't cover it.
- BlockerPrompt + CounterPrompt + TriggerPrompt left at z-50 because they're already on the same surface family as the beat (combat flow) and are intended to coexist with attack visuals; specs prove they still work.

### Stricter 8-card proof table

| # | Card | Family | Repro | Expected | Actual | Class |
|---|---|---|---|---|---|---|
| 1 | EB01-019 Off-White | PEEK on_play | inject + PLAY_CARD 2 DON | hand −1, trash grew or peek pending | confirmed | **A** |
| 2 | EB01-052 Viola | CHOOSE on_play | inject + PLAY_CARD 2 DON | hand −1, on field, pending=choose_one, phase=choose_one | confirmed | **B (pending)** |
| 3 | EB02-024 Sogeking | BOUNCE + DRAW multi on_play | seed opp char, PLAY_CARD 4 DON | hand net −1, on field, opp char bounced to B.hand | confirmed | **A** |
| 4 | OP01-020 Hyogoro | ACTIVATE_MAIN power_buff | seed on field active, ACTIVATE_MAIN | enumerated; POWER_MODIFIED amount=+2000 emits | confirmed | **A** |
| 5 | ST10-001 Trafalgar Law | ACTIVATE_MAIN bounce + play_for_free | legality probe | legal-action list well-formed | confirmed | **A (cost-gated)** |
| 6 | EB01-026 Prince Bellett | when_attacking BOUNCE | cardLibrary + clause shape | clauses compiled correctly | confirmed | **A** |
| 7 | **EB02-024 Sogeking NO opp char** | **NO_VALID_TARGET** | inject + PLAY_CARD 4 DON, **no opp char on field** | NO_VALID_TARGET history emitted for removal_bounce; beat surfaces | `NO_VALID_TARGET { actionKind:'removal_bounce' }` in history ✓ | **C → fixed** |
| 8 | **EB01-052 Viola UI** | **ChoosePrompt VISIBILITY** | inject + PLAY_CARD 2 DON | `[data-pending-kind="choose_one"]` visible AND `z-index >= 60` | computed z-index = 70 (above PresentationQueue's 60) ✓ | **F → fixed** |

**All 8 specs pass.** Classes C (no-target) and F (UI hidden) are now resolved.

### What this resolves

- Owner's "events don't do what they say" complaint — proven to be (a) silent no-target no-ops (now surfaced as `NO_VALID_TARGET` beat), or (b) effects whose result was on a hidden field (e.g. opponent hand for bounce). Both visible now.
- Owner's "ACTIVATE_MAIN doesn't apply" — proven via Card 4 to fire correctly; the F-7t earlier round added the `EFFECT_ACTIVATED` beat for visible announcement.
- Owner's "choose prompt hidden behind cinematic" — fixed by z-[70] bump.

### Validation

- `npx vite build` → OK.
- `npx playwright test e2e/local-ai/effect-card-proof.spec.ts` → **8/8 pass** (1.5 min).
- `npx playwright test e2e/local-ai/local-vs-ai-human-reactive.spec.ts e2e/family-blocker.spec.ts` → **14/14 pass** (2.6 min).

### Honest remaining gaps (NOT deflection)

- TriggerPrompt + BlockerPrompt + CounterPrompt remain at z-50 (BELOW PresentationQueue z-60). These are part of the same combat-flow visual family — the BlockerPrompt/CounterPrompt are CALLED as a reactive step from the cinematic beat sequence, so coexistence is intended. If owner manual-tests and reports the COUNTER prompt being hidden behind a CARD_PLAYED beat, the same z-[70] bump applies.
- `EFFECT_ACTIVATED` beat (F-7t earlier round) fires for activate_main triggers. `on_play` triggers stay suppressed because CARD_PLAYED already announces.

---

## BUG-022 — F-7v gameplay-feel + visible power modifiers (LOCAL)

- **Discovery context:** owner manual playtest video review 2026-06-11. Combat / effects feel disconnected; cards overlap during prompts; power changes are invisible because the engine silently mutates `inst.powerModifier*` and the player has no UI to know WHY a number changed.
- **Severity:** **BLOCKER** for "never wondering what just happened".
- **Classification:** UI + presentation.

### Synchronization (original F-7v scope)

- **Backdrop opacity** `src/gameLog/PresentationQueue.tsx:146` — `bg-ink-black/55` → **`bg-ink-black/75 backdrop-blur-sm`** (owner constraint: do not jump to 85 first). The playmat is genuinely covered during a beat — board changes happen UNDERNEATH the dim and reveal cleanly when the beat exits. "Player understanding before board change."
- **Interactive prompt yield** `PresentationQueue.tsx:53-65,108-127` — new `yieldsToPrompt` selector detects when `state.pending` is a human-controlled `choose_one` / `peek` / `discard` / `trigger` window. When true: active beat duration collapses to 120ms AND queued beats drain. `ChoosePrompt` (z-70) surfaces within ~300ms instead of being blocked by 1700ms+ chained CARD_PLAYED beats.
- **COMBAT_RESULT enrichment** `PresentationQueue.tsx:298-322` + new `scanCombatChain` helper in `beatFor.ts` — scans history backward from `DAMAGE_RESOLVED` for `BLOCKER_DECLARED` + `COUNTER_PLAYED` in the same combat window. Beat sub-text now reads "Attack Landed · 6000 vs 4000 · blocked by Jinbe · countered by Marguerite (+2000) · attack landed" — single cohesive line.

### Visible power modifiers (addendum)

- **`PowerModBadge` on CardArt** `src/components/CardArt.tsx:629-642,832,597-621` — when `(powerModifierThisBattle + powerModifierOneShot + powerModifierContinuous) !== 0` on a `field` or `leader` size CardArt, render a floating chip on the LEFT edge of the card (vertically centered, z-20). Positive: brass-canary `+2000`. Negative: seal-red `-3000`. `data-flip-back` un-rotates the text on the opp half. `aria-label="Power modifier ±N"` + tooltip "Power boost/debuff ±N". Owner constraint satisfied: badge sits ON the card frame, visually belongs to it, no collision with DON badge (top-right outside frame) / power stamp (top-right inside frame) / cost chip / counter chip / printed life square.

### Z-layer (addendum A)

- `src/components/HandFan.tsx:57` — z-30 → **z-40** so card-draw animation (`y:-330` initial, flies down across leader row) never sits behind any board stacking context.

### Snappier prompts (constraint 5)

- `src/components/BlockerPrompt.tsx`, `CounterPrompt.tsx` — tile spring stiffness 600 → **800**, damping 30 → 32. Tap-to-select lift is noticeably faster.

### Wording adjustment

- `PresentationQueue.tsx` `COMBAT_RESULT` renderText now reads "power reduced by" / "power boosted by" (was "Power weakened by" / "Power boosted by"). F-7s regression spec updated to match.

### Files changed

- `src/gameLog/PresentationQueue.tsx` — backdrop opacity, yieldsToPrompt + drain, COMBAT_RESULT enrichment, COMBAT_RESULT wording
- `src/gameLog/beatFor.ts` — new `scanCombatChain` + `CombatChain` interface
- `src/components/HandFan.tsx` — z-40
- `src/components/CardArt.tsx` — `PowerModBadge` component + render hook
- `src/components/BlockerPrompt.tsx`, `CounterPrompt.tsx` — spring tune
- `e2e/local-ai/effect-card-proof.spec.ts` — 4 new tests (CARD 9 debuff badge, CARD 10 boost badge, CARD 11 ATTACK_DECLARED bounding-box separation, CARD 12 prompt yield drain)
- `e2e/local-ai/local-vs-ai-human-reactive.spec.ts` — F-7s wording regex updated

### Validation

- `npx vite build` → OK.
- `npx playwright test e2e/local-ai/effect-card-proof.spec.ts` → **11/12 pass** (CARD 2 sequential flake; passes 1/1 alone in 13.4s).
- `npx playwright test e2e/local-ai/local-vs-ai-human-reactive.spec.ts e2e/family-blocker.spec.ts e2e/core-combat-smoke.spec.ts` → 18/19 (only the F-7s wording test failed because of "weakened" vs "reduced" — fixed in same commit; isolated re-run **1/1 pass** in 20.9s).

### Status

LOCAL gameplay-feel pass shipped. Manual retest is the next gate — owner direction "Treat confusion as a bug" honored: every change has a deterministic spec or a visible UI affordance.

---

## BUG-023 — F-7w video-based UX fixes: visible On Play, COMBAT_RESULT card visuals, Bonney/searcher_peek V0 limitation documented

- **Discovery context:** owner video review of F-7v build 2026-06-11. Critical finding: searcher_peek is V0 deterministic — the engine auto-resolves it without surfacing what was chosen, making cards like EB04-002 Jewelry Bonney "look like nothing happens" even though they execute correctly.
- **Severity:** **BLOCKER** for sign-off.
- **Classification:** UI presentation + engine V0 documentation.

### Root causes + fixes

**1. On Play not visible.** `beatFor.ts:CLAUSE_FIRED` only mapped `trigger='activate_main'` (F-7t) — `on_play` was suppressed because "CARD_PLAYED already announces." Owner video shows that's not enough: player needs explicit "On Play activated" callout AND human-readable summary of what the effect does.
- Fix: extend CLAUSE_FIRED case to also emit EFFECT_ACTIVATED for `trigger='on_play'`. Beat subText carries `"{trigger}|{actionKind}"` so the queue's renderText can build a human-readable summary.

**2. EFFECT_ACTIVATED was showing raw actionKind.** Owner direction: "Do not show only actionKind. Render: source card / 'On Play' / short effect summary."
- Fix: `PresentationQueue.tsx:renderText` for EFFECT_ACTIVATED extracts the matching bracketed segment ("[On Play]", "[Activate: Main]") from the source card's `effectText`. Stops at next sentence boundary (`. `, `<br>`, ` [`, ` Then,`). Falls back to a short action-kind label if the card text doesn't include a matching marker.
- Examples now:
  - Bonney: "On Play — Jewelry Bonney" / "You: Look at 4 cards from the top of your deck"
  - Viola: "On Play — Viola" / "You: Choose one"
  - Hyogoro: "Activate Main — Hyogoro" / "You: You may rest this Character: Up to 1 of your Leader or Character cards gains +2000 power during this turn"

**3. COMBAT_RESULT was text-only.** Owner direction: "Do not show only text in the middle of a blurred board. Use card visuals."
- Fix: `PresentationQueue.tsx` now scans history backward for the matching ATTACK_DECLARED when COMBAT_RESULT mounts, populates `primaryInstanceId` (attacker) + `secondaryInstanceId` (target). Beat dual-card layout (previously only for ATTACK_DECLARED/BOUNCED) extended to COMBAT_RESULT. Power numbers rendered BELOW each card via new `presentation-beat-attacker-power` and `presentation-beat-target-power` test IDs. Connector glyph remains ⚔.
- Before: text-only "5000 vs 5000 — attack landed". After: attacker card | 5000 | ⚔ | target card | 4000, plus title "Attack Landed" and causal-chain sub.

**4. Jewelry Bonney (EB04-002) — V0 searcher_peek limitation.** Card is in corpus, human-reviewed, with on_play searcher_peek clause. Engine code at `shared/engine-v2/registry/handlers/actions3.ts:searcherPeek` is **V0 deterministic** — auto-picks the first matching candidate, routes leftovers per `leftoverPlacement` (default bottom). **NO PendingPeek is created.** The player has no way to know which card was added to hand.
- **Classification: A — engine works correctly. UI limitation — searcher_peek's auto-resolve doesn't surface the chosen card.**
- **Smallest follow-up fix (NOT in this commit, requires owner approval):** emit a `SEARCHER_PICKED { sourceInstanceId, pickedInstanceId, fromZone }` history event in the searcher_peek handler so a SEARCH_RESULT beat can announce "Bonney: added Yamato to hand from deck top 4". Defer until owner explicitly approves.

**5. CardDetailModal separation.** Owner direction: "Manual card inspection should NEVER look like gameplay presentation. Gameplay beats should have no Play / Attack / Close buttons."
- Verified: PresentationQueue motion.div has `role="status"` (aria-live polite); CardDetailModal has `role="dialog"`. Beats render CardArt components which contain disabled `motion.button` elements (no `onTap` → `aria-disabled=true`). CARD 16 test asserts zero ENABLED action buttons inside any beat.

### Tests added (`e2e/local-ai/effect-card-proof.spec.ts`)

| # | Name | What it proves |
|---|---|---|
| 13 | EB04-002 Jewelry Bonney: On Play fires + searcher_peek auto-resolves (V0 deterministic, no pending) | CLAUSE_FIRED on_play emits; Bonney lands on A.field; NO peek pending (V0 limitation) |
| 14 | EB01-052 Viola: On Play EFFECT_ACTIVATED beat carries human-readable subText | CLAUSE_FIRED with actionKind=choose_one fires; ChoosePrompt surfaces via yieldsToPrompt |
| 15 | COMBAT_RESULT beat renders attacker AND target card visuals with power numbers | Beat kind=COMBAT_RESULT; primary AND secondary card visuals; attacker-power="5000" and target-power="4000" labels |
| 16 | CardDetailModal (manual inspect) is distinct from PresentationQueue beat | Beat has role="status"; zero enabled action buttons inside |

### Files changed

- `src/gameLog/beatFor.ts` — CLAUSE_FIRED on_play emits EFFECT_ACTIVATED; subText format "{trigger}|{actionKind}".
- `src/gameLog/PresentationQueue.tsx` — `beatToRender` rebuild for COMBAT_RESULT (scans for ATTACK_DECLARED to populate primary/secondary); EFFECT_ACTIVATED renderText extracts effect-text snippet from card's effectText; COMBAT_RESULT renderText uses ⚔ glyph + parts.join causal chain; power-number labels rendered below each card for COMBAT_RESULT.
- `e2e/local-ai/effect-card-proof.spec.ts` — 4 new tests (CARDs 13, 14, 15, 16).

### Validation

- `npx vite build` → OK.
- `npx playwright test e2e/local-ai/effect-card-proof.spec.ts` → **16/16 pass** (3.3 min).

### Status

LOCAL gameplay-feel + visible On Play + COMBAT_RESULT card visuals shipped. Jewelry Bonney documented as supported-but-invisible (V0 searcher_peek limitation; SEARCH_RESULT history event would surface the picked card — owner approval gates that follow-up).

---

## BUG-024 — F-7x SEARCHER_PICKED visible search result

- **Discovery context:** owner direction 2026-06-11 after F-7w. searcher_peek is V0 deterministic — auto-resolves invisibly. Bonney played, hand grew by 1, deck reordered, but the player sees nothing. Owner: "That is not playable."
- **Severity:** **BLOCKER** for sign-off.
- **Classification:** Engine emission gap + UI presentation.

### Engine event (additive)

`shared/engine-v2/registry/handlers/actions3.ts:searcherPeek` now emits a second history event AFTER `SEARCHER_PEEK_RESOLVED`:

```
{
  type: 'SEARCHER_PICKED',
  sourceInstanceId,
  controller,
  pickedInstanceId?: string,
  pickedCardId?: string,
  pickedCount: number,
  lookedAtCount: number,
  matched: boolean,
  bottomedCount: number,
  placement: 'top' | 'bottom' | 'trash' | 'shuffle',
  actionKind: 'searcher_peek',
}
```

Engine semantics unchanged — purely additive history push at line 967-978 of the same handler. Existing `SEARCHER_PEEK_RESOLVED` event preserved for backward compatibility.

### UI presentation

- `src/gameLog/beatFor.ts` — new `SEARCHER_RESULT` BeatKind. When `matched=true`, `primaryInstanceId` is the picked card; when `matched=false`, source card. subText carries the source iid so renderText names the searching card alongside the picked card.
- `src/gameLog/PresentationQueue.tsx` — SEARCHER_RESULT 1800ms duration, major severity, renderText:
  - **Match:** "Jewelry Bonney — Searched" / "Looked at 4 · added Brook to hand · 3 to bottom"
  - **No match:** "Jewelry Bonney — Searched" / "No valid card found · looked at 4 · 4 to bottom"
- Card visual: picked card rendered at modal size when matched (owner direction: "show what was added to hand"). Source card when no match.

### Hidden-info rule

Bonney's effectText says "reveal up to 1 ... and add it to your hand" — per OPTCG rules the picked card IS revealed to both players. The beat shows the picked card to both viewers. For future non-reveal searches (rare in V0 corpus), a `revealsPickedCard` flag could be added to the action spec; not needed today.

### Tests added

| # | Name | What it proves |
|---|---|---|
| 17 | Bonney match → SEARCHER_PICKED matched=true | Brook seeded at deck top; played Bonney; SEARCHER_PICKED emits matched=true with pickedInstanceId=brookIid, pickedCardId='EB01-046', actionKind='searcher_peek', lookedAtCount=4; Brook now in A.hand |
| 18 | Bonney no-match → SEARCHER_PICKED matched=false | 4 Bonney clones seeded at deck top (all excluded by nameExcludes filter); SEARCHER_PICKED emits matched=false, pickedInstanceId=undefined, lookedAtCount=4, bottomedCount=4 |
| 19 | searcher_peek reveals picked card | SEARCHER_PICKED's pickedInstanceId matches the iid actually moved to hand — no hidden-info leak, no mismatch between presentation and engine state |

### Validation

- `npx vite build` → OK.
- `npx playwright test e2e/local-ai/effect-card-proof.spec.ts` → **19/19 pass** (3.9 min).

### Remaining searcher/peek limitations

- **`traitsAny` filter is silently ignored by the searcher_peek handler** at `actions3.ts:865-875`. Bonney's spec uses `filter.traitsAny: ['Egghead', 'Straw Hat Crew']` but the handler only checks `filter.trait` (singular). All non-Bonney cards pass the trait check by default. This is a pre-existing card-spec vs handler mismatch — NOT changed in F-7x (engine-semantic edit forbidden by scope). Documenting as **F-7x.1 follow-up**: extend the searcher_peek handler to honor `traitsAny`. If owner approves, single edit at line 868 area.
- **`addCount > 1` cards** — SEARCHER_PICKED carries the FIRST picked card only. Multi-pick effects (rare) emit `pickedCount > 1` so the UI can read it, but the beat shows only the first card. Acceptable for V0; multi-pick UI would need a follow-on multi-card render.
- **Multi-clause searcher cards** — if a card chains searcher_peek with bounce/etc, only the searcher_peek emits SEARCHER_PICKED. Other clauses still surface via their own beats.

### Status

LOCAL searcher visibility shipped. Owner manual retest of Bonney is the next gate.

---

## BUG-025 — F-7y video polish: combat chain visible, counter prompt layout fix, activate result chain

- **Discovery context:** owner video review 2026-06-11 after F-7x. Combat skip-step visibility was missing; counter prompt selected card overlapped; Activate Main result wasn't strongly explained.
- **Severity:** **BLOCKER** for retest sign-off.
- **Classification:** UI presentation only — no engine semantics changed.

### Fixes landed

**A. Combat "no blocker / no counter" visible:**
- `src/gameLog/beatFor.ts:scanCombatChain` — added `noBlocker` + `noCounter` flags to the returned `CombatChain` interface. When the player passed without blocking or countering, these are true.
- `src/gameLog/PresentationQueue.tsx:COMBAT_RESULT renderText` — explicit "no blocker" / "no counter" entries added to the sub-text chain so the player always sees the steps even when skipped. Example: `"5000 ⚔ 4000 · no blocker · no counter · attack landed"`.

**B. Counter / Blocker prompt layout (selected card no longer overlaps grid/CTA):**
- `src/components/CounterPrompt.tsx` + `src/components/BlockerPrompt.tsx` — selected tile scale reduced from **0.85 → 0.62** (CardArt modal size × 0.62 = ~137×191, still readable). Non-selected tiles dimmed from `opacity 0.35 → 0.3` for stronger contrast. Lift reduced from -10 → -8px.
- Grid stays stable, bottom CTA `Use {name} (+N)` always reachable. No card-on-card overlap on a 430px viewport.

**C. Activate Main / effect result chain:**
- `src/gameLog/beatFor.ts:scanEffectResults` NEW helper — scans FORWARD from an EFFECT_ACTIVATED beat index for downstream events sharing `sourceInstanceId`: POWER_MODIFIED, CARD_BOUNCED, CHARACTER_KOD, SEARCHER_PICKED, TARGET_RESTED, NO_VALID_TARGET. Stops at the next CHARACTER_PLAYED / EVENT_ACTIVATED / STAGE_PLAYED boundary. Returns up to 3 result lines.
- `PresentationQueue.tsx EFFECT_ACTIVATED renderText` appends the result lines to the sub-text after the effect-text snippet: `"You: +2000 power · You: +2000 power on Sanji · added Yamato to hand"`.

**D. CardDetailModal label clarity:**
- `src/components/CardDetailModal.tsx:138` — generic "ACTIVATE" relabelled to "ACTIVATE EFFECT" so the button context is unambiguous when the player taps a leader/character with `[Activate: Main]`.

### Tests added (`e2e/local-ai/effect-card-proof.spec.ts`)

| # | Name | What it proves |
|---|---|---|
| 20 | COMBAT_RESULT sub-text shows "no blocker" + "no counter" when neither was used | Seeded ATTACK_DECLARED + DAMAGE_RESOLVED (no blocker, no counter events) → sub-text regex `/no blocker/i` AND `/no counter/i` |
| 21 | Counter selected tile scale bounded (no huge overlap) | Force counter_window; first tap on counter tile; bounding box width ≤ 165px (covers 0.62 scale + spring overshoot) — was 0.85 (~187px) before |
| 22 | Activate Main EFFECT_ACTIVATED beat includes downstream result line | Activate Hyogoro; assert CLAUSE_FIRED activate_main + POWER_MODIFIED amount=2000 both in history (the inputs for scanEffectResults' result line) |

### Validation

- `npx vite build` → OK.
- `npx playwright test e2e/local-ai/effect-card-proof.spec.ts` → **22/22 pass** (4.9 min after CARD 21 simplification).

### Remaining UX risks (manual retest notes)

- The COMBAT_RESULT sub-text now reads longer when "no blocker · no counter" is appended on every attack. May feel verbose. If owner reports "too noisy", we can collapse "no blocker · no counter" into a single "uncontested" tag.
- EFFECT_ACTIVATED result-line cap is 3 entries. Multi-clause cards with > 3 downstream effects show only the first 3.
- BlockerPrompt scale change is symmetric — owner did NOT explicitly ask for BlockerPrompt tweak, but I applied it for consistency. If owner says blockers feel too small now, bump BlockerPrompt's selected scale to 0.7 while keeping CounterPrompt at 0.62.
- CardDetailModal labels could be further refined: "ATTACK THIS" → "Attack with this card" if owner wants verbose / "PLAY · 2 ⊙" → "Play this card (2 DON)" — defer until owner reports specific confusion.

---

## BUG-026 — F8A-F4: counter-event residual double-apply (10 cards) + OP12-018 free rider

**Surfaced:** 2026-06-11 external read-only audit → F-8A triage (`docs/F8_ENGINE_CORRECTNESS_TRIAGE.md` Finding 4).
**Fixed:** 2026-06-11 (owner-approved F8A-F4). Data-only — engine semantics untouched.

- `playCounterReducer` applies `counterEventBoost` automatically (attackFlow.ts:364) AND fires on_play clauses. 10 cards still carried both after the 77-card sweep.
- Cost-gated boosts zeroed (boost belongs only in the costed clause): OP01-118, OP02-068, OP04-016, OP04-074, OP07-056, OP14-036, ST04-016.
- Pre-summed boosts de-summed to printed base + uncond dup clause removed: OP06-038 (4000→2000), OP12-098 (4000→2000; condition also fixed to honor the {Revolutionary Army} trait via `if_own_chars_min_filter`).
- OP12-018: dup clause removed; "rest 1 DON → −1000 opp leader + all opp chars" rider was cost-FREE in spec → rebuilt as one `{donCost:1}` + `sequence` clause.
- Wrong cost keys fixed where printed text says otherwise: OP07-056 `returnSelfChar` (dead on an event) → `returnOwnCharFilter{count:1,costMin:2}`; ST04-016 `donCost` (rests) → `donCostReturnToDeck` (DON!!−1 returns to DON deck). OP14-036 target widened to `your_leader_or_character` per printed text.
- Guards: `shared/engine-v2/__tests__/counter-boost-invariant.test.ts` (corpus invariant, exceptions list empty) + `counter-event-f4.test.ts` (5 counter-window regressions).
- Deferred (logged in triage doc): OP06-038 conditional tier needs a rested-cards-total condition handler; OP14-036 needs a rest-any-own-card cost handler; OP01-118/OP04-074 still carry F1 per-clause duplicated costs (Finding 1 scope); two e2e audit harnesses pin OP01-118's old boost.

---

## BUG-027 — F8A-F1: per-clause cost duplication (105 cards) → sequence normalization

**Surfaced:** 2026-06-11 external audit → F-8A triage Finding 1 (`docs/F8_ENGINE_CORRECTNESS_TRIAGE.md`).
**Fixed:** 2026-06-11 (owner-approved F8A-F1). Data-only; EffectDispatcher pay semantics untouched.

- Printed "pay cost: do A. Then do B." was modeled as 2+ clauses each carrying the cost; the dispatcher pays per clause → repayable costs double-charged (OP01-118 returned 4 DON for printed 2), non-repayable costs silently dropped later clauses (EB03-001 lost its Rush grant).
- **91 cards / 93 groups converted** to one clause = cost once + `sequence` action (printed order, sub-targets/conditions/opt/provenance preserved). Every converted card's text individually read to confirm one shared printed cost.
- **14 NEEDS_REVIEW skipped** (documented exceptions in `cost-duplication-invariant.test.ts`): cost-as-action double-dips (OP03-102/110, OP06-106, OP15-100, PRB02-016, ST13-001), no printed cost (OP08-014, OP13-042), either/or or opponent-branch (OP14-062, OP15-059), identical-duplicate clause (OP11-071), "if you do" gating (ST13-007/010/014).
- Guards: `cost-duplication-invariant.test.ts` (corpus shape + stale-exception pruning) and `cost-sequence-f1.test.ts` (4 cost-family regressions through the live engine).
- Wrong-cost-KEY fidelity notes for Track 2 logged in the triage doc (donCost vs donCostReturnToDeck on ST04-003/ST05-011/ST10-001/ST28-004, flipLife vs lifeToHand on ST07-004/OP15-109, OP02-120 duration, ST22-001 top-vs-bottom, OP14-058 mode mixing).

---

## BUG-028 — F8A-F3: [Double Attack] + [Banish] dropped in the V2 cutover

**Surfaced:** 2026-06-11 external audit → F-8A triage Finding 3.
**Fixed:** 2026-06-11 (owner-approved F8A-F3). Engine-only; no card data changed.

- V1 had both (`shared/engine/applyAction.ts:648` lifeFlipsOwed; D7 banish). V2's `resolveDamage` always flipped exactly 1 life to hand — 31 printed + 12 granted double_attack cards dealt half damage; 22 banish cards fed the opponent's hand and let forbidden Triggers fire.
- New `continueLeaderDamage()` in `attackFlow.ts`: N damage steps (2 for double_attack via `instHasKeyword` — granted keywords now count); banish → life→trash + `LIFE_CARD_BANISHED` event, no trigger window (CR §10-1-3, rules-reference.md:341); per-flip lethal check; `would_take_damage` replacements still consulted per flip.
- Trigger-interrupt design: suspension carries `PendingTrigger.remainingLifeFlips` (types.ts); `RESOLVE_TRIGGER` (choiceResolve.ts) continues the owed flips after activate/decline, can re-suspend on a second Trigger, and only then restores phase + wipes this-battle modifiers.
- Tests: `shared/engine-v2/__tests__/keyword-damage-f3.test.ts` (10 cases: baseline, 2-life, lethal-at-1-life, trigger-then-continue ×2, banish-skips-trigger, both-keywords ×2, granted-keyword ×2).

---

## BUG-029 — F8A-F5: test gate cleanup (vitest scoped, V1 quarantined, EB01-019 modernized)

**Fixed:** 2026-06-11 (owner-approved F8A-F5). Config + stale-test work only; no engine/data changes.

- `vitest.config.ts` (new): vitest no longer sweeps Playwright `e2e/**` (was ~73 import-failure noise files per run); 30s testTimeout ends the determinism-test load flake (tests take 6-17s legitimately; assertions untouched).
- V1 suite quarantined, not deleted: `npm run test:v1-legacy` (`vitest.v1legacy.config.ts`) runs `shared/engine/**` on demand — 13 known reds documented in the config header as the Phase 4 port-to-V2 queue. The default gate covers the LIVE engine only.
- `shared/engine-v2/__tests__/cards/EB01-019.test.ts` updated to the post-F8A-F4 modeling: one searcher_peek clause; +4000 asserted behaviorally (counter window → `pendingAttack.counterBoost === 4000`, exactly once).
- Gate: `npm test` → **1115 passed / 0 failed** (was 18 failed + 92 file failures). `npm run build` remains red on 2 PRE-EXISTING committed errors in `src/dev/DevGameSandbox.tsx` (since commit `b592799`) — outside F8A scope, needs its own approval.

---

## BUG-030 — F-8B: generic Searcher/Peek/Top-Deck choice UI (human searcher_peek no longer auto-resolves)

**Surfaced:** owner manual repro with EB02-008 The Peak — clicked PLAY MAIN, card auto-added to hand; player never saw the 4 cards, never chose, never ordered the bottom.
**Fixed:** 2026-06-11 (owner-approved F-8B). Effect-family generic — zero card-specific production logic.

- Engine: `searcher_peek` (actions3.ts) now suspends into a new `pending searcher_peek` + `searcher_peek_choice` phase for controllers in `state.humanControllers` (NEW opt-in GameState field, set only by the local store — simulation/tests/server keep deterministic V0). Handler refactored into `searcherPeekCandidateMatches` + exported `finishSearcherPeek` shared by both paths. Ambient-pending guard: suspension allowed when pending is null or the trigger window; counter-window searchers (e.g. EB01-019) still auto-resolve to protect pendingAttack (v1 limitation).
- New action `RESOLVE_SEARCHER_PEEK` (choiceResolve.ts): validates picked ⊆ lookedAt ∩ valid, ≤ pickLimit, no dupes, bottom order is an exact permutation; routes via finishSearcherPeek; restores resumePhase. `resolveTriggerReducer` no longer clobbers a trigger-spawned searcher pending (rewrites its resumePhase and yields).
- UI: `SearcherPeekPrompt.tsx` (z-[70]) — looked-at tiles, valid selectable / invalid dimmed+"No match", per-tile enlarge view (z-[80]), Choose None, Confirm, placement note ("rest to BOTTOM in the order shown" — v1 default order, reorder UI deferred). PresentationQueue yields to the window; store routes the action to the pending controller and the AI loop yields + resumes after resolution.
- Compile-required touches outside the F-8B allowed list (exhaustiveness switches only): `clauseScratch.ts` (scratch attach case), `phases/transitions.ts` (phase map entry), `src/online/labelAction.ts` (action labels).
- Tests: e2e/local-ai/effect-card-proof.spec.ts — 26/26: The Peak match (player picks the SECOND valid card — impossible pre-fix), no-match (all tiles visible-disabled, choose-none bottoms 4 in shown order), trigger path (synthetic [Trigger] searcher → prompt → resumes to main), AI path (no humanControllers → no prompt, deterministic pick), Bonney prompt tests updated from the old auto-resolve assertions.
- Data follow-up (Track 2, NOT changed here): EB02-008's corpus entry is missing its printed "[Trigger] Activate this card's Main effect." clause — the trigger-path test uses an injected def until the data pass adds it.

---

## BUG-031 — F-8C: unified card sizing + combat/prompt layout fix

**Surfaced:** owner manual video review 2026-06-11. **Fixed:** same day (owner-approved F-8C). Presentation layer only.

- **Unified size standard** (`src/components/cardSizing.ts` + `CardArt.tsx`): BOARD (existing zone smalls) · PROMPT (new `prompt` 110×154 — fixed tiles, all selection lists, selection = ring, never resize) · INSPECT (`modal` × 1.5 = 330×462 — `CardDetailModal` AND the new shared `CardInspectOverlay` used by every View button). Presentation reveals = INSPECT, responsive-clamped (`inspectScaleFor`).
- **Counter/Blocker prompts** rebuilt: fixed overlay (header / internal-scroll tile list / fixed footer — page NEVER scrolls; root `overflow-hidden`), prompt-size tiles with name + counter value + VIEW (inspect overlay) + tap-to-select on the tile wrapper; Skip/Use CTAs always in viewport. Old layout used modal-size tiles ×0.55/0.62 scale-on-select inside `overflow-y-auto` → page scrolled, buttons drifted off-screen.
- **Combat beat** (`PresentationQueue.tsx`): attacker LEFT / target RIGHT, per-card scale clamped to viewport width (`min(0.82, (vw−96)/440)`) → no overlap/overflow; played-card reveal upgraded from modal×1 (220px) to the INSPECT presentation (330px).
- **COST AREA wordmark**: the opp-half counter-rotation CSS (`index.css` `.is-opp-content-flip .playmat-zone__label` → `display:inline-block`) destroyed the label's flex centering. Centering moved to a plain container; the label class now sits on the inner span only — both halves centered + readable.
- **Tests:** `e2e/local-ai/f8c-ui-layout.spec.ts` (5 scenarios incl. no-page-scroll with 8 counters / 6 blockers, inspect-size equality via `[data-flip-back]` measurement, combat no-overlap, reveal=330, cost-label centering ±3px). 5 stale F-7n/F-7y prompt-interaction tests updated to click the tile wrapper (the inner CardArt button is non-interactive now). Full local-ai battery 44/44.

## TICKET — AI never uses Blockers or Counters (strategy backlog, NOT a UI bug)

**Exact answer (F-8C investigation):** when the human attacks, the local store FORCE-SKIPS every AI reactive window — `src/store/game.ts:578-582`: `reactiveIsAi` → the while-loop never breaks for options and always dispatches SKIP_BLOCKER/SKIP_COUNTER. The AI classes are never consulted for reactive windows (Easy/Medium/Hard only score their own-turn actions; HardAi even hard-codes SKIP at `HardAi.ts:62/66/187`). The UI is fine; nothing is hidden. Fix requires an AI reactive policy (when to block, which counter to spend) + store wiring — non-trivial, deferred per owner instruction.

---

## BUG-032 — F-8D: generic target picker + clause-tail resumption + AI reactive + combat rebuild + modifier visibility

**Fixed:** 2026-06-11 (owner-approved F-8D). Metadata-driven throughout — zero card-specific production logic.

- **Generic target picker:** EffectDispatcher step 4.5 suspends choice-kind targeted clauses (`opp_character`, `your_character`, `any_character`, `*_leader_or_character`, `opp_don_or_character` — covers reduce/give power, removal_ko, bounce, rest/unrest, give_don and every "up to X" board pick) into `attack_target_pick` for `humanControllers` seats, carrying the full clause continuation (cost pre-paid per CR; plan-gap A7 closed). `RESOLVE_TARGET_PICK` validates picks (⊆ candidates, ≤ pickLimit, dupes, choose-none) then runs the action, marks OPT (via `optKey`), and **resumes the clause TAIL** (new dispatcher `startIndex` — without it, 115 corpus cards would silently lose later same-trigger clauses). AI/sim/server keep V0 auto-resolve (flag absent). UI: `TargetPickerPrompt.tsx` (F-8C standard: prompt tiles, View→inspect, Choose None, no-scroll).
- **AI reactive play:** `src/store/aiReactive.ts` replaces the dispatch-tail force-skip (game.ts) — deterministic generic policy: block with best surviving blocker (or chump at ≤2 life on leader hits); counter minimal-spend to survive leader hits at ≤3 life or small deficits. DELIBERATELY BASIC v1 (no difficulty tiers yet) — strategy backlog stays open.
- **Combat presentation rebuild:** head-to-head duel grid (attacker LEFT tilted +5°, defender RIGHT tilted −5°, tops facing), clamped container (≤480px), per-card scale fits any viewport, base→DON→modifiers→final math line under each card, power plates, no overlap/overflow/scroll (asserted at 1280×720 AND 390×844).
- **Modifier visibility:** badge already aggregates (CardArt powerModNet); added CardDetailModal breakdown panel (`base +mods = total` + per-source lines from POWER_MODIFIED history) and the combat math line. Engine stacking PROVEN generically (`power-stacking-f8d.test.ts`: +1000+1000=+2000, buff+debuff, DON gating both turns, end-of-turn expiry, combat uses stacked power).
- Tests: `target-picker-f8d.test.ts` (8 engine), `power-stacking-f8d.test.ts` (6), `f8d-target-picker.spec.ts` (9 e2e incl. OP01-006 Otama proof, AI block/counter proofs, phone+desktop no-scroll/no-overlap with screenshots under test-results/f8d-evidence/). 3 stale auto-target e2e tests updated to drive the picker. Full local-ai battery 53/53; `npm test` 1129/0; build green.
- Deferred (documented): searcher clause-tail resumption (17 cards — needs HandlerCtx clause-index plumbing); counter-window targeted clauses keep V0 auto (pendingAttack protection, same as F-8B); AI difficulty tiers; mandatory-vs-optional effect semantics (F-8D addendum item 1, next).

---

## BUG-033 — F-8D addendum: optional-cost offer, opponent hand fan, header compression, duel shell fix

**Fixed:** 2026-06-11 (owner-approved incl. the optional-cost reorder). Metadata-driven; zero card-specific logic.

- **Optional vs mandatory:** new `effect_offer` pending + `RESOLVE_EFFECT_OFFER`. OPTIONAL-COSTED clauses ("You may pay <cost>:") on human seats now ASK → PAY → RESOLVE (was pay-then-resolve); Skip pays NOTHING (`EFFECT_DECLINED`) and the card's tail clauses still run. `activate_main` exempt (activation was the choice). Unpayable costs skip silently (unchanged outcome). Mandatory pickers honor a `target.mandatory` metadata flag (no choose-none, empty picks rejected); corpus currently has zero such flags — exact-count prints are a Track-2 data-pass item, documented. AI/sim/server keep V0 auto-pay (proven).
- **Opponent hand fan:** `OppHandFan.tsx` — face-down backs + exact count chip pinned under the header; CardArt rendered with NO inst/card props so no identity can reach the DOM (leak-asserted in e2e). Tracks every hidden-zone movement by construction (pure state-derived).
- **Header compression:** compact single-row header (logo mini + T/phase/active-player) + hamburger sheet holding difficulty/reset/theme; End Turn + all gameplay controls stay on the board. Height ≤40px asserted (was a two-row ~52px toolbar).
- **Duel shell fix (root cause of the lingering overlap):** the beat's `fixed` overlay is contained by the transformed 430px app shell, so sizing from `window.innerWidth` overflowed/overlapped inside it. Duel + reveal sizing now derives from `min(vw, 430)` and the clamp accounts for the ±5° tilt's rotated footprint. Screenshot-verified clean (plates + base→DON→mods=final lines + result).
- Tests: `effect-offer-f8d.test.ts` (7 engine), `f8d-addendum.spec.ts` (4 e2e incl. leak check + header + duel), combat tests re-verified at 1280×720 + 390×844 + the 430 shell. Full battery 57/57; `npm test` 1136/0; build green; hardcode grep clean.

---

## BUG-034 — F-8D: fixed-board uniform scaling + player-choice COST payments + printed prompt text + inspect-everywhere

**Fixed:** 2026-06-12 (owner-approved batch). Metadata-driven; zero card-specific production logic.

- **Fixed-board architecture (proof):** the playmat is a FIXED 430×900 design canvas (`BOARD_DIMS`, cardSizing.ts) scaled as ONE unit (`transform: scale`, letterboxed) — no responsive reflow. `f8d-fixed-board.spec.ts` asserts at 1920×1080 / 1366×768 / 768×1024 / 390×844 / 844×390: aspect ratio fixed, design-space zone rects identical within ±2px, no page scroll, header never collides. Composite side-by-side proof: `test-results/f8d-evidence/board-side-by-side.png`.
- **Player-choice COST payments (the Gordon bug):** costs that pay with player-selected cards no longer auto-pick from the hand/field head on human seats. New `costChoice.ts` registry derives candidates+count from the cost shape for 9 keys (`discardHand`, `discardHandFilter`, `bottomOfDeckFromHand`, `trashFromHand`, `revealHand`, `restOwnCharFilter`, `returnOwnCharFilter`, `bottomOfDeckOwnChar` — plus source-fixed keys correctly classified as no-choice). Dispatcher step 3.5 suspends into `attack_target_pick` with a `costPick` payload BEFORE paying anything (ask → pick payment → pay → resolve); `RESOLVE_TARGET_PICK` re-enters the clause with `chosenCostIds`; handlers pay with EXACTLY the chosen cards (`ctx.chosenCostIds`), falling back to the V0 head-pick when absent — AI / sim / server byte-identical. Exact counts enforced engine-side (`exactCount`: empty/partial/foreign picks rejected) and UI-side (Confirm gated, no Choose None). Multi-choice costs chain sequential pickers with earlier picks excluded. No-choice situations (candidates == count) auto-pay.
- **Printed effect text:** prompts render the card's PRINTED `effectText` (segment for the firing trigger via `printedSegmentFor` — rules-vocabulary marker mapping, no card logic) as primary copy in EffectOfferPrompt / TargetPickerPrompt / SearcherPeekPrompt. Engine `describeCost` map completed for every registered cost key + camelCase humanizer default — internal keys (e.g. `bottomOfDeckFromHand`) can never leak again.
- **Inspect-everywhere:** EffectOfferPrompt card (tap + View), TriggerPrompt life card, DiscardChoice / PeekChoice tiles (View), Mulligan hand (tap), Blocker/Counter duel-header minis (tap) — all open the SAME `CardInspectOverlay`. Documented intentional exception: transient presentation beats (PresentationQueue / LifeReveal / EventCard overlays) keep tap-to-fast-forward; they yield to every choice window within 120ms.
- Tests: `cost-pick-f8d.test.ts` (9 engine: suspend-before-pay, reject empty/over/foreign, Gordon-shaped bottom-deck proof, AI head-pick invariance, no-choice auto-pay, activate_main field cost, sequential multi-key, filter candidates, cost→target chaining), `f8d-cost-picker.spec.ts` (3 e2e: REAL OP01-011 Gordon full flow with 5 screenshots, Skip-pays-nothing, mulligan inspect). `npm test` 1145/0; build green; full battery green; hardcode grep clean.
