# Card Verification Plan

Short, deterministic, gameplay-representative tests per mechanic family.
Replaces long Playwright soak which is unreliable in this environment
(see Phase 7 isolation: page closes around T5-T6 under healthy engine
state). Each family test runs <3 min and isolates one effect category.

---

## 1. Inventory — mechanic families

Families ordered by combat / UI relevance for downstream player experience.

| # | Family | Engine surface | Notes |
|---:|---|---|---|
| 1 | **Power boost** | `aura_power_buff`, `power_buff` | DISPLAYED power must match engine; combat compares power |
| 2 | **Power reduction** | `power_buff` magnitude<0 | Symmetric inverse of #1 |
| 3 | **Removal / KO** | `ko_target`, `trash_target` | Field count decrements |
| 4 | **Bounce / bottom-deck / trash routing** | `bounce_*`, `bottom_of_deck_*` | Card destinations |
| 5 | **Search / peek** | `searcher_peek`, `peek_and_reorder_*` | NO_UI_EXPECTED — engine deterministic |
| 6 | **Discard from hand** | `discard_from_hand`, `opp_discard_from_hand` | NO_UI_EXPECTED for card-effect; system-discard auto-resolves |
| 7 | **Draw** | `draw` | Hand size +N |
| 8 | **DON manipulation** | `attach_don_*`, `add_don_*`, `set_active_don` | DON cost area changes |
| 9 | **Cost reduction** | `cost_reduce`, `nextPlayCostModifier` | Hand-card play cost diff |
| 10 | **Life manipulation** | `add_to_own_life_top`, `flipLife`, `play_self_from_life` | Life array changes |
| 11 | **on_play trigger** | `trigger: 'on_play'` | Already covered in Phase 3+5 |
| 12 | **activate_main trigger** | `trigger: 'activate_main'` | Already covered in Phase 4 |
| 13 | **when_attacking trigger** | `trigger: 'when_attacking'` | Already covered in Phase 5 |
| 14 | **on_ko trigger** | `trigger: 'on_ko'` | Already covered in Phase 5 |
| 15 | **trigger from life** | `trigger: 'trigger'` | Already covered in Phase 3+5 |
| 16 | **Counter event** | `[Counter]` events | Engine-deterministic; legality scoped to counter_window |
| 17 | **Blocker** | keyword `blocker` | Already covered in Phase 2 |
| 18 | **Conditional effects** | `condition.type` resolver | Engine unit tests cover; UI checks via clause firing |
| 19 | **Leader-gated effects** | `if_owned_leader_name`, `if_leader_has_trait/color` | Already covered as NO_UI_EXPECTED in Phase 4 |
| 20 | **Multi-turn effects** | `multi_turn_setup` riskFlag | Already covered in Phase 5 |
| 21 | **Passive / static** | `effectSpecV2.continuous[]` | Aura recompute via ContinuousManager |
| 22 | **Target selection** | `attack_target_pick` pending | NO_UI_EXPECTED in V0 per scenarioFactory comment |

---

## 2. Per-family spec template

For each family, define:

- **Representative cards** — 1 anchor card with clean, observable effect
- **Required setup** — leader, hand, field, DON, life
- **UI actions** — exact button sequence in order
- **Expected state diff** — before/after values for the affected fields
- **Expected visual assertion** — DOM aria-label changes if the family touches displayed values
- **Prompt UI expectation** — render expected, or NO_UI_EXPECTED with source citation
- **Risk level** — High / Medium / Low based on coverage gaps
- **Estimated card count** — for Stage C planning

---

## 3. Test shape constraints

Each test:
- Bootstraps via existing `PlayerDriver` (≤30s)
- Seeds minimal required state via `window.__store` mutation
- Performs ≤5 UI clicks
- Asserts exactly one observable state diff
- Runs under 3 min
- Fails on: pageerror, InvariantError, missing required button, stuck pending
- No `expect.poll` loops longer than 60s
- No long AI-turn waits (test the EFFECT, not the AI behavior)

---

## 4. Stages

| Stage | Scope | Cards | Acceptance |
|---|---|---:|---|
| **A** | 1 representative card per family | 22 | All 22 PASS |
| **B** | 5-10 cards per high-risk family | ~100 | ≥90% PASS per family |
| **C** | All cards in each family via generated scenarios | ~2500 | Per-family PASS rates reported |
| **D** | Final aggregate corpus report | 2500 | Classification breakdown |

---

## 5. Failure classification (mutually exclusive)

| Code | Meaning |
|---|---|
| **PRODUCT_BUG** | Effect doesn't fire OR fires with wrong magnitude OR DOM displays wrong value |
| **HARNESS_BUG** | Test setup wrong; engine behavior is correct |
| **SCENARIO_AUTHORING_GAP** | No scenario yet exists for this card's required setup |
| **NO_UI_EXPECTED** | Engine deterministic; no UI prompt mounts (cite source) |
| **NOT_IMPLEMENTED** | Engine has no handler for this primitive |
| **UNSUPPORTED_CARD_DATA** | effectSpecV2 missing or malformed |

---

## 6. Implementation order

### First 3 families (Stage A)

1. **Power boost** — chosen per owner directive. Touches displayed power AND combat correctness.
2. **Power reduction** — natural pair; same machinery, opposite sign.
3. **Draw** — simplest pure state-diff: hand size +N. Validates the seeded-leader + activate flow end-to-end before more complex tests.

After family 1+2+3 PASS, expand to families 3-6 (Removal, Bounce, Search, Discard).

---

## First test file to create

**`e2e/family-power-boost.spec.ts`** — Stage A coverage for the Power Boost family.

### Anchor card
**Roronoa Zoro OP01-001** (the default A leader) has the continuous effect `[DON!! x1] [Your Turn] All of your Characters gain +1000 power`. Already in the default deck. Easy to test.

### Test plan (single test, <2 min)
1. Bootstrap to A's main phase
2. Seed one synthetic A-side character on field with base power 1000 (no other effects)
3. Read DOM aria-label power BEFORE attaching DON to leader
4. Attach 1 DON from cost area to leader instance
5. Read DOM aria-label power AFTER
6. Assert: displayed power increased by exactly 1000

### Success criteria for first family

| # | Criterion |
|---|---|
| 1 | Test completes in <2 min |
| 2 | DOM aria-label for the seeded character shows the +1000 buffed power AFTER DON attach |
| 3 | DOM aria-label shows base power BEFORE DON attach (control) |
| 4 | Engine state aura recomputation fires (history event `AURA_APPLIED` or equivalent) |
| 5 | Zero pageerrors, zero InvariantErrors |
| 6 | No stuck pending state |
| 7 | Test continues to also seed an OPP character and confirm OPP power is **unchanged** by A's +1000 leader aura (filter scope correctness) |

If all 7 pass, Power Boost family Stage A is GREEN. Then expand to Stage B (5-10 more power-buff cards) for the same family before moving to Power Reduction.

---

## What NOT to do

- No 20-match soak.
- No 5-match soak.
- No long single-page Playwright sessions.
- No engine, UI, card-data, or scenarioFactory mods unless a Stage-A test surfaces a PRODUCT_BUG.
