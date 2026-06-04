# System Behavior Summary

Consolidated diagnostic record of the engine-v2 + simulation layer as of the
close of Phase 7. Every claim below is anchored to a file:line citation
verified during Phases 3–7. This document is **diagnostic-only** — no code
changes, no instrumentation expansion, no optimization proposals.

---

## 1. dice_roll lifecycle

### Normal path (no tie)

- `setup.ts:46-82` `rollDiceReducer` handles `ROLL_DICE` actions in `dice_roll` phase.
- For each `ROLL_DICE(player)` whose slot is `null`:
  - Pulls a d6 via `RngService.pull(state).nextInt(6) + 1` (`setup.ts:58-59`).
  - Writes `state.diceRoll[player] = value` (`setup.ts:60`).
  - Appends a `DICE_ROLLED` history entry (`setup.ts:61-65`).
- Once both slots are non-null AND distinct:
  - Winner = higher roll → `state.activePlayer = winner` (`setup.ts:77-78`).
  - `state.phase = 'first_player_choice'` (`setup.ts:79`).

### Tie path (per dice roll-off, expected ≈1/6 per round for fair d6 vs d6)

- When `a === b`, `setup.ts:71-74` resets `state.diceRoll = { A: null, B: null, rolls: prev.rolls + 1 }`.
- Phase **remains** `dice_roll`. Both players become re-rollable.
- This is a deliberate engine design — ties are re-rolled, never broken arbitrarily.

### Legality during dice_roll

- `legality.ts:46-50`:
  - `slot !== null && slot !== undefined` → returns `[{ type: 'CONCEDE' }]`.
  - `slot === null/undefined` → returns `[{ type: 'ROLL_DICE', player }, { type: 'CONCEDE' }]`.
- `moveSelector.ts:81-96` unions both players' results during `dice_roll` (special case; other phases query only `computeActor(state)`).

---

## 2. CONCEDE emergence mechanism

### Pre-Option-B baseline (1000 games, seedBase=0, adversarial=true)

- 999 / 1000 games ended via `state.result.reason === 'concede'`.
- Only 1 game ended via `life_zero`.
- Median game length: 3 turns (P50 turn count).
- Root cause then: `adversarial.ts:116` assigned `CONCEDE` base weight `0.05`. With `Math.max(1, floor(weight × 1000))` quantization at `adversarial.ts:173`, CONCEDE always received quantized weight ≥1 — per-tick CONCEDE probability ~3–9%, cumulative ~99% over 22 ticks.
- AI consumers (`EasyAi.ts:44`, `MediumAi.ts:53`, `HardAi.ts:33`) already filtered CONCEDE at the policy layer. The simulator's adversarial picker was the only consumer that did not.

### Option B fix (sim-layer policy filter applied at `runner.ts:271-295`)

- Strips CONCEDE from the legal-move set **before** invoking `pickAdversarial`.
- Maps the picked index back to the original `moves[]` so `actors[pickedIdx]` lookup remains correct.
- Empty-fallback path: if filtering would leave 0 moves, pass the original (CONCEDE-only) set to `pickAdversarial` — preserves dispatch in theoretical CONCEDE-only legal sets.
- Zero changes to `legality.ts`, `moveSelector.ts`, `adversarial.ts`, engine-v2.

### Post-Option-B residual CONCEDE rate: 16.3% (163 / 1000 games)

- 100% of residual CONCEDEs fire at **tick 2, phase = `dice_roll`**.
- Statistical match: 163/1000 = 16.3% ≈ 1/6 = 16.67% — equals d6-tie probability.
- All 163 events traced to the **dice-tie + noopExclude interaction** documented in §3 below.
- Classification per Phase 7 spec: 100% `legality_pruning_artifact` (bucket c).
  - **0** `legitimate_terminal_or_legal_only` (a)
  - **0** `actor_routing_bug` (b)
  - **0** `adversarial_picker_side_effect` (d)

---

## 3. `noopExclude` interaction (the runner.ts fingerprint gap)

### How it produces CONCEDE post-Option-B

1. `runner.ts:97-115` `stateFingerprint` includes:
   `phase, turn, activePlayer, hand/field/life/deck/donCostArea sizes, pending.kind, result.loser`.
2. `state.diceRoll` is **not** in that list.
3. `applyAction(ROLL_DICE)` mutates `state.diceRoll[player]` only — fingerprint unchanged.
4. `runner.ts:302-305` no-op detector treats unchanged fingerprint as evidence the move had no effect, adds it to `noopExclude`.
5. `noopExclude.clear()` runs only on phase change or pending appearance (`runner.ts:241-244`). `dice_roll` persists across ties, exclusion sticks.
6. On a dice tie, both ROLL_DICE entries return to the legal set (both slots nulled), but both are in `noopExclude` → filtered out → only CONCEDE entries remain → Option B's CONCEDE filter empties the set → empty-fallback → CONCEDE picked.

### Layers innocent of this artifact

- **engine-v2 reducers**: `setup.ts:rollDiceReducer` correctly implements OPTCG tie rule.
- **legality.ts**: emits CONCEDE-only when a slot is filled and `[ROLL_DICE, CONCEDE]` when null — per spec.
- **moveSelector.ts**: union behavior in `dice_roll` is correct (mirrors `src/store/game.ts` UI dispatch).
- **adversarial.ts**: weight 0.05 → 0 effective via Option B; weighting unrelated to fingerprint gap.
- **Option B**: does what was specified; exposed the pre-existing artifact rather than creating it.

The artifact is in `runner.ts` — `stateFingerprint` predates Option B, predates Phase 7, predates the policy-layer fix. It is a sim-layer concern, not engine-v2.

### Remediation surface (deliberately NOT applied)

- R1: add `diceRoll.A, diceRoll.B, diceRoll.rolls` to `stateFingerprint` parts array (3 lines, `runner.ts:99-115`).
- R2: clear `noopExclude` after every dice_roll tick (2 lines, `runner.ts:241-244`).
- Both are sim-layer-only; neither was authorized at Phase 7 close.

---

## 4. Determinism guarantees

### Verified at scale

- 1000-game post-Option-B run hashed and re-run: SHA-256 `61f31af01a5d1ba891d2273b5b69565686f6424790b008a54da9dfcf913128f0` — byte-identical across two runs.
- 1000-game pre-Option-B equivalent: deterministic JSON output of `mechanic-frequency-0.json` confirmed in items 3-5 batch determinism tests.

### Sources of determinism

- RNG: `shared/simulation/rng.ts` `newRng(seed)` exposes mulberry32 keyed by `seed >>> 0`.
- Per-tick fork: `runner.ts:267` `tickRng = rng.fork('tick:${tick}')` — independent of prior-tick RNG consumption.
- Engine state mutations are pure functions of state + action (verified via Phase 1–7 invariant suite).
- JSON serialization sorts keys lexicographically in all sim-layer reports (`mechanicInstrument.ts:serializeReport`, `playabilityTracker.ts:serializePlayabilityReport`, `cli-mechanic-distribution.ts`, `cli-mechanic-triage.ts`).

### Verified test gates

- `shared/simulation/__tests__/mechanicInstrument-determinism.test.ts` — 5 passing tests (byte-identical, reset between cycles, double-install throws, idempotent uninstall, counters non-empty).
- `shared/simulation/__tests__/playabilityTracker.test.ts` — 5 passing tests + 1 env-gated batch driver.
- Solo execution of each file confirms determinism. Full-suite concurrency-induced flake noted in §8 below.

---

## 5. Confirmed truly-dead handlers vs false positives

### Truly dead (verified via grep over `shared/data/cards.json` + internal-caller grep + test-refs grep)

**Action handlers (5):**
- `end_of_turn_trash` — registered `actions2.ts:538`, 0 corpus, 0 internal callers
- `give_next_play_cost_modifier` — registered `actions2.ts:537`, 0 corpus, 0 internal callers
- `return_to_hand_from_field` — registered `actions2.ts:540`, 0 corpus, 0 internal callers
- `shuffle_deck` — registered `actions2.ts:533`, 0 corpus, 0 internal callers
- `trash_opp_field` — registered `actions2.ts:541`, 0 corpus, 0 internal callers

**Cost keys (5):**
- `restSource` (`costs.ts:150`), `returnAttachedDon` (`costs.ts:153`), `returnOwnDon` (`costs.ts:154`), `trashFromHand` (`costs.ts:151`), `trashFromTrash` (`costs.ts:152`) — all 0 corpus, 0 internal callers; some appear only in a corpus-partial-classify test fixture enumeration.

**Target resolvers (2):**
- `opp_hand_card` (`targets.ts:198`), `top_of_opp_deck` (`targets.ts:201`) — 0 `target.kind` refs in corpus (Python AST walk over all `target` objects in `effectSpecV2`).

### False positive identified (triage CLI scanner gap)

- `deal_damage_opp` — 1 real corpus ref at `OP06-116` nested inside `choose_one.options[].action.actions[]`. Triage scanner at `cli-mechanic-triage.ts:107-127` does not recurse into `options[].action` — it treats options items as action nodes themselves rather than clause wrappers. This is a known scanner limitation, surfaced during Phase 6.

### String-collision caveat

- `top_of_deck` (target resolver at `targets.ts:200`) — 0 `target.kind` corpus refs (truly dead as resolver) BUT the literal string `"top_of_deck"` appears 45× in `cards.json` as a `from:` parameter on action objects (e.g., `add_to_own_life_top`). Resolver and parameter share a name but are independent surfaces. Removing the resolver does not affect the parameter usage.

---

## 6. Alias-wrapped actions (instrumentation double-counts)

### Confirmed wrappers (`shared/engine-v2/registry/handlers/actions3.ts`)

| Outer (in corpus) | Inner (engine-only) | Registration | Inner reference |
|---|---|---|---|
| `power_buff` | `give_power` | `actions3.ts:1142` | `actions3.ts:68-69` |
| `mill_self` | `trash_top_of_deck` | `actions3.ts:1143` | `actions3.ts:71-72` |
| `mill_opp` | `mill` | `actions3.ts:1144` | `actions3.ts:74-75` |
| `set_active` | `active_target` | `actions3.ts:1145` | `actions3.ts:77-78` |
| `opp_discard_from_hand` | `discard_opp_hand` | `actions3.ts:1146` | `actions3.ts:80-81` |

### Behavioral impact on Phase 3 frequency telemetry

- Each card-level invocation of a wrapper produces TWO `actionHandlers.get(kind)` calls (outer + inner).
- `power_buff` ↔ `give_power` shows the cleanest symmetry in the 1000-game batch: 423 ↔ 423 (exactly equal by construction).
- Inner names have 0 corpus refs by definition — they are engine-internal aliases, not cards.json action kinds.
- The instrumentation counts are NOT broken — they correctly record every handler lookup. The user-facing interpretation must subtract the inner-alias contribution when reasoning about card-level frequency.

---

## 7. `match_opp_don` magnitude formula status

- **Engine-live:** registered at `formula.ts:73`, documented at `formula.ts:6`.
- **Unit-tested:** `shared/engine-v2/__tests__/handlers/readMagnitude.test.ts`, `shared/engine-v2/__tests__/snapshots/magnitude.snapshot.test.ts:50` — both exercise the formula directly.
- **Corpus-absent:** 0 references in `shared/data/cards.json` (2489 cards). Python AST walk confirmed across all `magnitude` fields in `clauses`, `continuous`, and `replacements`.
- **Sim observations (1000 games):** 0 invocations.

**Status: ACTIVE (engine), UNSHIPPED (corpus).** Not a sim sampling bias, not deprecated, not dead code — simply a magnitude formula no card uses yet.

---

## 8. Outstanding observation (carried forward, not in scope)

- **Cross-test pollution risk** between `mechanicInstrument-determinism.test.ts` and `playabilityTracker.test.ts` byte-identical test when vitest schedules them concurrently within the same worker. Cause: `installMechanicInstrumentation()` mutates the global `actionHandlers.get` / `costHandlers.get` / `targetResolvers.get` own-properties (public-method wrap mechanism approved in Phase 3). If a parallel test reads handlers mid-install, the wrap can leak.
- Solo execution of each file: 5/5 + 5/5 pass deterministically.
- Full-suite execution: intermittent flake of the byte-identical assertion (observed once, not reproduced consistently).
- Mitigation surface (NOT applied at Phase 7 close): annotate the mutating describe with `describe.concurrent(false)` or `.sequential`. Sim-layer-only when authorized.

---

## 9. Phase delivery index

| Phase | Output | Status |
|---|---|---|
| 3 — instrumentation | `mechanicInstrument.ts`, `cli-mechanic-frequency.ts`, `reports/mechanic-frequency-0.json` | CLOSED |
| 4 — distribution | `cli-mechanic-distribution.ts`, `reports/mechanic-distribution-0.md` | CLOSED |
| 5 — triage | `cli-mechanic-triage.ts`, `reports/mechanic-triage-0.md` | CLOSED |
| 6 — balance reconciliation | findings folded into Phase 7 + this summary | CLOSED |
| 7a — playability metrics | `playabilityTracker.ts`, `cli-playability.ts`, `reports/playability-0.{json,md}` (post-fix) + `playability-0.pre-concede-fix.{json,md}` (preserved) | CLOSED |
| 7b — Option B policy fix | `runner.ts:271-295` (sim-layer, adversarial branch only) | CLOSED |
| 7c — CONCEDE root cause | `concedeTrace.ts`, `reports/concede-rootcause-0.md` | CLOSED |
| 8 — R1/R2 remediation | NOT authorized at Phase 7 close | DEFERRED |

---

## 10. Constraint compliance (cumulative)

- **engine-v2/**: 0 changes across Phases 3–7
- **shared/data/cards.json**: 0 changes
- **Card-spec mutations**: 0
- **legality.ts / moveSelector.ts / adversarial.ts**: 0 changes
- **runner.ts**: 1 additive change at lines 271-295 (Option B adversarial-branch CONCEDE filter); 1 additive `totalTicks: number` field on `RunBatchSummary`
- **Test suite**: 728 → 740+ passing; 0 introduced regressions; 1 cross-test pollution risk surfaced but unresolved by mutual agreement
- **Determinism**: byte-identical at 8-game and 1000-game scales, verified via SHA-256 and JSON diff

---

End of consolidated summary. No further actions queued.
