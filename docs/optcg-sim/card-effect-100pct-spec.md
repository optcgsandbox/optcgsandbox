# Card-Effect 100% Fidelity Spec

Authored 2026-05-30. Supersedes `card-effect-extraction-method.md` (which
targeted ≥95%). Goal: every card in the 2489-card corpus has a structured
`effectSpec` that faithfully reproduces its printed Bandai behavior when
the engine executes it.

## Why 100%

Owner direction 2026-05-30: "every card needs to be accurate. correct cost,
trigger, effect, counter, everything. if that takes days then ok." This
spec captures the methodology that gets there without misclassifications.

## Acceptance criteria

For each of the 2489 cards:
- Trigger condition matches printed text exactly.
- Activation cost (DON, discard, rest, etc.) modeled or explicitly noted as
  V0-deferred with a known engine gap.
- Effect action(s) match printed clauses in order.
- Condition(s) on each clause match printed `if`-conditionals exactly.
- Target descriptors (cost cap, color, trait, type, name filters) match.
- Magnitudes (draw N, +M power, top N peek, etc.) match.
- Counter values (printed chip) match the `cards.counter` column already
  ingested.
- Cost (DON to play) matches the `cards.cost` column already ingested.
- Card is annotated `verified: 'ground-truth'` after human sign-off.

Exit gate: `npm run verify-corpus` reports 100% of cards pass automated
verification AND every card carries `verified: 'ground-truth'` OR
`verified: 'human-deferred'` (explicit acknowledgement that the card's
effect exceeds V0 engine capability).

---

## Schema-gap findings (Phase A input)

Top-15 most-complex card sampling surfaced effect patterns the current
`EffectSpec` schema cannot express. Each gap maps to a schema addition.

| # | Pattern                                              | Example card        | Current schema? | Proposed addition |
|---|------------------------------------------------------|---------------------|-----------------|-------------------|
| 1 | Player choice between N action options               | OP05-096            | NO              | `EffectChoice` wrapper with `options: EffectSpec[]` |
| 2 | Multi-tier conditional effect by zone count          | OP15-092            | NO              | `if_trash_min`/`if_don_min` chained; need scaling logic |
| 3 | Replacement: would-be-K.O.'d, do X instead           | EB04-031            | Partial (D19)   | Generalize replacement registry |
| 4 | Reactive trigger: when opp plays char of cost N+     | OP12-081            | NO              | New trigger `when_opp_plays`, `when_opp_attacks` |
| 5 | Place card at top/bottom of opp's Life face-up       | OP05-096            | NO              | New target `opp_life_top` + action `place_face_up_life` |
| 6 | Negate target's effect                               | OP09-093            | NO              | New action `negate_effect`; needs effect-suppression state |
| 7 | Lock: cannot rest / cannot attack until X            | OP09-093, OP14-119  | NO              | New action `lock_target`; `lockUntil: PhaseMarker` field |
| 8 | Conditional cannot-be-removed                        | OP15-118            | NO              | Continuous effect; `permission_grant` w/ condition |
| 9 | Keyword grant during turn                            | OP02-013, OP15-008  | NO              | `give_keyword` action w/ `duration: 'this_turn' \| 'permanent'` |
| 10 | Cost: discard N cards from hand                     | OP06-062, OP14-119  | NO              | `EffectCost.discardHand: N` precondition |
| 11 | DON!! −N cost (return DON from field to deck)       | EB04-031, OP07-072  | Partial         | `EffectCost.donCost: N`; engine already has donCost on card |
| 12 | Mass effect: "give ALL opp characters X"            | OP15-008            | NO              | New target `all_opp_characters`, `all_your_characters` |
| 13 | Per-X scaling magnitude                              | OP15-008            | NO              | `magnitude.formula: 'per_X_n_Y'` mini-DSL |
| 14 | Count-of-X condition                                  | OP12-081            | NO              | New conditions `if_own_chars_min_cost`, etc. |
| 15 | Play from trash for free                             | OP06-062            | Partial         | Extend `play_for_free` with `fromZone: 'hand'\|'trash'\|'deck'` |
| 16 | This-turn-played condition                           | OP09-093, OP15-008  | NO              | New condition `if_played_this_turn` |
| 17 | Continuous power/cost modifier from board state      | OP15-092            | NO              | `ContinuousEffect[]` field on Card |
| 18 | Bottom-of-deck replacement on life flip              | ST13-003            | NO              | Owner-level rule override; out of effectSpec scope |
| 19 | Type-string includes match (vs exact name)           | EB01-034, OP01-040  | NO              | `if_leader_has_type: string` (distinct from trait) |
| 20 | Different-card-names constraint                      | OP06-062            | NO              | `params.uniqueByName: true` on play_for_free |
| 21 | DON!! given to opp char (state marker)              | OP15-008            | NO              | New action `give_don_to_target`; new state field |
| 22 | Place card at top of Life face-up                    | ST13-003, OP05-096  | NO              | See #5 |
| 23 | Look at top N + reorder (no add)                     | ST17-004            | NO              | New action `peek_reorder` |
| 24 | On-block reactive (already in trigger but unused)    | OP06-009            | Partial         | `on_block` trigger already exists; wire usage |
| 25 | At end of turn marker (set DON active)               | EB02-015            | NO              | New trigger `at_end_of_turn` |
| 26 | Effect-blocked-by-keyword (vs Slash, etc.)           | OP03-008            | NO              | `damage_immunity_attribute` field on Character |

This is the V0 audit. A second pass through 50 more long-text cards is
required before locking schema (Phase A.2 below).

### Phase A.1 expansion (audit pass on cards #16-65 by complexity)

| #  | Pattern                                                  | Example card        | Proposed addition |
|----|----------------------------------------------------------|---------------------|-------------------|
| 27 | Reveal top deck card + conditional play if matches filter| OP07-048            | New action `reveal_and_play_if`; params: filter (trait/cost/type) |
| 28 | Replacement: trash X from hand instead of being K.O.'d   | OP15-003, ST22-012  | Generalized `EffectReplacement` registry (multi-flavor) |
| 29 | Trash top N of deck (own)                                | OP14-079            | New action `self_mill_top` (distinct from opp mill) |
| 30 | Treat-as-multiple-names alias                            | EB04-038            | New Card field `nameAliases: string[]` |
| 31 | Game-rule override: DON deck size                        | OP15-058            | New top-level `gameRuleOverride` on Card |
| 32 | Game-rule override: deck construction restriction        | OP13-079            | Same as #31, different override |
| 33 | At-start-of-game play Stage from deck                    | OP13-079            | New action under at_start_of_game: `play_stage_from_deck` |
| 34 | Conditional Blocker grant (continuous)                   | OP07-029            | `continuous_keyword_grant` with `condition` field |
| 35 | Turn-face-up-life as a payable COST                      | OP15-114, EB03-053  | New `EffectCost.flipLife: N` precondition |
| 36 | Reactive trigger: opp attack declared                    | OP02-085, OP04-068, EB01-034 | New trigger `on_opp_attack` |
| 37 | Reactive trigger: card removed from Life cards           | OP11-041            | New trigger `on_life_changed` |
| 38 | Reactive trigger: opp's Refresh phase                    | OP15-023, EB02-015  | New trigger `at_opp_refresh` |
| 39 | For-every-N scaling magnitude                            | OP07-091, OP15-002  | `magnitudeFormula: 'per_count'` with `count_source` + `divisor` |
| 40 | Power BECOMES X (set base, not delta)                    | ST26-005, OP06-009  | New action `set_base_power` distinct from power_buff |
| 41 | DON given to opp's leader/character                      | OP15-023, OP15-008  | New action `give_don_to_opp_target`; new state field |
| 42 | Reveal opp's deck top (N cards)                          | OP11-070            | New action `peek_opp_deck`; populates knownByViewer |
| 43 | Multi-color leader condition                             | ST26-005, EB02-061  | New condition `if_leader_multicolored` |
| 44 | Same-card-name play-from-trash                           | EB02-039            | `play_for_free.params.matchTrashedName: true` |
| 45 | Effect negation on opp board                             | OP13-064            | `negate_target_effects` action; needs effect-suppression marker on instance |
| 46 | Restrict opp attack with conditional cost                | OP08-043            | New action `restrict_opp_attack`; `unless: {discardN: 2}` |
| 47 | Activate Event from hand as part of activate_main        | OP12-041            | `activate_event_from_hand` with cost filter |
| 48 | Place arbitrary trash → bottom of deck                   | OP07-091            | New action `bottom_of_deck_from_trash` with count |
| 49 | Conditional Blocker + cost grant (cost ↑)                | ST25-005, OP07-029  | `continuous_keyword_grant` extension with `cost_modifier` |
| 50 | Effect-only-on-opponent's-turn                           | OP12-102            | New trigger frame `during_opp_turn` |
| 51 | Negate single specific effect                            | OP09-093            | Same as #6, extended |
| 52 | Play from trash with cost filter + uniqueByName          | OP06-062            | `play_for_free.params.uniqueByName + costMax + fromZone:'trash'` |
| 53 | Conditional Rush at game state                           | OP13-119            | `give_keyword` with `condition: if_own_life_max` |
| 54 | Effect cost: trash 1 of YOUR characters                  | OP14-079, OP15-026  | New `EffectCost.koSelfCharacter: trait?` |
| 55 | All-affected mass effect targeting your characters       | OP12-073            | New target `all_your_characters_filtered`; with trait/type filter |
| 56 | DON return as cost (different from DON!! −N)             | EB02-061            | New cost `returnActiveDonToDeck: N` distinct from donCost |
| 57 | Set Character base power to opp's Leader's base power    | OP06-009            | New action `set_base_power_copy_from`; param: source |
| 58 | Look at opp deck top (1 card)                            | OP11-070            | See #42 |
| 59 | DON state: "given DON" tracking                          | OP15-008            | Pin state on target instance: `givenDonCount` |
| 60 | "Cannot be removed by your opponent's effect"            | OP15-118, OP14-079  | Continuous `immunity` flag with `source` discriminator |
| 61 | "Cannot attack until end of opp's next End Phase"        | OP09-093, OP14-120  | `attack_lock_until_phase` action |
| 62 | "Cannot be rested until end of opp's next turn"          | OP14-119, EB02-011  | `rest_lock_until_phase` action |
| 63 | At-end-of-this-turn defer (set DON active)               | EB02-015            | New trigger frame `at_end_of_turn_self` |
| 64 | Returning your own DON to deck as cost                   | OP02-085, EB02-061  | See #56 |
| 65 | Conditional Rush + power buff w/ Don return cost         | ST28-004            | Combined cost + multiple effect clauses |
| 66 | Counter event with conditional bonus                     | OP15-095, OP01-029  | `EffectCost.flipLife` + chained condition + bonus magnitude |
| 67 | Activate while-cost-area-≤-opp condition                 | EB02-041, OP12-073  | New condition `if_own_don_le_opp` |
| 68 | Multi-step searcher: peek + add filtered + play another  | EB02-013, EB02-028  | Composite action — clause chain handles natively |
| 69 | At start of opp's next End Phase trigger expiry          | OP14-119, OP09-093  | Phase marker reference for lock_until_phase |
| 70 | Counter event flat 3000 leader boost                     | EB03-038, EB03-049  | Already covered by power_buff target:your_leader; verified |
| 71 | Add to top of opp's Life cards face-up                   | OP05-096, OP12-119  | New action `add_to_opp_life_top_face_up` |
| 72 | Add to top of own Life cards from hand/trash             | OP12-119, ST13-003  | New action `add_to_own_life_top_face_up` |
| 73 | Multi-target play from hand at once                      | OP06-062 (4 cards)  | `play_for_free.params.count: N` |
| 74 | Discard from top of OPP's deck (mill opp)                | (separate, OP-mill) | New action `mill_opp` (distinct from self mill) |
| 75 | Conditional power on opp's turn                          | OP15-092            | `during_opp_turn` continuous |

Total cataloged after expansion: 75 distinct patterns. Schema must
support all 75 before Phase A.3 lock.

### Phase A.1 audit pass 3 (cards #66-150 by complexity)

| #  | Pattern                                                  | Example card        | Proposed addition |
|----|----------------------------------------------------------|---------------------|-------------------|
| 76 | Add to top of own Life FACE-DOWN (vs face-up)            | ST13-005            | Action `add_to_own_life_top` with `faceUp: boolean` |
| 77 | End-of-turn trash all face-up Life cards                 | ST13-002            | Action `trash_face_up_life`; trigger at_end_of_turn_self |
| 78 | Self-loss prevention game-rule override                  | OP15-022            | `gameRuleOverride.deckOutGrace: 'until_end_of_turn'` |
| 79 | Choose-cost + reveal opp deck top conditional            | OP11-066, OP11-073  | New action `choose_cost_reveal_opp_match` |
| 80 | Next-play cost reduction by card name                    | OP12-061            | `cost_reduction.scope: { cardName: string, costMin?: number }` |
| 81 | "Cannot play Character cards this turn" restriction      | OP14-020            | Action `restrict_play_self_this_turn` |
| 82 | DON return-to-match-opp dynamic count                    | OP08-074            | `magnitudeFormula: 'match_opp_don_count'` |
| 83 | Conditional self-set-active at EoT                       | OP09-037            | Trigger `at_end_of_turn_self` + condition `if_own_rested_chars_min: 3` |
| 84 | Damage-taken trigger (multi-event)                       | OP13-002            | New trigger `on_damage_taken_or_self_ko` (union of two events) |
| 85 | Look at opp Life + reorder (no flip)                     | EB01-052            | Action `peek_and_reorder_opp_life` |
| 86 | Turn ALL own Life cards face-down                        | EB01-052            | Action `turn_all_own_life_face_down` |
| 87 | Restrict effect-type within turn                         | EB04-016            | `restrict_effect_type` action with effect-source filter |
| 88 | Reactive on DON-returned-to-deck                         | EB02-035            | New trigger `on_own_don_returned` |
| 89 | End-of-turn self-trash (Stage)                           | OP05-040            | Action `self_trash_at_end_of_turn` |
| 90 | Reveal-as-cost (reveal N cards of type from hand)        | OP12-015            | `EffectCost.revealHand: { count: N, kindFilter? }` |
| 91 | Cost modifier on card while in hand (continuous)         | EB04-061            | `continuous.cost_modifier_in_hand: { condition, delta }` |
| 92 | Attribute filter on attacker                             | OP11-088            | Condition `if_attacker_has_attribute: '<Slash>' \| ...` |
| 93 | "Until end of opp's next End Phase" duration             | OP09-093, OP14-119  | Duration enum: `'this_turn' \| 'opp_next_turn' \| 'opp_next_end_phase'` |
| 94 | Effect with conditional self-power gain by trash size    | OP15-002, OP14-096  | Condition + magnitude reading `state.trash.length` |
| 95 | Place opp life card to opp hand                           | EB03-053            | Action `add_to_opp_hand_from_opp_life` |
| 96 | "Reveal 2 events from hand" cost pattern                 | OP12-015            | See #90 |
| 97 | "Don given to opp char" state marker                     | OP15-008, OP15-023, OP15-026 | See #41, confirmed widespread |
| 98 | Activate Event from hand triggered                       | OP12-041            | See #47 |

Total after 3 audit passes: ~95 distinct patterns (some duplicates folded
inline). Diminishing returns past pass 3 — rare cards mostly cluster around
the existing pattern set. Declaring Phase A.1 complete at this coverage.

Patterns NOT yet inventoried but acknowledged as "long tail" — to be
added in Phase A.4 (schema patches as encountered):
  - Stage-card passive continuous effects (e.g. "all of your X gain Y").
  - At-start-of-game deck composition checks.
  - Cross-color leader interactions.
  - Multi-stage stacking choreography.
  - Self-trash-as-replacement on K.O. (variant of #28 with self target).

---

## Phases

### Phase A — Schema completeness (target: support every card)

A.1 Audit pass: read 50 more long-text cards beyond the initial 15. Update
    the gap table above with any new pattern.
A.2 Draft full schema extension covering all gaps. Each new field/action/
    trigger/condition must have at least one example card cited.
A.3 Implement schema in `shared/engine/cards/Card.ts` and a fresh
    `shared/engine/effectSpec/types.ts`. Old `effectTags` + `templateParams`
    stays for fallback during migration.
A.4 Build the interpreter `runEffectSpec` to handle every new construct.
    Each new construct gets at least 1 unit test.
A.5 Build the verification harness: given a card and its expected
    behavior, simulate placement + trigger fire + assert post-state.

Exit gate: every pattern in the schema gap table has a passing interpreter
test. ≥95% engine test coverage on the runner.

### Phase B — Deterministic extractor (high-frequency patterns)

B.1 Inventory the recurring text templates by frequency (cluster
    effect_text by regex similarity). Pick the top 30 patterns covering
    the most cards.
B.2 Write one regex extractor per pattern. Each extractor is paired with
    unit tests: 5+ positive examples (cards that should match) + 3+
    negative examples (cards that should NOT match).
B.3 Run extractors against the full 2489-card corpus. Cards matching get
    `verified: 'auto'`.

Exit gate: ~70% of corpus has `verified: 'auto'` specs. Random sample of
50 spot-checked by human — 100% accuracy.

### Phase C — Pattern catalog for the tail (next ~25%)

C.1 Group cards still without specs by text-shape similarity.
C.2 For each cluster (≥3 cards), write a cluster-template extractor.
C.3 Spot-check each cluster's output before committing.

Exit gate: ~95% of corpus has `verified: 'auto'` specs.

### Phase D — LLM-assisted draft for the residual ~5%

D.1 Genuinely-unique cards (no cluster matches) get a Claude draft via
    subagent.
D.2 Every Claude output is human-reviewed before commit. Spec is bumped
    to `verified: 'human-reviewed'` on approval.
D.3 If Claude misclassifies, the disagreement is logged for the next
    schema iteration.

Exit gate: 100% of corpus has a spec.

### Phase E — Automated verification harness

E.1 For each spec'd card, derive an executable behavior assertion. E.g.
    "draw 2 → hand grows by 2 after on_play."
E.2 Harness reads card.json, runs the spec via the interpreter against a
    test state, compares pre/post-state to the assertion.
E.3 Failures get the card flipped to `verified: 'flagged'` and surface
    in the audit ledger.

Exit gate: 100% of cards pass the harness or are explicitly flagged with
a reason.

### Phase F — In-app debug overlay

F.1 `CardDetailModal` debug pane (toggle via `?debug=1`) renders:
   - Printed effect_text
   - Parsed effectSpec (formatted JSON)
   - `verified` provenance badge
   - Side-by-side mismatch highlighter
F.2 Spot-check tooling for the playtesting pass.

### Phase G — Audit ledger + safety gates

G.1 `data/verification-ledger.json` — append-only record of every
    spec change: `{cardId, author, source, verified, ts, before, after}`.
G.2 Pre-commit hook runs `scripts/verify-corpus.mjs`. Fails commit if
    any card moved from `ground-truth` → `auto` without explicit reason.
G.3 Feature flag `EFFECT_SPEC_ENABLED` defaults `false` in production
    until the corpus is 100% verified. Engine falls back to legacy tag
    dispatch when flag is off.
G.4 Rollback path: a single env var disables all specs and reverts to
    today's behavior. No code changes required to roll back.

---

## Verification harness specification

For each card, the harness:
1. Loads the card definition into an empty test state.
2. Synthesizes the trigger fire (e.g. PLAY_CARD the character; KO it; etc.).
3. Snapshots state before.
4. Runs the spec via `runEffectSpec`.
5. Asserts against expected behavior derived from the printed text:
   - draw N → hand grows by N
   - power_buff +M → target's effective power = base + M
   - removal_ko → target moves to trash
   - etc.
6. Reports PASS / FAIL with diff if FAIL.

The harness lives at `scripts/verify-corpus.mjs`. Run on every commit
via the pre-commit hook.

---

## Audit ledger schema

```ts
interface VerificationLedgerEntry {
  cardId: string;
  ts: string;            // ISO-8601
  author: 'regex' | 'cluster' | 'claude' | 'human';
  source: string;        // file/script that authored the spec
  verified: 'auto' | 'human-reviewed' | 'ground-truth' | 'flagged' | 'human-deferred';
  before: EffectSpec[] | null;
  after: EffectSpec[];
  reason?: string;       // why this change happened
}
```

Append-only. Never delete. Used for blame + rollback + drift analysis.

---

## Per-phase exit gates (no skipping)

| Phase | Exit gate | Owner sign-off required? |
|-------|-----------|--------------------------|
| A     | All schema-gap patterns have interpreter tests | YES |
| B     | 50-card random sample → 100% accuracy | YES |
| C     | 95% corpus coverage; spot-check passes | YES |
| D     | 100% corpus coverage; every Claude output reviewed | YES |
| E     | Verify harness green on 100% of cards | YES |
| F     | Debug overlay live; playtest pass complete | YES |
| G     | Audit ledger populated; feature flag wired | YES |

Owner must sign off each phase before the next starts. Skipping a gate
risks shipping misclassifications.

---

## Estimated effort

- Phase A: 8-12 hours (schema audit + draft + interpreter + tests).
- Phase B: 8-12 hours (regex patterns + unit tests).
- Phase C: 16-24 hours (cluster patterns).
- Phase D: 10-15 hours (LLM-assisted on ~125 unique cards + review).
- Phase E: 6-10 hours (harness + assertions).
- Phase F: 3-5 hours (debug overlay UI).
- Phase G: 2-4 hours (ledger + pre-commit hook + feature flag).

**Total: 53-82 hours over 8-12 sessions.**

API spend: ~$5 for Phase D Claude assistance (Max subscription covers
most of it via subagent calls; small fallback for the residual cases
that need API throughput).

---

## Rollback strategy

At any point during the project, if the corpus is partially specced and
gameplay regresses:
1. Set `EFFECT_SPEC_ENABLED=false` (env var or feature flag).
2. Engine falls back to legacy tag dispatch (current behavior, ≥185/185
   tests passing).
3. Investigate, fix, re-enable.

No card is ever moved from `effectSpec`-driven to spec-deleted in the
ledger — flagged cards still exist with `verified: 'flagged'` so we know
to skip them at runtime, not delete the work.

---

## Open questions (answer before Phase A.3)

- Does the schema need a `version` field so we can migrate cards as the
  schema evolves? PROBABLY YES.
- How do we handle Bandai errata (rule changes after card release)? Punt
  to V0.x — printed text is canonical for now.
- Does the engine need to support continuous effects (modify state every
  state-read), or are turn-scoped modifiers enough? Continuous needs a
  new layer; cards like OP15-092 require it.

---

## Out of scope for THIS project

- Tournament simultaneous-fire priority (CR §8-6). Tracked in
  `engine-v3-roadmap.md` D14.
- Replacement-effect ordering (CR §8-1-3-4-2). Tracked there too.
- Card art / images. Separate project.
- Multiplayer / online play. Separate project.
- Card-effect rules disputes (player vs printed text). Defer to attorney
  before any public dispute resolution.

---

*This spec is the authoritative plan for going from current state (185/185
tests, ~26% magnitudes bound) to 100% per-card fidelity. Updates require
owner sign-off and a ledger entry.*
