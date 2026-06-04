# Simulation System — High-Level Overview

Dev handoff doc. Derived from `shared/simulation/reports/system-behavior-summary.md`. All claims are file:line-cited against the codebase as of Phase 7 close.

## 1. Per-tick lifecycle (runner.ts)

The simulation runner (`shared/simulation/runner.ts`) drives a single game through repeated ticks until terminal:

1. **Phase auto-pump** (`runner.ts:128-160`)
   - Advances `refresh → draw → don` and post-attack windows (`damage_resolution`, `trigger_window`, `block_window`, `counter_window`) without picker involvement.
   - Returns early when `state.result` is set OR `state.pending` is set OR phase is none of the pumpable set (e.g., `dice_roll`, `main`, `mulligan_*`).
2. **Legal-move enumeration** (`shared/simulation/moveSelector.ts:71`)
   - Thin wrapper over `getLegalActions` (`shared/engine-v2/rules/legality.ts:42`).
   - Actor selection mirrors `src/store/game.ts:343-348`:
     - `pending` → `pending.<kind>.controller`
     - `block_window` / `counter_window` → opponent of `state.activePlayer`
     - Else → `state.activePlayer`
   - `dice_roll` phase is special-cased: unions per-player legal sets from both A and B, tagging each move with its source actor.
3. **No-op exclusion filter** (`runner.ts:251-258`)
   - Drops moves previously observed to produce no fingerprint change (`runner.ts:302-305`).
   - Cleared on phase change or new pending (`runner.ts:241-244`).
   - **Architectural artifact (§4 below).**
4. **Picker** (`runner.ts:266-295`)
   - `options.adversarial === true` branch: applies Option B CONCEDE filter, then calls `pickAdversarial` (`shared/simulation/adversarial.ts:164`).
   - Else: uniform-random over remaining moves.
5. **applyAction** (`shared/engine-v2/reducers/applyAction.ts`) — deterministic state transition.
6. **Post-action observers** — coverage tracker, exposure tracker, mechanic instrument (when enabled), playability tracker.
7. **Trace + fingerprint** — `Trace.push({tick, phase, controller, move, postHash})` (`shared/simulation/trace.ts`).
8. **Invariant + stuck-loop detection** — `invariantChecks.ts`, fingerprint-window cycle detection.
9. **Loop terminates** on `state.result !== null` (completed/failed) or `MAX_TICKS` (timeout). Tick budget: `MAX_TICKS = 1000` per game.

## 2. dice_roll lifecycle

### Normal (non-tie) path

- `shared/engine-v2/reducers/setup.ts:46-82` `rollDiceReducer` handles `ROLL_DICE(player)`:
  - Pulls d6 via `RngService.pull(state).nextInt(6) + 1` (lines 58-59).
  - Writes `state.diceRoll[player] = value` (line 60).
  - Pushes `DICE_ROLLED` history entry (lines 61-65).
- When both `diceRoll.A` and `diceRoll.B` are non-null and **distinct**:
  - Higher roll wins → `state.activePlayer = winner` (lines 77-78).
  - `state.phase = 'first_player_choice'` (line 79).

### Tie path

- `setup.ts:71-74`: when `a === b`, both slots null'd, `rolls` counter incremented, phase stays `dice_roll`.
- Both players become re-rollable. `legality.ts:46-50` returns `[ROLL_DICE, CONCEDE]` for each.
- Expected frequency: 1/6 per round (fair d6 vs d6).

### Legality during dice_roll

| `diceRoll[player]` state | Returned by `legality.ts:46-50` |
|---|---|
| `null` / `undefined` | `[{type:'ROLL_DICE', player}, {type:'CONCEDE'}]` |
| set | `[{type:'CONCEDE'}]` |

`moveSelector.ts:81-96` unions both A and B during dice_roll.

## 3. CONCEDE behavior — pre/post Option B

### Pre-Option-B (resolved, historical)

- `adversarial.ts:116` assigned `CONCEDE` base weight `0.05`.
- Quantization at `adversarial.ts:173` (`Math.max(1, floor(weight × 1000))`) gave CONCEDE a minimum quantized weight of 50.
- Per-tick CONCEDE probability ≈ 3–9% depending on co-legal move count; cumulative ~99% over 22 ticks.
- 1000-game baseline: 999 games ended via `concede`, 1 via `life_zero`, median 3 turns.

### Post-Option-B (current behavior)

- `runner.ts:271-295` strips CONCEDE from the picker's input inside the adversarial branch.
- Empty-fallback preserved: if the filter would leave zero moves, the picker receives the original (CONCEDE-only) set so dispatch is never lost.
- Index-map maintained so `actors[pickedIdx]` resolves correctly back to the original `moves[]`.
- Engine-v2, legality.ts, moveSelector.ts, adversarial.ts: **unchanged.**
- 1000-game post-fix: 831 games end via `life_zero`, 163 via `concede`, 6 via `deck_out`. Median 17 turns. Determinism SHA-256: `61f31af01a5d1ba891d2273b5b69565686f6424790b008a54da9dfcf913128f0`.

### Residual 163 CONCEDEs

- All occur at tick 2, phase = `dice_roll`.
- Caused by the noopExclude artifact in §4. Not an Option B bug.

## 4. noopExclude mechanism — architectural artifact

The runner classifies a tick as a "no-op" (and excludes the move from future picks within the phase) when the post-action state fingerprint matches the pre-action fingerprint AND `pending` did not change (`runner.ts:302-305`).

### The fingerprint (`runner.ts:97-115`)

Includes:
- `state.phase`
- `state.turn`
- `state.activePlayer`
- `hand/field/life/deck/donCostArea` lengths for both players
- `state.pending === null ? '0' : state.pending.kind`
- `state.result === null ? '0' : 'R:${result.loser}'`

Does **NOT** include:
- `state.diceRoll`
- `state.history`
- per-instance counters or modifiers
- any other deep state

### Consequence for dice_roll

`ROLL_DICE` mutates only `state.diceRoll[player]`. The fingerprint is unchanged, so the no-op detector marks the move as ineffective and adds it to `noopExclude`. Since `dice_roll` phase persists across ties (`setup.ts:71-74`), the exclusion sticks. On a tie, both ROLL_DICE entries return to the legal set but both are already in `noopExclude`. After Option B strips CONCEDE, the set is empty → empty-fallback → CONCEDE picked.

Statistical match: residual 163/1000 = 16.3% ≈ d6-tie probability 1/6.

### Status

Documented as a known architectural artifact. No active patch. Two minimal remediations were enumerated at Phase 7 close (R1: add diceRoll to fingerprint; R2: exempt dice_roll from no-op detection) but neither was authorized. Engine-v2, legality, moveSelector, adversarial, instrumentation all confirmed innocent of this interaction.

## 5. Determinism contract

- RNG: `shared/simulation/rng.ts` mulberry32, keyed by `seed >>> 0`.
- Per-tick fork: `rng.fork('tick:${tick}')` is independent of prior-tick consumption.
- State mutations are pure functions of `(state, action)`.
- JSON reports sort keys lexicographically before serialization.
- 1000-game post-Option-B SHA-256 hash matches across two seeded runs; `diff` between artifacts: empty.
- Determinism gates: `mechanicInstrument-determinism.test.ts` (5 tests), `playabilityTracker.test.ts` (5 tests + 1 env-gated batch driver). Solo execution always passes.

## 6. Trace shape

`shared/simulation/trace.ts:14-21`:

```ts
interface TraceEntry {
  readonly tick: number;
  readonly phase: Phase;
  readonly controller: PlayerId;  // the actor applyAction was called with
  readonly move: Action;
  readonly postHash: string;       // short fingerprint of post-state
}
```

Used by failure reporter, loop detector, and Phase 7 concede-trace replay (`shared/simulation/concedeTrace.ts`).

## 7. Cross-references

- Mechanism narrative: `shared/simulation/reports/system-behavior-summary.md`
- Pre-fix vs post-fix delta: `shared/simulation/reports/playability-0.{json,md}` + `playability-0.pre-concede-fix.{json,md}`
- Root-cause trace: `shared/simulation/reports/concede-rootcause-0.md`
