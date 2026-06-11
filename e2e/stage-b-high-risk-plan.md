# Stage B — High-Risk Mechanic Expansion Plan

## Status entry

- Stage A representative coverage: **complete (18/18 families VERIFIED)**.
- trigger_from_life ENGINE_BUGs fixed (Bug 1: `playSelfFromLife` zone lookup
  via `actions3.ts:281-329` hand-then-life fallback; Bug 2: dispatch routing
  via `src/store/game.ts:478-491` `isTriggerWindow` branch).
- Combat-family regressions intact.

## Scope

- 5–10 cards per priority family.
- One Playwright spec per family (`e2e/family-<name>-stage-b.spec.ts`).
- Each card individually scenario-tested with deterministic seeding,
  engine-state diff, and DOM assertion where applicable.
- Each finding classified per the plan's label set (`VERIFIED`,
  `PRODUCT_BUG`, `ENGINE_BUG`, `CARD_DATA_BUG`, `HARNESS_BUG`,
  `SCENARIO_GAP`, `NO_UI_EXPECTED`, `NOT_EXPOSED`, `NOT_IMPLEMENTED`).
- No engine, UI, card-data, or scenarioFactory edits unless a real bug
  is reproduced and confirmed.
- Family-test runtime budget: each card ≤2 min, each spec ≤15 min.

## Priority families (in execution order)

1. counter_event — has open audit (double-count suspicion)
2. continuous / passive — stacking + reversion + scope
3. leader_gated — variations across condition type
4. target_selection — explicit UI/engine target-pick path
5. power_boost / power_reduction — stacking, duration, modifier sources
6. conditional — variations across condition type
7. trigger_from_life — remaining 2 corpus members

---

## 1. counter_event — Stage B card set

Family scope: events with `[Counter]` printed and `counterEventBoost > 0`,
played through `PLAY_COUNTER` flow at `attackFlow.ts:317-411`.

| # | Card | Family | Risk reason | Setup | Engine diff | UI assertion | Prompt | Classification risk |
|---:|---|---|---|---|---|---|---|---|
| 1 | OP01-026 Gum-Gum Fire-Fist Pistol Red Hawk | counter_event | DOUBLE_COUNT_SUSPECT: counterEventBoost=4000 + on_play power_buff +4000 your_leader_or_character; both could apply | Engineer counter_window B→A leader; seed Red Hawk in A hand; DON ≥ 5 (cost 2 + clause cost 0); B field empty so removal_ko no-ops | If single-count: counterBoost=4000, defender effective +4000. If double-count: counterBoost=4000 + powerModifierThisBattle=4000 = +8000 | Defender power UI matches engine | NO_UI_EXPECTED for resolution | **PRODUCT_BUG** if double-count |
| 2 | OP01-029 Radical Beam!! | counter_event | DOUBLE_COUNT + conditional second clause (life ≤ 2 ⇒ +2000) | Counter_window; A.life=2 to fire 2nd clause; A.donCostArea ≥ 1 | counterBoost=4000 + (powerModifierThisBattle = 2000 or 4000) | DOM power matches engine | NO_UI_EXPECTED | **PRODUCT_BUG** or **CARD_DATA_BUG** |
| 3 | OP01-057 Paradise Waterfall | counter_event | DOUBLE_COUNT + side effect `set_active` rests an A target (not defender boost) | Counter_window; A.donCostArea ≥ 1; A.field has 1 rested char; target picks the rested char | counterBoost=2000; if double-count, defender +4000; A char un-rested via set_active | A char rested=false post-resolve | NO_UI_EXPECTED | **PRODUCT_BUG** if double-count |
| 4 | OP01-058 Punk Gibson | counter_event | DOUBLE_COUNT + `rest_target` on opp char | Counter_window; seed B char on field; A.donCostArea ≥ 2 | counterBoost=4000 (or 8000); B target.rested=true | B char rested aria reflects rest | NO_UI_EXPECTED | **PRODUCT_BUG** if double-count |
| 5 | OP01-086 Overheat | counter_event | DOUBLE_COUNT + `removal_bounce` opp char to hand | Counter_window; seed B char cost ≤3 active; A.donCostArea ≥ 2 | counterBoost=4000; B target.field→hand; defender effective +4000 (or +8000) | B target gone from opp field | NO_UI_EXPECTED | **PRODUCT_BUG** if double-count |
| 6 | OP01-088 Desert Spada | counter_event | DOUBLE_COUNT + `peek_and_reorder_own_deck` (silent) | Counter_window; A.donCostArea ≥ 1; A.deck has known top order | counterBoost=2000; deck order unchanged or reordered per scratch | NO_UI for peek_and_reorder (V0 deterministic) | NO_UI_EXPECTED | **PRODUCT_BUG** if double-count |
| 7 | OP01-119 Thunder Bagua | counter_event | DOUBLE_COUNT + `ramp` (donDeck → donCostArea) | Counter_window; A.donCostArea ≥ 2; A.donDeck ≥ 1 | counterBoost=4000; A.donCostArea +1; donDeck −1 | DON pill +1 active | NO_UI_EXPECTED | **PRODUCT_BUG** if double-count |
| 8 | OP01-118 Ulti-Mortar (control, minimal-DON) | counter_event | CONTROL: inner clauses skipped — pure counterEventBoost only (already covered Stage A; included to baseline single-count) | Reuse Stage A | counterBoost=2000 | n/a | NO_UI_EXPECTED | **VERIFIED** baseline |

### Counter-event double-count audit (dedicated test)

- Spec: `e2e/family-counter-event-double-count-audit.spec.ts`
- Goal: cleanly determine whether OP01-026/029/057/058/086/088/119 double-count.
- Procedure for each card:
  - Pre-attack snapshot baseline (defender power, life, A.hand counts, A.donCostArea).
  - Engineer counter_window B→A leader (5000 vs 5000).
  - Dispatch `PLAY_COUNTER {instanceId}`.
  - Read `state.pending.pendingAttack.counterBoost` AND
    `state.players.A.leader.powerModifierThisBattle`.
  - Skip counter → damage resolves.
  - Read `LIFE_CARD_TO_HAND` presence in history.
  - Expected per printed text: defender effective +N where N = printed
    text boost.
  - Double-count detected when both `counterBoost` and
    `powerModifierThisBattle` are positive AND their sum ≠ printed N.
- Outcome decides classification:
  - If SINGLE_COUNT for all: **VERIFIED** for the entire suspect set;
    no fix needed.
  - If DOUBLE_COUNT for any: classify per case — either **ENGINE_BUG**
    (handler over-applies) or **CARD_DATA_BUG** (`counterEventBoost`
    field redundant with on_play `power_buff`). Propose minimal fix
    only after confirmation; do NOT touch card data without explicit
    approval.

---

## 2. continuous / passive — Stage B card set

Family scope: cards with `effectSpecV2.continuous[]` populated. Top-level
action kinds tested in Stage A were `self_power_buff` (ST01-013 Zoro) and
implicitly `grant_keyword_to_self` (via family-blocker Jinbe).

| # | Card | Action kind | Condition | Risk reason | Setup | Engine diff | UI assertion | Prompt |
|---:|---|---|---|---|---|---|---|---|
| 1 | ST01-013 Zoro (Stage A baseline) | self_power_buff | if_attached_don_min:1 | Already VERIFIED Stage A; include as control | — | — | — | — |
| 2 | OP01-001 Roronoa Zoro (leader) | aura_power_buff | if_attached_don_min:1 AND is_own_turn | Stage A covered single-DON ON state; Stage B tests scope (A chars only, NOT B chars) under 2+ DON and turn-flip reversion | Default scene; attach 2 DON; verify all A chars +1000; B chars unchanged; end turn → B turn → reversion | A.field chars powerModifierContinuous=1000; B.field chars =0 | DOM powers update | NO_UI_EXPECTED |
| 3 | OP01-019 Bartolomeo | grant_keyword_to_self:blocker (unconditional) + self_power_buff (DON+opp turn) | mixed | Two continuous clauses on one card; verify both fire independently | Seed on A.field; ATTACH 2 DON; flip phase to is_opp_turn | `grantedKeywordsContinuous` contains 'blocker'; powerModifierContinuous=3000 only when is_opp_turn=true | DOM power reflects modifier | NO_UI_EXPECTED |
| 4 | OP01-014 Jinbe (Stage A control) | grant_keyword_to_self:blocker | none | Already implicit in family-blocker; Stage B verifies `grantedKeywordsContinuous` populated via refold | Seed Jinbe; trigger refold; read inst.grantedKeywordsContinuous | Contains 'blocker' | n/a | NO_UI_EXPECTED |
| 5 | EB04-057 Vegapunk | grant_keyword_to_self:blocker | if_attached_don_min:1 | Toggleable blocker grant (but printed kws already include 'blocker'); verify continuous toggle still drives `grantedKeywordsContinuous` even though legality already passes via printed kw | Seed; check grant pre-DON (continuous=undefined despite printed); attach DON; check grant populated; detach; reversion | grantedKeywordsContinuous toggles undefined ↔ ['blocker'] | n/a | NO_UI_EXPECTED |
| 6 | OP01-068 Gecko Moria | grant_keyword_to_self:double_attack | if_hand_min:5 | Hand-size toggle for legality-affecting grant (double_attack); reuse hand-size trim pattern from family-conditional | Seed Moria on field; trim hand to 5 (true); to 4 (false); refold each | grantedKeywordsContinuous toggles ['double_attack'] | n/a (double_attack visualization unclear) | NO_UI_EXPECTED |
| 7 | EB01-014 Sanji | self_power_buff (conditional) | conditional | Distinct conditional self-buff card | Vary condition; verify toggle | engine modifier toggle | DOM power toggle | NO_UI_EXPECTED |
| 8 | OP03-004 Curiel | grant_keyword_to_self:rush + DON gate | if_attached_don_min:1 | Conditional rush grant; toggle changes attack legality vs summoning-sick | Seed summoning-sick on field; ATTACH DON; verify DECLARE_ATTACK appears | legalActions for that attacker toggle | n/a | NO_UI_EXPECTED |

### Stacking + reversion test (one spec)

- `e2e/family-continuous-passive-stage-b.spec.ts` — covers cards 2–8.
- Validates refold is idempotent (multiple refolds same result), scope filters hold,
  reversion clears modifiers when condition flips false.

---

## 3. leader_gated — Stage B card set

Family scope: clauses with `condition.type` in `{if_leader_is,
if_owned_leader_name, if_leader_has_trait, if_leader_has_type,
if_leader_has_color, if_leader_multicolored}`. 245 corpus cards.

| # | Card | Condition type | Action | Risk reason | Setup |
|---:|---|---|---|---|---|
| 1 | OP01-089 Crescent Cutlass (Stage A baseline) | if_leader_has_trait | removal_bounce | Control | Reuse Stage A |
| 2 | OP03-048 Nojiko | if_leader_is | removal_bounce | Exact-name leader gate; mutate A leader cardLibrary entry's `name` instead of `traits` | Inject Nami leader id at runtime |
| 3 | EB01-035 Ms. Monday | if_leader_has_type | power_buff +1000 | Type substring match | typeString='Baroque Works' |
| 4 | OP02-021 Seaquake | if_leader_has_type | removal_ko | Whitebeard Pirates substring; mutate leader traits | Seed B target |
| 5 | OP04-018 Enchanting Vertigo Dance | if_leader_has_trait | power_buff -2000 | Negative-magnitude version; verify same gate path | Seed B char with known power |
| 6 | OP04-037 Flapping Thread | if_leader_has_trait | power_buff +2000 | Donquixote Pirates gate; mirror Alabasta from above | — |
| 7 | OP11-115 You're Just Not My Type! | if_leader_is | power_buff +4000 | Exact name "Shirahoshi" | — |
| 8 | OP12-054 Marshall.D.Teach | if_leader_has_type | removal_bounce | Seven Warlords type substring; non-OP01 control | — |

- Spec: `e2e/family-leader-gated-stage-b.spec.ts`
- Each card runs TWO subcases (wrong/matching leader) using runtime
  cardLibrary mutation (proven harness pattern from Stage A leader_gated).
- Classification: VERIFIED per card unless leader-mutation harness fails
  to take effect (HARNESS_BUG) or audit-flagged spec mismatch
  (CARD_DATA_BUG).

---

## 4. target_selection — Stage B card set

Family scope: clauses whose `target.kind` returns >1 candidate, exercising
the V0 deterministic resolver behavior + future UI target-pick path.

V0 reality (per `targets.ts:87-92`): `opp_character` returns first
eligible. No `attack_target_pick` pending is mounted for action targets;
only the attack-flow uses `pendingTargetPick`.

| # | Card | Target.kind | Risk reason | Setup |
|---:|---|---|---|---|
| 1 | OP01-026 Red Hawk | opp_character | Already covered Stage A; control | Reuse |
| 2 | OP01-016 Nami | searcher_peek (target via filter) | V0 deterministic peek; control | Reuse |
| 3 | Any all_opp_characters card | all_opp_characters | All-side action — distinguishes single-target from broadcast | TBD pick e.g. OP08-x |
| 4 | Any all_your_characters card | all_your_characters | All-side own — verify scope | TBD |
| 5 | Any any_character card | any_character | Cross-side resolver; opp first then own per `targets.ts:105-114` | TBD |
| 6 | Any your_character card | your_character | Self-side single eligible | TBD pick from corpus |
| 7 | Any opp_leader_or_character card | opp_leader_or_character | Leader-first ordering | TBD |
| 8 | Any opp_don_or_character card | opp_don_or_character (if exists) | Unusual target kind | TBD |

- Stage B test focus: deterministic order of resolver picks, scope
  isolation (own vs opp), and explicit absence of pending kind for
  multi-candidate effects (NO_UI_EXPECTED at V0).
- Spec: `e2e/family-target-selection-stage-b.spec.ts`
- Card selection deferred until first execution; pre-check via corpus
  query at spec author time.

---

## 5. power_boost / power_reduction — Stage B card set

Family scope: 308 cards with `power_buff` magnitude ≥ 0, 110 with < 0.
Stacking, duration, and modifier-source interactions are the high-risk
surface.

| # | Card | Variant | Risk reason | Setup |
|---:|---|---|---|---|
| 1 | OP01-001 Zoro (aura_power_buff, leader) | this_turn-via-continuous (NOT one-shot) | Stage A baseline | Reuse |
| 2 | OP01-006 Otama (Stage A baseline) | one-shot this_turn negative | Control | Reuse |
| 3 | OP01-022 Brook | power_buff +N self when DON attached, on when_attacking | Cross-trigger | Seed Brook attacker scenario |
| 4 | EB01-001 Kouzuki Oden (leader, when_attacking +1000 opp_next_turn) | duration: 'opp_next_turn' (vs 'this_turn') | Duration boundary | Run engineered attack; verify ticker decrement |
| 5 | OP02-021 Seaquake (power_buff via removal_ko side; not directly applicable) | n/a | Skip (covered elsewhere) | — |
| 6 | EB02-052 Enel (rush grant + power_buff condition complex) | duration: 'this_battle' | Combat scope | Engineer attack + verify clear at clearPendingAttack |
| 7 | Card with magnitude reading from formula (per_count) | bound magnitude resolved via formula | Numeric source variation | OP01-072 Smiley `own_hand_count` per_count |
| 8 | OP01-083 Mr.1(Daz.Bonez) | own_trash_event_count per_count | Distinct count source | Seed trash events |

- Stage B test focuses: (a) per-instance modifier additivity when
  multiple sources fire same battle, (b) duration boundaries
  (this_turn / this_battle / opp_next_turn / permanent),
  (c) formula-driven magnitudes vs literal numerics.
- Spec: `e2e/family-power-modifier-stage-b.spec.ts`
- Each card: snapshot before, fire effect, snapshot after, advance
  expected boundary, snapshot reversion.

---

## 6. conditional — Stage B card set

Family scope: non-leader-gated conditional clauses. 500 corpus cards.

| # | Card | Condition | Action | Risk reason |
|---:|---|---|---|---|
| 1 | P-053 Nami (Stage A baseline) | if_hand_max:3 | removal_bounce | Control |
| 2 | OP05-050 Hina | if_hand_max:5 | draw 1 | Different threshold; verify boundary at hand=5 vs hand=6 |
| 3 | EB03-058 Lilith | if_own_life_max:2 | draw 2 | Life-based gate |
| 4 | OP07-115 I Re-Quasar Helllp!! | if_own_life_max:2 | power_buff your_leader_or_character | Self life condition + boost interaction |
| 5 | OP09-026 Sakazuki | if_own_chars_min:2 | removal_ko opp_character | Own-board count gate |
| 6 | OP05-118 Kaido | if_opp_life_max:3 | draw 1 | Opp-life gate |
| 7 | OP09-087 Charlotte Pudding | if_opp_hand_min:5 | opp_discard | Opp-hand gate |
| 8 | OP07-050 Boa Sandersonia | if_own_chars_min_filter (Amazon Lily/Kuja Pirates ≥2) | removal_bounce | Filter-aware count gate |

- Spec: `e2e/family-conditional-stage-b.spec.ts`
- Each card: two subcases (condition false / true) using runtime state
  mutation (hand-trim, life-trim, char-seed) per Stage A pattern.

---

## 7. trigger_from_life — remaining cards

Only 3 corpus cards trigger from life. Stage A covered OP01-009 Carrot.
Remaining 2: see corpus query.

```
node -e "const a=require('./shared/data/cards.json'); for (const c of a) {
  if ((c.effectSpecV2?.clauses||[]).some(cl => cl.trigger==='trigger')) console.log(c.id, c.name);
}"
```

(To be enumerated at spec author time. Expected to be small targeted
spec — `e2e/family-trigger-from-life-stage-b.spec.ts`.)

---

## Special audits

### A. Counter-event double-count audit

- Driver: covered in Stage B family section #1 above.
- Spec: `e2e/family-counter-event-double-count-audit.spec.ts`
- Output: confirmed audit report per card with classification.

### B. Nami search nameExcludes audit

- Anchor: OP01-016 Nami — printed "[Other than [Nami]]" but spec lacks
  `nameExcludes:"Nami"`.
- Other Nami SHC chars in corpus: EB02-017, EB03-006, EB03-053, OP02-036,
  OP04-011 (all character + Straw Hat Crew trait).
- Test design:
  - Seed A.deck top-5 with mix: positions 0,2,3,4 = ineligible Land of
    Wano; position 1 = ANOTHER Nami (e.g. OP02-036) — different id,
    same name.
  - Play OP01-016 Nami.
  - Per printed text: the other Nami should NOT be picked (excluded by
    name).
  - Per current spec: the other Nami WILL be picked (only trait filter).
  - Engine state diff identifies which behavior the engine produces.
- Spec: `e2e/family-search-peek-nami-exclusion-audit.spec.ts`
- Likely classification: **CARD_DATA_BUG** if engine picks the other
  Nami (spec missing nameExcludes); fix would be card-data edit (needs
  explicit owner approval per directive).

### C. CardArt cost display UI follow-up

- Observation: `src/components/CardArt.tsx:209, :438` use static
  `card.power` — fixed in STEP 1 via `effectivePowerForDisplay`.
- Parallel issue: `CardArt.tsx:214, :426` (cost) use STATIC `card.cost`;
  no runtime `effectiveCostForDisplay` exists.
- Decision needed (PM/owner call):
  - **Option A (PRODUCT_BUG)**: ship parallel
    `effectiveCostForDisplay` in `shared/engine-v2/state/derived/cost.ts`
    and rewire CardArt aria-label + cost square reads. Symmetric with
    power fix. Cost: ~1 file engine, ~2 sites CardArt edit.
  - **Option B (NOT_EXPOSED — acceptable)**: defer until OPTCG players
    actually need to see effective cost in UI (most cost modifiers
    apply to opp chars and are short-lived; visual KO is already
    surfaced when cost ≤ 0 via other mechanics).
- Stage B will NOT modify UI; record the decision and proceed.

---

## Stage B execution order

1. **counter-event double-count audit** — discovers most likely engine
   over-application; gates further counter-event work.
2. **continuous/passive stacking and reversion** — refold robustness.
3. **leader-gated variations** — confirm condition-handler coverage.
4. **target-selection explicit checks** — V0 resolver order confirms.
5. **power modifier stacking/duration** — boundary semantics.
6. **conditional variations** — broader condition coverage.
7. **trigger-from-life remaining 2 cards** — verify Bug 1/2 fix holds.

---

## First Stage B test to implement

**File:** `e2e/family-counter-event-double-count-audit.spec.ts`

Anchor sequence: OP01-026 Red Hawk first (cleanest power_buff +
removal_ko side; removal_ko isolated by empty B.field).

### Success criteria for first Stage B test

| # | Criterion |
|---:|---|
| 1 | Test completes < 2 min |
| 2 | Engineered counter_window B leader → A leader with `counterBoost=0` baseline |
| 3 | After `PLAY_COUNTER {OP01-026}`: read both `state.pending.pendingAttack.counterBoost` and `state.players.A.leader.powerModifierThisBattle` |
| 4 | Classify outcome per card: SINGLE_COUNT iff exactly one field is positive; DOUBLE_COUNT iff both fields are positive |
| 5 | If DOUBLE_COUNT for OP01-026: record `PRODUCT_BUG` finding with effective defender boost = sum of both fields (8000); diff vs printed text (+4000) |
| 6 | Test asserts engine-truth values, NOT a particular outcome — outcome is the AUDIT result; test PASS iff data captured cleanly + 0 pageerrors + 0 InvariantErrors |
| 7 | history records `COUNTER_PLAYED` with `boost: <counterEventBoost>` matching |
| 8 | After `SKIP_COUNTER`: damage resolution outcome (leader life change) matches the effective boost (single vs double); confirms engine consistently uses both fields if double-encoded |
| 9 | 0 pageerrors, 0 InvariantErrors, no stuck pending |

Once OP01-026 captured, extend the same spec to cards 2–7 with identical
shape. If all DOUBLE_COUNT, audit report is the basis for a follow-up
fix proposal (engine or card-data).

---

## Stop conditions / re-prompts to owner

- If counter-event audit shows DOUBLE_COUNT: stop Stage B execution and
  surface a fix proposal (engine vs card-data) before proceeding to
  continuous/passive — the cleanest fix may affect other Stage B
  expectations.
- If Nami exclusion audit shows engine matches CARD_DATA missing
  `nameExcludes`: stop and surface for explicit approval per directive
  (card-data edits gated).
- If a HARNESS_BUG is reproduced across multiple cards (e.g. setState
  pattern doesn't propagate to selector re-render): stop and lift a
  shared seed-helper module (`e2e/helpers/seed.ts`) before continuing.

End of plan.
