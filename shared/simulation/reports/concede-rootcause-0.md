# CONCEDE root-cause analysis — seedBase=0

- Total games: **1000**
- Games with ≥1 CONCEDE: **163** (16.3%)
- Total CONCEDE events: **163**

## Classification summary

| Classification | Count | Share |
|---|---:|---:|
| `legitimate_terminal_or_legal_only` | 0 | 0.0% |
| `actor_routing_bug` | 0 | 0.0% |
| `legality_pruning_artifact` | 163 | 100.0% |
| `adversarial_picker_side_effect` | 0 | 0.0% |

## By phase

| Phase | Count | Share |
|---|---:|---:|
| `dice_roll` | 163 | 100.0% |

## Absence-indicator frequency

| Indicator | Count |
|---|---:|
| `dice_roll post-tie reset (rolls=N): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:N-N)` | 163 |

## Sample events (first 20)

| seed | tick | phase | actor | traceCtrl | pendingKind | pendingCtrl | legalCount | legalTypes | classification | indicator |
|---:|---:|---|---|---|---|---|---:|---|---|---|
| 2 | 2 | dice_roll | A | B | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 3 | 2 | dice_roll | A | B | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 5 | 2 | dice_roll | A | A | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 23 | 2 | dice_roll | A | B | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 33 | 2 | dice_roll | A | B | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 52 | 2 | dice_roll | A | B | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 55 | 2 | dice_roll | A | A | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 58 | 2 | dice_roll | A | A | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 67 | 2 | dice_roll | A | A | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 69 | 2 | dice_roll | A | A | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 75 | 2 | dice_roll | A | A | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 78 | 2 | dice_roll | A | B | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 84 | 2 | dice_roll | A | A | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 86 | 2 | dice_roll | A | B | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 87 | 2 | dice_roll | A | B | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 93 | 2 | dice_roll | A | A | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 95 | 2 | dice_roll | A | A | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 100 | 2 | dice_roll | A | B | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 102 | 2 | dice_roll | A | B | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |
| 105 | 2 | dice_roll | A | B | — | — | 4 | `ROLL_DICE,CONCEDE,ROLL_DICE,CONCEDE` | `legality_pruning_artifact` | dice_roll post-tie reset (rolls=1): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115) |

## Mechanism narrative (verified against source)

- **Trigger phase:** `dice_roll` initial roll-off. Both players roll a d6 via `setup.ts:46-82` `rollDiceReducer`.
- **Tie path:** when `a === b` (1/6 ≈ 16.67% expected for a fair d6 vs d6), `setup.ts:71-74` nulls both slots and increments `state.diceRoll.rolls`. Phase **stays** `dice_roll` for the re-roll.
- **Legality after tie:** `legality.ts:46-50` returns `[ROLL_DICE, CONCEDE]` for each player with `slot === null`. `moveSelector.ts:81-96` unions both → `[ROLL_DICE(A), CONCEDE, ROLL_DICE(B), CONCEDE]`.
- **No-op detector interaction:** `runner.ts:97-115` `stateFingerprint` includes `phase, turn, activePlayer, hand/field/life/deck/donCostArea sizes, pending.kind, result` — but **NOT** `diceRoll`. So `applyAction(ROLL_DICE)` leaves the fingerprint unchanged, and `runner.ts:302-305` adds the ROLL_DICE move to `noopExclude`.
- **Exclusion persistence:** `noopExclude` clears only on phase change or pending appearance (`runner.ts:241-244`). Since `dice_roll` persists across ties, both ROLL_DICE entries stay excluded.
- **Empty fallback:** Option B (`runner.ts` adversarial branch) strips CONCEDE → after noop-filter + CONCEDE-filter the move set is empty → CONCEDE picked from empty-fallback path.
- **Statistical match:** 163 / 1000 = 16.3% ≈ 1/6 = 16.67% (dice-tie probability for two distinct d6 rolls).

## Classification per Phase 7 spec

- All 163 events bucket to **`(c) legality_pruning_artifact`**.
- NOT `(a)` — `state.result` is null at pre-CONCEDE.
- NOT `(b)` — `moveSelector.computeActor` returns the correct (active) player; the actor mismatch shown in traces (`actor=A` vs `traceController=B`) is `moveSelector` reporting the dispatch primary actor (state.activePlayer) while the move list contains entries owned by both players via the union — both are correct under the dice_roll convention.
- NOT `(d)` — adversarial weighting is unrelated; even uniform-random would empty-fallback identically given the noopExclude state.

## Implication (diagnostic only — NO patch in this phase)

- The root cause is a **runner-layer fingerprint gap**, NOT an engine, legality, moveSelector, adversarial, or Option-B bug.
- Two possible future remediations (each strictly sim-layer, not requested here):
  - Add `diceRoll.A, diceRoll.B, diceRoll.rolls` to `stateFingerprint` so ROLL_DICE is no longer mistaken as a no-op.
  - Exempt `dice_roll` phase from the no-op detector (clear `noopExclude` after every dice_roll tick).
- Engine, legality, moveSelector, adversarial, instrumentation: all confirmed innocent.

## Notes

- Replay uses public engine-v2 APIs only: `buildDeck`, `buildInitialState`, `applyAction`, `PhaseScheduler.enter*`. No engine modifications.
- The `pumpAutoPhases` helper is a passive copy of `runner.ts:128-160` and is NOT a behavioral change to the runner.
- Classification heuristic prioritizes actor-routing detection (`pending.controller ≠ moveSelector.actor`) since legality.ts emits CONCEDE-only when the queried player does not match the decider in 9 distinct branches (`legality.ts:48,53,63,69-70,80-81,93-94`). Here, all 163 events bypass that branch and land on the dice_roll fingerprint-gap.
