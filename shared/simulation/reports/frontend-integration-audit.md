# Frontend ↔ Engine-v2 Integration Audit

Read-only audit verifying the React frontend in `src/` is correctly wired to the post-hardening engine-v2 pipeline. Every claim is grep- or stat-backed against the working tree as of the audit timestamp.

## 1. Engine source-of-truth mapping (verified import paths)

### Single dispatch boundary

| Symbol | Imported from | Used in `src/` | Single source? |
|---|---|---|---|
| `applyAction` | `@shared/engine-v2/reducers/applyAction` (`src/store/game.ts:5`) | only `src/store/game.ts` | **yes** |
| `getLegalActions` | `@shared/engine-v2/rules/legality` (`src/store/game.ts:13`) | only `src/store/game.ts` | **yes** |
| `setupGame` | `@shared/engine-v2/setup/setupGame` (`src/store/game.ts:11`) | only `src/store/game.ts` | **yes** |
| `PhaseScheduler` | `@shared/engine-v2/phases/PhaseScheduler` (`src/store/game.ts:12`) | only `src/store/game.ts` | **yes** |
| `EasyAi` | `@shared/engine-v2/ai/EasyAi` (`src/store/game.ts:6`) | only `src/store/game.ts` | **yes** |
| `registerAllHandlers` | `@shared/engine-v2/registry/handlers/index` (`src/store/game.ts:14`) | only `src/store/game.ts` | **yes** |
| `registerAllReducers` | `@shared/engine-v2/reducers/index` (`src/store/game.ts:15`) | only `src/store/game.ts` | **yes** |
| `initialState` | `@shared/engine-v2/setup/initialState` (`src/store/game.ts:10`) | only `src/store/game.ts` | **yes** |
| `type Action` | `@shared/engine-v2/protocol/actions` | imported as type in `store/game.ts`, `EndTurnButton`, `CardDetailModal` | **yes** |
| `type GameState` / `PlayerId` / `Phase` / `CardInstance` / etc. | `@shared/engine-v2/state/types` | imported as types in 14 components | **yes** |
| `type Card` / `LeaderCard` / `CardColor` | `@shared/engine-v2/cards/Card` | imported as types in 3 components | **yes** |

### Vite path alias (single root)

- `vite.config.ts`: `alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) }`
- One alias, one resolved root, no per-package indirection.

### `applyAction` / `getLegalActions` call-site inventory (frontend)

- Total references in `src/`: **21**, ALL inside `src/store/game.ts` (lines 5, 13, 180, 192, 205, 214, 287, 288, 303, 322, 349, 357, 362, 386, 403, 436, 470, 489, plus 3 doc comments).
- No component re-implements, re-wraps, or duplicates the dispatch primitives.

## 2. Detected duplication / stale copies

### Engine-v1 leakage from `src/`

- `grep -rEn "from ['\"]@?shared/engine/" src --include=*.ts --include=*.tsx` → **zero matches**.
- `shared/engine/` (v1) is present on disk (`applyAction.ts`, `GameState.ts`, `rules/`, `phases/`, etc.) but **no `src/` file imports it**.
- Conclusion: v1 directory is dormant; UI is exclusively v2-wired.

### Rule re-implementation in `src/`

- Searched for inline `applyAction|isLegal|computeTurn|costPaid|hasRush|canAttack` function declarations in `src/`: **zero matches**.
- Only local `interface ActionButton` (`CardDetailModal.tsx:26`) — a UI-only type, unrelated to engine semantics.
- Conclusion: no shadow rules in the frontend.

### Type re-declarations in `src/`

- No `type GameState` / `interface GameState` / `type Action` / `interface Action` redeclarations in `src/`.
- All schema types are imported (not redefined) from the same `engine-v2` modules the engine uses.

### `src/` references to sim-layer modules

- `grep -rEn "simulation/(runner|cli|mechanicInstrument|playabilityTracker|concedeTrace)"` against `src/` → **zero matches**.
- The simulation layer (Phases 3–8 instrumentation, CLIs, trackers, runners) is **not bundled into the frontend**. Frontend depends only on engine-v2; sim-layer is a CLI/test surface.

## 3. Contract alignment

### Action union

- Defined exactly once at `shared/engine-v2/protocol/actions.ts:107-128` (`type Action = …` over 22 action variants).
- Frontend imports the same type (no rewrite). Engine reducers import the same type. Single source.

### GameState shape

- Defined once at `shared/engine-v2/state/types.ts`. Frontend imports the type; the store's `state: GameState` field uses this exact type. Engine reducers operate on the exact same shape.

### Per-phase legal-action contract

- `legality.ts:42 getLegalActions(state, player): Action[]` is the canonical enumerator. Frontend calls it directly (`store/game.ts:180, 192, 205, 214, 288, 303, 322, 357, 403, 436, 470, 489`). No wrapper, no derived schema.

### Detected mismatches

- **None**. Schema, signatures, and discriminator field (`Action.type`, not `kind`) are consistent across engine, store, and components.

## 4. Execution flow

```
   UI event (button click, drag, etc.)
        │
        ▼
   React handler in components/* (e.g., EndTurnButton, CardDetailModal)
        │ calls store action: dispatch(action), endTurn(), startGame()...
        ▼
   ┌──────────────────────────────────────────────────────────┐
   │ src/store/game.ts (Zustand store — SINGLE DISPATCH SURFACE)│
   │   - imports applyAction from engine-v2/reducers/applyAction│
   │   - imports getLegalActions from engine-v2/rules/legality  │
   │   - imports PhaseScheduler from engine-v2/phases           │
   │   - registers handlers + reducers on init                  │
   │                                                            │
   │   On action: result = applyAction(state, player, action)   │
   │   On query:  legal = getLegalActions(state, player)        │
   └──────────────────────────────────────────────────────────┘
        │ pure (state, action) → state'
        ▼
   ┌──────────────────────────────────────────────────────────┐
   │ shared/engine-v2/reducers/applyAction                     │
   │   - dispatches to per-type reducer                        │
   │   - effects flow through EffectDispatcher / CostPayer     │
   │   - phase scheduling via PhaseScheduler                   │
   │   - returns { state, events } — pure, deterministic       │
   └──────────────────────────────────────────────────────────┘
        │ new state
        ▼
   set({ state, legalActions: getLegalActions(state, activePlayer) })
        │
        ▼
   Zustand subscribers re-render: PlayfieldStage, HandFan, CostAreaBand,
   LifeStack, DiceRollPrompt, MulliganPrompt, EndTurnButton, …
```

- Every UI render reads `state` + `legalActions` from the store.
- No component bypasses the store. No component calls engine functions directly.
- AI opponent (EasyAi) is itself an engine-v2 module; the store invokes it identically to the human path.

## 5. Build artifact staleness

### dist/ vs source mtimes

| File | mtime |
|---|---|
| `dist/index.html` | Jun 3 19:56:48 2026 |
| `dist/assets/index-C61XStJN.js` | Jun 3 19:56:48 2026 |
| `shared/engine-v2/rules/legality.ts` | Jun 3 20:46:02 2026 |
| `shared/engine-v2/registry/handlers/actions3.ts` | Jun 4 09:07:53 2026 |
| `shared/engine-v2/registry/handlers/actions2.ts` | Jun 4 09:07:40 2026 |
| `shared/engine-v2/registry/handlers/costs2.ts` | Jun 4 09:17:09 2026 |
| `shared/engine-v2/registry/handlers/continuous.ts` | Jun 4 08:51:18 2026 |

### Uncommitted engine-v2 source delta vs HEAD

- HEAD commit: `b75a3cd engine-v2: close clusters B/C/D/E/F/G — all 23 baseline xfails resolved`
- `git diff --stat HEAD -- shared/engine-v2/` (excluding tests): **17 files / +1272 / -731**
  - `effects/EffectDispatcher.ts` (+37)
  - `reducers/choiceResolve.ts` (+10/-X)
  - … additional 15 files
- These uncommitted source changes post-date the last `dist/` build.

### Bundle integrity verdict

- **The current `dist/` bundle is stale.** It was built before:
  - The most recent engine-v2 source modifications (Jun 3 20:46 onward)
  - The 17 uncommitted engine-v2 source files (Jun 4 morning)
  - 6 uncommitted UI files (`App.tsx`, `CardArt.tsx`, `DiceRollPrompt.tsx`, `CostAreaBand.tsx`, `DonDeckSlot.tsx`, `NavyCardBack.tsx`)
- **Dev mode (vite dev server) is unaffected** — vite compiles from source on the fly.
- **Deployed-bundle correctness** requires a rebuild before next deployment.

### Note on Option B + R1

- Phase 7 Option B (`runner.ts:271-295` CONCEDE policy filter) and Phase 8 R1 (`runner.ts:99-118` `stateFingerprint` extension for `diceRoll`) live in `shared/simulation/runner.ts`.
- **The frontend never imports anything from `shared/simulation/*`** (verified §2). Therefore Option B + R1 do NOT affect the bundled or live app at all. They are sim-only telemetry tooling.

## 6. Pass / fail verdict

| Audit dimension | Result |
|---|---|
| Frontend imports the correct engine-v2 build | **PASS** |
| Exactly one source of truth for `applyAction` | **PASS** |
| Exactly one source of truth for `getLegalActions` | **PASS** |
| Exactly one source of truth for state transitions | **PASS** |
| Frontend → engine execution path is single-channel via `store/game.ts` | **PASS** |
| Frontend does not reimplement game rules | **PASS** |
| Frontend does not reimplement legality | **PASS** |
| Frontend does not reimplement turn logic | **PASS** |
| Frontend does not reimplement cost/damage | **PASS** |
| Action schema alignment | **PASS** (single declaration) |
| State schema alignment | **PASS** (single declaration) |
| No duplicated engine packages | **PASS** (no separate npm deps) |
| No local mocks | **PASS** |
| Engine-v1 leakage into `src/` | **NONE** |
| Sim-layer leakage into `src/` | **NONE** |
| `dist/` build freshness | **STALE** (pre-dates engine-v2 source + uncommitted UI changes) |

### Overall integration integrity: **PASS** (wiring) / **STALE** (build artifact)

The wiring is fully correct: the React frontend dispatches through a single point (`src/store/game.ts`) which calls into engine-v2 functions directly with no duplication, no shadow rules, and no schema drift. The deployed `dist/` bundle is **stale** relative to current source — running it would execute pre-cluster-fix engine logic. This is a build-step issue, not a wiring issue.

## 7. Minimal fix list

Per audit scope (no refactors, no redesigns, no engine changes), the only required action is:

### Fix 1 — Rebuild the deployed bundle

- **What:** run `npm run build` (defined in `package.json:scripts.build` as `tsc -b && vite build`) to regenerate `dist/` from current source.
- **Why:** the existing `dist/index.html` and `dist/assets/index-C61XStJN.js` (Jun 3 19:56) predate the engine-v2 cluster-fix landings (Jun 3 20:46 onward) and the 17 uncommitted engine-v2 source files (Jun 4).
- **Scope:** none of: engine-v2 modifications, gameplay rule changes, simulation reruns, instrumentation additions. Pure build.
- **Pre-condition:** ensure uncommitted engine-v2 source changes are intended for inclusion (or stash/revert as the owner decides). Audit does NOT make this call.

### Not-required items

- No code changes in `src/` are needed for integration correctness.
- No code changes in `shared/engine-v2/` are needed for integration correctness.
- No engine-v1 cleanup is needed — it's dormant and isolated.
- No vite config changes are needed — `@shared` alias is correct.

## 8. Source-of-truth references

- `src/store/game.ts` — single dispatch boundary, 503 lines
- `shared/engine-v2/reducers/applyAction.ts` — engine-v2 dispatch entry
- `shared/engine-v2/rules/legality.ts:42` — canonical legality enumerator
- `shared/engine-v2/protocol/actions.ts:107-128` — canonical `Action` union
- `shared/engine-v2/state/types.ts` — canonical `GameState` shape
- `vite.config.ts` — `@shared` alias definition
- `dist/` — current (stale) deployed bundle
- `package.json:scripts.build` — `tsc -b && vite build`

---

End of audit. No code modifications applied.
