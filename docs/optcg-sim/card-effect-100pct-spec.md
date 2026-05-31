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
