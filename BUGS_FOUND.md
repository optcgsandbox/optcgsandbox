# BUGS_FOUND — Phase 4 + 5 per-card audit log

Append-only log of spec / engine gaps surfaced during the per-card and cross-card audits.

**Format per entry:**
- Card ID (+ name) that surfaced the gap
- Date surfaced
- Gap class (spec gap / engine gap / handler missing / wrong magnitude / etc.)
- Printed text
- Actual spec / engine implementation file:line
- Cross-card impact (how many other cards use the same primitive — `python3 -c '...'` against cards.json)
- Action: **spec gaps may be fixed during audit; engine gaps are LOGGED ONLY** and queued for the post-audit engine-fix pass.

---

## EB01-001 — Kouzuki Oden (leader)

**Surfaced:** 2026-06-02 during Phase 4 audit (card #1).

### Spec gap (FIXED in cards.json during audit)
- **Printed:** "All of your {Land of Wano} type Character cards **without a Counter** have a +1000 Counter, according to the rules."
- **Spec at `shared/data/cards.json` EB01-001 `effectSpecV2.continuous[0].action.filter`:** originally `{ trait: 'Land of Wano', kind: 'character' }`.
- **Missing:** the "without a Counter" restriction (counter chip = 0/null).
- **Fix applied to cards.json:** added `counterValueMax: 0` to the filter. New filter: `{ trait: 'Land of Wano', kind: 'character', counterValueMax: 0 }`.

### Engine gap (LOGGED, NOT FIXED)
- **Required:** `CardFilter` (`shared/engine-v2/registry/handlers/filter.ts:17-44`) needs `counterValueMin` / `counterValueMax` fields + matching logic in `matchesCardFilter`.
- **Current state:** no such fields. The spec edit above is INERT until the engine learns to honor it.
- **Engine workaround currently in place:** the `auraCounterBuff` handler at `shared/engine-v2/registry/handlers/continuous.ts:315-333` has an intrinsic check that skips targets where `card.counterValue > 0`. This compensates for the missing filter support, so EB01-001 actually plays correctly today.
- **Why this is a gap anyway:** the engine intrinsic is a shortcut — printed restrictions belong in the spec's filter. Future cards using `aura_counter_buff` for OTHER restrictions (or other handlers using counter filters) would need the proper filter support.
- **Cross-card impact:** only 1 card uses `aura_counter_buff` today (EB01-001 itself, confirmed via python3 against cards.json earlier this session). Engine fix is low-risk but waits until the post-audit pass per protocol.

### Audit verdict
- **EB01-001 plays correctly in the live app** because the handler intrinsic compensates for the missing filter support.
- **Spec is now correct** (counterValueMax: 0 added).
- **Engine fix queued** for post-audit pass (add `counterValueMin`/`counterValueMax` to `CardFilter`).

---
