# Engine Behavior Specification

Release-facing canonical specification of the engine-v2 + simulation runtime, structured for downstream developer consumption. Derived from `shared/simulation/docs/system-overview.md`, `shared/simulation/docs/policy-layer-contract.md`, and `shared/simulation/reports/system-behavior-summary.md`. All claims are anchored to a file:line citation verified during Phases 3–7.

## 1. Layered architecture

```
┌─────────────────────────────────────────────────────────┐
│ POLICY CONSUMER                                          │
│   • simulator (runner.ts adversarial branch)             │
│   • EasyAi / MediumAi / HardAi                           │
└──────────────────────────┬──────────────────────────────┘
                           │ getLegalActions(state, player)
┌──────────────────────────▼──────────────────────────────┐
│ SELECTOR — moveSelector.ts                               │
│   • routes the queried actor                             │
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

Boundaries are strict:
- Legality enumerates; never filters.
- Selector routes; never filters.
- Policy filters; never mutates the legality contract.
- Engine reduces; never reasons about who is choosing.

## 2. Game tick lifecycle (runner.ts)

Each iteration of the runner's main loop performs the following steps in order:

| # | Step | File:line | Behavior |
|---:|---|---|---|
| 1 | Terminal check | `runner.ts:231-233` | exit if `state.result !== null` |
| 2 | Phase auto-pump | `runner.ts:236, 128-160` | auto-advance `refresh / draw / don` and post-attack windows (no picker involved) |
| 3 | Terminal recheck | `runner.ts:237-239` | exit if pump landed state in terminal |
| 4 | No-op exclusion reset | `runner.ts:241-244` | clear `noopExclude` if phase changed or pending appeared |
| 5 | Legal-move enumeration | `runner.ts:250, moveSelector.ts:71` | thin wrapper over `getLegalActions` |
| 6 | No-op exclusion filter | `runner.ts:251-258` | drop previously-observed-no-op moves; empty-fallback to raw set |
| 7 | Empty-set guard | `runner.ts:259-262` | `no_legal_moves` failure |
| 8 | Pick + apply | `runner.ts:266-295` | adversarial-weighted OR uniform random; runs Option B CONCEDE filter on the adversarial branch |
| 9 | applyAction | `runner.ts:283-289` | pure state transition; crash captured if it throws |
| 10 | Observer updates | `runner.ts:292-294` | coverage / exposure / mechanic-instrument (when enabled) |
| 11 | Trace push | `runner.ts:296-297` | `{tick, phase, controller, move, postHash}` |
| 12 | No-op detection | `runner.ts:299-305` | if fingerprint unchanged & pending unchanged, mark as no-op for this phase |
| 13 | Invariant check | `runner.ts:308-313` | `invariantChecks.ts`; fails game if violated |
| 14 | Stuck detection | `runner.ts:316-327` | rolling fingerprint window; fails game if cycling |
| 15 | Advance | `runner.ts:329` | `state = next` |

Loop terminates on `state.result !== null` (completed/failed) or `MAX_TICKS = 1000` (timeout).

## 3. dice_roll phase contract

| Pre-state | Action | Post-state | Authority |
|---|---|---|---|
| `diceRoll[player] === null` | `ROLL_DICE(player)` | `diceRoll[player] = d6` | `setup.ts:46-65` |
| Both slots non-null AND distinct | (auto on second ROLL_DICE) | `phase = 'first_player_choice'`; `activePlayer = winner` | `setup.ts:70-80` |
| Both slots non-null AND equal | (auto on second ROLL_DICE) | both slots → null; `rolls += 1`; phase stays `dice_roll` | `setup.ts:71-74` |

Legality during `dice_roll`:

| `diceRoll[player]` | `getLegalActions(state, player)` returns | `legality.ts` |
|---|---|---|
| null/undefined | `[{type:'ROLL_DICE', player}, {type:'CONCEDE'}]` | line 49 |
| set | `[{type:'CONCEDE'}]` | line 48 |

`moveSelector.ts:81-96` unions both A and B during `dice_roll` and tags each move with its source actor.

## 4. CONCEDE behavior

### Engine contract (immutable)

- `legality.ts` emits `{type:'CONCEDE'}` in the legal set for every phase branch (lines 48, 49, 53, 57, 63, 64, 69-74, 80-87, 93-102, 108- ...).
- CONCEDE is a universal fallback — UI affordance for human play and engine safety termination path.

### Policy contract (post-Option-B, current)

> The simulator's policy layer NEVER voluntarily selects CONCEDE when at least one non-CONCEDE legal move exists.

| Policy consumer | Filter location | Empty-fallback |
|---|---|---|
| Easy AI | `EasyAi.ts:44-45` | `END_TURN` |
| Medium AI | `MediumAi.ts:53` | (no explicit fallback) |
| Hard AI | `HardAi.ts:33` | (no explicit fallback) |
| Simulator (adversarial) | `runner.ts:271-295` | original `moves[]` (preserve dispatch) |

### Verified post-fix metrics (1000 games, seedBase=0, adversarial=true)

| Win reason | Pre-Option-B | Post-Option-B |
|---|---:|---:|
| `life_zero` | 1 (0.1%) | 831 (83.1%) |
| `concede` | 999 (99.9%) | 163 (16.3%) |
| `deck_out` | 0 (0.0%) | 6 (0.6%) |

| Stat | Pre | Post |
|---|---:|---:|
| Median turns | 3 | 17 |
| Median ticks | 13 | 201 |
| A/B winner split | 522/478 | 543/457 |
| Failures | 0 | 0 |

The 16.3% residual CONCEDE rate is **NOT** a policy bug; see §6.

## 5. noopExclude — architectural artifact

### Fingerprint

`runner.ts:97-115` computes a short hash over:

```
[phase, turn, activePlayer,
 hand.length × 2, field.length × 2, life.length × 2, deck.length × 2,
 donCostArea.length × 2,
 pending.kind | '0',
 result.loser | '0']
```

It deliberately does NOT include:
- `state.diceRoll`
- `state.history`
- per-instance modifiers/counters

### No-op detector

At `runner.ts:302-305`, if `fp(post) === fp(pre)` AND `next.pending === prev.pending`, the move is added to `noopExclude`.

`noopExclude` clears only on phase change or new pending (`runner.ts:241-244`).

### Consequence in dice_roll

- `ROLL_DICE` mutates `state.diceRoll` only → fingerprint unchanged → move classified as no-op → added to `noopExclude`.
- `dice_roll` phase persists across ties → exclusion sticks.
- On a tie, both ROLL_DICE entries return to the legal set but are already noop-excluded.
- After Option B strips CONCEDE, the set is empty → empty-fallback → CONCEDE.

Statistical signature: 1/6 (d6 tie probability) = 16.67%; observed 16.3% in 1000-game post-fix run.

**Status: documented architectural artifact. No active patch. Engine, legality, moveSelector, adversarial, instrumentation all confirmed innocent.**

## 6. Determinism contract

| Property | Source | Verification |
|---|---|---|
| RNG | `shared/simulation/rng.ts` mulberry32 keyed by `seed >>> 0` | unit-tested in `mechanicInstrument-determinism.test.ts` |
| Per-tick fork | `rng.fork('tick:${tick}')` — keyed by tick string, not RNG state | `runner.ts:267` |
| State purity | applyAction is a pure function of `(state, action)` | engine invariant suite |
| Serialization | JSON reports sort keys lexicographically before write | `mechanicInstrument.ts:serializeReport`, `playabilityTracker.ts:serializePlayabilityReport` |
| Scale verification | 1000-game post-Option-B SHA-256 | `61f31af01a5d1ba891d2273b5b69565686f6424790b008a54da9dfcf913128f0` (verified across 2 runs, `diff` empty) |

Solo execution of each determinism test file always passes. Full-suite concurrency-induced flake is documented in `system-behavior-summary.md` §8.

## 7. Trace surface

`shared/simulation/trace.ts:14-21`:

```ts
interface TraceEntry {
  readonly tick: number;
  readonly phase: Phase;
  readonly controller: PlayerId;   // actor applyAction was called with
  readonly move: Action;
  readonly postHash: string;
}
```

Used by:
- failure reporter (replayable bug dumps)
- stuck-loop detector
- Phase 7 root-cause replay (`shared/simulation/concedeTrace.ts`)
- per-game playability aggregation (`shared/simulation/playabilityTracker.ts`)

## 8. Versioning & stability commitments

- The engine-v2 source surface (`shared/engine-v2/**`) has been unchanged across Phases 3–7.
- The legality contract (`legality.ts`), selector behavior (`moveSelector.ts`), and adversarial weighting (`adversarial.ts`) have been unchanged across Phases 3–7.
- `runner.ts` carries exactly one additive change (Option B CONCEDE filter, adversarial branch only, lines 271-295) and one additive field (`totalTicks: number` on `RunBatchSummary`).
- `RunGameResult.{ticks, turn, trace, finalState}` shape is stable. Phase 7 instrumentation depends on this contract.

## 9. Source-of-truth index

- `shared/simulation/reports/system-behavior-summary.md` — consolidated diagnostic record
- `shared/simulation/docs/system-overview.md` — tick + dice_roll + CONCEDE + noopExclude reference
- `shared/simulation/docs/policy-layer-contract.md` — formal policy/legality separation
- `shared/simulation/docs/mechanics-dead-vs-live.md` — handler inventory
- `shared/simulation/reports/playability-0.json` — post-fix metrics
- `shared/simulation/reports/playability-0.pre-concede-fix.json` — pre-fix metrics (preserved)
- `shared/simulation/reports/concede-rootcause-0.md` — Phase 7 diagnostic
