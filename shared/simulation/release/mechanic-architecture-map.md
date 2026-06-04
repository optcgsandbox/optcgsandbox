# Mechanic Architecture Map

Release-facing diagrammatic mapping of engine-v2 primitive layers and their relationships. Derived from `shared/simulation/docs/mechanics-dead-vs-live.md`, `shared/simulation/docs/system-overview.md`, and `shared/simulation/reports/system-behavior-summary.md`. No new findings.

## 1. Primitive layer diagram

```
            cards.json (effectSpecV2)
                    │
        ┌───────────┼───────────┬────────────┐
        ▼           ▼           ▼            ▼
     ACTION      TARGET        COST        MAGNITUDE
   handlers   resolvers    handlers     (formula.ts)
   (82 reg)    (18 reg)      (27 reg)    (4 formulas)
        │           │           │            │
        ▼           ▼           ▼            ▼
   registry.get(kind)   registry.get(kind)   resolveMagnitude
   in EffectDispatcher  in EffectDispatcher  inline call
        │           │           │            │
        └───────────┴───────────┴────────────┘
                    │
                    ▼
                applyAction
                    │
                    ▼
               GameState'
```

Source files:
- Action handlers: `shared/engine-v2/registry/handlers/actions{,2,3}.ts`
- Target resolvers: `shared/engine-v2/registry/handlers/targets{,2}.ts`
- Cost handlers: `shared/engine-v2/registry/handlers/costs{,2}.ts`
- Magnitude formulas: `shared/engine-v2/registry/handlers/formula.ts`

## 2. Per-layer inventory snapshot (1000-game adversarial, seedBase=0)

| Layer | Registered | Observed | Truly dead | Wrapper-aliased | False-positive orphans |
|---|---:|---:|---:|---:|---:|
| Action | 82 | 59 | 5 | 5 outer/inner pairs | 1 (`deal_damage_opp`) |
| Cost | 27 | 18 | 5 | 0 | 0 |
| Target | 18 | 13 | 2 + 1 string-collision | 0 | 0 |
| Magnitude | 4 formulas | 3 | 1 unshipped (`match_opp_don`) | 0 | 0 |

Full per-kind counts: `shared/simulation/reports/mechanic-frequency-0.json`.

## 3. Alias wrapper system

Five action kinds are pure delegating wrappers around an inner kind. Both are registered; the outer is what `cards.json` references; the inner is engine-internal.

```
   cards.json kind          delegates to          where
   ──────────────────       ──────────────        ─────────────────────
   power_buff          ──▶  give_power            actions3.ts:68-69, 1142
   mill_self          ──▶   trash_top_of_deck     actions3.ts:71-72, 1143
   mill_opp           ──▶   mill                  actions3.ts:74-75, 1144
   set_active         ──▶   active_target         actions3.ts:77-78, 1145
   opp_discard_       ──▶   discard_opp_hand      actions3.ts:80-81, 1146
   from_hand
```

Each card-level invocation produces TWO `actionHandlers.get(kind)` lookups (outer + inner). The frequency telemetry records both. Inner kinds have 0 corpus references by definition — the "0 corpus / high sim count" pattern in `mechanic-frequency-0.json` is a wrapper signature, not a bug.

## 4. Truly-dead handlers

```
ACTION  end_of_turn_trash               actions2.ts:538
ACTION  give_next_play_cost_modifier    actions2.ts:537
ACTION  return_to_hand_from_field       actions2.ts:540
ACTION  shuffle_deck                    actions2.ts:533
ACTION  trash_opp_field                 actions2.ts:541

COST    restSource                      costs.ts:150
COST    returnAttachedDon               costs.ts:153
COST    returnOwnDon                    costs.ts:154
COST    trashFromHand                   costs.ts:151
COST    trashFromTrash                  costs.ts:152

TARGET  opp_hand_card                   targets.ts:198
TARGET  top_of_opp_deck                 targets.ts:201
```

All have:
- 0 corpus references (Python AST walk over `effectSpecV2`)
- 0 internal handler invocations (grep over all engine-v2 handler files)
- 0 test-suite references (excluding fixture enumerations)

## 5. False positive — `deal_damage_opp`

Triage CLI scanner classified this as orphan; verified ref count is **1**.

```
   OP06-116 (Reject)
   └── effectSpecV2.clauses[0]
       └── action.kind = "choose_one"
           ├── options[0].action.kind = "removal_ko"
           └── options[1].action.kind = "chained_actions"
               └── actions[0].kind = "deal_damage_opp"  ← here
               └── actions[1].kind = "life_to_hand"
```

Scanner gap at `cli-mechanic-triage.ts:107-127` `collectFromActionNode`: walks `options[]` as action nodes themselves rather than clause wrappers. Options items have their own `action` field that the scanner misses.

## 6. String-collision caveat — `top_of_deck`

```
   targets.ts:200  ←  resolver "top_of_deck"  ←  0 cards reference as target.kind
                                                  ┌─ truly dead AS RESOLVER

   cards.json string "top_of_deck"   ←  45 references as `from:` parameter
                                       on action objects (e.g., add_to_own_life_top)
                                                  └─ live AS PARAMETER
```

Same name, two independent surfaces. Removing the resolver does not affect the parameter usage. Any future removal must re-grep `target.kind === "top_of_deck"` to confirm separation.

## 7. `match_opp_don` — active formula, unshipped in corpus

```
   formula.ts:73                                 ← engine handler registered
   formula.ts:6                                  ← documented
   readMagnitude.test.ts                         ← unit-tested
   magnitude.snapshot.test.ts:50                 ← snapshot-tested
   cards.json                                    ← 0 references in 2489 cards
   1000-game sim                                 ← 0 invocations
```

Status: **ACTIVE (engine) / UNSHIPPED (corpus).** Not deprecated. Not a sim sampling bias. Future card design that needs "magnitude scales with opp DON count" has a handler ready.

## 8. Effect dispatcher call sites

Every handler invocation in the engine flows through one of these public lookups:

```
   actionHandlers.get(kind)(state, ctx, action, targets)
       ↓ EffectDispatcher.ts:234
       ↓ PhaseScheduler.ts:246
       ↓ choiceResolve.ts:259
       ↓ ReplacementManager.ts:168
       ↓ actions2.ts:143 (sequence sub-action)
       ↓ actions3.ts:69, 72, 75, 78, 81, 1063 (alias delegations + recursion)

   targetResolvers.get(kind)(state, ctx, target)
       ↓ EffectDispatcher.ts:139
       ↓ choiceResolve.ts:255
       ↓ ReplacementManager.ts:165
       ↓ actions2.ts:138 (sequence sub-target)

   costHandlers.get(key).pay(state, ctx, cost)
       ↓ CostPayer.ts:23 (.canPay walk)
       ↓ CostPayer.ts:39 (.pay walk)
       ↓ EffectDispatcher.ts:195, 207

   resolveMagnitude(state, ctx, m)   (free function, immutable export)
       ↓ formula.ts:62-89
       ↓ called inline by action handlers reading action.magnitude
```

The mechanic instrumentation (`shared/simulation/mechanicInstrument.ts`) wraps the three `.get()` methods on each registry's instance — a public-method runtime shadow, not a prototype mutation. `resolveMagnitude` cannot be wrapped (immutable ESM const export), so magnitude counting is action-level approximate (introspection of `action.magnitude.kind` at action wrapper time).

## 9. cards.json effectSpecV2 → primitive layer mapping

```
   card.effectSpecV2
     ├── clauses[]            (triggered effects)
     │     └── action / target / cost / condition / trigger
     ├── continuous[]         (folded each refold tick)
     │     └── action / target / condition
     └── replacements[]       (would-be-X replacement effects)
           └── action / target / condition / trigger

   Each {action, target, cost} object has a `.kind` (or cost has key strings)
   that must match a registered handler name. Engine boot-time
   validateCardsAgainstRegistry asserts no card carries an unregistered
   primitive — fails LOUDLY rather than silently no-op'ing.
```

Boot validator: `shared/engine-v2/registry/validate.ts`.

## 10. Source-of-truth references

- Inventory + counts: `shared/simulation/docs/mechanics-dead-vs-live.md`
- Raw frequency data: `shared/simulation/reports/mechanic-frequency-0.json`
- Layered distribution: `shared/simulation/reports/mechanic-distribution-0.md`
- Triage classification: `shared/simulation/reports/mechanic-triage-0.md`
- Engine contracts: `shared/engine-v2/docs/mechanic-contracts.md`
