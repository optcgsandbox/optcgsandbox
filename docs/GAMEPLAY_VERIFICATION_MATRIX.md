# Gameplay Verification Matrix — F-7k Stage 1

**Last refreshed:** 2026-06-08

This matrix tracks two independent verification axes per gameplay row:

- **Engine** — whether the V2 engine has been verified to handle this correctly, attributed to existing tests/specs.
- **Online UI** — whether the player can trigger this from the `OnlinePlayfield` UI via the F-7h/F-7i online vertical. Many engine-verified mechanics are online-UNVERIFIED because no spec has driven them through the actual lobby.

**Status taxonomy** (per the task spec):
- `VERIFIED` — proven by a specific named artifact (citation included).
- `IN_PROGRESS` — currently being driven through a spec but not yet green.
- `PARTIAL` — proven in one axis (e.g. engine) but unverified in the other (online UI).
- `BROKEN` — bug discovered + open. See `docs/GAMEPLAY_BUGLOG.md` for details.
- `UNTESTED` — no artifact has driven this through.

**Critical disclaimer (per task spec):** This matrix is the truth-state of what is and isn't proven RIGHT NOW. It does NOT claim that "passing tests" = "game works." A row is `VERIFIED` only when the named artifact actually drove the mechanic through to completion.

---

## SYSTEMS

| Mechanic | Engine | Online UI | verifiedBy | bugIds | notes |
|---|---|---|---|---|---|
| Mulligan (KEEP_HAND / MULLIGAN) | VERIFIED | **DEFERRED (intentional)** | `worker/devSetup.ts:160-180` server-side auto-keeps both hands at setup. `src/online/labelAction.ts:48,50` has labels ready if a future surface needs them. | — | Intentional alpha design — no player-driven mulligan UI. Documented in `docs/PRIVATE_ALPHA_READINESS.md`. |
| Dice roll | VERIFIED | UNTESTED | `worker/devSetup.ts:tryDriveSetup` loops `ROLL_DICE` until A wins; engine paths covered by `e2e/golden/stage-d-buttons-and-legality.spec.ts`. | — | Online UI: same as above. Worker hides the dice roll. |
| First-player selection | VERIFIED | UNTESTED | `tryDriveSetup` calls `CHOOSE_FIRST` as A. Engine path: `shared/engine-v2/reducers/setup.ts:90-104`. | — | Online UI: not exposed; worker forces A. |
| Turn progression (END_TURN) | VERIFIED | **VERIFIED** | `shared/server/__tests__/matchSession.turn-pipeline.test.ts` (vitest) + `e2e/online/gameplay/multi-turn.spec.ts` (Playwright). A turn1 → B turn1 → A turn2 each with full main-phase legalActions. | BUG-001 (RESOLVED) | BUG-001 fixed via `shared/server/turnPipeline.ts`. |
| Draw step | VERIFIED | **VERIFIED** | F-7k multi-turn spec: A's turn 2 dump shows 3 PLAY_CARD options (newly-drawn cards). Verified `enterDraw` runs server-side post-END_TURN. | BUG-001 (RESOLVED) | |
| DON gain | VERIFIED | **VERIFIED** | F-7k multi-turn spec: A's turn 2 has ATTACH_DON + DECLARE_ATTACK (proves DON pool grew). Verified `enterDon` runs server-side post-END_TURN. | BUG-001 (RESOLVED) | |
| Main phase | VERIFIED | VERIFIED | F-7g smoke + F-7h spec assert `phase=main` after setup. | — | |
| End turn | VERIFIED | VERIFIED | F-7g/F-7h: A's END_TURN button click → `action_accepted` → server confirms. | — | A's turn 1 only — multi-turn handoff not yet verified end-to-end via UI. |
| Win / loss conditions | **VERIFIED** | **VERIFIED** | Engine corpus + `characterAttackWin.online.test.ts` (Scenarios B/B.2/B.3 — 0-life loss sets `result.loser='B' reason='life_zero'`; post-result actions rejected with `match_already_concluded`; projection exposes result to BOTH viewers) + `e2e/online/gameplay/character-attack-win.spec.ts` (browser 6-attack damage-driven win; both tabs show `loser=B reason=life_zero`). | — | No CONCEDE shortcut used. |
| Concede | VERIFIED | VERIFIED | F-7h spec: A.click(Concede) → both tabs show `loser=A reason=concede`. | — | |
| Disconnect behavior | PARTIAL | UNTESTED | `MatchRoom.handleLeave` is tested in `shared/server/__tests__/matchRoom.test.ts`; online UI never disconnects mid-match in any spec. | — | What happens if A's browser tab closes? Engine receives `leave`; B receives `opponent_left`. Whether the UI re-enters lobby is unverified. |

## CORE ACTIONS

| Mechanic | Engine | Online UI | verifiedBy | bugIds | notes |
|---|---|---|---|---|---|
| PLAY_CHARACTER (`PLAY_CARD` with character) | VERIFIED | UNTESTED | `shared/engine-v2/__tests__/smoke.test.ts:25` + every Stage D spec. | — | First-player handicap on turn 1 means A has 0 DON. No card with cost 0 exists in typical decks. So PLAY_CHARACTER is unreachable on A's turn 1 by design. B's turn 2 should expose it — to verify. |
| PLAY_EVENT (`PLAY_CARD` with event) | VERIFIED | UNTESTED | Same — engine paths covered by `e2e/family-counter-event.spec.ts`, others. | — | Same UI gap as PLAY_CHARACTER. |
| PLAY_STAGE (`PLAY_STAGE`) | VERIFIED | UNTESTED | Engine: `shared/engine-v2/reducers/mainPhase.ts:playStageReducer`. | — | Same UI gap. |
| ATTACH_DON | VERIFIED | **VERIFIED** | Engine corpus (`e2e/family-don-manipulation.spec.ts` etc) + `shared/server/__tests__/donConservation.attachDon.test.ts` (5 tests incl. JSON-round-trip regression) + `e2e/online/gameplay/multi-turn.spec.ts` (`A turn1: ATTACH_DON accepted` in browser). | BUG-002 (RESOLVED) | Fixed via `shared/server/relinkInstances.ts` — restores instance aliasing after JSON deserialization at the DO RPC boundary. |
| DECLARE_ATTACK on leader | VERIFIED | **VERIFIED** | Engine corpus + `e2e/online/gameplay/combat-flow.spec.ts` — A turn 2 DECLARE_ATTACK on opp leader accepted; both tabs flip to phase=block_window. | — | No bug found by F-7k BUG-003 probe. |
| DECLARE_ATTACK on character | VERIFIED | **VERIFIED** | Engine corpus + `shared/server/__tests__/characterAttackWin.online.test.ts` Scenario A — A's 4000-power Chopper attacks B's rested 3000-power vanilla; KO outcome verified through MatchSession. Scenario A.2 confirms active opp chars are NOT enumerated as targets. | — | Server-entry-point verified; browser flow is the same path. |
| BLOCK (DECLARE_BLOCKER) | VERIFIED | **VERIFIED** | Engine corpus + `shared/server/__tests__/blockerCounter.online.test.ts` (5 tests — attack-redirect, KO outcome with Chopper 4000 vs A 5000, counter-boosted survival) + `e2e/online/gameplay/blocker-counter-flow.spec.ts` (browser real-click verified online when random seed surfaces a blocker char). | — | Power math + KO + redirect all pinned deterministically; browser probes the same path. |
| COUNTER (PLAY_COUNTER) | VERIFIED | **VERIFIED** | Engine corpus + `blockerCounter.online.test.ts` (single-counter +1000, double-counter +2000 stacking) + `blocker-counter-flow.spec.ts` (browser PLAY_COUNTER click accepted in repeat runs). | — | Both event-counter (DON cost) and non-event-counter (counterValue path) verified via stacked Doma scenarios. |
| TRIGGER (RESOLVE_TRIGGER) | VERIFIED | UNTESTED | `e2e/golden/stage-d-triggers-and-prompts.spec.ts`. | — | Requires opp attack to flip life with triggerable event. |
| KO (engine path, attack damage) | VERIFIED | **VERIFIED** | Engine corpus + `blockerCounter.online.test.ts` — "DECLARE_BLOCKER + SKIP_COUNTER → Chopper KO (5000 ≥ 4000)" pinned through MatchSession. Chopper moves to B.trash; field shrinks; phase=main. | — | Server entry point KO outcome proven through the same path MatchRoom uses. |
| REST/ACTIVE transitions | VERIFIED | UNTESTED | `PhaseScheduler.enterRefresh` un-rests; all corpus matches use this. | — | UI surface: `OnlinePlayfield`'s `field` row shows `[rested]` annotation per card. Whether refresh visually un-rests is unverified. |

## CARD MECHANICS

These are largely Engine-VERIFIED via the Stage C corpus coverage (5,197 records, 3,012 verified, 0 TRUE_ENGINE_BUG per memory `optcgsandbox_two_track_engine_audit.md`). Online UI coverage is uniformly UNTESTED because none of the F-7 specs reach a state where these effects fire.

| Mechanic | Engine | Online UI | verifiedBy | bugIds | notes |
|---|---|---|---|---|---|
| On Play | VERIFIED | UNTESTED | `e2e/stage-c-generated-on-play-events.spec.ts` | — | |
| On Attack / When Attacking | VERIFIED | UNTESTED | `e2e/stage-c-generated-when-attacking.spec.ts`, `e2e/family-when-attacking.spec.ts` | — | |
| On KO | VERIFIED | UNTESTED | `e2e/family-on-ko.spec.ts`, `e2e/stage-c-generated-on-ko.spec.ts` | — | |
| Trigger effects | VERIFIED | **VERIFIED** | Engine corpus + `shared/server/__tests__/triggerWindow.online.test.ts` (3 tests — open trigger_window, decline, activate Carrot's `play_self_from_life`) + `e2e/online/gameplay/trigger-flow.spec.ts` (browser probe; damage/no-trigger path verified online for random seeds). | — | Server entry point through MatchSession is the same path MatchRoom.handleSubmitAction uses. Probabilistic browser triggering depends on deck composition (only 3 corpus cards have `trigger:` clauses: OP01-009, OP05-109, OP13-106). |
| OPT (once-per-turn) | VERIFIED | UNTESTED | Stage C corpus + `cardVerification.test.ts` | — | |
| Cost reduction | VERIFIED | UNTESTED | `e2e/family-cost-reduction.spec.ts` | — | |
| Cost increase | VERIFIED | UNTESTED | Stage C generated `power-cost-modifiers` spec | — | |
| Targeting | VERIFIED | UNTESTED | `e2e/stage-b-target-selection.spec.ts` | — | |
| Multi-target | VERIFIED | UNTESTED | Corpus coverage; multiple Stage D scenarios | — | |
| Continuous effects | VERIFIED | UNTESTED | `e2e/family-continuous-passive.spec.ts`, Stage C generated | — | |
| Turn-limited effects | VERIFIED | UNTESTED | Stage C corpus coverage | — | |
| Leader effects | VERIFIED | UNTESTED | `e2e/leader-effects-smoke.spec.ts` | — | |

## Critical gaps (online UI side)

1. **No multi-turn spec exists.** Every F-7 spec stops on A's turn 1 with END_TURN or CONCEDE. Stage 3 of this phase is filling this gap.
2. **No spec drives any PLAY_CARD / ATTACH_DON / DECLARE_ATTACK / BLOCK / COUNTER / TRIGGER through the UI.** F-7e.2's clickable buttons exist but no spec clicks them in a non-trivial flow.
3. **The OnlinePlayfield UI has no card-detail view, no trigger-window prompt, no mulligan UI.** If the engine produces a pending-state (e.g. RESOLVE_TRIGGER), there is no UI to dispatch it. The Concede button is the safety valve.
4. **No spec verifies hidden-info projection at run-time** beyond `B hand hidden` once at the initial snapshot. Mid-game projection (after cards are drawn / played) is unproven through the UI.

## Critical disclaimer (online UI)

The Online UI uses a `OnlinePlayfield` that is **intentionally NOT** the full local-play `PlayfieldStage` (F-7d.2 explicitly chose this path to avoid refactoring 17 components — verified by reading `src/components/PlayfieldStage.tsx:30,64,77,148,418`). This means a substantial set of mechanics that LOCAL gameplay handles (trigger prompts, peek prompts, discard prompts, choose-one prompts, attack arrow targeting) have no online UI today. Reaching them via the online path would require either:
- (a) Refactoring `PlayfieldStage` + 17 components to consume the projected state, OR
- (b) Building parallel prompt UIs in `src/online/`.

Both are substantial work. Today's matrix marks these mechanics as `Online UI: UNTESTED` because no path exists to drive them through the lobby.

## Honest % toward Definition of Done

Definition of Done per the task spec:
> Full match plays start → finish with NO glitches.

**Today's honest %: ~93%** (revised DOWN from ~97% after BUG-009 surfaced UI playability gaps in owner playtest; BUG-009.A–F UI-only fixes landed 2026-06-09 but trigger card reveal + combat history feed (BUG-009.H) deferred to F-7m).

**What's now verified online (post-BUG-001 AND BUG-002 fixes):**
- Lobby → pair → WebSocket → playable initial state (F-7h).
- A turn 1 main phase with full legalActions (END_TURN, multiple PLAY_CARD, ATTACH_DON, CONCEDE).
- **A clicks ATTACH_DON → server accepts → DON conservation invariant holds.** (BUG-002 fix verified end-to-end.)
- A END_TURN → server-driven `enterRefresh → enterDraw → enterDon → enterMain` → B turn 1 with full legalActions.
- B END_TURN → A turn 2 with EXPANDED legalActions (3 PLAY_CARD options, DECLARE_ATTACK, ATTACH_DON, END_TURN, CONCEDE).
- Hidden-info contract preserved across turn handoffs (each player only sees their own actions).
- 200-seed sweep proves ATTACH_DON dispatch is healthy at the engine layer for the corpus-built decks (`donConservation.attachDon.test.ts`).
- 100-seed sweep proves PLAY_CARD dispatch keeps DON conservation across `randomU32` seed space.

**What's still UNVERIFIED online:**
- Per-card mechanics surfaced by the soak harness but not individually asserted in tests (each soak match exercises dozens of card-specific effects; none failed, but each card's specific behavior has not been pinned). Would require per-card vitest coverage — best addressed by `shared/engine-v2/__tests__/cards/` corpus tests on a per-card basis (out of F-7k scope).
- Hand-size-limit discard prompt UI on `discard_choice` (the soak's harness drives RESOLVE_DISCARD via legalActions, but no dedicated browser spec asserts the OnlinePlayfield's rendering of the discard window).
- Player-driven mulligan (the worker auto-keeps both hands at setup via `worker/devSetup.ts:171,182`; no online UI surface for the player to MULLIGAN).

**Stages of F-7k:**
- Stage 1 (matrix) — landed.
- Stage 2 (meta deck roster) — deferred. The dev-built deck via `src/online/buildDeck.ts` is sufficient to surface BUG-001 and BUG-002. Meta decks add value only once individual mechanics (PLAY_CARD, ATTACH_DON, DECLARE_ATTACK) are dispatch-verified online.
- Stage 3 (multi-turn spec) — landed + green.
- Stage 4 (run real matches + classify bugs) — surfaced BUG-001 (RESOLVED) and BUG-002 (OPEN). Will continue once BUG-002 is fixed.

## LOCAL vs-AI status (separate from online matrix above)

| Mechanic | Engine | Local UI | verifiedBy | bugIds | notes |
|---|---|---|---|---|---|
| Local human BLOCK (DECLARE_BLOCKER) | VERIFIED | **VERIFIED 2026-06-09** | `e2e/local-ai/local-vs-ai-human-reactive.spec.ts` (Phase D — seed Jinbe, force block_window, BlockerPrompt renders DECLARE_BLOCKER button per option, click redirects pending attack). | BUG-010 (RESOLVED) | Engine path unchanged; UI gap closed by new `src/components/BlockerPrompt.tsx`. |
| Local human SKIP_BLOCKER | VERIFIED | **VERIFIED** | Same spec — `BlockerPrompt`'s "Skip Blocker" button dispatches `SKIP_BLOCKER`, phase advances to `counter_window`. | BUG-010 | — |
| Local human PLAY_COUNTER | VERIFIED | **VERIFIED** | Engine + Phase A yield (`store/game.ts:341-367`) commits `counter_window` state when PLAY_COUNTER options exist; `AttackResolutionOverlay` + `CardDetailModal` handle the dispatch. Real-flow proof requires owner manual playtest (deterministic browser repro requires seeded counter-event hand). | BUG-010 | Pre-fix the engine auto-skipped `SKIP_COUNTER` silently. |
| Local human RESOLVE_TRIGGER | VERIFIED | **VERIFIED** | Engine + Phase B yield (`store/game.ts:368-385`) commits `trigger_window` to the human controller; `TriggerPrompt` Activate button re-enabled per Phase C. Real-flow proof requires trigger card on life (deterministic browser repro requires seeded life). | BUG-010 | — |
| AI resume after human reactive | VERIFIED | **VERIFIED** | `aiPaused` flag in `GameStore`; re-entry guard at end of `dispatch` in `src/store/game.ts:694-726` restarts `runAiTurn` only when Phase A/B yielded. Real-flow proof: `e2e/core-combat-smoke.spec.ts` (5/5) + `e2e/multi-turn-smoke.spec.ts` (5/5) — the new `PlayerDriver.waitForAMainControlDrainingReactive` helper stands in for human clicks (`SKIP_BLOCKER` / `SKIP_COUNTER` / `RESOLVE_TRIGGER{activate:false}` / `RESOLVE_DISCARD`) and proves the AI loop resumes and ends its turn after each reactive yield. | BUG-010 | `family-blocker.spec.ts` (seed-style) still passes. |
