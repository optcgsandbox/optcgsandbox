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

## BUG-008.A — `resolveDiscardReducer` ignored `pendingDiscard.count`, allowing single-discard satisfaction of CR §6-5-7

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
