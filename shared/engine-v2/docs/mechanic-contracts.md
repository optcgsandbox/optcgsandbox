# Engine V2 — Mechanic Contracts

> **This document is non-normative. The engine code is the source of truth.**
> Every signature, invariant, and call-site cited here is grounded in the
> `shared/engine-v2/` source tree. If the code disagrees with this document,
> trust the code and update the document.

Four interlocking contracts make up the engine's primitive surface. Every
card-effect primitive — every action, cost, target, magnitude — resolves
through one of them. This file catalogs each contract's signature, call
sites, and invariants implementers must respect.

---

## 1. `TargetResolver` — target resolution

### Signature

`shared/engine-v2/registry/types.ts:73-77`

```ts
export type TargetResolver = (
  state: GameState,
  ctx: HandlerCtx,
  target: EffectTargetV2,
) => ReadonlyArray<InstanceId>;
```

Registered via `targetResolvers` (an instance of `Registry<TargetResolver>`)
at `registry/types.ts:169`. Implementers live in
`shared/engine-v2/registry/handlers/targets.ts` + `targets2.ts`.

### Call sites

- `EffectDispatcher.ts:139` — primary clause-level target resolution
  inside the dispatch loop: `const resolver = targetResolvers.get(clause.target.kind); targets = resolver(working, clauseCtx, clause.target);`
- `EffectDispatcher.ts:160-161` — re-resolve with `count: 99` when
  `target.oppSelect === true` (P-OPP-FORCED-ACTION path)
- `shared/engine-v2/registry/handlers/actions2.ts:138` — sub-action
  target resolution inside the `sequence` handler (cluster-B fix)

### Invariants

- **Pure read over `state`.** No mutation of `state`, `state.players`, or
  any instance. Returns a fresh array.
- **Deterministic.** Same `(state, ctx, target)` triple → same result.
  No `Math.random()`; no clock reads.
- **Honors `target.count`.** Most resolvers slice the candidate set to
  `getCount(target) ?? 1` (see `targets.ts:35-38`). The `oppSelect`
  re-resolve at `EffectDispatcher.ts:160` passes `count: 99` to gather
  the full candidate pool.
- **Empty result is a valid outcome.** Returning `[]` causes the
  dispatcher to skip the clause (`EffectDispatcher.ts:141-142`). Do not
  throw on no-match.
- **Filter handling.** When `target.filter` is present, run it through
  `matchesCardFilter(state, inst, filter)` from
  `registry/handlers/filter.ts`. Custom resolvers must use the shared
  filter — no inline duplicate filter logic.
- **Bind contract.** The `target.bind` field is NOT processed inside the
  resolver. The dispatcher writes the bind into `ctx.scratch` AFTER the
  resolver returns (see `EffectDispatcher.ts:146-148`). Resolvers must
  not touch `ctx.scratch`.

---

## 2. `CostHandler` — cost application

### Signature

`shared/engine-v2/registry/types.ts:79-82`

```ts
export interface CostHandler {
  readonly canPay: (state: GameState, ctx: HandlerCtx, cost: EffectCostV2) => boolean;
  readonly pay:    (state: GameState, ctx: HandlerCtx, cost: EffectCostV2) => GameState | null;
}
```

Registered via `costHandlers` (`Registry<CostHandler>`) at
`registry/types.ts:170`. Implementers live in
`shared/engine-v2/registry/handlers/costs.ts` + `costs2.ts`.

### Call sites

- `EffectDispatcher.ts:195` — `canPay` check during the clause cost loop;
  if any cost key returns false, the whole clause is skipped.
- `EffectDispatcher.ts:207` — `pay` invocation during the same loop;
  if any handler returns `null`, the entire clause is rolled back to
  `preCostSnapshot` (see `EffectDispatcher.ts:202, 215-217`).
- `EffectDispatcher.ts:226-230` — post-pay `_costPicked` sentinel rename
  into the declared `cost.bind` name.

### Invariants

- **`canPay` is read-only.** Must not mutate `state`. Run by the
  dispatcher before any cost is paid; the result decides whether ANY
  cost pay calls happen.
- **`pay` may mutate `state`.** Returning a different `GameState`
  reference is fine. Returning `null` signals atomic-failure mid-pay; the
  dispatcher restores `preCostSnapshot` and skips the clause.
- **Atomic semantics.** The dispatcher snapshots `working` BEFORE the pay
  loop (`EffectDispatcher.ts:202`). Implementers should treat `pay`
  failures as recoverable — return `null` and the dispatcher unwinds.
- **`_costPicked` sentinel.** Cost handlers that resolve a specific card
  during pay (e.g., `returnSelfChar`, `discardHandFilter`,
  `returnOwnCharFilter`) write that card's snapshot into
  `ctx.scratch['_costPicked']` via `writeBinding` from
  `effects/clauseScratch.ts`, GATED on `typeof cost['bind'] === 'string'`.
  See `costs2.ts:188`, `costs2.ts:319`, `costs2.ts:327`. The dispatcher
  then renames it into the declared `cost.bind` name.
- **`cost.bind` is meta.** During `canPay` and `pay`, the key `'bind'` on
  the cost object is a meta-key, not a cost-handler kind. Skip it during
  the dispatcher's per-key walk (handled at `EffectDispatcher.ts:193-194`
  and `:205-206`).
- **No side effects outside `state`.** No file writes, no console output,
  no clock reads. Deterministic per `(state, ctx, cost)`.

---

## 3. `resolveMagnitude` — formula contract

### Signature

`shared/engine-v2/registry/handlers/formula.ts:62-89`

```ts
export function resolveMagnitude(
  state: GameState,
  ctx: HandlerCtx,
  raw: unknown,
  fallback = 0,
): number;
```

Companion: `resolveCount(state, ctx, action, fallback)` at
`formula.ts:96-109` — reads `action.magnitude` / `action.count` /
`action.n` and dispatches to `resolveMagnitude` when the value is a
formula object.

### Supported formula shapes

- **literal number** — passes through unchanged
- `{ kind: 'match_opp_don' }` — returns `state.players[OTHER[ctx.controller]].donCostArea.length`
- `{ kind: 'read_state', source: <string> }` — dispatches to `readCountSource(state, ctx.controller, source, fallback)`
- `{ kind: 'per_count', countSource: <string>, divisor: <number>, perUnit: <number> }` — `Math.floor(readCountSource(...) / divisor) * perUnit`

`readCountSource` shapes are listed at `formula.ts:30-55` (own/opp trash
count, own/opp hand count, own/opp life count, own/opp don count,
`own_rested_don_count`, `own_trash_event_count`,
`cards_trashed_this_resolution`).

### Call sites

- `formula.ts:103` — internal use from `resolveCount`
- `shared/engine-v2/registry/handlers/continuous.ts:73` — used by the
  cluster-C fix in `readMagnitude(action, state?, source?)` when state
  and source are supplied (continuous power-buff handlers forward the
  source's controller as ctx)
- Many action handlers via `resolveCount` in
  `actions.ts`, `actions2.ts`, `actions3.ts` (see grep for `resolveCount(`)

### Invariants

- **Pure function.** No state mutation. Deterministic per
  `(state, ctx, raw)`.
- **Fallback safety.** Returns `fallback` for: undefined / null / non-object
  inputs, unknown `kind`, unknown `countSource`, `divisor === 0`. Never
  throws.
- **Backward compat for callers without `(state, source)`.** Continuous
  handler `readMagnitude` (`continuous.ts:60-77`) accepts state+source as
  OPTIONAL; when missing, formula objects return 0. This preserves
  legacy callers (readDelta, basePower readers) that don't carry the
  ctx; they retain the V0 stub behavior.
- **Negative magnitudes are allowed.** `power_buff` action takes
  `magnitude: -3000` for debuffs (see `actions.ts:96-100`). Implementers
  must not clamp or absolute-value the result.

---

## 4. `ActionHandler` — zone mutation contract

### Signature

`shared/engine-v2/registry/types.ts:53-58`

```ts
export type ActionHandler = (
  state: GameState,
  ctx: HandlerCtx,
  action: EffectActionV2,
  targets: ReadonlyArray<InstanceId>,
) => GameState;
```

Registered via `actionHandlers` (`Registry<ActionHandler>`) at
`registry/types.ts:167`. Implementers live in
`shared/engine-v2/registry/handlers/actions.ts` + `actions2.ts` +
`actions3.ts` (plus continuous fold via `continuous.ts`).

### Call sites

- `EffectDispatcher.ts:234-235` — primary clause-level action dispatch:
  `const actionHandler = actionHandlers.get(clause.action.kind); working = actionHandler(working, clauseCtx, clause.action, targets);`
- `shared/engine-v2/registry/handlers/actions2.ts:143` — sub-action
  dispatch inside the `sequence` handler (after sub-target resolution
  per cluster B)
- `actions2.ts:127` — `has(sub.kind)` registration check before sub-action
  dispatch
- Pending-resolve reducers in `reducers/choiceResolve.ts` dispatch action
  handlers when a chosen option carries `_preBoundTargets` (see
  `EffectDispatcher.ts:166-170` for the bind plumbing)

### Invariants

- **May mutate `state`.** The dispatcher passes a `structuredClone` of
  the caller's state (`reducers/applyAction.ts:62`), so handlers can
  mutate freely without aliasing.
- **Return value.** Return the mutated `state` (or a fresh object). The
  dispatcher chains successive handlers and continuous refolds through
  the return.
- **Pre-resolved `targets` is the source of truth for who acts.** When
  the parent clause declares `target`, the dispatcher pre-resolves and
  passes the result. Implementers must iterate `targets`, not re-resolve
  from `clause.target`.
- **Empty-targets fallback path.** When `targets.length === 0`, some
  handlers (post-cluster fixes) fall back to a zone scan via
  `action.filter` + `magnitude`. Examples: `play_for_free` (hand/trash
  scan, `actions2.ts:288-345`), `recursion` (trash scan,
  `actions2.ts:153-185`), `bottom_of_deck_from_hand` (hand prefix,
  `actions3.ts:368-385`). NEW handlers SHOULD NOT add additional
  zone-scan branches without explicit data declaring the source zone
  (e.g., `action.from`, or a documented filter).
- **`ctx.scratch` is read/write.** Action handlers may write to
  `ctx.scratch` via `writeBinding` (write-once gate). The
  `flattenBindingFilter` helper in `actions2.ts` reads scratch for
  BindingRef-typed filter fields. Suspending actions move scratch into
  `state.pending.<kind>.scratch` via
  `attachScratchToPending` from `effects/clauseScratch.ts`.
- **No side effects outside state mutation.** No file writes, no console
  output, no network. Deterministic per `(state, ctx, action, targets)`.
- **History event emission.** Handlers that mutate zones SHOULD push an
  event to `state.history` describing the mutation (e.g., `CARD_PLAYED`,
  `CARD_RETURNED_TO_HAND_FROM_TRASH`, `CHARACTER_KOD`). Consumers (UI,
  replay, coverage harness) depend on these events.
- **Suspension contract.** If a handler sets `state.pending` non-null,
  the dispatcher detects suspension at `EffectDispatcher.ts:270-273`,
  attaches the current ClauseScratch onto the inner pending payload via
  `attachScratchToPending`, and breaks out of the clause loop. The host
  must later dispatch the matching `RESOLVE_*` action to resume.
- **Continuous refold timing.** Handlers that move characters onto the
  field MUST refold continuous before firing `on_play` (see
  `actions2.ts:325` for the play_for_free pattern that uses
  `ContinuousManager.refold` before `EffectDispatcher.dispatch(... 'on_play')`).

---

## Cross-cutting invariants

These apply to all four contracts:

- **Determinism.** Same input → same output. No `Math.random()` — all
  randomness flows through `state.seed` + `state.rngCounter` via
  `RngService.pull(state)` (`shared/engine-v2/state/RngService.ts:62-83`).
- **No `state.cardLibrary` mutation.** Card definitions are immutable per
  game. Implementers may read but not write.
- **Honor `effectsNegated`.** The dispatcher gates ALL clause firing on
  `inst.effectsNegated !== true` (`EffectDispatcher.ts:105`). Continuous
  handlers MAY still apply (they don't go through dispatch) — but if a
  continuous effect references an instance, check the negation flag.
- **Scratch is clause-local.** `ClauseScratch` is created fresh per
  clause-firing (`EffectDispatcher.ts:129`), destroyed at clause
  completion, OR moved into the pending payload on suspension. Never
  share a scratch across clauses.
- **OPT bookkeeping is dispatcher-owned.** Only `EffectDispatcher.ts:257-262`
  marks an OPT key used. Handlers must NOT push to `inst.perTurn.effectsUsed`
  directly (ESLint rule: `no-direct-perTurn-effects-used-write`).

---

## How to use this document

When implementing a new primitive or modifying an existing handler:

1. Read the section for the contract you're touching.
2. Verify your implementation matches the signature exactly.
3. Walk every invariant — flag any you can't satisfy as a follow-up.
4. If your change requires a new invariant, update this document AFTER
   the implementation is merged and tested.

When reviewing handler code:

1. Match the signature against the contract's signature line.
2. For each call site, verify the dispatcher's expectations (return
   shape, side-effect scope, suspension behavior).
3. Run the relevant hardening unit tests in
   `shared/engine-v2/__tests__/handlers/` to confirm the mechanic-level
   invariants still hold.

---

*Generated 2026-06-04 as part of the post-cluster-fix hardening phase.
Reflects engine state at commit `b75a3cd` (clusters A–G all closed).
This file is non-normative — the engine code in `shared/engine-v2/`
remains the source of truth.*
