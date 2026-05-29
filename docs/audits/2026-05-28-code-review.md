# Code Review Audit — 2026-05-28 (commit `ba15030` → fixed in next commit)

Source: Code Reviewer agent dispatch 2026-05-28. Findings verified against actual code by main thread before fixing.

## BLOCKER — none after triage

Agent surfaced 3 BLOCKERs; on verification 1 was real-engine, 1 was real-engine, 1 was doc-vs-engine. Reclassified below.

## MAJOR — fixed

- **`legality.ts:138-144`** — `cardColorMatchesLeader` was a stub returning true for any colored card. Wrong-color cards were playable. **FIXED:** replaced with `sharesColorWithLeader(card, leaderCard)` that intersects color sets. Regression test added (`regressions.test.ts`).
- **`legality.ts:146-149`** — `playedThisTurn` hard-coded `false`. Summoning sickness was unenforced (characters could attack the turn they were played). **FIXED:** added `summoningSick: boolean` flag on `CardInstance` (`GameState.ts`), set true in `applyAction.ts` on PLAY_CARD, cleared in `turn.ts` `runRefreshPhase`. Attack legality checks `!summoningSick || keywords.includes('rush')`. Regression test added.
- **`applyAction.ts:169`** — `resolveAttack` returned `events: []` despite pushing 1–3 events to `next.history`. DELTA broadcast (per `backend-architecture.md` protocol) would have been empty for attacks. **FIXED:** track `historyStart = next.history.length` at entry, return `next.history.slice(historyStart)` as events. Regression test verifies events.length > 0 for a successful leader attack.

## MAJOR — doc, not code

- **Spec mismatch:** `backend-architecture.md:254` GameRoom skeleton calls `engine.applyAction(state, action)` but engine implements `applyAction(state, player, action)`. Engine signature is correct (explicit player attribution is required for server-authoritative validation). **DOC UPDATE PENDING** — backend-architecture.md needs to be corrected.

## False positives (verified clean)

- `effectivePower` adds +1000 per attached DON unconditionally — agent flagged "should only on owner's turn". Verified clean: `endTurn` sets `inst.attachedDon = 0` at end of turn (DON returns to rested pool), so during opponent's turn the count is 0 and boost is 0. No fix needed.
- `runDonPhase` skipping `PHASE_CHANGED` when 0 DON dealt — verified clean. The `if (dealt > 0)` gate is ONLY around `DON_DEALT`; `PHASE_CHANGED` push is unconditional at end of function.
- Refresh-vs-end-of-turn DON detach location — verified functionally equivalent. `endTurn` detaches to rested pool; `runRefreshPhase` moves rested → active. Net effect matches rules. Structural preference only.

## MINOR

- Reactive-window phases (`block_window`, `counter_window`) declared in `GameState.Phase` union but unreachable until v0.1 — tracked under task #65.
- 18-effect taxonomy in `Card.ts` vs `rules-reference.md` §2 — verified 18/18 match.
- `RULES` constants in `GameState.ts` vs `rules-reference.md` §1.1 — verified clean.

## Test verification

- Pre-fix: 21/21 passing
- Post-fix: 25/25 passing (4 new regression tests: summoning-sickness blocks attack, refresh clears summoning sickness, color rule blocks blue-on-red-leader, resolveAttack events non-empty)
- Build: 206KB JS / 65KB gzipped — unchanged

## Status

- BLOCKER findings: 3/3 addressed
- MAJOR engine findings: 3/3 fixed in commit pending
- MAJOR doc finding: 1 pending (backend-architecture.md update)
- False positives: 3 cleared without code change
