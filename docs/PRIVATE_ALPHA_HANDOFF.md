# Private Alpha Handoff

**Date:** 2026-06-09
**Status:** `PRIVATE_ALPHA_READY` — per `docs/PRIVATE_ALPHA_READINESS.md`.

This document is the operator-facing handoff for running the OPTCG online vertical locally and inviting alpha testers.

---

## Run locally

Two terminals.

**Terminal 1 — worker (Cloudflare Durable Objects in miniflare):**

```bash
cd worker
npx wrangler dev --port 8801 --local --var DEV_AUTH:1 --var ENV:dev
```

Wait for `Ready on http://localhost:8801`.

**Terminal 2 — Vite app:**

```bash
npx vite --port 5174
```

Open two browser tabs (or two different browser windows for cleaner sessions):

- `http://localhost:5174/?online=1`

Each tab:
1. Type a unique `sessionId`.
2. Pick a color (`red`, `blue`, `green`, `purple`, `black`, `yellow`).
3. Click **Find Match**.

Once both tabs reach `phase=connected`, the live match begins.

---

## Run the verification suite

**Server vitest (28 files / 324 tests):**

```bash
npx vitest run shared/server/__tests__/ src/online/labelAction.test.ts
```

**Build sanity:**

```bash
npx vite build
cd worker && npx wrangler deploy --dry-run
```

**Browser e2e (single match):**

```bash
# Terminal 1 already running wrangler.
ONLINE_E2E=1 WORKER_ORIGIN=http://localhost:8801 \
  npx playwright test e2e/online/online-two-tab.spec.ts --project=chromium
```

**Gameplay battery (7 specs):**

```bash
ONLINE_E2E=1 WORKER_ORIGIN=http://localhost:8801 \
  npx playwright test e2e/online/online-two-tab.spec.ts e2e/online/gameplay/ \
  --project=chromium
```

**Full 18-game soak (BUG-007 harness):**

```bash
SOAK_FULL=1 ONLINE_E2E=1 WORKER_ORIGIN=http://localhost:8801 \
  npx playwright test e2e/online/gameplay/soak/gameplay-soak.spec.ts \
  --project=chromium
```

The soak takes ~5-15 min depending on seeds. Soak v9 result: 18/18 clean.

---

## What is verified

- Lobby pair + WebSocket + projection to both tabs (F-7b/F-7d/F-7h).
- Turn pipeline (`enterRefresh → enterDraw → enterDon → enterMain`) after every END_TURN (BUG-001).
- ATTACH_DON dispatch through the JSON-RPC boundary (BUG-002 fix via `relinkInstances`).
- PLAY_CARD / PLAY_STAGE dispatch.
- DECLARE_ATTACK on leader + on rested characters.
- DECLARE_BLOCKER click — attack redirect, blocker rested, KO outcome with power math (BUG-005).
- PLAY_COUNTER click — single + stacked counter boost (BUG-005).
- SKIP_BLOCKER / SKIP_COUNTER.
- RESOLVE_TRIGGER — both activate=true (`play_self_from_life`) and activate=false (decline) branches (BUG-004).
- RESOLVE_DISCARD — CR §6-5-7 hand-size drain (BUG-008.A fix).
- RESOLVE_CHOOSE_ONE / RESOLVE_PEEK / RESOLVE_TARGET_PICK — drained by soak picker.
- CONCEDE — always-legal per `MatchSession.validateLegalAction`.
- Win conditions: `life_zero` (BUG-006 + every soak match), `deck_out` (soak v3), `concede` (F-7h).
- Match-result projection to BOTH tabs (`resultA === resultB` always).
- Hidden-info contract: opp hand / deck / face-down life anonymized in `publicProjection`.

See `docs/GAMEPLAY_VERIFICATION_MATRIX.md` for the full matrix.

---

## What is NOT verified (and why it doesn't block alpha)

| Gap | Status | Why non-blocking |
|---|---|---|
| Player-driven mulligan UI | DEFERRED (intentional) | `worker/devSetup.ts:160-180` server-side auto-keeps both hands. Alpha+1 UX nicety. |
| Per-card mechanic browser pinning | DEFERRED | Stage C corpus (5,197 records / 3,012 human-reviewed / 0 TRUE_ENGINE_BUG) + soak harness (~2,000+ clicks) cover it. See `docs/CARD_MECHANIC_PINNING_PLAN.md`. |
| Production Supabase auth | Operator-blocked | F-5d.1 preflight is parked on 4 operator inputs (project URL + JWKS URL + audience + issuer). DEV_AUTH is intended only for local smoke; production-bound deploys MUST switch to Supabase. |
| Production CORS allowlist beyond `https://optcgsandbox.com` | Operator config | `worker/index.ts:22-25`. Adjust for staging hostnames if alpha cohort uses them. |
| Tracing / observability | Operator config | Cloudflare DO logs are the only signal today. |

---

## Bugs closed in F-7k

8 total — all RESOLVED. See `docs/GAMEPLAY_BUGLOG.md`.

- **BUG-001** — server didn't drive R/D/D/Main pipeline after END_TURN.
- **BUG-002** — JSON-RPC boundary broke `players.X.{leader,field,stage}` ↔ `state.instances[id]` aliasing.
- **BUG-003** probe — no bug found (combat flow clean).
- **BUG-004** probe — no bug found (trigger flow clean).
- **BUG-005** probe — no bug found (blocker + counter clean).
- **BUG-006** probe — no bug found (character attack + 0-life win clean).
- **BUG-007.A** — soak picker missed RESOLVE_CHOOSE_ONE/PEEK/TARGET_PICK.
- **BUG-007.B** — soak picker over-used PLAY_COUNTER, stalemating matches.
- **BUG-007.C** — soak orchestrator raced result-set vs button-disable.
- **BUG-008.A** — `resolveDiscardReducer` ignored `pendingDiscard.count`.

---

## Alpha+1 backlog

- Per-card mechanic browser pinning per-action-family (see `docs/CARD_MECHANIC_PINNING_PLAN.md`).
- Player-driven mulligan UI surface (engine + protocol + `labelAction` already support MULLIGAN/KEEP_HAND; needs UI wiring + setup-chain rewire to expose the window).
- Production Supabase auth handoff (F-5d.1 preflight).
- Match replay sharing (Replay V2 already serializable; needs a UI surface).
- Reconnect resilience on transient WS drops.
- Telemetry (PostHog/Sentry hooks per crew-builder pattern).
- Ranked / ELO / chat / spectator — explicitly out of scope until alpha cohort feedback lands.

---

## Final test summary

| Gate | Result |
|---|---|
| `npx vitest run shared/server/__tests__/ src/online/labelAction.test.ts` | 28 files / 324 tests passed |
| `npx vite build` | OK |
| `npx wrangler deploy --dry-run` | OK |
| `online-two-tab.spec.ts` | passed |
| `e2e/online/gameplay/` 7-spec battery | all passed |
| `SOAK_FULL=1` soak v9 | 18/18 clean (9 A wins / 9 B wins / 1982 clicks) |

---

## Verdict

**`PRIVATE_ALPHA_READY`.** Ship.
