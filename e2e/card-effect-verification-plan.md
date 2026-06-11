# Card Effect Verification Plan

Roadmap to verify every card effect by mechanic family, then scale to
card-by-card coverage. Replaces long Playwright soak (unreliable —
page-close around T5–T6 confirmed Chromium/Playwright infra issue, see
`e2e/page-close-repro.spec.ts`). UI Interaction Correctness now fully
representative-verified after CardArt power-display fix (commit pending,
see STEP 1 report).

All counts below were measured from `shared/data/cards.json` (2,489
cards: 128 leader / 1,943 character / 374 event / 44 stage) by tallying
each card's `effectSpecV2.clauses[].trigger`, `.action.kind`, `.target`,
and `.condition` plus `keywords[]`. A card is counted in every family
it touches. Anchor cards are the first OP01 match for that family;
fallback to first matching card when no OP01 exists.

---

## 1. Family inventory

| Family | Card count | Engine surface (action.kind / trigger / keyword) | Anchor card | Required setup | UI actions | Engine assertion | UI assertion | Prompt | Risk | Priority |
|---|---:|---|---|---|---|---|---|---|---|---|
| **power_boost** | 308 | `power_buff` (mag ≥ 0), `aura_power_buff` | OP01-026 Gum-Gum Fire-Fist | A main, 1 own char base 1000, hand has anchor | play anchor | target char `powerModifierOneShot` += mag | char aria-label `power X+mag` | NO_UI_EXPECTED for self-target | HIGH | P0 |
| **power_reduction** | 110 | `power_buff` (mag < 0) | OP01-006 Otama | A main, 1 opp char base 2000, hand has anchor | play anchor → pick opp char | opp char `powerModifierOneShot` −= mag | opp char aria-label decremented | choose_one if multi-target | HIGH | P0 |
| **counter (event)** | 173 | `kind: event` with `[Counter]` in effectText | OP01-091 (per-set) | B is attacking A leader (counter_window), event in A hand | click counter event button during counter prompt | event resolves; B attacker power-vs-defender check uses +counter | A leader aria-label shows +counter during window | counter_window pending kind | HIGH | P0 |
| **counter_window (trigger)** | 64 | `trigger: on_block` or `on_opp_attack` | EB01-002 Izo | B attack, A char w/ on_block effect on field | observe auto-resolution | trigger fires before damage | A char power +N or attacker −N | NO_UI_EXPECTED unless target choice | MED | P1 |
| **blocker** | 323 | `keywords: blocker` | OP01-014 Jinbe | B attack on A leader, A blocker on field rested=false | BLOCK button during attack prompt | attack redirected to blocker | blocker shown as new defender | block prompt at counter_window | HIGH | P0 |
| **removal_ko** | 263 | `action.kind: removal_ko` | OP01-026 Gum-Gum Fire-Fist | A main, 1 opp char base power within range, hand has anchor | play anchor → pick opp char | opp char moves to trash; `events: REMOVED_KO` | opp slot empty; trash count +1 | choose target if multi-eligible | HIGH | P0 |
| **bounce / bottom-deck** | 97 | `removal_bounce`, `bottom_of_deck_to_opp_deck` | OP01-086 Overheat | A main, 1 opp char, hand has anchor | play anchor → pick opp char | opp char moves to opp hand or deck bottom | opp slot empty; opp hand count +1 (or deck +1) | choose target | MED | P1 |
| **search / peek** | 220 | `searcher_peek`, `peek_and_reorder_own_deck`, `reveal_top_and_conditional_play` | OP01-016 Nami | A main, deck has known card mix, hand has anchor | play anchor → pick from peek_pick prompt | picked card moves to hand; deck reshuffled | hand count +1 | peek_pick pending | MED | P1 |
| **discard** | 50 | `discard_from_hand`, `opp_discard_from_hand` | OP01-007 Caribou | A main, opp has hand>=1, hand has anchor | play anchor → opp discards (or A picks) | opp hand count −N | opp hand badge decremented | system-auto for opp_discard | MED | P1 |
| **draw** | 232 | `draw` | OP01-011 Gordon | A main, deck >= n, hand has anchor | play anchor | A hand += n; deck −n; `events: CARDS_DRAWN` | A hand count +n | NO_UI_EXPECTED | LOW | P2 |
| **cost_reduction** | 60 | `cost_reduction`, `removal_cost_reduce` | OP02-025 Kin'emon | A main, opp char base cost 3+, A has cost-reduce anchor | play anchor → pick opp | opp char `costModifier` -= N; if cost<=0 → KO | opp char chip shows reduced cost or empty slot | choose if multi | MED | P1 |
| **don_manipulation** | 294 | `ramp`, `set_active_don`, `give_don_to_target`, `set_active` | OP01-061 Kaido (ramp) | A main, A activeDon known, hand has anchor | play anchor | A `donArea.active` +N (ramp) or `attachedDon` mutation | DON pill / cost area increments | NO_UI_EXPECTED | HIGH | P0 |
| **life_manipulation** | 89 | `add_to_own_life_top`, `add_to_opp_life_top`, `life_to_hand` | EB04-001 Jewelry Bonney | A main, A life count known, hand has anchor | play anchor (or activate_main) | A or B `life` array length changes | A leader LifePill decremented/incremented | NO_UI_EXPECTED | MED | P1 |
| **on_play trigger** | 1,161 | `trigger: on_play` | OP01-002 Trafalgar Law | per sub-family | play character | clause resolves on enter | per sub-family visible diff | per sub-family | HIGH | P0 |
| **activate_main trigger** | 348 | `trigger: activate_main` | OP01-002 Trafalgar Law | A main, A char rested=false on field | tap char → ACTIVATE button | char `rested=true`; clause resolves | char visually rotated; activate button gone | per sub-family | MED | P1 |
| **when_attacking trigger** | 236 | `trigger: when_attacking` | OP01-001 Roronoa Zoro | A main, A leader attached DON if condition | declare attack on opp leader | clause fires pre-damage | attacker aria-label shows +power | NO_UI_EXPECTED | MED | P1 |
| **on_ko trigger** | 149 | `trigger: on_ko` / `on_battle_ko` / `on_any_char_ko` | OP01-007 Caribou | A char in trash slot pre-loaded, B attacker KOs it | B attacks A char | clause fires post-KO | post-KO state diff (hand+1 / search prompt) | maybe peek/search | MED | P1 |
| **trigger from life** | 3 | `trigger: trigger` | OP01-009 Carrot | A leader with `[Trigger]` cards in life, B deals damage | B attacks A leader; trigger card revealed | clause fires from life | life card animation + state diff | trigger pending | LOW | P2 |
| **leader-gated** | 285 | conditions: `if_leader_is`, `if_leader_has_trait`, `if_leader_has_type` | EB01-001 Kouzuki Oden | matching leader + char, opposite leader for negative case | declare attack / play char | clause active iff condition true | per sub-family visible diff | NO_UI_EXPECTED | MED | P1 |
| **continuous / passive** | 531 | `effectSpecV2.continuous[]` | OP01-001 Roronoa Zoro (`[DON!! x1] all chars +1000`) | A leader on field, DON attached as gating | passive (no click) | `ContinuousManager.refold` re-applies; instances get `powerModifierContinuous` | char aria-label `power +1000` | NO_UI_EXPECTED | HIGH | P0 |
| **multi-turn / delayed** | 0 measured (`riskFlag` / `multiTurnSetup` not populated in current corpus) | n/a | n/a (deferred) | n/a | n/a | n/a | n/a | n/a | LOW | P3 |
| **target selection** | derived (every targeted action with > 1 valid target) | `target.kind ∈ opp_character / your_character / opp_leader_or_character / choose` | OP01-002 Trafalgar Law | A main with ≥ 2 valid targets | play / activate | target_pick pending mounts | aria-busy buttons, target highlights | target_pick pending | HIGH | P0 |
| **conditional effects** | 737 | `clause.condition.type` (`if_leader_*`, `if_attached_don_min`, `if_own_life_max`, `and`/`or`, etc.) | EB01-001 Kouzuki Oden | leader+DON+chars satisfying or NOT satisfying clause | trigger underlying action | clause skips when false; fires when true | per sub-family diff | NO_UI_EXPECTED | HIGH | P0 |

Notes:
- `aura_power_buff` action kind = 0 in corpus; auras land via
  `effectSpecV2.continuous[].action.kind: 'power_buff'` (returned 531
  cards). Counted under continuous_passive and power_boost.
- `trigger_from_life` = 3 surprised the audit — confirmed by re-tally.
  Most `[Trigger]` text in effectText is sugared into other primitives
  during compile.
- `cost_reduction` family also covers `removal_cost_reduce` (cost set
  to 0 = de-facto KO), which the spec treats as removal — flagged so
  Stage A doesn't double-count.
- `multi_turn` had 0 hits because `riskFlag` / `multiTurnSetup` aren't
  yet populated in `cards.json`; deferred to P3 until card data carries
  the flag.

---

## 2. Verification stages

| Stage | Scope | Cards | Acceptance |
|---|---|---:|---|
| **A** | 1 anchor per family | 22 | All families either PASS or NO_UI_EXPECTED with cited source |
| **B** | 5–10 cards per HIGH-risk family | ~80 | ≥ 90% PASS per family; failures classified |
| **C** | Generated family-level scenarios for every card in family | up to 2,489 | Per-family PASS rate reported; classified breakdown |
| **D** | Final card-by-card report aggregated across all families | 2,489 | Single signed report with classification counts |

Each stage gates the next. Do not start B before A is green for that
family. Do not start C before B is green or a known acceptable
non-PASS rate.

---

## 3. Classification labels

| Label | Meaning |
|---|---|
| **VERIFIED** | Engine state diff matches expected AND visible UI matches engine |
| **PRODUCT_BUG** | Engine wrong, OR UI fails to render engine state |
| **CARD_DATA_BUG** | `effectSpecV2` doesn't reflect printed `effectText` |
| **HARNESS_BUG** | Test setup wrong; engine + card data are correct |
| **SCENARIO_GAP** | No factory path to set up this card's required state |
| **NO_UI_EXPECTED** | Engine is deterministic; no prompt expected (source cited) |
| **NOT_IMPLEMENTED** | Engine has no handler for this primitive |

Labels are mutually exclusive. Each finding ships with: card id, family,
engine state diff, DOM aria-label diff, expected, observed, classification.

---

## 4. Stage A — first 5 implementation targets

Per directive, start with player-facing visible effects:

1. **power_boost** (308 cards) — visible aria-label change
2. **power_reduction** (110 cards) — symmetric inverse of #1
3. **counter (event)** (173 cards) — combat-defining; counter_window prompt
4. **blocker** (323 cards) — combat redirection; block prompt
5. **removal_ko** (263 cards) — visible field state change

Top 5 highest-risk families:

1. **power_boost** — already produced one PRODUCT_BUG (CardArt static read). Reliance on `effectivePowerForDisplay` must hold across all combat surfaces, not just CardArt.
2. **continuous / passive (aura)** — ContinuousManager.refold ordering bugs are silent corrupters; high impact.
3. **target selection** — wrong target list = silent rule break; `attack_target_pick` legality differs from action `target.kind`.
4. **counter event** — counter_window pending kind ordering is fragile; combat math diverges if window pre/post-damage is wrong.
5. **leader-gated** — broad coverage (285 cards); easy to silently mis-fire when leader matching is by type/trait/id.

---

## 5. First test file

File: `e2e/family-power-boost.spec.ts`

Status: not yet written. Per directive STEP 2 is the plan only.

### Anchor

Roronoa Zoro **OP01-001** — leader effect: `[DON!! x1] [Your Turn]
all of your Characters gain +1000 power`. Already in the default A
deck, so no seeded leader swap needed; only attach DON.

### Scenario

1. Bootstrap via `PlayerDriver.open()` → reach `phase=main, activePlayer=A`.
2. Seed one A-side character on field with base power 1000 via `window.__store` dispatch (no other modifiers).
3. Read DOM aria-label power BEFORE attaching DON (control).
4. Dispatch `ATTACH_DON` for 1 DON onto A's leader instance.
5. Read DOM aria-label power AFTER.
6. Seed one B-side character with base power 1000; confirm B power is **unchanged** (aura scope must be own-only).

### Success criteria

| # | Criterion | Source |
|---:|---|---|
| 1 | Test completes < 2 min | `playwright.config.ts:timeout` 120 s default |
| 2 | A char aria-label BEFORE = `power 1000` | CardArt describeForA11y |
| 3 | A char aria-label AFTER = `power 2000` (+1000 aura) | `effectivePowerForDisplay` post-CardArt-fix |
| 4 | B char aria-label AFTER = `power 1000` (unchanged) | aura scope filter |
| 5 | 0 pageerrors, 0 InvariantErrors | Playwright hooks |
| 6 | 0 stuck pending | `state.pending === null` after dispatch |
| 7 | Test classified **VERIFIED** | per §3 |

If criteria 1–7 all pass → power_boost Stage A is **VERIFIED**.
Then proceed to Stage B (5–10 additional power_buff/aura_power_buff
cards), still in the same spec or a sibling. Do not advance to
power_reduction until power_boost Stage A + B are green.

---

## 6. Out of scope (do not do)

- No 20-match soak (Phase 7 page-close issue still unresolved at infra
  level).
- No 5-match soak.
- No engine, UI, card-data, or scenarioFactory mods unless a Stage-A
  test surfaces a PRODUCT_BUG.
- No release / launch gating discussion.
- No corpus-wide generated tests until Stage A is green.
