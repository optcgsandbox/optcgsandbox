# Card Effect Extraction — Methodology

Authored 2026-05-30. Companion to `engine-v3-roadmap.md`. The V3 batch
delivered the tag taxonomy and per-tag default magnitudes. This document
specifies how we go the rest of the way — from "card knows it does `draw`"
to "card runs the exact algorithm its printed text describes" — without
shipping misclassifications.

## Goal

Every playable card has a structured `effectSpec` that the engine
interprets to reproduce the card's actual behavior, with at least 95%
fidelity to the printed Bandai text. Cards that fail validation fall back
to today's tag dispatch (so the worst case is "today's behavior").

## Non-goals

- Tournament rules-engine completeness (replacement effect ordering,
  simultaneous-fire priority — out of scope; tracked in
  `engine-v3-roadmap.md`).
- Card art / images.
- LLM-style "smart" effect resolution at play-time. The interpreter must be
  deterministic and engine-pure; only the EXTRACTION uses an LLM.

## Inputs

- **`cards.effect_text`** (Crew Builder Supabase) — printed Bandai text per
  card. 2489 cards covered.
- **`card_tags.tag`** (Crew Builder Supabase) — Claude-tagged effect
  category per card (already mapped to `effectTags` in V3).
- **EffectSpec schema** (this doc, §Schema).
- **ANTHROPIC_API_KEY** (Crew Builder `.env`) — for the extraction LLM call.

## Output

`shared/data/cards.json` gains, per card, an optional `effectSpec` field
populated by the extraction pipeline. Cards keep their existing `effectTags`
+ `templateParams` for back-compat fallback.

---

## Schema

```ts
// shared/engine/cards/Card.ts (proposed addition)

export type EffectTrigger =
  | 'on_play' | 'on_ko' | 'when_attacking' | 'on_block'
  | 'activate_main' | 'trigger' | 'at_start_of_game';

export type EffectCondition =
  | { type: 'always' }
  | { type: 'if_leader_is'; name: string }
  | { type: 'if_leader_has_trait'; trait: string }
  | { type: 'if_don_min'; n: number }
  | { type: 'if_own_life_max'; n: number }
  | { type: 'if_opp_life_max'; n: number }
  | { type: 'if_hand_max'; n: number }
  | { type: 'if_trash_min'; n: number };

export type EffectTarget =
  | 'self'
  | 'your_leader'
  | 'your_character'      // controller picks at play-time
  | 'opp_leader'
  | 'opp_character'       // controller picks
  | 'opp_character_cost_max'  // bounded by magnitude param
  | 'top_of_deck'
  | 'top_of_opp_deck'
  | 'opp_hand'            // controller picks
  | 'own_trash';          // controller picks

export type EffectAction =
  | 'draw'                       // magnitude = N
  | 'mill'                       // magnitude = N (own or opp by target)
  | 'lifegain'
  | 'life_to_hand'
  | 'power_buff'                 // magnitude = N power, this turn
  | 'set_power_zero'
  | 'cost_reduction'             // magnitude = N
  | 'removal_cost_reduce'        // magnitude = N
  | 'removal_ko'
  | 'removal_bounce'
  | 'exile'
  | 'rest_target'
  | 'rest_opp_don'               // magnitude = N
  | 'move_to_top'
  | 'recursion'
  | 'searcher_peek'              // params = { lookCount, addCount }
  | 'reveal_opp_hand'
  | 'take_from_opp_hand'
  | 'search_deck'
  | 'play_for_free'
  | 'give_keyword'               // params = { keyword, duration: 'turn' | 'permanent' }
  | 'ramp';                      // magnitude = N DON

export interface EffectSpec {
  trigger: EffectTrigger;
  condition?: EffectCondition;     // omit = 'always'
  action: EffectAction;
  target?: EffectTarget;
  magnitude?: number;
  params?: Record<string, unknown>;
  /** Provenance — how this spec was authored. */
  verified: 'ground-truth' | 'auto' | 'flagged';
}
```

A card's `effectSpec` is an ordered list of these — chained clauses ("Draw
1. Then, give your leader +1000 power this turn.") become two specs.

---

## Pipeline

### Stage 0 — Foundation (engine work, no LLM)

- Add the schema above to `Card.ts`.
- Build `shared/engine/cards/effects/runner.ts` exporting
  `runEffectSpec(state, ctx, specs)`. Walks the spec list, checks each
  condition against state, picks/asks for targets, calls the existing
  templates with bound magnitudes.
- Wire `fireEffects` in `dispatch.ts` to prefer `card.effectSpec` over
  `card.effectTags` when both are present.
- Unit tests: hand-craft 20-30 EffectSpec inputs covering each
  trigger × condition × action × target combination we'll see. No real
  card data yet.
- Exit gate: 20+ green unit tests, no regressions in the existing 186.

### Stage 1 — Calibration set (50 hand-authored cards)

- Pick 50 cards from the corpus that cover diverse patterns:
  - 10 vanilla characters (effectSpec = empty array).
  - 10 simple on_play (draw 1 / +1000 power / KO target).
  - 10 with conditions (if leader is X / if DON ≥ N / if opp life ≤ N).
  - 10 with chained clauses (X, then Y).
  - 5 [Trigger] cards.
  - 5 [Counter] / activate_main cards.
- Hand-author the ground-truth EffectSpec for each. Store in
  `data/calibration-cards.json`.
- These 50 are the gold standard. Mark each as
  `verified: 'ground-truth'`.

### Stage 2 — Prompt tuning

- Write the Claude prompt: schema definition + 8-10 few-shot examples
  drawn from the calibration set.
- Run Claude on the same 50 calibration cards.
- Compare LLM output to ground truth field-by-field. Score:
  - Trigger match
  - Condition match
  - Action match
  - Target match
  - Magnitude match
- Iterate prompt until every field ≥95% match across the 50.
- Document failure modes in this doc's appendix as we hit them.
- Exit gate: ≥95% per-field match. No API spend on the full corpus until
  this gate is passed.

### Stage 3 — Stratified extraction

- Group the remaining ~2440 cards into 12 batches of ~200, stratified by
  effect_tag set (so similar cards process together — easier to spot
  systematic errors).
- For each batch:
  - Run Claude with the tuned prompt.
  - JSON-validate every output. Malformed → flag, don't write spec.
  - Random-sample 10 outputs per batch for human review. Document any
    issues found.
  - Auto-flag low-confidence outputs (Claude's stated confidence < 0.7)
    for review queue.
  - Write `verified: 'auto'` for clean outputs, `verified: 'flagged'` for
    suspect ones.
- Between batches: review the spot-check findings before kicking the next
  batch. Adjust prompt if a systematic issue surfaces.
- Exit gate: all 2489 cards have either an effectSpec OR a flagged status
  the engine can fall back from.

### Stage 4 — Continuous audit

- `CardDetailModal` adds a debug section (toggleable via `?debug=1` URL
  param) showing the raw `effectSpec` next to the printed effect_text.
  Mismatch is visually obvious during play.
- Discord feedback channel for reported misclassifications. Each fix gets
  the spec promoted to `verified: 'ground-truth'` and added to the
  calibration set for future runs.

### Stage 5 — Engine wiring

- `fireEffects` short-circuits to `runEffectSpec` when `card.effectSpec`
  exists. Falls through to existing tag dispatch otherwise.
- Existing 186 tests stay green (fallback path unchanged for cards
  without specs).
- Add 10+ integration tests that load a real-corpus card and assert its
  in-game behavior matches its printed text.

---

## Cost model

- Calibration (Stage 2): 50 cards × ~1500 input + 500 output tokens ≈
  1M tokens total. Cost: ~$3.50 (Haiku 4.5 standard tier, no batch).
- Bulk (Stage 3): 2440 cards × same shape ≈ 5M tokens. Cost: ~$17.50.
- Total one-shot extraction spend: ~$20-25.
- Re-runs for failure-mode fixes: budget another $10-15.
- **Estimated total: $30-40 over the full project life.**

Time:
- Stage 0: 3-4 hours (engine + tests).
- Stage 1: 4-6 hours (hand authoring + review).
- Stage 2: 2-3 hours (prompt iteration).
- Stage 3: 4-6 hours (batched runs + spot checks).
- Stage 4: 1-2 hours (debug UI).
- Stage 5: 2-3 hours (wire + integration tests).
- **Estimated total: 16-24 hours over 3-5 sessions.**

---

## Verification gates (the audit discipline)

Before any stage advances:

1. **Schema gate:** schema reviewed; no field added without a real card
   needing it.
2. **Calibration gate:** 50 ground-truth specs reviewed and signed off.
3. **Prompt gate:** ≥95% per-field match on calibration set.
4. **Batch gate:** 10/200 spot-check finds < 2 errors per batch; otherwise
   pause + re-tune prompt.
5. **Integration gate:** existing 186 tests + new integration tests all
   green before each commit.

Skip any gate → likely ship a misclassification. Don't.

---

## Open questions (answer before Stage 0 starts)

- Should `effectSpec` REPLACE `effectTags` over time, or live alongside as
  a richer overlay? Probably co-exist; tags stay as fast-path categorization
  (used by AI heuristics, deck-builder filters).
- How do we handle cards where Bandai has issued errata? Punt to V0.x —
  treat the printed text as canonical.
- Multi-color targeting ("a Red or Green Character") — schema needs a
  `colorFilter?: CardColor[]` on EffectTarget. Add when first card requires
  it; don't pre-build.

---

## Appendix — failure mode log

(To be populated during Stages 2-3.)
