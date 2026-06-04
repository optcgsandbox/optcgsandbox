# Mechanics — Dead vs Live Inventory

Dev handoff doc. Authoritative as of Phase 7 close. All counts and classifications were verified via direct grep + Python AST walk over `shared/data/cards.json` and internal-caller grep over `shared/engine-v2/registry/handlers/`.

## 1. Confirmed truly-dead handlers

### Action handlers (5)

| Kind | Registration | Corpus refs | Internal callers | Verdict |
|---|---|---:|---:|---|
| `end_of_turn_trash` | `actions2.ts:538` | 0 | 0 | dead |
| `give_next_play_cost_modifier` | `actions2.ts:537` | 0 | 0 | dead |
| `return_to_hand_from_field` | `actions2.ts:540` | 0 | 0 | dead |
| `shuffle_deck` | `actions2.ts:533` | 0 | 0 | dead |
| `trash_opp_field` | `actions2.ts:541` | 0 | 0 | dead |

### Cost keys (5)

| Key | Registration | Corpus refs | Internal callers | Verdict |
|---|---|---:|---:|---|
| `restSource` | `costs.ts:150` | 0 | 0 | dead |
| `returnAttachedDon` | `costs.ts:153` | 0 | 0 | dead |
| `returnOwnDon` | `costs.ts:154` | 0 | 0 | dead |
| `trashFromHand` | `costs.ts:151` | 0 | 0 | dead |
| `trashFromTrash` | `costs.ts:152` | 0 | 0 | dead |

Some of these keys appear only in `corpus-partial-classify.test.ts` as part of a test fixture enumeration. No production card uses them.

### Target resolvers (2)

| Kind | Registration | `target.kind` corpus refs | Verdict |
|---|---|---:|---|
| `opp_hand_card` | `targets.ts:198` | 0 | dead as resolver |
| `top_of_opp_deck` | `targets.ts:201` | 0 | dead as resolver |

## 2. False positives — triage CLI scanner gap

### `deal_damage_opp`

- Triage classification (Phase 5): orphan_primitive (0 corpus refs)
- Verified ref count: **1**
- Location: `OP06-116` clause structure:
  - `effectSpecV2.clauses[0].action.kind === 'choose_one'`
  - `.options[1].action.kind === 'chained_actions'`
  - `.options[1].action.actions[0].kind === 'deal_damage_opp'`
- Scanner gap: `cli-mechanic-triage.ts:107-127` `collectFromActionNode` walks `options[]` as if each item were an action node. Options are actually clause-wrappers with their own `action` field. The wrapped action's `.kind` is never recorded.
- Impact: any action kind only reachable via `choose_one.options[].action` (or `.options[].action.actions[]` for `chained_actions`) may be similarly under-counted by the triage CLI.
- Spot-checked: only `deal_damage_opp` surfaces this gap among the Phase 5 orphan list. Other true-dead handlers are confirmed at zero refs through alternate paths.

## 3. String-collision caveat — `top_of_deck`

- Target resolver `top_of_deck` is registered at `targets.ts:200`.
- **0** cards use `target.kind === 'top_of_deck'` in `effectSpecV2` (Python AST walk verified).
- BUT the literal string `"top_of_deck"` appears **45 times** in `cards.json` as a `from:` PARAMETER on action objects (e.g., `add_to_own_life_top.from === 'top_of_deck'`).
- Resolver and parameter share a name but live on independent surfaces.
- **Implication for any future removal:** the resolver can be deleted without touching the parameter usage. Verify with a `target.kind: "top_of_deck"` re-grep before removal.

## 4. `match_opp_don` — engine-live, corpus-absent

- Engine handler: `formula.ts:73`
- Engine docs: `formula.ts:6`
- Unit tests:
  - `shared/engine-v2/__tests__/handlers/readMagnitude.test.ts`
  - `shared/engine-v2/__tests__/snapshots/magnitude.snapshot.test.ts:50`
- Corpus references: **0** across 2489 cards (Python AST walk over every `magnitude` field in `clauses`, `continuous`, `replacements`)
- Sim observations (1000 games): **0**

### Status interpretation

- NOT deprecated — registered and unit-tested
- NOT a sim sampling bias — would remain 0 with any number of additional games because no card carries the formula
- Classification: **ACTIVE (engine) / UNSHIPPED (corpus)**
- Future card design that needs "magnitude scales with opponent DON count" already has a handler ready

## 5. Alias-wrapped actions — instrumentation double-counts

All five wrappers live in `actions3.ts` and delegate via `actionHandlers.get('...inner')(state, ctx, action, targets)`.

| Outer (cards.json kind) | Inner (engine-only) | Outer registration | Inner reference |
|---|---|---|---|
| `power_buff` | `give_power` | `actions3.ts:1142` | `actions3.ts:68-69` |
| `mill_self` | `trash_top_of_deck` | `actions3.ts:1143` | `actions3.ts:71-72` |
| `mill_opp` | `mill` | `actions3.ts:1144` | `actions3.ts:74-75` |
| `set_active` | `active_target` | `actions3.ts:1145` | `actions3.ts:77-78` |
| `opp_discard_from_hand` | `discard_opp_hand` | `actions3.ts:1146` | `actions3.ts:80-81` |

### Instrumentation consequence

- Phase 3 frequency telemetry (`mechanicInstrument.ts`) counts every `actionHandlers.get(kind)` lookup.
- Wrapper invocation produces TWO counts per card-level action: one outer + one inner.
- Cleanest example: 1000-game batch records `power_buff = 423` and `give_power = 423` (exactly equal by construction).
- Inner names have 0 corpus refs by definition. The "0 corpus refs but high sim count" pattern in `mechanic-frequency-0.json` is a wrapper signature, not a bug.

### Reading the telemetry correctly

- Treat outer/inner pairs as a single logical action for card-level frequency analysis.
- The instrumentation itself is correct — every handler lookup IS counted. The interpretation must account for the wrapper layer.

## 6. Counts summary (post-verification)

| Layer | Registered | Observed (1000g) | Truly dead | False-positive orphans | Wrapper-aliased |
|---|---:|---:|---:|---:|---:|
| Action | 82 | 59 | 5 | 1 (`deal_damage_opp`) | 5 outer (10 total handlers) |
| Cost | 27 | 18 | 5 | 0 detected | 0 |
| Target | 18 | 13 | 2 (+ 1 string-collision) | 0 detected | 0 |
| Magnitude | — | 3 | 1 unshipped (`match_opp_don`) | 0 detected | 0 |

## 7. Cross-references

- `shared/simulation/reports/mechanic-frequency-0.json` — raw counts
- `shared/simulation/reports/mechanic-distribution-0.md` — distribution analysis
- `shared/simulation/reports/mechanic-triage-0.md` — initial triage (subject to the scanner gap in §2)
- `shared/simulation/reports/system-behavior-summary.md` — consolidated narrative
