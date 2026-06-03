# Phase 5 — Cross-Card Interaction + Property + Soak + Golden Snapshot

**Read this in full before starting any cross-card work.** This phase covers the bugs that Phase 4 per-card audits CANNOT catch: card-A-vs-card-B interactions, stochastic-state corruption, regressions against V1 baseline.

**Prerequisite:** Phase 4 (per-card semantic tests for all 2489 cards) must be substantially complete — at minimum, the first ~250 cards audit-clean — before starting Phase 5. Otherwise interaction tests fail for reasons unrelated to interactions.

---

## Scope

Four test layers in order:

1. **§5.3 Property tests** (P1-P5) — random-state invariants
2. **§5.6 Cross-card interaction matrix** — 50 paired scenarios
3. **§5.7 V1↔V2 golden snapshot** — 50 fixed seeded games, equivalence modulo documented divergences
4. **§5.4 AI-vs-AI soak** — 1000 random games, terminate without throws / invariant violations

References: `ENGINE_V2_DEFINITIVE_PLAN.md` §5.3 (line 1072), §5.4 (line 1088), §5.6 (line 1102), §5.7 (line 1113), §8.4 (line 1312).

---

## Layer A — §5.3 Property tests

**File:** `shared/engine-v2/__tests__/properties/*.test.ts` (one file per property)

5 properties, each runs ~100 randomized trials:

### P1 — Continuous idempotence
- For any reachable state `s`: `refold(refold(s))` is structurally equal to `refold(s)`.
- Generator: random board states with 1-5 continuous-bearing cards per side (sample from `cards.json` where `effectSpecV2.continuous?.length > 0`).
- Implementation: deep-equality check on the two states' `instances` snapshots.

### P2 — DON conservation
- For any state `s` and any legal action `a`, after `applyAction(s, player, a)`:
  - `players[X].donDeck.length + donCostArea.length + donRested.length + Σ(inst.attachedDon.length + inst.attachedDonRested.length for inst in instances where inst.controller===X) === 10` for each player.
- Catches DON leak / double-count bugs.

### P3 — Field-size cap
- For any state `s` and any legal action `a` (sampled from `getLegalActions`):
  - After `applyAction`, `players[X].field.length <= 5` for each player.

### P4 — Instance count stable
- `Object.keys(state.instances).length` is invariant across legal actions.
- No orphans, no duplicates.

### P5 — Replay determinism
- `applyAction(s, p, a)` is deterministic given `(s, p, a, s.seed)`.
- 1000 trials: serialize state → apply action twice from same seed → assert identical.

**Workflow per property:**
1. Define generator (random state with constraints).
2. Define invariant (the assertion).
3. Run ~100 trials.
4. On counter-example: minimize the state, log to `BUGS_FOUND.md`, fix the engine, re-run until 0 failures across 1000 trials.

**Budget:** 5 × 8h = 40h (Plan §8.4 line 1316).

---

## Layer B — §5.6 Cross-card interaction matrix

**File:** `shared/engine-v2/__tests__/interactions/<scenario_id>.test.ts` (one file per scenario)

50 paired or triple-card scenarios. Each scenario constructs a specific game state, dispatches a specific action sequence, asserts the printed outcome of BOTH cards' effects.

### Required scenarios (anchor list — extend as bugs surface)

Per Plan §5.6 line 1105-1111:
1. **EB02-030 armed replacement vs EB01-008 KO replacement** — priority. Which replacement fires when both apply to the same would-be KO event.
2. **EB01-061 base power override vs continuous power buff** — does the +X continuous stack on top of the "becomes Y base" override, or is it suppressed?
3. **EB01-020 Chambres bounce + play_for_free with color exclude** — `lastBouncedColors` populated, next play filtered by `colorMustDifferFromLastBounced`.
4. **Continuous-granted blocker + opp attack target selection** — does a temp Blocker grant honor the legality enumeration mid-attack?
5. **Bounce + replay → OPT slot reopens** — character bounces back to hand, replays this turn; do its OPT-marked clauses reset?
6. **DON detach across removal_ko cascade** — chain of KOs; DON returns to `donRested` per CR §6-2-3.

Plus 44 additional scenarios — enumerate as Phase 4 surfaces card-pair questions, OR pre-build from Plan §5.6 and cards that combine common primitives:
- `removal_ko` + `would_be_ko` replacement (cost match / mismatch)
- `would_be_removed` + `removal_bounce` (replacement fires once)
- `power_buff this_battle` + counter event boost (sum into pendingAttack.counterBoost)
- `give_don_to_target` + `attach_don` legality
- `play_for_free` + `summoning_sick` keyword grant
- `at_end_of_turn_self` + `at_end_of_turn` (broadcast order)
- `aura_*` + `card leaves field` (target's bonus cleared on refold)
- `set_base_power` + `power_buff` (additive or floor?)
- `if_attached_don_min` + DON detached mid-condition-check
- Multiple replacements with overlapping triggers (LIFO order verification)

### Workflow per scenario
1. **Construct the state** using `buildState` from `_fixtures.ts` — place Card A and Card B in the scenario-specific positions.
2. **Dispatch the action sequence** through the highest-level engine entry (e.g., `applyAction` for the attack; or `EffectDispatcher.dispatch` for clause triggers).
3. **Assert printed outcomes for BOTH cards** — Card A's effect resolved correctly AND Card B's effect resolved correctly AND interaction order matches CR.
4. **Run `npx vitest run` for the file.**
5. **On failure:** investigate per the same no-shortcuts protocol from `TASK_PHASE4_PER_CARD.md` Step 7.
6. **Audit** via independent Code Reviewer sub-agent.
7. **Move to next scenario.**

**Budget:** 50 × 4h = 200h (Plan §8.4 line 1315).

---

## Layer C — §5.7 V1↔V2 golden snapshot

**File:** `shared/engine-v2/__tests__/golden/<seed>.test.ts` (50 files, one per fixed seed)
**Snapshot data:** `golden-snapshots/v1-states-<seed>.json`

### Setup
1. Run V1 engine on 50 fixed seeds. For each game, capture:
   - Initial state (post-mulligan).
   - Every action dispatched (decklist of actions per turn).
   - State after each action.
2. Store snapshots in `golden-snapshots/`.

### Per-snapshot workflow
1. Load V1 snapshot for seed `S`.
2. Run V2 engine: starting from V1's initial state, replay V1's action sequence.
3. After each replayed action, compare V2's state to V1's snapshot.
4. **Allowed divergences** — documented in `golden-snapshots/divergences.md`:
   - Bug-fix divergences from Plan §0 cert-finding list (e.g., V1's `add_to_opp_life_top` crash → V2 succeeds; documented).
   - Phase pacing changes (V2 yields at `phase='refresh'`; V1 chained).
   - Schema differences (V2 `attachedDonRested` exists; V1 didn't).
5. **Any UNDOCUMENTED divergence** = bug. Log to `BUGS_FOUND.md`, fix engine, re-run.

**Budget:** 40h (Plan §8.4 line 1317) — covers infra + 50 fixture captures.

---

## Layer D — §5.4 AI-vs-AI soak

**File:** `shared/engine-v2/__tests__/soak.test.ts`

### Setup
- 1000 games per run, random seed per game.
- Random leader sampled from the cards in `cards.json` where `kind === 'leader'`.
- Random deck: 50 random characters matching the leader's color.
- HardAi vs HardAi.

### Pass criteria
- Every game terminates within 200 turns (lethal / `deck_out` / `concede` / cap).
- Zero thrown errors.
- Zero invariant violations during run (assertInvariants checked after every action).

### Workflow
1. Seed RNG, build random state.
2. Loop: AI picks action → applyAction → assertInvariants → check termination.
3. On error/violation: record `(seed, turn, action, state-at-error)` to `soak-failures.json`.
4. After 1000 games: report failures.
5. **For each failure:** minimize repro, log to `BUGS_FOUND.md`, fix engine, re-run until 0 failures across 1000 games.

Runs on CI nightly + on PR for refactors touching core state.

**Budget:** 24h harness + 1.5mo calendar for 1000-game-hour observation (Plan §8.4 line 1318 + §8.5 line 1326).

---

## Stop conditions

Phase 5 complete when ALL of:
- 5 properties × 1000 trials green
- 50 interaction scenarios audit-clean
- 50 golden snapshots equal modulo documented divergences
- 1000 soak games terminate cleanly across 3 consecutive runs

---

## Order of operations

1. **Property tests first** (40h) — they catch the simplest invariant bugs and unblock interaction tests.
2. **Golden snapshot harness** in parallel (40h) — gives regression coverage during the rest of the work.
3. **Interaction matrix** (200h) — slowest, most thinking-intensive.
4. **AI soak last** (24h + calendar) — runs continuously once harness exists, surfaces residual stochastic bugs.

---

## Connection to Phase 4

- Phase 4 surfaces cards-individually-broken. Phase 5 surfaces cards-together-broken.
- Bugs found in Phase 5 may require Phase 4 re-audit of the affected cards (their individual semantics may have been wrong all along, just masked).
- Both phases log to the same `BUGS_FOUND.md`.

---

## Why this exists

Owner asked "what will cover the card A + B issue" after the Phase 4 doc was written for individual-card audits. This document specifies the test layers that cover A+B interactions, A+B+C stochastic combinations, V1↔V2 regressions, and engine invariants under random play. Phase 4 alone is necessary but not sufficient for "every card plays correctly in every game state."
