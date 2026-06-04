# Deployment Sync — Final Report

Phase: deployment sync / build finalization (post-Phase-7 hardening). Result: **SUCCESS** — production build emits a clean bundle.

## STATUS UPDATE — build now passes

After the (δ) tsconfig refactor below, the owner authorized a minimal engine-source narrowing fix (type-only, zero runtime change) at `actions2.ts:328-330`. With that fix applied, `npm run build` completes successfully and emits `dist/`.

### Final build evidence

| Item | Value |
|---|---|
| Build timestamp | Jun 4 13:21:30 2026 |
| Engine commit at HEAD | `b75a3cd engine-v2: close clusters B/C/D/E/F/G — all 23 baseline xfails resolved` |
| `dist/index.html` SHA-256 | `073b7a5106fb8a8e6d8609821c522d430f5d251c778fa62e58578cfafa5ecd59` |
| `dist/assets/index-BLS5vfES.js` SHA-256 | `3b1ca31eab441a70765fb5e4c9d477debb71b856e35060d6e9a96146ed453b58` |
| `dist/assets/index-Ctw0QWSm.css` SHA-256 | `13040017a9db73730553160c25f7030de82b30040934ce1ff9db5376be703475` |
| JS bundle size | 2,439.78 kB (gzip 358.76 kB) |
| Modules transformed | 508 |
| Engine-v1 / sim-layer refs in bundle | **0** (`grep -c "shared/engine[^-]\|shared/simulation\|shared/sim/" dist/assets/*.js` → 0) |
| PWA service worker | generated (`dist/sw.js`, 17 precache entries / 3488 KiB) |

### Files changed this phase (verified via `git diff --stat HEAD`)

| File | Type | Δ |
|---|---|---:|
| `tsconfig.app.json` | build-config only | +15/-1 |
| `shared/engine-v2/registry/handlers/actions2.ts` | engine source (narrowing only, no runtime change) | +5/-1 |

### Layer audit (per scope constraint)

- **Engine logic:** unchanged. The `actions2.ts` edit added 3 explicit `undefined`-typed properties to a fallback object literal so the discriminated union collapses to a uniform shape — semantics identical, all runtime guards (`flattened.excludedColors !== undefined`, `flattened.excludedName !== undefined`) preserved.
- **Frontend logic:** unchanged.
- **Simulation logic:** unchanged.
- **Test logic:** unchanged.
- **Card data:** unchanged.

### Detailed narrowing fix

`shared/engine-v2/registry/handlers/actions2.ts:328-335`:

```ts
const flattened = typeof rawFilter === 'object' && rawFilter !== null
  ? flattenBindingFilter(rawFilter as Record<string, unknown>, ctx.scratch)
  : {
      filter: undefined as CardFilter | undefined,
      excludedColors: undefined as readonly string[] | undefined,
      excludedName: undefined as string | undefined,
    };
```

Both branches of the ternary now produce the same property set. TS no longer flags the property access at lines 347-353. Runtime behavior is identical: the fallback values are `undefined`, the existing guards skip them.

---

(Earlier sections of this report — the original FAILED state and recovery options — are retained below as historical record.)

---

## HISTORICAL (prior FAILED state)

Phase: deployment sync / build finalization (post-Phase-7 hardening). Earlier result: **partial success** — production compilation boundary corrected; build remained blocked by pre-existing engine source type errors that were out of scope per the directive "Do NOT modify engine logic / test logic / patch type errors in engine or tests".

## 1. Actions applied this phase

### A. `tsconfig.app.json` exclude refactor

Restructured the exclude list so the production frontend type-check graph no longer includes any test or simulation tooling. Added wildcards to ensure recursive coverage of all test directories under `shared/`.

```jsonc
"exclude": [
  "shared/engine",
  "shared/engine/**",
  "shared/protocol",
  "shared/protocol/**",
  "shared/sim",
  "shared/sim/**",
  "shared/simulation",
  "shared/simulation/**",
  "shared/engine-v2/__tests__",
  "shared/engine-v2/__tests__/**",
  "shared/engine-v2/tests",
  "shared/engine-v2/tests/**",
  "shared/**/__tests__",
  "shared/**/__tests__/**",
  "shared/**/tests",
  "shared/**/tests/**"
]
```

### B. Cleared TS incremental buildinfo

`rm -rf node_modules/.tmp/tsconfig.app.tsbuildinfo` to force a clean re-check.

### C. Re-ran `npm run build`

Eliminated 11 of 12 prior-phase errors (8 from test/fixture inclusion, 3 from sim-layer Node-API references). Only 4 errors remain — all in engine source code.

## 2. Remaining errors (all in `shared/engine-v2/registry/handlers/actions2.ts`)

```
shared/engine-v2/registry/handlers/actions2.ts(347,23): error TS2339:
  Property 'excludedColors' does not exist on type
    '{ filter: CardFilter; excludedColors?: readonly string[]; excludedName?: string; }
     | { filter: CardFilter | undefined; }'.
shared/engine-v2/registry/handlers/actions2.ts(349,48): error TS2339: (same)
shared/engine-v2/registry/handlers/actions2.ts(351,23): error TS2339:
  Property 'excludedName' does not exist on type (same union).
shared/engine-v2/registry/handlers/actions2.ts(353,38): error TS2339: (same)
```

### Root cause (file:line evidence — no fix applied)

- The variable `flattened` (from `flattenBindingFilter`) has a discriminated union shape: one variant carries `excludedColors` + `excludedName`, the other carries only `filter`.
- The code at `actions2.ts:347-353` accesses `flattened.excludedColors` and `flattened.excludedName` without narrowing first. TS rejects because those properties don't exist on the second variant.
- At runtime, accessing `undefined.excludedColors` would return `undefined` (and the `!== undefined` guard handles it) — so the **runtime behavior is correct**. The TS surface alone is incorrect.
- Fix would require either:
  - Narrowing the union before access (engine logic touch — out of scope), OR
  - Adding `excludedColors?` / `excludedName?` to the second variant's type (engine type touch — out of scope), OR
  - Using `(flattened as { excludedColors?: readonly string[] }).excludedColors` cast (engine code touch — out of scope).
- All 3 options modify engine source. Per (δ): **forbidden**.

### Origin

- HEAD commit `b75a3cd engine-v2: close clusters B/C/D/E/F/G — all 23 baseline xfails resolved` introduced these accesses at lines 347-353.
- Previous commit `9314438 engine-v2: SP-1/SP-2 stabilization` predates them. The existing `dist/` (now removed) was almost certainly built from `9314438` or earlier — before these accesses landed.

## 3. Build graph boundary — verification

After the (δ) tsconfig refactor, the production type-check graph correctly excludes:

| Excluded surface | Mechanism |
|---|---|
| `shared/engine` (engine-v1) | explicit + wildcard exclude |
| `shared/protocol` (top-level v1 protocol) | explicit + wildcard exclude |
| `shared/sim` (engine-v1 sim layer, incl. its tests) | explicit + wildcard exclude |
| `shared/simulation` (Phase 3–8 instrumentation, CLIs, trackers) | explicit + wildcard exclude |
| `shared/engine-v2/__tests__` (engine-v2 unit + snapshot tests) | explicit + wildcard exclude |
| `shared/engine-v2/tests` (engine-v2 corpus scaffolding) | explicit + wildcard exclude |
| Any other `__tests__` / `tests` subtree under `shared/` | `shared/**/__tests__/**` + `shared/**/tests/**` |

Before the refactor: 12 errors across these surfaces. After: **0 errors from these surfaces.** All remaining errors are in the production engine source (`actions2.ts`).

## 4. Build status

- `npm run build` exits with `tsc -b` failure (4 errors).
- `vite build` does NOT run (`&&` short-circuit).
- `dist/` is **absent** (cleaned in step 1 of the sync; not regenerated).

## 5. Verdict per acceptance criteria

| Criterion | Status |
|---|---|
| NO engine-v2 runtime errors blocking the build | **FAIL** — 4 errors in `actions2.ts` (engine source) |
| NO test/fixture inclusion in build graph | **PASS** — verified via post-refactor error log |
| frontend compiles cleanly | **FAIL** — dependency engine source does not compile |
| Production compilation boundary restored | **PASS** — tsconfig graph boundaries are correct |
| build graph separation correct | **PASS** |
| no engine logic modified | **PASS** |
| no test logic modified | **PASS** |
| no engine/test type errors patched | **PASS** |

### Composite: **PARTIAL.**

- Build graph correctness: achieved.
- Buildable bundle: not produced — pre-existing engine source type errors block the final emit.

## 6. Recovery options (each out of scope at this phase)

- **(R1)** Patch `actions2.ts` discriminated-union narrowing at lines 347-353 (engine logic — forbidden by (δ)).
- **(R2)** Revert HEAD to `9314438` (pre-cluster-fix). Removes engine cluster fixes but restores buildable engine. Major scope change.
- **(R3)** Roll back the deletion of the previous `dist/`. Note: it was removed in step 1 of this phase and not preserved; recovery requires either rebuilding from `9314438` or restoring from a backup not in this repo's working tree.
- **(R4)** Skip `tsc -b` in `npm run build` (e.g., `vite build` only). Would emit a bundle but bypass static type checking entirely — a regression of build hygiene, not recommended.
- **(R5)** Add the 3 lines of explicit narrowing/casts in `actions2.ts` as a **build-surface-only** fix (no runtime change since the existing guards already handle the undefined case). Borderline (δ) — technically engine source touch but zero runtime impact. **Owner decision.**

## 7. Net state of repository

- `tsconfig.app.json` — refactored (16-entry exclude list). No engine, frontend, sim, or test logic changed.
- `dist/` — absent.
- `shared/simulation/reports/playability-0.{json,md}` — current post-R1 outputs.
- `shared/simulation/reports/playability-0.pre-r1.{json,md}` — preserved (Phase 8).
- `shared/simulation/reports/playability-0.pre-concede-fix.{json,md}` — preserved (Phase 7).
- `shared/simulation/reports/mechanic-distribution-0.md` — post-alias-fold (Phase 8).
- `shared/simulation/reports/mechanic-distribution-0.pre-aliasfold.md` — preserved (Phase 8).
- `shared/simulation/reports/frontend-integration-audit.md` — Phase 9 wiring audit (PASS / STALE).
- `shared/simulation/reports/deployment-sync-final.md` — this file.

## 8. Summary

The production compilation boundary is correctly separated from test and simulation surfaces. The frontend's React + engine-v2 wiring is intact (verified in `frontend-integration-audit.md`). The blocking issue is upstream in engine source code — `actions2.ts:347-353` — which falls outside this phase's permitted scope.

**Awaiting owner decision on (R1) / (R2) / (R5) before a buildable `dist/` can be emitted.**
