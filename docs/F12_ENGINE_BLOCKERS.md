# F-12 — Engine Blockers for the Last 3 Known-Wrong Cards

**Date:** 2026-06-17 · **Scope:** 3 generic engine primitives + 3 cards' data. No UI/AI/multiplayer/unrelated-engine changes. Not committed.

**Result: proven-wrong 3 → 0.** All three remaining known-wrong cards are now correctly modeled, each via a **generic, card-agnostic** primitive (hardcode grep: 0 card-ID literals, 0 card-name branches in engine production).

Tests: `npx vitest run` → **1176 passed / 0 failed / 2 skipped**. `npm run build` → green.

---

## Blocker 1 — ST22-001 (place revealed card on top of deck)

**Primitives added (generic):**
- `top_of_deck_from_hand` action (`actions3.ts`) — moves card(s) from hand to the TOP of the controller's deck (`deck.unshift`), emits `CARD_HAND_TO_DECK_TOP`. Card comes from a clause/sub-action target, else a pre-bound target, else AI/sim deterministic first-N. No free human hand-picker exists (no such UI); the human's choice is supplied upstream as the card-selecting cost (`revealHand`) and passed here via a binding — so a human never gets a silent auto-pick.
- `binding` target resolver (`targets2.ts`) — resolves a card bound earlier in the same clause (`cost.bind`/`target.bind`) to its live instance. Reusable by any action.
- `revealHand` cost (`costs2.ts`) — now honors the printed filter (canPay + pay + AI pick) and writes the revealed card to the `_costPicked` binding (same protocol as `discardHandFilter`). The human cost-picker (`costChoice.ts`) now offers only filter-matching cards.

**Data:** ST22-001 → cost `{bind:'revealed', revealHand:{count:1, filter:{typeIncludes:'Whitebeard Pirates'}}}`; action `sequence[draw 1, top_of_deck_from_hand target:{kind:'binding', name:'revealed'}]`.

**Tests:** AI path (revealed card → top, removed from hand, draw happens); human-choice path (the *chosen* card via `chosenCostIds`, not the first, goes on top); no opponent hidden-info touched.

## Blocker 2 — OP14-058 ([Main]/[Counter] mode discrimination)

**Primitive added (generic):**
- `EffectClauseV2.mode?: 'main' | 'counter'` (`spec/types.ts`) — `undefined` = fires in any mode (default for ~all cards).
- `EffectDispatcher.dispatch` gains an `opts.mode` (default `'main'`) and skips a clause when `clause.mode` is set and ≠ the play mode. Generic, data-driven.
- The counter-window play (`attackFlow.ts:413`) now dispatches with `{mode:'counter'}`; main-phase plays use the default `'main'`. (The parallel sim path `safeProcessSimEvent` is a no-op in the live game — `_library` is empty — so gating the dispatcher suffices.)

**Data:** OP14-058 → clause 0 `mode:'main'` (`[Main]`: rest 3 DON → play Fish-Man + bounce); clauses 1–2 `mode:'counter'` (`[Counter]`: draw 1 + Leader +3000).

**Tests:** counter play fires only the `[Counter]` clauses (draw 1 + Leader +3000); main play fires neither counter clause (deck untouched, no Leader buff).

## Blocker 3 — ST28-004 (leader-targeting continuous power)

**Primitive added (generic):**
- `leader_power_buff` continuous handler (`continuous.ts`) — adds `magnitude` to the SOURCE controller's Leader (`players[source.controller].leader.powerModifierContinuous`). Magnitude + condition come from effect metadata. The Leader instance is in `state.instances` and reset every refold tick (`ContinuousManager.ts:58`), so the buff is idempotent and expires automatically when the condition is false or the source leaves play.

**Data:** ST28-004 continuous → `{condition:{and:[is_own_turn, if_own_life_max:2]}, action:{kind:'leader_power_buff', magnitude:1000}}` (was `aura_power_buff filter:character`, which buffed Characters instead of the Leader).

**Tests:** Leader gains +1000 from the character source when ≤2 Life on own turn; idempotent across refolds; absent at 3 Life; absent when the source isn't on the field.

---

## Files changed

Engine: `spec/types.ts`, `effects/EffectDispatcher.ts`, `reducers/attackFlow.ts`, `registry/handlers/{actions3,targets2,continuous,costs2,costChoice}.ts`.
Data: `shared/data/cards.json` — ST22-001, OP14-058, ST28-004 (3 cards).
Tests: `engine-blockers-f12.test.ts` (9).

## Final confidence

```
Total cards:        2489
Known-correct:      1790   (1787 + the 3 unblocked)
Proven-wrong:          0   ← target reached
Unsupported:          19   (unchanged — not authored)
Needs-human-review:  680   (flagged — unverified)
```

**Can we now truthfully say "there are zero known-wrong cards"?** **Yes.** Every card-mapping error proven by the F-11 audits is fixed (81 unique cards across F-11A/B/C + F-12), and the three that required engine support now have generic, tested primitives. The remaining work is **not** known-wrong: 19 cards have no authored spec (3 of them have truncated source text), and 680 `flagged` cards are unverified — both are the subject of a future authoring/reading pass, not corrections to known-bad data.
