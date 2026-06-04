# OPTCG Sandbox — System Master Specification

Final archival reference. Consolidates all engineering knowledge produced
across Phases 3–8 (instrumentation, distribution, triage, balance
reconciliation, playability validation, policy fix, root-cause trace,
documentation, productization, and hardening).

This is **archival documentation**. No new findings, no new runs, no
speculation. Every claim is cited at file:line, anchored to verified
artifacts and code state as of the close of the hardening phase.

---

## TABLE OF CONTENTS

1. Canonical game tick lifecycle (post-R1 truth)
2. Policy-layer architecture (legality / selector / weighting / policy)
3. CONCEDE lifecycle (pre-Option-B → post-Option-B → post-R1)
4. Determinism contract (SHA-256 + fingerprint rule)
5. Alias system specification
6. Dead vs live primitive registry
7. Known artifacts and their purpose
8. What the system is NOT
9. Cross-test isolation guarantees

---

## 1. Canonical game tick lifecycle (post-R1)

The simulation runner (`shared/simulation/runner.ts`) drives one game from
initial state to terminal in a fixed 15-step loop per tick. The order is
authoritative; deviations are bugs.

| # | Step | File:line | Behavior |
|---:|---|---|---|
| 1 | Terminal check | `runner.ts:231-233` | exit if `state.result !== null` (returns RunGameResult) |
| 2 | Phase auto-pump | `runner.ts:128-160, 236` | auto-advance `refresh / draw / don / damage_resolution / trigger_window / block_window / counter_window` — picker is NOT involved in these phases |
| 3 | Terminal recheck | `runner.ts:237-239` | exit if pump landed in terminal |
| 4 | No-op exclusion reset | `runner.ts:241-244` | clear `noopExclude` if phase changed or pending appeared |
| 5 | Legal-move enumeration | `moveSelector.ts:71` | thin wrapper over `getLegalActions(state, computeActor(state))` |
| 6 | No-op exclusion filter | `runner.ts:251-258` | drop previously-observed-no-op moves; empty-fallback to raw set |
| 7 | Empty-set guard | `runner.ts:259-262` | reports `no_legal_moves` failure |
| 8 | Pick + apply | `runner.ts:266-295` | adversarial-weighted (with Option B CONCEDE filter) OR uniform-random |
| 9 | applyAction | `runner.ts:283-289` | pure `(state, player, action) → state'`; crashes captured |
| 10 | Observer updates | `runner.ts:292-294` | coverage / exposure / mechanic-instrument (when env-enabled) |
| 11 | Trace push | `runner.ts:296-297` | `{tick, phase, controller, move, postHash}` |
| 12 | No-op detection | `runner.ts:299-305` | if post-fingerprint == pre-fingerprint AND pending unchanged, add move to `noopExclude` |
| 13 | Invariant check | `runner.ts:308-313` | `invariantChecks.ts`; fails game on violation |
| 14 | Stuck detection | `runner.ts:316-327` | rolling fingerprint window |
| 15 | Advance | `runner.ts:329` | `state = next`; loop continues |

**Tick budget:** `MAX_TICKS = 1000`. Termination on `state.result !== null`
(completed/failed) or budget exhaustion (timeout).

**dice_roll phase contract** (`setup.ts:46-82` `rollDiceReducer`):

| Pre-state | Action | Post-state |
|---|---|---|
| `diceRoll[player] === null` | `ROLL_DICE(player)` | `diceRoll[player] = d6` |
| Both slots non-null AND distinct | (auto on second `ROLL_DICE`) | `phase = 'first_player_choice'`; `activePlayer = winner` |
| Both slots non-null AND equal | (auto on second `ROLL_DICE`) | both slots → null; `rolls += 1`; phase stays `dice_roll` |

**Legality during dice_roll** (`legality.ts:46-50`):

| `diceRoll[player]` | Returns |
|---|---|
| `null` / `undefined` | `[{type:'ROLL_DICE', player}, {type:'CONCEDE'}]` |
| set | `[{type:'CONCEDE'}]` |

`moveSelector.ts:81-96` is the special-case that unions BOTH A and B during
`dice_roll` (other phases query `computeActor(state)` only).

---

## 2. Policy-layer architecture

### Layer responsibilities

```
┌─────────────────────────────────────────────────────────┐
│ POLICY CONSUMER                                          │
│   • Simulator (runner.ts adversarial branch)             │
│   • EasyAi / MediumAi / HardAi                           │
└──────────────────────────┬──────────────────────────────┘
                           │ getLegalActions(state, player)
┌──────────────────────────▼──────────────────────────────┐
│ SELECTOR — moveSelector.ts                               │
│   • routes the queried actor (computeActor)              │
│   • unions A+B during dice_roll                          │
│   • NO filtering, NO policy                              │
└──────────────────────────┬──────────────────────────────┘
                           │ Action[]
┌──────────────────────────▼──────────────────────────────┐
│ LEGALITY — rules/legality.ts                             │
│   • canonical "what can player do now?"                  │
│   • emits CONCEDE in every phase branch (by design)      │
└──────────────────────────┬──────────────────────────────┘
                           │ applyAction(state, player, action)
┌──────────────────────────▼──────────────────────────────┐
│ ENGINE — reducers + phase scheduler + effect dispatcher  │
│   • pure (state, action) → state transitions             │
│   • deterministic given seeded RNG                       │
└─────────────────────────────────────────────────────────┘
```

### Layer contracts

- **Legality layer** (`shared/engine-v2/rules/legality.ts`):
  - Single source of truth for "what can `player` do?"
  - `getLegalActions(state, player): Action[]` at `legality.ts:42`.
  - Includes CONCEDE in **every** phase branch (`legality.ts:48, 49, 53, 57, 63, 64, 69-74, 80-87, 93-102, 108-...`).
  - **Never modified by sim-layer code.**

- **Selector layer** (`shared/simulation/moveSelector.ts`):
  - Wrapper over `getLegalActions`. Routes actor per `src/store/game.ts:343-348` convention.
  - Actor routing (`moveSelector.ts:60-83 computeActor`):
    - `pending !== null` → `pending.<kind>.controller`
    - `block_window` / `counter_window` → `OTHER_PLAYER[state.activePlayer]`
    - Else → `state.activePlayer`
  - Special-case: `dice_roll` unions A+B.
  - **Mirrors legality verbatim. Does not filter.**

- **Weighting layer** (`shared/simulation/adversarial.ts`):
  - Pure weighting engine. `pickAdversarial` at `adversarial.ts:164`.
  - Scores via `(base × interaction × edge)` factors (`adversarial.ts:140-157`).
  - Deterministic quantization: `Math.max(1, floor(weight × 1000))` at `adversarial.ts:173`.
  - **Stateless. Policy-agnostic. Knows nothing about CONCEDE.**

- **Policy layer**: every consumer of `getLegalActions`. Four known:

| # | Consumer | File:line | Role |
|---:|---|---|---|
| 1 | Easy AI | `EasyAi.ts:37-55` | random-but-legal AI tier |
| 2 | Medium AI | `MediumAi.ts:53` | heuristic-weighted AI tier |
| 3 | Hard AI | `HardAi.ts:33` | depth-limited search AI tier |
| 4 | Simulator (adversarial) | `runner.ts:271-295` | adversarial-weighted batch driver |

UI button gating mirrors the same contract via `src/store/game.ts:343-348` dispatch routing (not itself a `getLegalActions` consumer).

### Cross-consumer parity table

| Property | Easy AI | Medium AI | Hard AI | Simulator |
|---|---|---|---|---|
| Filter location | `EasyAi.ts:44` | `MediumAi.ts:53` | `HardAi.ts:33` | `runner.ts:271-295` |
| Filter expression | `legal.filter(a => a.type !== 'CONCEDE')` | identical | identical | per-move map preserves actor index |
| Empty-fallback | `{type:'END_TURN'}` | (no explicit fallback) | (no explicit fallback) | original `moves[]` |
| Touches `legality.ts`? | no | no | no | no |
| Touches `moveSelector.ts`? | no | no | no | no |
| Touches `adversarial.ts`? | n/a | n/a | n/a | no |

---

## 3. CONCEDE lifecycle

### Stage 1 — pre-Option-B baseline

- `adversarial.ts:116` assigned `CONCEDE` base weight `0.05`.
- Quantization at `adversarial.ts:173` (`Math.max(1, floor(weight × 1000))`) gave CONCEDE a minimum quantized weight of 50.
- Per-tick CONCEDE probability ≈ 3–9%; cumulative ~99% over 22 ticks.
- **1000-game baseline:** 999/1000 `concede`, 1 `life_zero`, median 3 turns.
- Artifacts: `reports/playability-0.pre-concede-fix.{json,md}` (preserved).

### Stage 2 — Option B applied (policy filter at runner.ts:271-295)

- Strips CONCEDE from the legal-move set BEFORE invoking `pickAdversarial`.
- Index-map preserves `actors[pickedIdx]` lookup.
- Empty-fallback: if filtering leaves 0 moves, original (CONCEDE-only) set is passed to `pickAdversarial` so dispatch is never lost.
- Engine-v2, legality, moveSelector, adversarial: all unchanged.
- **1000-game post-Option-B:** 831 `life_zero`, 163 `concede`, 6 `deck_out`, median 17 turns.
- Residual 163 CONCEDEs all fire at tick 2, phase=`dice_roll` — root-caused to the `noopExclude` × dice-tie interaction (Stage 3 below).
- Artifacts: `reports/playability-0.pre-r1.{json,md}` (preserved).

### Stage 3 — R1 hardening (stateFingerprint extended)

- Diagnostic discovery: `runner.ts:97-115` `stateFingerprint` did not include `diceRoll` → `ROLL_DICE` actions appeared as no-ops to the loop detector at `runner.ts:302-305` → `noopExclude` accumulated them → after dice tie + Option B's CONCEDE strip, the move set emptied → CONCEDE via fallback. Statistical signature: 1/6 = 16.67% ≈ observed 16.3%.
- R1 patch: added `dr:${A}:${B}:${rolls}` to `stateFingerprint` parts at `runner.ts:115`. ROLL_DICE now produces a fingerprint delta and is not noop-excluded.
- Engine-v2, legality, moveSelector, adversarial, AI policy: all unchanged.
- **1000-game post-R1:** 994 `life_zero` (99.4%), 6 `deck_out` (0.6%), **0 `concede`**, median 18 turns, min 5 turns.
- Current artifacts: `reports/playability-0.{json,md}`.

### Delta table

| Metric | Pre-Option-B | Post-Option-B | Post-R1 |
|---|---:|---:|---:|
| `concede` | 999 (99.9%) | 163 (16.3%) | **0 (0.0%)** |
| `life_zero` | 1 (0.1%) | 831 (83.1%) | **994 (99.4%)** |
| `deck_out` | 0 (0.0%) | 6 (0.6%) | **6 (0.6%)** |
| Median turns | 3 | 17 | **18** |
| Median ticks | 13 | 201 | **221** |
| Mean turns | 3.25 | 16.20 | **19.18** |
| Min turns | 1 | 1 | **5** |
| A/B winner split | 522/478 | 543/457 | **532/468** |
| Failures | 0 | 0 | **0** |

### CONCEDE canonical rule (binding)

> A policy consumer NEVER voluntarily selects CONCEDE when at least one
> non-CONCEDE legal move exists.

Applied at each consumer's own boundary; not at legality / selector /
weighting. Each consumer holds its own copy of the filter.

---

## 4. Determinism contract

### Sources of determinism

| Property | Source | File:line |
|---|---|---|
| RNG | mulberry32 keyed by `seed >>> 0` | `shared/simulation/rng.ts` `newRng` |
| Per-tick fork | `rng.fork('tick:${tick}')` (keyed by string, not RNG state) | `runner.ts:267` |
| Engine purity | `applyAction(state, action)` pure | engine invariant suite |
| JSON serialization | sorted keys, fixed top-level order | `mechanicInstrument.ts serializeReport`; `playabilityTracker.ts serializePlayabilityReport`; `cli-mechanic-distribution.ts`; `cli-mechanic-triage.ts` |

### Fingerprint contract (post-R1)

`runner.ts:99-118` `stateFingerprint` computes a short hash over:

```
[phase,
 turn,
 activePlayer,
 hand.length × 2, field.length × 2, life.length × 2, deck.length × 2,
 donCostArea.length × 2,
 pending.kind | '0',
 result.loser | '0',
 dr:${diceRoll.A}:${diceRoll.B}:${diceRoll.rolls}]
```

Deliberately excluded: `state.history`, per-instance modifiers/counters,
RNG state, scratch.

### Verified hashes at 1000-game scale

| Stage | Artifact | SHA-256 |
|---|---|---|
| Post-Option-B | `playability-0.pre-r1.json` | `61f31af01a5d1ba891d2273b5b69565686f6424790b008a54da9dfcf913128f0` |
| Post-R1 | `playability-0.json` (current) | `630afc18f29a2021bc249df6b174dcb4fd5eb560f6b3409126a2f122d7ce3c8a` |

Both verified across two identically-seeded runs with `diff` empty.

---

## 5. Alias system specification

### Definition

An **alias wrapper** is an `ActionHandler` registered under one kind that
delegates to a different registered `ActionHandler` via
`actionHandlers.get('inner_kind')(state, ctx, action, targets)`.

- Outer kind is what `cards.json effectSpecV2` references.
- Inner kind is engine-internal — 0 corpus references by construction.
- Both kinds are independently registered. Both increment the mechanic
  instrumentation counter on each invocation.

### Inventory (5 confirmed)

| Outer (cards.json) | Inner (engine-only) | Outer registration | Inner reference |
|---|---|---|---|
| `power_buff` | `give_power` | `actions3.ts:1142` | `actions3.ts:68-69` |
| `mill_self` | `trash_top_of_deck` | `actions3.ts:1143` | `actions3.ts:71-72` |
| `mill_opp` | `mill` | `actions3.ts:1144` | `actions3.ts:74-75` |
| `set_active` | `active_target` | `actions3.ts:1145` | `actions3.ts:77-78` |
| `opp_discard_from_hand` | `discard_opp_hand` | `actions3.ts:1146` | `actions3.ts:80-81` |

### Counter behavior

- Each card-level invocation of an outer kind produces **2** lookups (outer + inner).
- Verified 1:1 equality of counts at 1000-game post-Option-B: each pair has identical outer/inner counts (e.g., `power_buff` 423 ↔ `give_power` 423).
- Inner-kind "0 corpus refs but high sim count" is the wrapper signature, not a bug.

### Reporting normalization

- Raw counts in `mechanic-frequency-<seed>.json` are NOT modified.
- Distribution markdown (`mechanic-distribution-<seed>.md`) carries a
  presentation-only "Alias-folded action view" section that subtracts
  inner-alias contributions and reports outer-only totals.
- The mechanic instrumentation correctly records every
  `actionHandlers.get(kind)` lookup; the alias-fold view is a viewer
  convenience.

---

## 6. Dead vs live primitive registry

### Truly dead (verified via Python AST walk + internal-caller grep + test-refs grep)

**Action handlers (5):**

| Kind | Registration |
|---|---|
| `end_of_turn_trash` | `actions2.ts:538` |
| `give_next_play_cost_modifier` | `actions2.ts:537` |
| `return_to_hand_from_field` | `actions2.ts:540` |
| `shuffle_deck` | `actions2.ts:533` |
| `trash_opp_field` | `actions2.ts:541` |

**Cost keys (5):**

| Key | Registration |
|---|---|
| `restSource` | `costs.ts:150` |
| `returnAttachedDon` | `costs.ts:153` |
| `returnOwnDon` | `costs.ts:154` |
| `trashFromHand` | `costs.ts:151` |
| `trashFromTrash` | `costs.ts:152` |

**Target resolvers (2):**

| Kind | Registration |
|---|---|
| `opp_hand_card` | `targets.ts:198` |
| `top_of_opp_deck` | `targets.ts:201` |

### False positive (triage CLI scanner gap)

| Kind | Location | Reason |
|---|---|---|
| `deal_damage_opp` | `OP06-116` clause inside `choose_one.options[].action.actions[]` | `cli-mechanic-triage.ts:107-127` does not recurse into `options[].action` nesting |

### String-collision caveat

| Symbol | Resolver status | String-parameter status |
|---|---|---|
| `top_of_deck` | dead as target resolver (`targets.ts:200` — 0 `target.kind` refs) | live as string parameter (45 `from:` refs in `cards.json`) |

### Engine-live but corpus-absent

| Magnitude formula | Engine | Corpus | Sim observations |
|---|---|---|---|
| `match_opp_don` | registered `formula.ts:73`; unit-tested | 0 references in 2489 cards | 0 invocations in 1000-game batch |

Status: **ACTIVE (engine) / UNSHIPPED (corpus).** Not deprecated, not dead, not a sim artifact.

### Live counts snapshot (1000-game adversarial, seedBase=0, post-R1)

| Layer | Registered | Observed | Truly dead | Wrapper-aliased | False-positive orphans |
|---|---:|---:|---:|---:|---:|
| Action | 82 | (post-R1 observed count differs; raw at `mechanic-frequency-0.json`) | 5 | 5 outer/inner pairs | 1 (`deal_damage_opp`) |
| Cost | 27 | 18 | 5 | 0 | 0 |
| Target | 18 | 13 | 2 + 1 string-collision | 0 | 0 |
| Magnitude | 4 formulas | 3 | 1 unshipped (`match_opp_don`) | 0 | 0 |

---

## 7. Known artifacts and their purpose

### Reports (sim-runtime telemetry outputs)

| Artifact | Purpose | Producer |
|---|---|---|
| `reports/mechanic-frequency-0.json` | per-handler-kind invocation counts | `cli-mechanic-frequency.ts` (deterministic, sorted-key) |
| `reports/mechanic-distribution-0.md` | top-10 / zero-fire / per-tick rates + alias-folded view | `cli-mechanic-distribution.ts` |
| `reports/mechanic-distribution-0.pre-aliasfold.md` | pre-hardening snapshot (no alias-fold section) | preserved |
| `reports/mechanic-triage-0.md` | orphan / starvation / conditional classification | `cli-mechanic-triage.ts` |
| `reports/playability-0.{json,md}` | current — turn/tick distributions, win-reason, action-type frequency | `cli-playability.ts` (post-R1) |
| `reports/playability-0.pre-r1.{json,md}` | preserved — post-Option-B-only state | snapshot |
| `reports/playability-0.pre-concede-fix.{json,md}` | preserved — pre-Option-B baseline | snapshot |
| `reports/concede-rootcause-0.md` | Phase 7 diagnostic of residual CONCEDE | `concedeTrace.ts` (env-gated) |
| `reports/system-behavior-summary.md` | consolidated diagnostic record | Phase 7 close |

### Docs (developer reference, derived from reports)

| Doc | Purpose |
|---|---|
| `docs/system-overview.md` | tick + dice_roll + CONCEDE + noopExclude reference |
| `docs/policy-layer-contract.md` | formal policy/legality separation |
| `docs/mechanics-dead-vs-live.md` | handler inventory |

### Release (productization handoff)

| Doc | Purpose |
|---|---|
| `release/engine-behavior-spec.md` | canonical engine + simulation runtime spec |
| `release/mechanic-architecture-map.md` | diagrammatic mapping of primitives + aliases |
| `release/policy-consistency-notes.md` | cross-AI parity + invariants |

### Final (this document)

| Doc | Purpose |
|---|---|
| `final/system-master-spec.md` | single authoritative consolidation of all above |

### Source modules (sim-layer code introduced during Phases 3–8)

| Module | Role |
|---|---|
| `shared/simulation/mechanicInstrument.ts` | public-method-wrap counters on `actionHandlers / costHandlers / targetResolvers`. Install/uninstall symmetric. |
| `shared/simulation/cli-mechanic-frequency.ts` | runs `runBatch` under instrumentation; writes frequency JSON. |
| `shared/simulation/cli-mechanic-distribution.ts` | reads frequency JSON; emits distribution markdown (incl. alias-fold). |
| `shared/simulation/cli-mechanic-triage.ts` | reads frequency JSON + corpus; emits triage markdown. |
| `shared/simulation/playabilityTracker.ts` | observer-only per-game aggregation. |
| `shared/simulation/cli-playability.ts` | runs `runGame` loop + tracker; writes playability artifacts. |
| `shared/simulation/concedeTrace.ts` | env-gated CONCEDE root-cause replay. |

### Test gates

| Test file | Purpose |
|---|---|
| `__tests__/mechanicInstrument-determinism.test.ts` | byte-identical instrumentation JSON, reset, double-install throws, idempotent uninstall (now `describe.sequential`). |
| `__tests__/playabilityTracker.test.ts` | byte-identical playability JSON, totals invariants; env-gated 1000-game batch driver. |
| `__tests__/mechanic-frequency-batch.test.ts` | env-gated 1000-game instrumentation batch driver. |

---

## 8. What the system is NOT

To prevent misuse of these artifacts downstream:

- **NOT a game engine specification.** Engine behavior is defined by `shared/engine-v2/` source code, not these docs. The docs DESCRIBE behavior, they do not DEFINE it.
- **NOT an AI specification.** AI tiers live in `shared/engine-v2/ai/{Easy,Medium,Hard}Ai.ts`. The policy-consistency notes describe how the simulator aligns with them; they do not specify AI strategy.
- **NOT a balancing tool.** Mechanic frequency / distribution / triage measure how often primitives fire under one adversarial picker. They are NOT card-balance scores; cards are not ranked by these.
- **NOT a card design system.** `mechanic-triage-0.md` classifies primitives, not cards. Zero-fire kinds do not mean their cards are bad.
- **NOT a performance benchmark.** Tick counts are sim-runtime artifacts, not engine performance metrics. Real performance is measured elsewhere.
- **NOT a coverage gate.** Coverage tracker exists but is disabled in instrumented runs (`coverage: false`) to keep determinism intact. Coverage gating is a separate workflow.
- **NOT a regression test.** Determinism tests verify byte-identical output across seeded runs; they do not check correctness of game rules. Game rules are tested in `shared/engine-v2/__tests__/` per-card tests.
- **NOT a replacement for game design judgment.** The "0 CONCEDE post-R1" outcome is a measurement of how the engine + adversarial picker behave together; it does not say humans never concede.
- **NOT a production AI.** The adversarial picker is a stress-test exerciser, not a smart opponent. It biases toward complex interactions and edge states; humans play differently.
- **NOT engine-v2 itself.** Nothing in `shared/simulation/` ships in the playable game. It's diagnostic + telemetry tooling only.

---

## 9. Cross-test isolation guarantees

### Architectural guarantees

- **Per-worker module isolation:** vitest's default `forks` pool gives each test file its own process. Module-level state (registries, counters) does not cross worker boundaries.
- **No shared global state outside engine handler registries:** the only module-level mutable state used by sim tests is `actionHandlers / costHandlers / targetResolvers`. These are populated by `registerAllHandlers()` once per worker.

### Per-suite guarantees

- **`mechanicInstrument-determinism.test.ts` runs `describe.sequential`** at line 60. This serializes the install/uninstall window for the public-method wrap so other concurrent tests do not observe mid-wrap state if vitest scheduling places them in the same worker.
- **`playabilityTracker.test.ts`** does not mutate registries; it reads them via `runGame`. Safe under concurrent scheduling.
- **`__tests__/mechanic-frequency-batch.test.ts`** is env-gated (`MECH_FREQ_GAMES=…`) and uses `describe.runIf` so the long-running batch never executes under normal `npm test`.

### Determinism gate observations (post-hardening)

- **Full suite execution:** `141 passed | 1 skipped (142)`, `733 passed | 2 skipped (735)`, 11.93s runtime. 0 failures.
- **Per-file solo execution:** all determinism tests pass 100% solo (verified at multiple points across Phases 3–8).
- **Byte-identical artifacts at scale:** confirmed via SHA-256 hash equality + empty `diff` at both Option-B-only and post-R1 stages.

---

## ARCHIVE COMPLETE

This document supersedes all prior sectional docs as the single archival
reference. The underlying source-of-truth docs and reports remain
authoritative for their respective scopes and are not removed; this is a
union view, not a replacement.

End of master spec.
