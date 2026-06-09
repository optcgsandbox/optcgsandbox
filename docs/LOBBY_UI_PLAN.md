# F-7 Lobby UI + Deck Submission Plan

**Status:** PLAN ONLY. Created 2026-06-08. No code changes. Supersedes the F-7 sketch in `docs/ONLINE_INTEGRATION_PLAN.md` §18.

This document plans the first user-visible online loop. It is written under three hard constraints:

1. No engine changes (Stage C/D + Phase E–F-6 layers stay sealed).
2. No Supabase yet (identity stays `dev:<sessionId>` until F-5d.1 unblock list is satisfied).
3. No OP16 intake (corpus is whatever `shared/data/cards.json` already holds).

---

## 1. Discovery — current state of the codebase (read-only, 2026-06-08)

Every claim below is grounded in a grep/read against the repo today.

### 1.1 Frontend shape
- `src/main.tsx:23-27` — vanilla `createRoot.render(<App />)`. No `RouterProvider`. The app is single-screen.
- `src/App.tsx:14-17` — `?dev=1` query toggles `<DevGameSandbox />`; `?test=1` toggles a Playwright escape hatch (`src/main.tsx:9-22`). Otherwise renders `<PlayfieldStage />`.
- `package.json` — `react-router-dom ^7.16.0` is a dependency but `grep -rln "createBrowserRouter|RouterProvider|BrowserRouter|Routes" src/` returns zero matches outside the non-Router substring `useFieldTapRouter` in `src/components/PlayfieldStage.tsx:87`. **React Router is installed but not used.**
- `src/components/` lists 20+ in-game components (HandFan, PlayfieldStage, etc.) — all gameplay UI. No lobby/menu/queue components exist.

### 1.2 State + engine integration
- `src/store/game.ts:1-65` — Zustand store. Imports the engine V2 surface directly. Calls `applyAction` from `@shared/engine-v2/reducers/applyAction` synchronously.
- `src/store/game.ts:21` — corpus loaded via `import cardsDataRaw from '@shared/data/cards.json'`.
- `src/store/game.ts:41-100` (approx) — `pickLeader(color)`, `pickLeaderById(id)`, `buildDeck(color)`, `bootGame(seed)`. Builds 50-card decks filtered by leader color from the corpus.
- **No WebSocket consumer in `src/`.** `grep -rln "WebSocket|api/join|wss://" src/` → zero matches.

### 1.3 Corpus
- `shared/data/cards.json` — 122,963 lines as of today (a JSON array of card objects). `src/store/game.ts:35` references "2489 cards across leader/character/event/stage" in a comment. Treat the number as a comment claim, not a verified count — F-7a should `length`-check at module-load if the validator depends on it.
- Loaded once at boot (`src/store/game.ts:21`); no cache layer beyond Vite's static asset handling.

### 1.4 Existing tests + smoke surface
- Playwright via `?test=1` (`src/main.tsx:9-22`) — established e2e path. F-7's e2e can ride on this.
- `npx wrangler dev --port <X> --local` (verified F-5d.0, F-6) — works without Cloudflare credentials. Local-only smoke is feasible.
- Memory `optcgsandbox_cloudflare_token.md` — local DO env binds for free; no live deploy required during F-7 development.

### 1.5 Worker surface F-7 inherits
- `worker/index.ts:38-58` — routes today: `POST /api/join`, `GET /ws?room=&token=`, `GET /health`.
- `worker/Matchmaker.ts` (F-6) — accepts `{ sessionId }`, returns `QUEUED` or `PAIRED { roomId, you, clientId, token }`.
- `worker/GameRoom.ts:122-149` — `/init` validator requires `seats.A.clientId` + `seats.B.clientId`; `token` optional.
- `worker/devSetup.ts:67-75` — `buildDevInitialState(seed)` builds a stub state from a hardcoded leader + 15 identical vanilla characters.

### 1.6 What F-7 must NOT touch
- `shared/engine-v2/**` — engine semantics.
- `shared/data/cards.json` — corpus.
- `shared/server/transport/protocol.ts` — F-4b wire shapes.
- `shared/server/MatchSession.ts` / `MatchRoom.ts` — match semantics.
- Stage C/D specs in `e2e/`.

---

## 2. F-7 objective

A user can:
1. Open the app.
2. Choose a leader from the corpus and submit a 50-card deck (start: pre-built color decks via reuse of `src/store/game.ts:buildDeck`).
3. Click **Find Match**. App POSTs `/api/join` with `{ sessionId, deck }`.
4. See `QUEUED → PAIRED`.
5. Connect to `wss?room=<id>&token=<token>` (transport-token only — auth is still F-5c.2 territory; the actual JWT comes later).
6. See projected initial state in the existing `PlayfieldStage`.
7. Submit at least one legal action and see the opponent's projection update.

Out-of-scope but adjacent (call out so F-7 doesn't accidentally absorb them):
- Mobile polish.
- Reconnect.
- Real Supabase JWT (waiting on operator unblocks; see §10).

---

## 3. Deck submission contract

### 3.1 Request payload

```typescript
interface DeckSubmission {
  readonly sessionId: string;           // dev:<sessionId> identity material
  readonly leaderId: string;            // single leader card id
  readonly mainDeckCardIds: string[];   // 50 ids
  readonly deckName?: string;           // optional cosmetic
}
```

Wire shape into `/api/join`:

```typescript
interface ApiJoinRequest {
  readonly sessionId: string;
  readonly deck: {
    readonly leaderId: string;
    readonly mainDeckCardIds: string[];
    readonly deckName?: string;
  };
}
```

### 3.2 Validation rules (in `shared/server/deck/validateDeck.ts` — NEW location)

Rules in priority order. Each maps to a structured failure reason:

| Rule | Reason on fail |
|---|---|
| `leaderId` is a string, non-empty | `missing_leaderId` |
| `mainDeckCardIds` is an array | `mainDeck_not_array` |
| `mainDeckCardIds.length === 50` | `mainDeck_size_must_be_50` |
| leaderId exists in cardLibrary AND `kind === 'leader'` | `leader_not_in_corpus` |
| every mainDeckCardId exists in cardLibrary | `unknown_card_id: <id>` |
| no mainDeckCardId is `kind === 'leader'` | `leader_in_main_deck: <id>` |
| no card appears more than 4 times | `card_count_exceeds_4: <id>` |
| every main-deck card shares ≥1 color with the leader | `color_identity_violation: <id>` |

OPTCG color-identity rule per the official Comprehensive Rules: a card is legal in a deck if **any** of its colors matches **any** of the leader's colors. Encode as `card.colors.some(c => leader.colors.includes(c))`.

**Banlist** is NOT enforced in F-7. The engine doesn't currently consult a banlist; adding one is a follow-on (memory: `banlist_push_pipeline` ships push notifications when a Crew Builder banlist changes, but the optcgsandbox engine treats every card as legal). Document the gap; do not invent a banlist source.

### 3.3 Where deck validation lives

`shared/server/deck/validateDeck.ts` — pure function `validateDeck(submission, cardLibrary): { ok: true, leader, cards } | { ok: false, reason: string }`. No I/O. Importable by both worker (Matchmaker) and the Vite app (client-side pre-check for fast feedback).

The function takes the cardLibrary as an argument; no global import. Worker passes the full corpus; client passes the same corpus (already loaded via `src/store/game.ts:21`).

### 3.4 Initial-state construction from a validated deck

After validation, build a `GameState` via `shared/engine-v2/setup/initialState.ts:42`:

```typescript
const state = initialState({
  seed,
  decks: {
    A: { leader: leaderA, cards: cardsA },
    B: { leader: leaderB, cards: cardsB },
  },
});
```

This is the same path `worker/devSetup.ts:67` uses, just with real cards. The worker now imports the corpus to look up Card objects from ids. Corpus size: ~3 MiB raw. Wrangler bundles import it; F-6 already loads it transitively via the engine handlers' card-tag tests, so the bundle size hit is the same magnitude (verified: wrangler bundle is 292 KiB gzipped pre-corpus; the corpus is much larger, but it's bundled lazily because no current worker file imports it directly).

**Open risk:** the worker bundle WILL grow once `cards.json` is bundled in. Verify the impact in F-7a by checking `wrangler deploy --dry-run` output. If the bundle exceeds Cloudflare's Worker size limits (3 MiB compressed today per public docs; **I have not verified this number against current docs** — F-7a must confirm), the worker reads corpus from KV or R2 instead. Treat as a flagged risk, not a foregone conclusion.

---

## 4. Matchmaker changes (v0.3)

### 4.1 Queue entry shape

```typescript
interface QueueEntryV03 {
  readonly sessionId: string;
  readonly joinedAt: number;
  readonly submission: DeckSubmission;   // NEW — was just sessionId in v0.2
}
```

Storage: same key (`'queue'`), same SQLite-backed DO. Bumping schema means dropping old queue entries on first cold-start after F-7a deploy — acceptable because the dev environment is non-prod and the queue is in-memory FIFO.

### 4.2 `/api/join` flow

```
client → POST /api/join { sessionId, deck }
  ↓
Matchmaker: validateDeck(submission, cardLibrary)
  ├─ invalid → 400 { status: 'deck_invalid', reason }
  └─ valid:
       ├─ if queue empty: enqueue + 200 { status: 'QUEUED', sessionId, queueLen }
       └─ if queue has peer:
            ├─ buildInitialState({ seed, peer.submission, mySubmission })
            ├─ POST GameRoom /init { initialState, seats: { A: {clientId}, B: {clientId} } }
            ├─ if ok: 200 PAIRED { roomId, you, clientId, token, leaderA, leaderB }
            └─ if not ok: re-queue peer; 502 init_failed { upstreamStatus, upstreamBody }
```

`clientId` namespacing stays `dev:<sessionId>` — same as F-6. The Matchmaker swap to `sb:<sub>` happens in F-5d.2 (or whenever Supabase env is wired).

### 4.3 Response shape changes

PAIRED response gets two new fields so the client can render an opening screen before the WS opens:

```typescript
interface ApiJoinPaired {
  readonly status: 'PAIRED';
  readonly roomId: string;
  readonly you: 'A' | 'B';
  readonly clientId: string;
  readonly token: string;           // dev opaque (F-5d.1 swaps to caller-supplied JWT)
  readonly leaderA: { id: string; name: string };   // public; for opening screen
  readonly leaderB: { id: string; name: string };   // public
}

interface ApiJoinQueued {
  readonly status: 'QUEUED';
  readonly sessionId: string;
  readonly queueLen: number;
}

interface ApiJoinDeckInvalid {
  readonly status: 'deck_invalid';
  readonly reason: string;
}

interface ApiJoinInitFailed {
  readonly status: 'init_failed';
  readonly upstreamStatus: number;
  readonly upstreamBody: string;
}
```

### 4.4 The "first-player paired notification" gap (still open)

F-6 §17.2 already flagged this. F-7's MVP shows a "Waiting for opponent" view; the first player polls `/api/poll?sessionId=<>` every 2s (new endpoint) until they get `PAIRED` or timeout. Polling is cheap on DO + simple. SSE comes later.

New endpoint specifically for polling:

```
GET /api/poll?sessionId=<...>
  ├─ session still in queue → 200 { status: 'QUEUED', queueLen }
  ├─ session paired         → 200 { status: 'PAIRED', ... }   (same shape as /api/join PAIRED)
  ├─ session never seen     → 404 { status: 'unknown_session' }
```

Storing the pairing result by `sessionId` requires the Matchmaker to keep a `pairedResultBySessionId` map keyed on the sessionId of both seats. Persisted under a new storage key `paired_results`. TTL = 5 minutes (eviction at next `/api/poll`).

---

## 5. UI flow

### 5.1 Surface decision: routes vs single-component switch

`react-router-dom` is installed but unused. Two viable approaches:

**Option A — adopt React Router:** add routes `/`, `/lobby`, `/room/:id`. Cleaner for back/forward navigation, deep-linking a room id is free, easy to migrate later.

**Option B — single-component state machine in `App.tsx`:** existing `?dev=1` / default fork in `src/App.tsx:34` extends to `view: 'home' | 'lobby' | 'queued' | 'paired' | 'in-game'`. Smaller surface, no new dependency activated, less navigation polish.

**Recommendation: Option B.** The project's mobile-first 430px letterbox doesn't benefit from URL navigation today; a deep link to `/room/:id` wouldn't carry the auth/token context anyway under dev identity. Re-evaluate after F-5d.1 introduces real auth.

### 5.2 Screen mock (text only; visual polish is out-of-scope)

```
┌─────────────────────────────────┐
│ OPTCGSandbox                    │
│  Online Match                   │
├─────────────────────────────────┤
│ Pick a deck                     │
│  ◉ Red (Luffy ID-PROMO-XX)      │
│  ○ Green                        │
│  ○ Blue                         │
│  ○ Purple                       │
│  ○ Black                        │
│  ○ Yellow                       │
│                                 │
│  [Find Match]                   │
└─────────────────────────────────┘

→ Queued state
┌─────────────────────────────────┐
│ Finding a match…                │
│ Queue position: 1               │
│                                 │
│  [Cancel]                       │
└─────────────────────────────────┘

→ Paired
┌─────────────────────────────────┐
│ Match found!                    │
│ You are Player A                │
│ Leader A: Luffy                 │
│ Leader B: Zoro                  │
│                                 │
│  Connecting…                    │
└─────────────────────────────────┘

→ In-game
   (existing PlayfieldStage)
```

### 5.3 New components

- `src/online/OnlineEntry.tsx` — home view; leader-color picker; Find Match button.
- `src/online/OnlineQueued.tsx` — queued spinner + cancel.
- `src/online/OnlinePaired.tsx` — handshake card; transitions into PlayfieldStage once WS opens.
- `src/online/useOnlineMatch.ts` — single hook: `joinMatch(submission)` / `cancelMatch()` / `state: 'idle' | 'queued' | 'paired' | 'in-game' | 'error'`. Owns the polling timer.
- `src/online/onlineSocket.ts` — thin wrapper around the browser global `WebSocket`. Constructor takes `(url, onFrame, onClose)`. Sends F-4b `ClientMessage` JSON frames. Verifies inbound shape against the F-4b `ServerMessage` discriminator (reuse `shared/server/transport/parseClientMessage.ts`'s patterns; consider a sibling `parseServerMessage`).

### 5.4 Cancel/leave behavior

- From `OnlineEntry`: no socket open; cancelling is a no-op.
- From `OnlineQueued`: stop polling; send `POST /api/leave?sessionId=<>` (new endpoint) to drop from queue.
- From `OnlinePaired` mid-connect: close socket; clear local state.
- From `InGame`: send `leave` ClientMessage (already supported by `MatchRoom`).

### 5.5 Reuse of existing UI

`PlayfieldStage` and the gameplay components stay. The state source switches from `src/store/game.ts` (engine local) to a new online-aware store that consumes server snapshots. Two stores OR one store with a `mode: 'local' | 'online'` discriminator. **Recommendation: one store, single discriminator.** The existing Zustand selectors keep working unmodified.

---

## 6. Wire protocol sequence

For player A (first to queue):

```
A → POST /api/join { sessionId:"a-uuid", deck }            → 200 QUEUED
loop:
  A → GET /api/poll?sessionId=a-uuid                       → 200 QUEUED | PAIRED
A → (on PAIRED) GET /ws?room=<id>&token=<token>            → 101 Upgrade
A → ClientMessage { type:'join', player:'A', clientId:'dev:a-uuid' }
A ← ServerMessage { type:'joined', state, hash, lastSeq }
...
B → ClientMessage { type:'submit_action', ... }
A ← ServerMessage { type:'snapshot', state, hash, serverSeq }
```

For player B (joins second):

```
B → POST /api/join { sessionId:"b-uuid", deck }            → 200 PAIRED { roomId, ... }
B → GET /ws?room=<id>&token=<token>                        → 101 Upgrade
B → ClientMessage { type:'join', player:'B', clientId:'dev:b-uuid' }
B ← ServerMessage { type:'joined', state, hash, lastSeq }
A ← ServerMessage { type:'opponent_joined', player:'B' }   (broadcast)
```

The `token` is dev-opaque in F-7. F-5d.1 will replace it with the user's Supabase JWT; everything downstream stays the same because `SupabaseJwtAuthBinding.authenticate(token)` produces `clientId = "sb:<sub>"` which is the same surface the rest of the worker reads.

---

## 7. Testing plan

### 7.1 Unit tests (vitest)

| File | Asserts |
|---|---|
| `shared/server/__tests__/deck/validateDeck.test.ts` (NEW) | Each rule in §3.2 — valid deck passes; each failure mode hits the right reason; color-identity edge cases (multi-color leader, multi-color card). Use real corpus subset, not synthetic. |
| `shared/server/__tests__/matchmakerInitShape.test.ts` (EXTEND) | Add cases for real submitted decks: matchmaker constructs `initialState` correctly when leaders differ between seats. |

### 7.2 Worker integration smoke (wrangler dev)

Reuse the F-5d.0 / F-6 pattern: spawn `wrangler dev`, drive curls against `/api/join` and `/api/poll`. Assert:
- Valid `/api/join` with deck → QUEUED.
- Second valid `/api/join` with different sessionId → PAIRED with non-stub leader names.
- Invalid deck → 400 `deck_invalid` with the right reason.
- Polling: first session goes from QUEUED → PAIRED.

### 7.3 Worker → engine integration check

After PAIRED, `GET /ws?room=<id>&token=<token>` should succeed past `room_not_initialized` IF the SUPABASE_* env is faked or `StaticTokenAuthBinding` is temporarily swapped back. **F-7 keeps `SupabaseJwtAuthBinding` and accepts that `/ws` will return `auth_failed: <reason>` under dev identity.** That's the right cutoff: F-7a–b validate the deck / matchmaker / lobby path; the WS-auth bridge is F-5d.1.

Alternative for true end-to-end smoke under dev identity: F-7c adds a `?devAuth=1` config to `worker/wrangler.toml [vars]` that selects `StaticTokenAuthBinding` instead of `SupabaseJwtAuthBinding`. Tradeoff: introduces a second config branch in `worker/GameRoom.ts:rebuildEngine()`. Acceptable if owner wants the local smoke loop to close end-to-end without Supabase. **Recommendation: defer F-7c until F-7a + F-7b are green; revisit then.**

### 7.4 Playwright e2e (optional in F-7)

Reuse `?test=1` (`src/main.tsx:9-22`). Drive two browser contexts. Each joins, submits a deck, the test asserts both reach the in-game stage with matching state hashes pulled from `window.__store`. Skip until F-7b lands.

---

## 8. Non-goals (explicitly)

- ❌ Ranked, ELO, tiers.
- ❌ Matchmaking quality / latency-aware pairing.
- ❌ Supabase auth.
- ❌ Persistence beyond Replay V2 (already in worker; no F-7 changes).
- ❌ Deck cloud-save / deck management.
- ❌ OP16 corpus intake.
- ❌ Mobile-platform polish (iOS share, Android intent, etc.).
- ❌ Spectator / replay sharing UI.
- ❌ In-game chat.
- ❌ Reconnect-after-disconnect.
- ❌ Banlist enforcement.
- ❌ Sideboard / format selection (Block 1 / OP-01..OP-04 rotation per CLAUDE.md is product-level; engine treats every card as legal today).

---

## 9. Risk list

| # | Risk | Concrete cost if hit | Mitigation |
|---|---|---|---|
| R1 | Worker bundle blows Cloudflare size limit when corpus is imported | Worker fails to deploy | F-7a measures `wrangler deploy --dry-run` bundle size after corpus import; if over limit, move corpus to R2 / KV with a startup fetch (F-7a.2). |
| R2 | Real `initialState` with cards.json corpus exceeds DO `bootstrap` key 128 KiB | GameRoom `state.storage.put('bootstrap', ...)` rejects | The full GameState including cardLibrary for real decks could be >128 KiB. F-7a measures actual size; if over, strip cardLibrary from bootstrap and re-attach on hibernate-wake (mirrors F-5b.2 approach). |
| R3 | Hidden-info projection fails when both decks contain the same cards | Opponent could deduce hand contents from cardId reuse | `MatchRoom.getPublicStateFor` already anonymizes opponent hand instanceIds (verified F-4b §10). Projection contract is preserved; deck content reuse changes nothing. |
| R4 | Reconnect intentionally NOT in scope; mid-match disconnect drops the player | Match becomes unplayable | Accept as F-7 limitation; document in lobby UI ("Don't refresh during a match"). F-8+ work. |
| R5 | Dev identity collision: two clients with same `sessionId` | Seat collision in MatchRoom | Generate sessionId client-side as `crypto.randomUUID()` if absent. Already worker-side behavior for missing sessionId (`worker/Matchmaker.ts`). |
| R6 | Existing `src/store/game.ts` is engine-coupled; refactoring it for online mode breaks DevGameSandbox or PlayfieldStage | Local play regresses | F-7b uses a separate `src/online/` namespace; existing local-play store untouched. Two-store approach during cutover, consolidate later. |
| R7 | Polling endpoint produces a noisy queue UI under flaky network | False "queue position changed" flashes | UI debounces queueLen changes; treat polling as best-effort, not authoritative. |
| R8 | `/api/poll` reveals pairing to anyone who guesses a sessionId | Opponent token leak | Mitigation: include a session-specific opaque token in the queue entry (issued at `/api/join`) and require it on `/api/poll`. Same pattern OAuth state. |
| R9 | Worker dev needs cards.json bundled for tests, but F-5c.2 worker tsconfig include is broad and may pull bad test files | Worker fails to build | Pre-existing issue (§14.7); F-7a tightens the include if it bites. |
| R10 | Color-identity rule edge case: a multi-color card whose colors are `[red, green]` paired with a multi-color leader `[blue, green]` matches via `green` — valid by spec but feels unintuitive | None — this is correct per OPTCG rules | Test it explicitly. |

---

## 10. Operator unblock list (carried forward from F-5d.1, unchanged)

Nothing in F-7 unblocks any of these. F-5d.1 still depends on operator action.

1. Provision an optcgsandbox-isolated Supabase project.
2. Add `SUPABASE_JWKS_URL` + `SUPABASE_ISSUER` to `worker/wrangler.toml [vars]`.
3. Two Supabase test users for two-client smoke.
4. The ~50 LOC smoke client (Node 24+'s global `WebSocket`).

---

## 11. F-7 implementation sequence

Five phases. Each is independently shippable and independently testable.

| Phase | Surface | Output | Gate before next |
|---|---|---|---|
| **F-7a** | `shared/server/deck/validateDeck.ts` + tests. Matchmaker payload shape updated; corpus import + size measurement. | Unit tests green. Wrangler bundle size measured. | Bundle under limit OR R2/KV migration prompt. |
| **F-7b** | Matchmaker v0.3 (validates deck, builds real initialState, returns leader names). `/api/poll` + queue token. | Wrangler dev smoke: two clients pair on real decks. GameRoom `/init` accepts the real `initialState`. | `room_not_initialized` no longer reachable through routing. |
| **F-7c** | `src/online/` lobby UI + WS client. Single-store discriminator (`mode: 'local' | 'online'`). | Manual smoke in browser: two tabs pair + see snapshots. | UI flow is clear; the only blocker is `/ws` auth (Supabase). |
| **F-7d** | OPTIONAL: dev-auth bypass in worker (`StaticTokenAuthBinding` when `DEV_AUTH=1`). | Two tabs reach `InGame` end-to-end on local wrangler. | Owner decides whether to ship the bypass. |
| **F-7e** | Playwright e2e: two browsers, full join → action → snapshot. | Headless smoke green on CI. | Ready to swap dev-auth for Supabase JWT in F-5d.1. |

---

## 12. First implementation prompt (F-7a — deck validation + matchmaker payload shape)

Use this prompt to kick off F-7a:

> **F-7a — Deck Validation + Matchmaker Payload Shape**
>
> Goal: produce a tested, pure deck-validation module and update Matchmaker to consume submitted decks instead of stub decks. No UI, no WS changes, no auth changes.
>
> Allowed scope:
> - `shared/server/deck/` (NEW)
> - `shared/server/__tests__/`
> - `worker/Matchmaker.ts` (consume submissions)
> - `worker/GameRoom.ts` ONLY if `/init` payload shape needs adjustment (it shouldn't)
> - `docs/ONLINE_INTEGRATION_PLAN.md` + `docs/LOBBY_UI_PLAN.md`
>
> Forbidden:
> - engine, cards.json, Stage C/D, UI code, auth code, Supabase, OP16 intake.
>
> Required:
> 1. `validateDeck(submission, cardLibrary): { ok: true, leader, cards } | { ok: false, reason }` — pure function, no I/O. Rules per LOBBY_UI_PLAN §3.2.
> 2. `shared/server/__tests__/deck/validateDeck.test.ts` covering every rule + edge cases (multi-color leader, multi-color card, exact-50 boundary, duplicate-counts, leader-in-main-deck, unknown id).
> 3. `worker/Matchmaker.ts` updated to accept `{ sessionId, deck }`, validate, store the submission on the queue entry, and on pair build real `initialState` via existing `shared/engine-v2/setup/initialState.ts:42`.
> 4. Bundle-size measurement: `npx wrangler deploy --dry-run` before/after. **If the corpus import pushes the bundle over Cloudflare's Worker size limit (verify the limit against current docs, don't recall it), STOP and report — the corpus migration to R2/KV is a separate sub-phase.**
> 5. `/api/poll` endpoint stub (returns `404 unknown_session` for everything) — full implementation is F-7b. We add the route here so F-7b doesn't have to touch `worker/index.ts:38-58`.
> 6. Add `validateDeck` reasons to LOBBY_UI_PLAN §3.2 table if any need adjustment after implementation.
>
> Stop-and-report triggers:
> - Bundle size exceeds the Worker size limit.
> - DO bootstrap key `state.storage.put('bootstrap', ...)` with a real-deck initialState exceeds 128 KiB at smoke time (R2 below confirms F-5b.2 caveat carries into bootstrap).
> - Validator design needs a rule not listed in §3.2.
>
> Output:
> - exact files changed
> - validateDeck failure-reason taxonomy as implemented
> - bundle size before/after corpus import
> - bootstrap-key size measurement under real deck
> - whether any stop-and-report trigger fired
> - next phase (F-7b)
>
> Stop after report.

---

*Plan only. No code changes. F-5d.1 vertical remains blocked on operator Supabase inputs; F-7 is the parallel-track work that does NOT depend on Supabase.*
