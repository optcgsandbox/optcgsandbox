# F-11C — Final Card-Mapping Confidence

**Date:** 2026-06-17 · **Scope:** data-correctness only (cards.json + tests). No engine/UI/AI/multiplayer changes. Not committed.

Tests: `npx vitest run` → **1167 passed / 0 failed / 2 skipped**. `npm run build` → green.

---

## Headline

**Proven-wrong: 11 → 3.** The 3 remaining are **not data-fixable** — each is blocked by a missing engine capability, documented exactly below. We **cannot** yet truthfully say "zero known-wrong cards"; we can say **"exactly 3 known-wrong cards remain, each blocked by a specific missing engine handler, none fixable in data."**

```
Total cards:        2489
Known-correct:      1787
Proven-wrong:          3   (all engine-blocked — see §4)
Unsupported:          19   (9 author-safe + 10 manual; 3 have truncated source text)
Needs-human-review:  680   (flagged provenance — unverified)
```
(1787 + 3 + 19 + 680 = 2489.)

---

## 1. Phase 1 — Entangled life-to-hand (5) → ALL FIXED

Root cause (all 5): **class-C double-modeling.** "You may [add 1 life to hand](COST): EFFECT" was modeled as `clause[0]{cost:flipLife, action:life_to_hand}` (flips a life card AND moves one to hand = double consumption) + a separate **cost-free** EFFECT clause (so the effect fired even without paying). Fixed → ONE clause: cost `{lifeToHand:1}` gating the real effect.

| card | text (cost: effect) | fix |
|---|---|---|
| P-036 | life→hand : +1000 self & leader | 1 clause, `lifeToHand` cost + `sequence`[buff self, buff leader] |
| P-073 | life→hand : +1000 self | 1 clause, `lifeToHand` cost + power_buff |
| P-105 | life→hand : give 1 rested DON to Leader **or Character** | `lifeToHand` cost; target → `your_leader_or_character`; **+ added the missing `self_cost_buff:4` continuous** ("+4 cost") |
| ST13-012 | life→hand : look at all Life, reorder | `lifeToHand` cost + `peek_and_reorder_own_life` |
| PRB02-016 | rest this + life→hand : 1 Leader **or Character** +3000 | 1 clause, cost `{restSelf, lifeToHand}`; target → `your_leader_or_character` (also pruned from the F8A-F1 cost-dup exception list) |

Runtime-proven: P-036 pays exactly 1 life to hand (not double) and buffs both self + leader (`mapping-fixes-f11c.test.ts`).

## 2. Phase 2 — F-8A-class (3): 1 partial-fix, 2 remain blocked

| card | bug | verdict |
|---|---|---|
| **ST28-004** | (a) cost `donCost:2` (rests from cost area) vs text "return given DON to cost area rested" → **FIXED** `returnAttachedDon:2` (handler matches exactly). (b) continuous buffs **characters** but text says "your **Leader** gains +1000" | **REMAINS** — (b) is engine-blocked (§4) |
| **ST22-001** | action `bottom_of_deck_from_hand` vs text "place at **TOP** of deck" | **REMAINS** — engine-blocked (§4) |
| **OP14-058** | (a) bounce target `opp_character` vs text "return any Character" → **FIXED** `any_character`. (b) `[Main]`/`[Counter]` sections both modeled as `on_play` (both fire together) | **REMAINS** — (b) is engine-blocked (§4) |

## 3. Phase 3 — PARTIALs (3) → ALL FIXED

| card | bug | fix |
|---|---|---|
| **P-092** | continuous `-3000` was `condition: always` (permanent) vs text "[Opponent's Turn]" | `condition: is_opp_turn` |
| **ST27-005** | KO target `opp_character` vs "1 Character"; missing `[On K.O.]` clause | target → `any_character`; **added** `[On K.O.]` `recursion(black, 1)` |
| **EB03-055** | missing `[Opponent's Turn][On K.O.]` "deal 1 damage" clause | **added** `[On K.O.]` `deal_damage_opp(1)` gated on `is_opp_turn`. (Soft note: `add_to_own_life_top` adds 1, not "up to 2" — an F-9-class count/choice limitation shared corpus-wide, not a text↔spec mapping error.) |

Runtime-proven: ST28-004 returns 2 given DON to `donRested`; ST27-005's on_ko pulls a black card from trash to hand; EB03-055's on_ko deals 1 damage on the opponent's turn (`mapping-fixes-f11c.test.ts`).

---

## 4. The 3 remaining proven-wrong cards — exact blockers

Each needs an **engine handler that does not exist**. None is data-fixable; authoring a spec for them with current primitives would be a guess, which the brief forbids.

1. **ST22-001 Ace & Newgate** — needs a **`top_of_deck_from_hand` action** (place a hand card on TOP of the deck). The engine has `bottom_of_deck_from_hand`, `trash_top_of_deck`, `add_to_*_life_top` — none place a hand card on top of the deck. *Blocker: new action handler.*
2. **OP14-058 Ocean Current Shoulder Throw** — needs **clause-level main-vs-counter mode discrimination**. The card has a `[Main]` ability AND a separate `[Counter]` ability; both are modeled as `on_play`, so both fire together. The engine fires `on_play` in both the main-play path and the counter window with no way to mark a clause "counter-window only." *Blocker: a clause mode flag + dispatcher gate.* (The bounce-target half is fixed.)
3. **ST28-004 Kouzuki Momonosuke** — needs a **leader-targeting continuous power buff from a character source** ("[Your Turn] if ≤2 Life, your **Leader** gains +1000"). All continuous power handlers (`aura_power_buff`, `give_continuous_power`, `self_power_buff`) target the character field or the source; none buff the controller's Leader. *Blocker: a leader-target continuous power handler.* (The DON cost half is fixed.)

These three are the right input for an **engine** ticket (F-12?), not a data pass.

---

## 5. Protection (Phase 5) — invariants added

`mapping-fixes-f11c.test.ts`:
- **No life-to-hand double-modeling** — no card carries BOTH a `flipLife` cost and a `life_to_hand` action (corpus-wide, 0).
- Spec-shape guards: P-092 `is_opp_turn`, OP14-058 bounce `any_character`, ST28-004 `returnAttachedDon:2`.
- Runtime regressions for the remodel + both new `[On K.O.]` clauses.

Combined with `don-return-cost-f11a.test.ts` and `mapping-invariants-f11b.test.ts`, every fixed bug class now has a regression guard: DON!!−N→return, life-to-hand→`lifeToHand`, next-turn→`opp_next_turn`, no double-modeling.

---

## 6. Files & exact changes

- `shared/data/cards.json` — **80 unique cards** changed across F-11A+B+C (49 DON cost-key + 18 life-to-hand key + 3 duration + 5 entangled remodel + 5 Phase-2/3). All surgical (parse→modify→re-stringify, byte-identical elsewhere; verified `cards.json` is canonical `JSON.stringify(_,2)+"\n"`).
- New tests: `don-return-cost-f11a.test.ts` (9), `mapping-invariants-f11b.test.ts` (5), `mapping-fixes-f11c.test.ts` (8).
- Updated: `cards/EB02-010.test.ts` (stale `donCost:2`), `cost-duplication-invariant.test.ts` (pruned PRB02-016).

---

## 7. Can we say "there are zero known-wrong cards"?

**No — not truthfully.** There are **exactly 3** (ST22-001, OP14-058, ST28-004), each blocked by a named missing engine handler (§4). Every other proven-wrong card from the audits is fixed and regression-guarded. The honest statement is:

> "All proven card-mapping errors that are fixable in data have been fixed (80 cards). Three cards remain known-wrong; each is blocked by a specific missing engine capability and is deferred to an engine pass." 

Separately, **680 cards remain unverified** (`flagged`, NEEDS_HUMAN_REVIEW) — those are unknown, not known-correct, and are the next real frontier (per-card reading pass).
