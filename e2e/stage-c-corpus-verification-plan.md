# Stage C — Corpus Verification Plan

Plan-only. **No specs written yet.** Stage C is a *generated*, batched verification of the full card corpus. This document defines the readiness baseline, architecture, contracts, invariants, execution order, batch sizes, reporting shape, first target, and stop conditions. Implementation begins only after this plan is approved.

All file references cite current repo state at planning time.

---

## 0. Readiness snapshot

### Stage A — representative-anchor family specs (one card per mechanic family)

Per directive: complete. Verified at planning time only for the four specs run as the regression suite in the recent Group 1B + dispatcher-fix turns:

| Spec | Last verified PASS |
|---|---|
| `e2e/family-counter-event.spec.ts` | yes (this session) |
| `e2e/family-blocker.spec.ts` | yes (this session) |
| `e2e/family-when-attacking.spec.ts` | yes (this session) |
| `e2e/family-trigger-from-life.spec.ts` | yes (this session) |

Stage A specs not exercised this session (status NOT freshly re-verified; relying on prior owner-declared "Stage A complete"):

- `family-activate-main`, `family-bounce`, `family-conditional`, `family-continuous-passive`, `family-cost-reduction`, `family-discard`, `family-don-manipulation`, `family-draw`, `family-leader-gated`, `family-life-manipulation`, `family-on-ko`, `family-power-boost`, `family-power-reduction`, `family-removal-ko`, `family-search-peek`

**Stage C pre-requisite:** before starting Stage C, run all 19 Stage A specs together in one batch. Treat any failure there as a blocker.

### Stage B — high-risk family expansion (~8 cards per family)

Per directive: complete. Verified at planning time only for the audit re-runs in this session that exercise the underlying engine paths. Stage B specs:

- `stage-b-conditional`, `stage-b-continuous-passive`, `stage-b-leader-gated`, `stage-b-power-modifier`, `stage-b-target-selection`, `stage-b-trigger-from-life`

Stage B specs NOT freshly re-verified this session; relying on owner-declared "Stage B complete". Stage C pre-requisite: re-run all Stage B specs together before starting Stage C.

### Counter-event backlog

| Group | Cards | Status |
|---|---:|---|
| 0. Group 4 — engine `if_own_chars_min_filter` ignored `traitsAny`/`kind` | engine handler at `shared/engine-v2/registry/handlers/conditions2.ts:207-237` | **CLOSED** — handler now reads `traitsAny` + `kind`; verified via `audit-own-chars-filter.spec.ts` |
| 1A. Cost-gated SAFE patches | 59 cards | **CLOSED** — patched in `cards.json` prior to this session |
| 1C. Magnitude-mismatch | 6 cards (OP01-029, OP04-095, OP05-114, OP07-035, OP07-095, OP11-059) | **CLOSED** — `counterEventBoost → unconditional tier` + drop duplicate clause; verified by `audit-counter-event-magnitude-mismatch.spec.ts` |
| 1B/1A/1D. Cost-gated / condition-gated / leader+cost gated | 8 cards (OP03-055, OP03-072, OP03-097, OP05-037, OP06-115, OP07-076, OP08-115, OP14-078) | **CLOSED** — printed-strict semantic via `counterEventBoost → 0` (cards.json) + counter-event legality widened at `shared/engine-v2/rules/legality.ts:267-285` to A OR (B AND C); verified by `audit-counter-event-condition-gated.spec.ts` |
| OP14-078 multi-clause dispatcher break | engine `shared/engine-v2/effects/EffectDispatcher.ts:270-275` | **CLOSED** — break-on-`pending` now skipped when `pending.kind === 'attack'` (ambient counter-window state); verified by safety check in the same audit spec |

---

## 1. Remaining unresolved backlog items

All cited as owner-deferred from earlier sessions. Each remains a pre-Stage-C decision point or a known accepted exception that must be enumerated in the Stage C "known accepted exceptions" report.

| Item | Source | What's open |
|---|---|---|
| **OP06-038** Trichil "rested-cards" ambiguity | `manual-review-backlog-plan.md` Group 1C tail; `cards.json` effectSpecV2.verified=flagged | Printed text "8 or more rested cards" not interpretable. Engine has only `if_own_chars_min_rested` (field rested chars); no handler for rested DON or combined chars+DON. Owner decision + possible engine handler addition required. |
| **OP12-098** Hair Removal Fist same-target binding | `cards.json` auditNote; flagged | Printed "that card" implies same-target binding between clause[0] (`your_leader_or_character`) and clause[1] (`your_character filter:typeIncludes:Revolutionary Army`). Engine has no clause-to-clause target binding; spec encoding allows divergent targets. |
| **OP01-016** Nami `nameExcludes` audit | `manual-review-backlog-plan.md` Group 3 | Search filter missing `nameExcludes:"Nami"` per printed text. Engine handler at `actions3.ts:861` already supports `nameExcludes`. Single-line cards.json patch after a targeted audit. |
| **OP03-004** Curiel rush-gate audit | `manual-review-backlog-plan.md` Group 5 | `card.keywords:['rush']` always-on but printed text gates rush on `[DON!! x1]` attach. Continuous `grant_keyword_to_self:rush` gated by `if_attached_don_min:1` exists but is shadowed by the static keyword. Targeted audit + cards.json decision. |
| **OP05-109** Pagaya `mill_self` / `trigger` semantic | `manual-review-backlog-plan.md` Group 6 | Stage B observed `mill_self:2` does not materialize in trash. Plus broader `trigger:'trigger'` overload (reactive vs life-flip). Single-card audit + likely engine investigation. |
| **OP13-106** Conney `trigger` semantic | `manual-review-backlog-plan.md` Group 7 | Same `trigger:'trigger'` overload as Pagaya. Both require an owner-level decision on whether to add a new trigger kind (e.g. `on_other_trigger_activated`) — corpus-wide schema change. |
| **OP10-001 / OP10-003** `powerMin` filter audit | Findings from `audit-own-chars-filter.spec.ts` corpus query | These 2 cards use a `powerMin` key on `if_own_chars_min_filter` that the handler still ignores (only reads `trait`/`traitsAny`/`kind`/`minCost`/`maxCost`). Latent engine gap — not introduced by the recent fix. Single-line engine extension + targeted test. |
| **CardArt effective-cost display** follow-up | `manual-review-backlog-plan.md` Group 8 | UI parity issue. `src/components/CardArt.tsx:214, 292, 426` uses static `card.cost` rather than effective post-cost-reduction value. Needs `effectiveCostForDisplay` derivation symmetric with STEP1 power fix. Pure UI work, doesn't gate engine Stage C. |
| **Twelve newly counter-playable cards** | Side-effect of legality patch this session | EB03-029, EB03-038, EB03-049, EB04-008, EB04-009, EB04-029, EB04-040, EB04-050, OP04-037, OP04-076, OP06-017, OP06-059 now satisfy A OR (B AND C) and become counter-playable. Functionally untested as counters. Stage C must validate each. |

---

## 2. Stage C architecture

Stage C is **NOT** a single monolithic spec. It is a fan-out of generated tests organized into mechanic families. Each family gets its own generated spec file. Each generated test exercises one card in one canonical setup against family-specific assertions.

### Family buckets (each becomes a generated spec file)

The taxonomy below mirrors the existing `family-*.spec.ts` files where possible. Each bucket maps to a `stage-c-generated-<family>.spec.ts`:

| # | Family | Notes |
|---:|---|---|
| 1 | `counter_events` | All event cards with `effectTags includes 'counter_event'` OR `counterEventBoost > 0` |
| 2 | `on_play_events` | Non-counter event cards with on_play clauses |
| 3 | `on_play_characters` | Character cards with on_play clauses |
| 4 | `activate_main` | Cards with `[Activate Main]` (keyword `activate_main`) |
| 5 | `when_attacking` | Clauses with trigger `when_attacking` |
| 6 | `on_ko` | Clauses with trigger `on_ko` |
| 7 | `trigger_from_life` | Clauses with trigger `trigger` flipped from life |
| 8 | `continuous_passive` | `effectSpecV2.continuous[]` consumers |
| 9 | `leader_gated` | Effects gated by `if_leader_is` / `if_leader_has_trait` / `if_leader_has_type` |
| 10 | `conditionals` | Effects gated by hand/life/trash/field conditions (not leader-specific) |
| 11 | `removal_bounce` | `removal_ko`, `removal_bounce`, `rest_target` |
| 12 | `draw_search_discard` | `draw`, `searcher_peek`, `discard_*` actions |
| 13 | `don_manipulation` | DON give/take/return clauses |
| 14 | `life_manipulation` | `add_to_own_life_top`, `add_to_opp_life_top`, `life_to_hand` |
| 15 | `power_cost_modifiers` | `power_buff`, `give_continuous_power`, `aura_power_buff`, cost reduction |

Cards can belong to multiple families (e.g. a counter event that does both `power_buff` AND `draw`). Generated tests select the **primary family per card** via a deterministic heuristic (effectTags ranked → first match), and add a `secondary_families: string[]` field on the result record for cross-classification.

### Generation pipeline

```
shared/data/cards.json
     │
     ▼
  classify(card) ─► primary family + secondary families
     │
     ▼
  recipe(card, family) ─► deterministic setup spec
     │
     ▼
  assertions(card, family) ─► expected diff + classification rules
     │
     ▼
generated spec entries (one per card)
     │
     ▼
Playwright runs in slices (see §6)
```

Recipe + assertions live in shared helper modules under `e2e/helpers/stage-c/`. Per-family helper modules: `counter-events.ts`, `on-play-events.ts`, etc.

---

## 3. Per-card generated test contract

Every generated test produces one result record with this shape (JSON, written to `e2e/stage-c-report/<family>/<card-id>.json` for slice runs and rolled up to `e2e/stage-c-report/index.json`):

```ts
interface StageCResult {
  cardId: string;                  // e.g. "OP14-078"
  cardName: string;                // verbatim from cards.json
  primaryFamily: FamilyName;
  secondaryFamilies: FamilyName[];
  setupRecipe: {
    donCount: number;
    aHandSize: number;
    aLeaderTraits?: string[];      // for leader-gated cards
    seededField?: SeededInstance[];
    aLifeCount?: number;
    aTrashCount?: number;
    // family-specific extras
    [k: string]: unknown;
  };
  actionPerformed: 'PLAY_CARD' | 'PLAY_COUNTER' | 'ACTIVATE_MAIN' | 'DECLARE_ATTACK' | 'RESOLVE_TRIGGER' | 'OTHER';
  expectedStateDiff?: {
    // Derivable when the printed text + spec map cleanly to a state delta.
    aHandDelta?: number;
    aTrashDelta?: number;
    aLifeDelta?: number;
    aFieldDelta?: number;
    aDonCostDelta?: number;
    leaderPowerModifierThisBattle?: number;
    leaderPowerModifierOneShot?: number;
    counterBoost?: number;
    // ...etc per family
  };
  observedStateDiff: {
    /* same shape; engine-observed */
  };
  uiAssertions?: {
    // Only when the family has an exposed UI surface (counter prompt,
    // peek prompt, discard prompt, choose-one prompt, blocker prompt).
    // Populated only when actionPerformed touches one.
    promptMounted?: boolean;
    promptDismissedAfter?: boolean;
    ariaLabel?: string;
  };
  promptExpectation: 'no_prompt' | 'auto_resolved' | 'human_prompt_expected' | 'human_prompt_observed' | 'human_prompt_missing';
  classification:
    | 'VERIFIED'
    | 'ENGINE_BUG'
    | 'CARD_DATA_BUG'
    | 'UI_BUG'
    | 'HARNESS_BUG'
    | 'NOT_IMPLEMENTED'
    | 'NO_UI_EXPECTED'
    | 'INCONCLUSIVE';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes: string;                   // human-readable diagnostic
  history: ReadonlyArray<{ type?: string; [k: string]: unknown }>; // tail of state.history
}
```

### Per-card requirements per the directive

| Field | Source |
|---|---|
| `cardId` / `cardName` | cards.json |
| `family classification` | classifier helper |
| `setup recipe` | family helper |
| `action performed` | family helper |
| `expected state diff` (if derivable) | spec-to-diff projector + printed-text heuristic |
| `UI assertions` (if exposed) | UI-parity helper |
| `prompt expectation` | family helper (one of 5 values above) |
| `result classification` | the 8 classifications above |

---

## 4. Invariant requirements

Every generated test asserts ALL of the following. Any failure flips classification to `INCONCLUSIVE` (for infra/harness issues) or to the matching bucket (`ENGINE_BUG` / `HARNESS_BUG`).

| Invariant | Check |
|---|---|
| 0 pageerrors | Playwright `page.on('pageerror')` collector empty |
| 0 InvariantErrors | console-message filter for `InvariantError` / `invariant` substrings empty |
| No stuck pending | `state.pending === null` at test exit (force-clean fallback allowed for safety-check parity, but flagged) |
| No impossible phase | `state.phase` ∈ engine-defined phase enum at every snap point |
| DON conservation | Sum of `donDeck.length + donCostArea.length + donRested.length + attachedDon.length` is constant per side across the test (initial = 10) |
| No duplicated instance IDs | `state.instances` keys unique; cross-check by walking every zone (hand, field, deck, life, trash, leader, stage, attachedDon, donCostArea, donDeck, donRested) and asserting no `instanceId` appears twice across all zones |
| Field cap respected | `players[X].field.length <= FIELD_CAP` (see `shared/engine-v2/state/types.ts:21`) |
| Legal action exists before dispatch (UI path) | When the test simulates a click/select flow, `getLegalActions(state, player)` includes the chosen action *before* dispatch |
| Pending resolves OR is correctly classified | Test must either drain pending OR record `promptExpectation: 'human_prompt_expected'` and assert prompt mounted |

These are global preconditions; family helpers MAY add stricter invariants.

---

## 5. Execution plan

Sequenced. Each phase gates the next.

### A. Static corpus audit pass

- No browser. Pure cards.json walk + classification.
- For every card, produce:
  - primary + secondary families
  - whether `effectSpecV2` is present, well-formed, schemaVersion=2
  - whether any clause uses a condition/action/cost/target NOT in the engine handler registries (`conditionHandlers`, `actionHandlers`, `costHandlers`, `targetResolvers`)
  - whether `effectSpecV2.verified === 'flagged'` (count + list)
- Emits `e2e/stage-c-report/static-audit.json` + markdown summary.
- Cards with unsupported primitives or `verified:'flagged'` are pre-classified `NOT_IMPLEMENTED` or `CARD_DATA_BUG` and excluded from the smoke pass until resolved.

### B. Generated smoke pass per family

- Per family, run the "minimal-setup" version of the generated test:
  - Setup the recipe
  - Dispatch the primary action
  - Assert NO crash (invariants from §4)
  - Capture history tail + final state digest
- Classification at this phase is only `VERIFIED` (no crash, no anomaly), `ENGINE_BUG` (crash / invariant violation), or `INCONCLUSIVE` (harness setup failed).
- Goal: prove the engine can DRIVE every card without dying. State-correctness comes in phase C.

### C. Generated state-diff pass per family

- Per family, run the same recipe but ALSO assert the projected `expectedStateDiff`.
- This is where most `CARD_DATA_BUG` and `ENGINE_BUG` classifications surface.
- Cards without a derivable expected diff (e.g. cards with multiple interactive choices) skip this phase with `classification: 'INCONCLUSIVE'` and a reason.

### D. UI parity pass for exposed surfaces

- Subset of cards whose action mounts a prompt: counter, peek, discard, choose_one, blocker, target_pick.
- Test asserts:
  - Prompt UI mounts when the engine creates the corresponding pending
  - Prompt UI dismisses when pending clears
  - Prompt `aria-label` matches expected per accessibility rules
- Non-prompt cards skip with `classification: 'NO_UI_EXPECTED'`.

### E. Full report with failure clustering

- Roll up all results into `e2e/stage-c-report/final.{json,md}`:
  - Per family: count of each classification
  - Per root-cause cluster: e.g. "12 cards fail because `if_X_min_filter` ignores `kind:'event'` key" — group cards with shared error signatures
  - Top fix clusters: ordered by `cards_affected × ease_of_fix_inverse`
  - Known accepted exceptions list (the open-backlog items from §1)

### F. Patch / rerun loops

- For each fix cluster:
  - Owner approves the fix
  - Patch lands
  - Affected slice re-runs (just those cards, not the full corpus)
  - Classifications update
- Loop until report reaches owner-defined target (e.g. ≥95% `VERIFIED`).

---

## 6. Batch size + performance constraints

### Slice sizes

Per directive:

- **25-card slices** for proving harness stability (Phase B initial sub-batches)
- **100-card slices** for routine throughput once 25-card slices are reliably green
- **Full-family runs** once 100-card slices are stable (~200-500 cards per family in the largest buckets)

### Browser-session constraints

The repo has prior Playwright stability incidents documented at `e2e/page-close-repro.spec.ts` and `e2e/reset-repro.spec.ts`. Stage C **MUST**:

- Open a **fresh page per slice** (not per card). State-pollution across cards within a slice is acceptable IF the recipe resets state via `state.result = null` + A.life refill + hand rebuild (proven pattern in `audit-counter-event-condition-gated.spec.ts:120-200`). State pollution across slices is NOT acceptable.
- Cap slice runtime at **~5 minutes** wall-clock. Cards that need substantially longer are pulled into a slow-cards slice.
- Run slices as **independent processes**: each slice = its own `npx playwright test e2e/stage-c-generated-<family>.spec.ts --shard=N/M`. Avoid one long-running Playwright invocation for the whole corpus.
- Kill stale Vite dev servers (`lsof -ti:5174 | xargs kill`) between independent slice processes to force fresh cards.json reads. JSON imports in Vite are NOT hot-reloaded reliably (proven this session).

### Parallelism

- Initial: single-worker (`fullyParallel: false` already set at `playwright.config.ts:9`). Stage C does not change this.
- Future optimization: parallelize across families (different specs, separate processes) once slice stability is proven.

---

## 7. Reporting format

Two formats per slice + one roll-up.

### Per-card JSON

`e2e/stage-c-report/<family>/<card-id>.json` — full `StageCResult` record (see §3).

### Per-slice JSON roll-up

`e2e/stage-c-report/<family>/slice-<N>.json`:

```ts
{
  family: string;
  sliceIndex: number;
  cardCount: number;
  classifications: {
    VERIFIED: number;
    ENGINE_BUG: number;
    CARD_DATA_BUG: number;
    UI_BUG: number;
    HARNESS_BUG: number;
    NOT_IMPLEMENTED: number;
    NO_UI_EXPECTED: number;
    INCONCLUSIVE: number;
  };
  failureClusters: Array<{
    rootCause: string;
    affectedCards: string[];
    proposedFix: string;
  }>;
  durationMs: number;
}
```

### Final markdown report

`e2e/stage-c-report/final.md`:

| Section | Content |
|---|---|
| Headline | Total cards, %verified, %failed |
| Classification buckets | Stacked totals + per-family breakdown |
| Failures by family | Per-family count + top 3 failing card examples per family |
| Failures by root cause | Top fix clusters (cards-affected, ease-of-fix, proposed engine/cards.json change) |
| Rerun status | Cards re-run since last full pass, with delta |
| Known accepted exceptions | Open backlog items from §1, each with reason and owner decision pending |

---

## 8. First Stage C target

**Recommendation: counter events (family bucket #1).**

### Justification

1. **Harness infrastructure already exists and is fresh.** Two audit specs landed this session — `e2e/audit-counter-event-magnitude-mismatch.spec.ts` and `e2e/audit-counter-event-condition-gated.spec.ts` — implement the exact patterns Stage C needs (counter-window seeding, guard counter to prevent auto-skip, life refill, state.result clear, history-derived snap, classification taxonomy). Reusing them as a template for the generated `stage-c-generated-counter-events.spec.ts` is ~50% of the work pre-done.
2. **Recent semantic change has high regression risk.** The legality patch (A OR (B AND C)) + the dispatcher fix (skip break on `pending.kind === 'attack'`) + 14 card-data patches are all changes from the last two sessions. Generated counter-event Stage C will surface any cards we missed. Doing it FIRST closes the recent-change risk window.
3. **12 newly counter-playable cards are unverified.** EB03-029, EB03-038, EB03-049, EB04-008, EB04-009, EB04-029, EB04-040, EB04-050, OP04-037, OP04-076, OP06-017, OP06-059 became counter-playable as a side-effect of the legality patch. They have never been exercised as counters. Stage C must validate them; if any fail, the failures inform follow-up cards.json or engine fixes.
4. **Bounded set.** Counter events are ~70-90 cards (events with `counter_event` tag OR `counterEventBoost > 0`) — small enough to fit in one 3-slice family run, large enough to exercise the Stage C taxonomy meaningfully before scaling to ~hundreds of on_play events.
5. **Sharp pre/post comparison available.** The audit specs already classify the 8+6+59 patched counter events. Stage C's generated counter-event spec should reproduce those classifications. Any mismatch is a regression signal.

### Why NOT on_play events first

On_play events are higher-volume (likely ~200-400 cards) and would force Stage C to deal with its hardest scale + UI parity questions BEFORE proving the per-card contract works. Counter events let the contract be validated on a smaller, recently-touched surface where divergences are likely + cheap to investigate. On_play events become target #2 once counter events are green.

### Success criteria for the first Stage C generated spec

`e2e/stage-c-generated-counter-events.spec.ts` PASSES iff ALL of the following hold:

| # | Criterion |
|---:|---|
| 1 | Every event card in cards.json with `effectTags includes 'counter_event'` OR `counterEventBoost > 0` is iterated exactly once |
| 2 | Each card produces a `StageCResult` record on disk |
| 3 | 0 pageerrors and 0 InvariantErrors across the entire run |
| 4 | No stuck pending at slice end |
| 5 | The 8 condition-gated cards (OP03-055, OP03-072, OP03-097, OP05-037, OP06-115, OP07-076, OP08-115, OP14-078) classify VERIFIED |
| 6 | The 6 magnitude-mismatch cards (OP01-029, OP04-095, OP05-114, OP07-035, OP07-095, OP11-059) classify VERIFIED |
| 7 | The Stage A baseline OP01-118 Ulti-Mortar classifies VERIFIED |
| 8 | The over-broadening guard (synthetic non-counter event with `effectTags:['draw']` and no `counter_event` tag) classifies NOT_IMPLEMENTED (correctly excluded by legality) — proves the patched legality doesn't drift |
| 9 | The 12 newly counter-playable cards classify either VERIFIED or surface a single root-cause cluster |
| 10 | Per-card setup recipe is recorded so a failing card can be re-run in isolation by reading its result JSON |
| 11 | Slice runtime under 5 minutes (cap) |
| 12 | Spec works against a freshly-restarted Vite dev server (cards.json picked up correctly) |

A first-target FAIL on criteria 5-8 indicates a regression in the recent work and is a HARD blocker for Stage C continuation.

---

## 9. Stop conditions

Stage C must HALT and surface to the owner if any of the following occur:

| # | Condition | Action on trigger |
|---:|---|---|
| 1 | A systemic engine bug (InvariantError reproducible across multiple cards) | Halt the family. Bisect by card. Report root cause. Owner gates the fix before resume. |
| 2 | A slice has >10% HARNESS_BUG rate | Halt the slice. The harness is the problem; fix the recipe/helper before continuing. |
| 3 | The same CARD_DATA_BUG signature repeats across ≥5 cards | Halt the family. Cluster the cards. Propose a batched cards.json fix. Owner approves before resume. |
| 4 | Any Stage A or Stage B regression spec turns red mid-Stage-C | Hard stop. Revert any in-flight Stage C harness change. Verify it wasn't a Vite stale-cache artifact. If real, escalate. |
| 5 | Wall-clock for a single slice exceeds 10 minutes (2× the cap) | Halt the slice. Move its cards to a slow-cards bucket; revisit batch sizing. |
| 6 | More than 25% of cards in a family classify INCONCLUSIVE | The family's recipe is under-specified. Halt; refine the recipe; rerun. |
| 7 | Any cards.json or engine change made during Stage C without owner approval | Stage C is read-only against the corpus + engine. Patches MUST come from a separate approved cycle. |

---

## 10. References

- `e2e/manual-review-backlog-plan.md` — source of unresolved backlog items in §1
- `e2e/card-effect-verification-plan.md`, `e2e/card-verification-plan.md` — prior planning docs (Stage A/B precedents)
- `e2e/stage-b-high-risk-plan.md` — Stage B precedent for plan format
- `e2e/audit-counter-event-magnitude-mismatch.spec.ts` — Group 1C audit template
- `e2e/audit-counter-event-condition-gated.spec.ts` — Group 1B/1A/1D audit template, includes guard + safety patterns
- `e2e/audit-own-chars-filter.spec.ts` — Group 4 audit template
- `shared/engine-v2/rules/legality.ts:267-285` — counter-event legality (post-patch)
- `shared/engine-v2/effects/EffectDispatcher.ts:264-280` — clause-iteration pending-break (post-patch)
- `shared/engine-v2/registry/handlers/conditions2.ts:207-237` — `if_own_chars_min_filter` (post-patch)
- `shared/engine-v2/state/types.ts:188-193` — 6 pending kinds enumerated
- `shared/data/cards.json` — corpus (current state has 14 cards patched this session)
- `playwright.config.ts:8-30` — runner config (timeout, workers, web server)

---

End of Stage C plan. No specs written yet. Implementation gated on owner approval of this plan + the first-target success criteria.
