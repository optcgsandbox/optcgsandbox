# Policy Consistency Notes

Release-facing parity & invariant reference for engine-v2 policy consumers. Derived from `shared/simulation/docs/policy-layer-contract.md` and `shared/simulation/reports/system-behavior-summary.md`. No new findings.

## 1. Policy consumers — registry

Four code paths consume `getLegalActions(state, player)` and act as policy boundaries:

| # | Consumer | File / line | Role |
|---:|---|---|---|
| 1 | Easy AI | `shared/engine-v2/ai/EasyAi.ts:37-55` | random-but-legal AI tier; avoids suicide attacks |
| 2 | Medium AI | `shared/engine-v2/ai/MediumAi.ts:53` | heuristic-weighted AI tier |
| 3 | Hard AI | `shared/engine-v2/ai/HardAi.ts:33` | depth-limited search AI tier |
| 4 | Simulator | `shared/simulation/runner.ts:271-295` | adversarial-weighted batch driver |

No other consumer reads the canonical legal-move set. UI button gating mirrors this contract via `src/store/game.ts:343-348` dispatch routing.

## 2. CONCEDE canonical rule

**Rule (binding across all four consumers):**

> A policy consumer NEVER voluntarily selects CONCEDE when at least one non-CONCEDE legal move exists.

**Rationale:**

- `legality.ts` emits CONCEDE in every phase branch (lines 48, 49, 53, 57, 63, 64, 69-74, 80-87, 93-102, 108-) as a UI affordance + safety termination path. The rule is engine-design-intentional.
- CONCEDE-only selection by an autonomous policy consumer is a policy bug: the consumer is giving up while alternatives exist.
- Filtering belongs at the policy layer, not at legality, selector, or weighting. Each consumer holds its own copy of the filter.

## 3. Per-consumer implementation parity

| Property | Easy AI | Medium AI | Hard AI | Simulator |
|---|---|---|---|---|
| Filter location | `EasyAi.ts:44` | `MediumAi.ts:53` | `HardAi.ts:33` | `runner.ts:271-295` |
| Filter expression | `legal.filter(a => a.type !== 'CONCEDE')` | identical | identical | per-move map preserves actor index |
| Empty-fallback behavior | `{type: 'END_TURN'}` (`EasyAi.ts:45`) | (no explicit fallback documented) | (no explicit fallback documented) | original `moves[]` incl. CONCEDE (`runner.ts:282-287`) |
| Pre-CONCEDE-filter ordering | random | weighted | searched | weighted (adversarial.ts) |
| Touches `legality.ts`? | no | no | no | no |
| Touches `moveSelector.ts`? | no | no | no | no |
| Touches `adversarial.ts`? | n/a | n/a | n/a | no |

### Divergence note

- AI consumers fall back to `END_TURN` when the filter would empty the move set.
- The simulator falls back to the **original** (CONCEDE-only) set to keep the runner's dispatch loop alive.
- This divergence is intentional: AI behavior is single-turn-scoped; simulator behavior must drive games to a terminal state to produce telemetry.

## 4. Verified policy outcomes (1000-game post-Option-B run, seedBase=0, adversarial=true)

| Metric | Value |
|---|---:|
| Total games | 1000 |
| `terminalCategories.completed` | 1000 |
| `terminalCategories.failed` | 0 |
| `terminalCategories.timeout` | 0 |
| `winReason.life_zero` | 831 (83.1%) |
| `winReason.concede` | 163 (16.3%) — 100% from dice_roll noopExclude artifact |
| `winReason.deck_out` | 6 (0.6%) |
| A vs B winner split | 543 / 457 |
| Median game length (turns) | 17 |
| Median game length (ticks) | 201 |
| Median ticks per turn | 11.58 |
| Median unique action types per game | 13 |

Source: `shared/simulation/reports/playability-0.json`.

## 5. Invariants protected by the policy layer

| Invariant | Protected by | File:line |
|---|---|---|
| Consumer never voluntarily concedes when alternatives exist | All 4 policy filters | (see §3) |
| Legality contract is consumer-agnostic | Legality layer never inspects consumer identity | `legality.ts:42` |
| Selector mirrors legality verbatim | No filtering in moveSelector | `moveSelector.ts:71-99` |
| Weighting is policy-agnostic | adversarial.ts scores every move passed to it | `adversarial.ts:140-157` |
| RNG determinism | Per-tick fork keyed by tick string, not RNG state | `runner.ts:267` |
| Engine purity | applyAction is a pure function of `(state, action)` | engine invariant suite |

## 6. Cross-consumer invariants (do not violate)

- **Filter must be local to each consumer.** Do not push the CONCEDE filter into legality, moveSelector, or adversarial; doing so would couple unrelated layers and break the equivalence table.
- **Empty-fallback must always succeed.** Any consumer that empties its move set after filtering must define a fallback (END_TURN, original set, etc.). Returning `undefined` from a consumer is a dispatch bug.
- **No consumer mutates the legality output.** Filters produce new arrays; the original `getLegalActions` return value is treated as immutable.
- **Determinism is consumer-local.** A consumer that introduces non-determinism (e.g., wall-clock time, untracked global state) violates the simulator's byte-identical artifact guarantee.

## 7. Adding a fifth consumer — checklist

If a new system (replay validator, hint engine, new AI tier, training data generator) begins reading `getLegalActions`:

1. **Filter location:** add the CONCEDE filter at the consumer's own boundary. Do not move shared code into legality/moveSelector/adversarial.
2. **Empty-fallback:** decide on a domain-specific fallback (END_TURN for turn-scoped AIs; original-set for game-driving simulators; custom for specialized analyses).
3. **Determinism contract:** if the consumer participates in deterministic batch runs, ensure no untracked RNG/time/global state.
4. **Equivalence table:** add a row to §3 above so the parity inventory remains complete.
5. **Audit grep:** `grep -rn "filter.*CONCEDE" shared/` should surface all consumers in one read.

## 8. Known carry-forward items (not blocking)

- **Residual 16.3% CONCEDE-only games** in the 1000-game post-fix baseline are caused by the `noopExclude` × `stateFingerprint`-missing-`diceRoll` interaction documented in `engine-behavior-spec.md` §5. This is a runner-layer artifact, NOT a policy violation: the filter behaves correctly (CONCEDE is removed when alternatives exist; fallback fires only when alternatives are exhausted by upstream pruning).
- **Cross-test pollution risk** between `mechanicInstrument-determinism.test.ts` and `playabilityTracker.test.ts` byte-identical test under concurrent vitest scheduling — mitigation surface noted but not authorized.

## 9. Source-of-truth references

- Policy/legality separation: `shared/simulation/docs/policy-layer-contract.md`
- Mechanism narrative: `shared/simulation/reports/system-behavior-summary.md`
- Tick lifecycle + dice_roll behavior: `shared/simulation/release/engine-behavior-spec.md`
- Mechanic mapping: `shared/simulation/release/mechanic-architecture-map.md`
- Verified delta artifacts: `shared/simulation/reports/playability-0.{json,md}` + `playability-0.pre-concede-fix.{json,md}`
- Root cause for residual CONCEDE: `shared/simulation/reports/concede-rootcause-0.md`
