# Engine V3 Roadmap — Card-Effect Completeness

Authored 2026-05-30. Builds on engine V2 (closed) and the V0 dispatch
infrastructure landed 2026-05-29 via D11–D19. V3 closes the remaining
templates-and-tags gaps so real OPTCG card text resolves correctly when we
start authoring per-card handlers.

The §15 divergence list in `rules-reference.md:452` tracks D1–D24 (now all
closed except D6 cosmetic). The work below is the next layer: stub templates
that no-op, real-text shortcuts in v0 templates, missing effect tags, schema
debt, and AI-policy follow-ups exposed by the Hard tier.

Numbering is V3-1 onward to keep clear of the D-series.

---

## V3-1 — ✅ `power_buff` template (HIGH) — SHIPPED 2026-05-30

- **Today:** `shared/engine/cards/effects/templates.ts:102` returns state
  unchanged. Comment: "v0: skipped (needs turn-scoped modifier system)."
- **Reality:** That system EXISTS — `CardInstance.powerModifier` (D16,
  `GameState.ts:65`) plus the end-turn clear in `phases/turn.endTurn`. The
  `set_power_zero` template (`templates.ts:109`) already uses it.
- **Scope:** Implement `power_buff` as `+param × 1` added to target's
  `powerModifier`. Mirror onto per-zone struct (leader / field / stage) like
  `set_power_zero` does. Default `param = 1000`.
- **Acceptance:**
  - On_play `power_buff` with target adds +1000 to effective power; cleared
    at end of turn.
  - Stacks with existing DON attachments.
  - Stacks with `set_power_zero` correctly (current effectivePower already
    accounts for `powerModifier`).
  - Tests: 3 cases (positive buff this turn; clears at endTurn; stacks with
    DON).
- **Unblocks:** Any card text containing "Give a character +X power this
  turn" — extremely common.

## V3-2 — ✅ `cost_reduction` + `removal_cost_reduce` templates (HIGH) — SHIPPED 2026-05-30

- **Today:** `templates.ts:143` and `templates.ts:81` both no-op.
- **Scope:** Add a turn-scoped cost modifier. Two flavors:
  - `cost_reduction`: reduces the controller's NEXT play cost by `param`.
    Cleared on play OR at end of turn.
  - `removal_cost_reduce`: reduces a specific target instance's printed cost
    by `param` for the rest of the turn (when that instance is later
    referenced for replacement/removal).
- **Schema:** Add `state.players[P].costModifierThisTurn: number` (or a
  more general per-card modifier list). Cleared in `endTurn`.
- **Acceptance:**
  - `cost_reduction` template applied → next PLAY_CARD action validates
    `playerCost - modifier <= donCostArea.length`.
  - Modifier consumed on play (one-shot) OR cleared on endTurn whichever
    comes first.
  - `removal_cost_reduce` mutates `targetInstance.costModifier` so the
    target's effective cost (for "if cost ≤ N" gated removal) drops.
  - Tests: 4 cases (apply + spend, apply + endTurn-clear, removal target
    cost change, no-target rejection).
- **Unblocks:** Cards like Hatchan "(Activate:Main) If you have less life
  than your opp, reduce cost of next play by 2."

## V3-3 — ✅ Real `searcher` (MEDIUM) — SHIPPED 2026-05-30

- **Today:** `templates.ts:29` just takes top 1 of deck → hand. No peek
  surface, no choice.
- **Scope:**
  - Engine: `searcher` reads `param = { lookCount: N, addCount: M, filter? }`,
    pulls top N to a "peek zone" on `PendingChoice`, awaits user/AI choice,
    moves M to hand, shuffles the rest back.
  - New phase: `'peek_choice'` (similar to `trigger_window`).
  - New action: `RESOLVE_PEEK { instanceIds: string[] }` (add M; rest go
    back to deck after a shuffle).
  - View-restriction: `viewForPlayer` exposes the peek-zone instances to the
    controller only; opp sees them as `UNKNOWN_CARD`.
- **AI surface:** HardAi enumerates peek-choice candidates and scores via
  `evaluateForPlayer` after adding each candidate. Tie-break by cost or
  power.
- **Acceptance:**
  - V0 single-card searcher behavior is a special case (`lookCount=1,
    addCount=1`) so existing wiring keeps passing.
  - Pick UI prompt mounts in `peek_choice` phase, lists peeked cards.
  - Tests: 4 cases (look 5 pick 1 happy path; look 5 pick 0 cancel; filter
    skips non-matching; AI picks highest-power candidate).
- **Unblocks:** Nami OP01-016, Robin OP01-025, every "look at top N" card.

## V3-4 — ✅ Real `disruption` (MEDIUM) — SHIPPED 2026-05-30

- **Today:** `templates.ts:183` discards `opp.hand[0]` blindly.
- **Scope:**
  - Add `RevealChoice` mode where opp's hand is exposed to the controller
    for a single decision.
  - New phase: `'discard_choice'`.
  - New action: `RESOLVE_DISCARD { instanceId: string }`.
  - `viewForPlayer` exposes opp hand identities ONLY for the duration of the
    choice and ONLY to the controller of the disruption source.
- **AI surface:** HardAi inspects opp hand during this window (legitimately
  exposed), picks the card whose removal most hurts opp's `evaluateForPlayer`.
- **Acceptance:**
  - Discard target is the controller's pick, not the engine's `hand[0]`.
  - Hidden info exposure is single-decision scoped (no permanent memory in
    V3; that's V3-9).
  - Tests: 3 cases (controller picks highest-cost card; cancel branch
    discards nothing; empty hand short-circuits).
- **Unblocks:** Sakazuki "Look at opp hand, discard 1," etc.

## V3-5 — ✅ New effect tags (MEDIUM) — SHIPPED 2026-05-30 (engine surface only; pick UIs deferred to V3-3/V3-4)

Currently absent from the `EffectTag` union (`Card.ts:32`). Each adds:
union entry + template + dispatch whitelist entry + tests.

| Tag                  | Spec                                                                                 | Card examples                          |
|----------------------|--------------------------------------------------------------------------------------|----------------------------------------|
| `rest_opp_don`       | Move N of opp's `donCostArea` to `opp.donRested`.                                    | Yellow tempo effects                   |
| `mill`               | Move top N of controller-or-opp's deck → trash.                                      | Black mill / deck-out cards            |
| `reveal_opp_hand`    | Reveal opp hand to the controller for the resolution window only. No discard.        | Scout effects                          |
| `take_from_opp_hand` | Reveal then move 1 from opp hand → controller's hand or trash.                       | Some Black character lock effects      |
| `search_deck`        | Search whole deck for a card matching `filter`, add to hand, shuffle.                | Tutor effects (broader than searcher)  |
| `exile`              | Send card to a new `exile` zone — distinct from trash, can't recur from there.       | "Exile" removal                        |
| `play_for_free`      | Play target card from hand/trash bypassing cost-area check.                          | Trigger effects "play this for free"   |
| `rest_target`        | Rest a target character (not DON).                                                   | Lock effects                           |
| `move_to_top`        | Move a card from hand/trash to top of deck.                                          | Manipulation effects                   |

- **Schema add for exile:** `PlayerZones.exile: string[]` per player, public
  visibility.
- **Acceptance:** Each tag gets at least 1 test per direction (positive +
  negative).
- **Unblocks:** Substantial card-text coverage outside the current 12-tag
  spine.

## V3-6 — ⏸ D23 `summoningSick` defaults (LOW) — DEFERRED

Reason: V3-5's `play_for_free` already sets `summoningSick = true` inline. No
other current placement path exists. Folding into a shared helper has no
caller benefit yet — revisit when a second placement effect lands.

- **Today:** `summoningSick` only set by `applyAction.PLAY_CARD`
  (`rules-reference.md:515`). Any future effect that puts a character on
  field (e.g., `play_for_free`, `recursion`-to-field, "summon a token") will
  ship cards that are immediately attackable — bug.
- **Scope:** Centralize "place a character on field" through a helper
  `placeOnField(state, P, instanceId, opts?)` that defaults
  `summoningSick = true` unless `opts.skipSick`. Cards with `Rush` keyword
  effectively skip the practical effect via existing legality bypass.
- **Acceptance:** `play_for_free` test confirms summoning-sick on placed
  card. Existing `PLAY_CARD` test surface unchanged.

## V3-7 — ✅ D6 slot-6 trash event (LOW, cosmetic) — SHIPPED 2026-05-30

- **Today:** `applyAction.ts:93` emits `CARD_KOED` when slot 6 forces an
  earlier character to trash. Per CR §3-7-6-1-1 that's rule processing, not
  K.O. — currently the only consequence is the event name (no on_ko cards
  cascade on it). Listed as the sole open D6 in §15.2.
- **Scope:** Emit a new `CARD_TRASHED_BY_RULE` event instead of
  `CARD_KOED` for that branch. `on_ko` dispatch already skips slot-6 path,
  so no cascade.
- **Acceptance:** Test asserts the new event type on the slot-6 case.

## V3-8 — ✅ HardAi trigger-activation policy (LOW) — SHIPPED 2026-05-30

- **Today:** `HardAi.ts:simulateAction` auto-DECLINES every trigger in
  lookahead. Mirrors what AI today picks if it's the trigger owner —
  pessimistic.
- **Scope:** When AI is the trigger controller, simulate BOTH branches
  (`activate: true` and `activate: false`), pick the higher-scoring tail.
  Cap by `deadlineMs` if many triggers chain.
- **Acceptance:** Test where activating a `draw` trigger raises score → AI
  picks activate=true.

## V3-9 — ✅ `knownByViewer` memory layer for view-restriction (LOW) — SHIPPED 2026-05-30

- **Today:** `viewForPlayer.ts` is a stateless snapshot — every call redacts
  hidden zones identically.
- **Scope:** Track `state.knownByViewer: Record<PlayerId, Set<instanceId>>`
  populated when a card is revealed to that viewer by V3-3 / V3-4 / V3-5
  effects. `viewForPlayer` respects the overlay — instances in that set
  stay visible. Cleared per-zone whenever that zone is shuffled.
- **Acceptance:** Test where searcher peeks 5 → AI later "remembers" 4 it
  didn't add until next shuffle of the deck.
- **Notes:** Cheap to implement once V3-3 / V3-4 land. Defer until then.

---

## Out of scope for V3

- Simultaneous-fire ordering (CR §8-6 turn-player-first) — already noted in
  §15.1 D14 as TODO; no current call site triggers it. Defer until a card
  with chained on_ko fires lands.
- Per-card handlers (i.e., authoring real Bandai cards). V3 is engine
  surface; the actual card library is a separate body of work.
- Stage-card passive effects (e.g., "while this Stage is in play, +1000
  power to your <trait>"). Needs a continuous-effect registry.
- Multi-replacement ordering (§8-1-3-4-2) — single replacement already V0
  token.

---

## Suggested implementation order

V3-1 → V3-2 → V3-6 → V3-5 (in any order within) → V3-3 → V3-4 → V3-7 → V3-9
→ V3-8.

Rationale:
- V3-1 and V3-2 are pure template wires with infra already in place — fast wins.
- V3-6 hardens the placement helper so V3-5 (new tags that place chars) lands cleanly.
- V3-5 is mechanical: one tag at a time, each ≈30–60 LOC plus tests.
- V3-3 and V3-4 are the heaviest (new phases + UI prompts).
- V3-7 is cosmetic; bundle into a cleanup commit.
- V3-9 + V3-8 close out AI honesty + smarts after the effect surface is real.

Test target: every V3-N adds at least its acceptance tests; full suite stays
green through the sequence.
