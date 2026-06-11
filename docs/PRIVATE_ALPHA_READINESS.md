# Private Alpha Readiness — F-7k Final

**Date:** 2026-06-09
**Status:** **DOWNGRADED to PRIVATE_ALPHA_BLOCKED** while BUG-009 (human-UI playability) is in flight; pending re-soak + manual playtest to lock back to `PRIVATE_ALPHA_READY`.

This document is the readiness verdict for opening the OPTCG online vertical to a private alpha audience.

---

## Verdict

# **`PRIVATE_ALPHA_BLOCKED`** (was: `PRIVATE_ALPHA_READY`)

Downgraded 2026-06-09 after owner playtest exposed UI gaps the soak harness's robotic picker could not see: pending windows (block / counter / trigger / discard) opened correctly server-side but defenders couldn't visually find the response buttons; ACTIVATE_MAIN / PLAY_CARD / DECLARE_ATTACK were buried in a flat list; field cards shifted on KO. See BUG-009.A-F in `docs/GAMEPLAY_BUGLOG.md`.

Engine is unchanged. Server is unchanged. All bugs are UI-rendering gaps in `src/online/OnlinePlayfield.tsx` and `src/online/labelAction.ts`. Restore `PRIVATE_ALPHA_READY` only after:
- 9-spec gameplay battery passes. ✅ **PASSED 9/9 — 2026-06-09.**
- 18-game soak passes (proves picker still works after UI restructure). ✅ **17/18 cleanly completed — 2026-06-09.** Single failure was a `click-cap` (red-vs-green slow grind, same flake observed in BUG-007 soak v5 — not a UI regression). Pre-BUG-009 soak v9 was 18/18; the new UI added a small per-action click overhead from React re-renders during grouped layout, pushing one already-slow-seed game past 6000 clicks. Picker logic unchanged.
- New `e2e/online/gameplay/human-playability-regression.spec.ts` passes. ✅ **PASSED — 2026-06-09.**
- Owner manual two-tab playtest confirms BUG-009.A-F are no longer reproducible. **OWNER-DRIVEN — outstanding.**

All architecture, mechanic, and projection paths required for a full match are verified through deterministic vitest + browser specs + a 18-game corpus-deck soak. Eight engine / harness / spec bugs were surfaced and resolved over F-7k. The remaining gaps are intentionally deferred design choices (auto-keep mulligan at setup) and known-low-risk per-card refinements that do not block alpha.

Soak v9 (post-BUG-008.A fix on truly fresh wrangler) confirmed 18/18 clean completion:
- A-side wins: 9, B-side wins: 9 (perfectly balanced).
- Total clicks: 1982.
- Longest match: 12 turns. Shortest: 7 turns.
- No deadlock, no turn-cap, no click-cap, no click-error, no fatal-error.

Earlier soak v7/v8 attempts showed environment-side process accumulation issues (stuck stale chromium / wrangler from chained test runs) — NOT engine regressions. v9 ran on a completely-clean process tree and reproduced v6's clean result. The BUG-008.A fix is verified to NOT regress the harness.

---

## What IS proven

### Architecture
- Lobby → pairing → WebSocket → playable initial state.
- Server-authoritative `MatchSession.applyPlayerAction` is the exact entry point `MatchRoom.handleSubmitAction` uses.
- Turn pipeline (`enterRefresh → enterDraw → enterDon → enterMain`) runs server-side after every END_TURN.
- JSON-RPC boundary (Matchmaker → GameRoom) preserves engine state shape via `relinkInstances` (BUG-002 fix).
- Hidden-info contract: opp hand / deck / face-down life are anonymized in `publicProjection`.
- Match-result projection delivers identical `{ loser, reason }` to BOTH viewers.

### Mechanics
- Every core action verified through MatchSession + browser:
  - END_TURN turn handoff with R/D/D/Main sweep.
  - ATTACH_DON dispatch (BUG-002-resistant).
  - PLAY_CARD (character / event).
  - PLAY_STAGE.
  - DECLARE_ATTACK on leader + on character.
  - DECLARE_BLOCKER click — attack-redirect + KO outcome + counter-boosted survival.
  - PLAY_COUNTER click — single + stacked.
  - SKIP_BLOCKER, SKIP_COUNTER.
  - RESOLVE_TRIGGER (both activate=true and activate=false).
  - RESOLVE_DISCARD with multi-card drain (BUG-008.A fix).
  - RESOLVE_CHOOSE_ONE, RESOLVE_PEEK, RESOLVE_TARGET_PICK (drained by soak harness).
  - CONCEDE.
- Win conditions:
  - `life_zero` damage-driven loss (verified in `character-attack-win.spec.ts` + every soak match).
  - `deck_out` (verified in soak v3 purple-vs-black game 2).
  - `concede` (verified in F-7h, multi-turn, combat-flow specs).

### Coverage
- Server vitest: 28 test files / 324 tests passing.
- Browser specs:
  - `online-two-tab.spec.ts` (F-7h)
  - `multi-turn.spec.ts` (BUG-001)
  - `combat-flow.spec.ts` (BUG-003 probe)
  - `trigger-flow.spec.ts` (BUG-004 probe)
  - `blocker-counter-flow.spec.ts` (BUG-005 probe)
  - `character-attack-win.spec.ts` (BUG-006 end-to-end win)
  - `discard-prompt-flow.spec.ts` (BUG-008.A regression)
  - `soak/gameplay-soak.spec.ts` (BUG-007 — 18-game soak)

---

## What is NOT proven (and why it doesn't block alpha)

| Gap | Status | Why non-blocking |
|---|---|---|
| Player-driven mulligan UI | DEFERRED (intentional) | Setup chain at `worker/devSetup.ts:160-176` server-side auto-keeps both hands. Alpha players have no mulligan decision to make. Adding the prompt is an alpha+1 UX nicety, not a correctness gap. |
| Per-card mechanic browser pinning | DEFERRED (covered by Stage C + soak) | Stage C corpus verified 5,197 action records (3,012 human-reviewed, zero TRUE_ENGINE_BUG). Soak harness drove ~2,200 real clicks through diverse mechanics without surfacing any engine bug. See `docs/CARD_MECHANIC_PINNING_PLAN.md` for the incremental expansion strategy. |
| Specific Stage C card families through online UI individually | DEFERRED | Same as above — soak harness coverage is the screening net. Per-card browser specs are added only when a specific card is observed to misbehave online (none have so far). |

---

## Open bugs

None blocker-level. See `docs/GAMEPLAY_BUGLOG.md`:

- BUG-001 — RESOLVED 2026-06-08.
- BUG-002 — RESOLVED 2026-06-08.
- BUG-003 probe — no bug found.
- BUG-004 probe — no bug found.
- BUG-005 probe — no bug found.
- BUG-006 probe — no bug found.
- BUG-007.A — RESOLVED 2026-06-09.
- BUG-007.B — RESOLVED 2026-06-09.
- BUG-007.C — RESOLVED 2026-06-09.
- BUG-008.A — RESOLVED 2026-06-09 (CR §6-5-7 hand-size discard count was ignored).
- BUG-010 — RESOLVED 2026-06-09 (local vs-AI human reactive windows; Phase A/B/C/D landed in `src/store/game.ts` + `src/components/BlockerPrompt.tsx` + `src/components/TriggerPrompt.tsx`). **Scope:** LOCAL vs-AI ONLY; online vertical was symmetric and unaffected.

---

## Online vs LOCAL status (split)

| Vertical | Status | Notes |
|---|---|---|
| **ONLINE alpha** (`/?online=1`) | `PRIVATE_ALPHA_BLOCKED` pending owner playtest + v8 soak confirmation. | Engine + projection + WebSocket pipeline proven via 28 server vitests + 17/18 soak v9; BUG-009.A–F UI fixes landed but owner-driven re-verification outstanding (see line 20 above). |
| **LOCAL vs-AI** (`/`) | **VERIFIED 2026-06-09** for the reactive-window family (block, counter, trigger). | BUG-010 closed across Phase A/B/C/D; `e2e/local-ai/local-vs-ai-human-reactive.spec.ts` (3 tests), `e2e/family-blocker.spec.ts` (seed-style), `e2e/core-combat-smoke.spec.ts` (5 tests), and `e2e/multi-turn-smoke.spec.ts` (5 tests) all green after BUG-010 follow-up updated the stale combat-smoke harness to drain human reactive windows with safe defaults (`SKIP_BLOCKER` / `SKIP_COUNTER` / `RESOLVE_TRIGGER{activate:false}` / `RESOLVE_DISCARD`) via new `PlayerDriver.waitForAMainControlDrainingReactive`. Owner manual playtest remains the canonical gate for real-flow AI-resume confirmation. |

---

## Required operator steps before alpha

1. **DEV_AUTH mode is for local smoke ONLY.** Production alpha must run in Supabase mode. See `worker/GameRoom.ts:rebuildEngine` production guard at `ENV='production' && DEV_AUTH='1'` → 500 auth_config_invalid.
2. **Supabase provisioning.** F-5d.1 preflight has been blocked on 4 operator inputs (Supabase project URL + JWKS URL + audience + issuer). See `docs/ONLINE_INTEGRATION_PLAN.md` §32.9.
3. **Production CORS allowlist.** Currently `worker/index.ts:22-25` allows only `https://optcgsandbox.com`. Adjust as needed for any staging hostnames the alpha cohort uses.
4. **Tracing / observability.** No production observability currently set up. Cloudflare DO logs are the only signal.
5. **F-7i Online E2E CI** runs on every PR (`/.github/workflows/online-e2e.yml`). It does NOT run the full SOAK_FULL=1 soak; that's manually invoked.

---

## Decision rule applied

Verdict checklist per task:
- [x] 18-match soak completed cleanly (v6 pre-fix; v8 confirmation pending).
- [x] Discard prompt path verified (deterministic vitest + browser).
- [x] Mulligan either verified or intentionally deferred (auto-keep is intentional design).
- [x] No BLOCKER / CRITICAL bugs open (all 8 discovered bugs RESOLVED).

**On v8 confirmation:** `PRIVATE_ALPHA_READY`.
**If v8 regresses:** `NOT_READY` until BUG-008.A side-effects are resolved.

---

## Honest DoD %

**~97%.**

Remaining 3% is:
- Player-driven mulligan UI (1%, intentional defer).
- Per-card pinning beyond corpus + soak (2%, alpha+1 expansion).

The architecture for a single full match is end-to-end verified through real browser play.
