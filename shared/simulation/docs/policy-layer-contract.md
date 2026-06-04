# Policy Layer Contract

Dev handoff doc. Defines the boundary between **legality** (what is allowed), **selection** (what is chosen), and **policy** (the rules a chooser follows). Authoritative as of Phase 7 close.

## 1. Layer responsibilities

### Legality layer — `shared/engine-v2/rules/legality.ts`

- Single source of truth for "what can `player` do right now?"
- Returns the canonical legal-action set for any `(state, player)` pair via `getLegalActions(state, player): Action[]` (`legality.ts:42`).
- Includes `CONCEDE` as a universal fallback action across **every** phase branch — see lines 48, 49, 53, 57, 63, 64, 69-74, 80-87, 93-102, 108-, and beyond.
- CONCEDE inclusion is **intentional**. It exists as a UI-affordance for human play and as a safety termination path for the engine state machine.
- **Never modified by sim-layer code.**

### Selector layer — `shared/simulation/moveSelector.ts`

- Thin wrapper over `getLegalActions`. Routes the queried actor per the dispatch convention mirrored from `src/store/game.ts:343-348`.
- Per-phase actor selection (`moveSelector.ts:60-83` `computeActor`):
  - `pending !== null` → `pending.<kind>.controller`
  - `block_window` / `counter_window` → `OTHER_PLAYER[state.activePlayer]`
  - Else → `state.activePlayer`
- Special case: `dice_roll` queries BOTH players and unions results, tagging each move with its source actor.
- **Mirrors legality verbatim; does not filter, prioritize, or rewrite the move set.** Selector is NOT a policy boundary.

### Weighting layer — `shared/simulation/adversarial.ts`

- Pure weighting engine for adversarial mode (`pickAdversarial`, `adversarial.ts:164`).
- Computes per-move scores from `(base × interaction × edge)` factors (`weightMove`, `adversarial.ts:140`).
- Picks proportionally via deterministic quantization (`Math.max(1, floor(weight × 1000))`, `adversarial.ts:173`).
- **Stateless and policy-agnostic.** It does NOT inspect move type for legitimacy; it scores everything passed to it.
- Knows nothing about CONCEDE filtering, suicide attacks, or any other policy rule.

### Policy layer — the consumer of legality

Every consumer of `getLegalActions` operates at the policy layer. There are FOUR known consumers in the codebase:

| Consumer | File | Policy stance on CONCEDE |
|---|---|---|
| Easy AI | `EasyAi.ts:44-45` | filter out; if empty, fall back to `END_TURN` |
| Medium AI | `MediumAi.ts:53` | filter out |
| Hard AI | `HardAi.ts:33` | filter out |
| Simulator (adversarial branch) | `runner.ts:271-295` | filter out; if empty, fall back to original move set (preserve dispatch) |

## 2. CONCEDE canonical rule

> **The simulator's policy layer NEVER voluntarily selects CONCEDE when at least one non-CONCEDE legal move exists.**

- This is a **policy** rule, not a legality rule. The engine continues to emit CONCEDE in every legal-move set per the legality contract.
- Each policy consumer applies the rule independently at its own boundary. There is no shared filter — each consumer holds its own copy of the convention.
- Required at the policy boundary for: AI tiers (Easy/Medium/Hard) and the simulator's adversarial branch.
- NOT applied at: legality.ts, moveSelector.ts, adversarial.ts, or anywhere else inside the weighting/dispatching machinery.

### Empty-fallback semantics

- If the CONCEDE filter would leave **zero** moves, the consumer's behavior depends on its role:
  - AI consumers fall back to `END_TURN` (`EasyAi.ts:45`).
  - Simulator's adversarial branch falls back to the original (CONCEDE-only) move set so the runner has something to dispatch (`runner.ts:282-287`).
- This is a deliberate divergence: the simulator's job is to drive games to terminal states; the AI's job is to make a turn move.

### Why filter at the policy layer (not legality, not moveSelector)

- **Single Responsibility:** legality enumerates; selectors route; weighting scores; policy decides. Each layer has one job.
- **Avoid invariant churn:** changing legality.ts would affect every downstream consumer (including the UI). Filtering at the policy boundary keeps the contract local to the consumer that wants it.
- **Auditability:** `grep -n "filter.*CONCEDE"` over the codebase surfaces all four policy consumers in one read.
- **Preserves `Math.max(1, …)` weighting invariant** at `adversarial.ts:173` — the weighting engine continues to give every legal move nonzero pickability.

## 3. Equivalence table across consumers

| Property | EasyAi | MediumAi | HardAi | Simulator (adversarial) |
|---|---|---|---|---|
| Filter location | `EasyAi.ts:44` | `MediumAi.ts:53` | `HardAi.ts:33` | `runner.ts:271-295` |
| Filter expression | `legal.filter(a => a.type !== 'CONCEDE')` | identical | identical | identical (per-move map preserves actor index) |
| Empty fallback | `{type: 'END_TURN'}` | (no explicit fallback documented) | (no explicit fallback documented) | original `moves[]` (incl. CONCEDE) |
| Layer touched by filter | AI module | AI module | AI module | sim runner |
| `legality.ts` touched? | no | no | no | no |
| `moveSelector.ts` touched? | no | no | no | no |
| `adversarial.ts` touched? | n/a | n/a | n/a | no |

## 4. Determinism guarantee at the policy layer

- The simulator's CONCEDE filter does not consume RNG.
- `pickAdversarial` is invoked with a filtered move array, but `rng.fork('tick:${tick}')` is keyed by tick string, not RNG state, so per-tick RNG remains deterministic regardless of policy-filter outcomes.
- Same `seedBase` + same code path → byte-identical artifacts at scale. Verified at 1000 games via SHA-256 hash equality (`shared/simulation/reports/system-behavior-summary.md` §4).

## 5. Non-policy behaviors out of scope

The following are **not** policy concerns and are not subject to the CONCEDE filter rule:

- Engine reducers (`shared/engine-v2/reducers/`) — pure state transitions.
- Phase scheduling (`shared/engine-v2/phases/`) — phase advancement is engine-internal.
- Card effects (`shared/engine-v2/registry/handlers/`) — operate on resolved targets, never receive the raw legal-move list.
- noopExclude (`runner.ts:251-258, 302-305`) — runner-internal fingerprint cache, sits below the policy layer. See `system-overview.md` §4 for the architectural artifact this creates in `dice_roll` phase.
- Trace recording (`shared/simulation/trace.ts`) — observational, not decisional.

## 6. Adding a new policy consumer

If a future system (new AI tier, replay validator, hint engine) becomes a fifth consumer of `getLegalActions`:

1. The consumer is responsible for applying the CONCEDE canonical rule itself.
2. Place the filter at the consumer's own boundary — not in legality, not in moveSelector, not in adversarial.
3. Decide the empty-fallback (END_TURN, original set, or domain-specific) based on the consumer's role.
4. Add a row to §3 above to keep the equivalence inventory complete.

## 7. Cross-references

- Mechanism narrative + Option B history: `shared/simulation/reports/system-behavior-summary.md`
- Pre-fix vs post-fix delta: `shared/simulation/reports/playability-0.{json,md}` + `playability-0.pre-concede-fix.{json,md}`
- Root-cause trace for residual CONCEDE: `shared/simulation/reports/concede-rootcause-0.md`
- Lifecycle overview: `shared/simulation/docs/system-overview.md`
- Live vs dead inventory: `shared/simulation/docs/mechanics-dead-vs-live.md`
