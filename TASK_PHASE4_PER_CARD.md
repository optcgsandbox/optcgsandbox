# Phase 4 — Per-Card Audit Protocol

**Read this in full before starting OR resuming the per-card grind.** This is the contract. Agents follow it without deviation. Owner sets the bar: 100000000% correctness — every card plays per its printed effectText.

## ⚠️ Rules (set 2026-06-02 — owner-explicit)

**ALLOWED to fix during this pass:**
- Spec data in `cards.json` for the card being audited (filter fields, magnitude, duration, target.kind, condition.type, OPT flag, missing primitive declarations) — fix if printed text says X but spec encodes Y
- The card's own per-card test file at `shared/engine-v2/__tests__/cards/<ID>.test.ts`

**FORBIDDEN to fix during this pass:**
- Engine code under `shared/engine-v2/**` (handlers, filters, reducers, condition impls, target resolvers, cost handlers, ContinuousManager, ReplacementManager, etc.)
- Engine gaps are LOGGED in `BUGS_FOUND.md` with file:line + expected vs actual + cross-card impact count. They get fixed AFTER all 2489 cards are read + audited — in a separate dedicated pass.

**Why:** a handler fix during the audit can silently break cards #1..N-1 because no per-card semantic coverage exists yet. By gathering the full bug list first, each engine fix is evaluated against full corpus impact.

**Checkpoint:** stop every 250 cards, summarize gaps, wait for owner update.

**Auto-commit:** one commit per card audited (cards.json + per-card test + BUGS_FOUND.md), pushed automatically. No relay-back per commit.

---

## Scope

- **Target:** cards #1 through #2489 (the entire corpus) in `shared/data/cards.json` (sequential by array index).
- **Card #1 = EB01-001**, **Card #250 = OP01-005** (verified 2026-06-02).
- After 250 are audit-clean, owner decides whether to extend through the full 2489.

---

## What this is

A per-card audit pass against engine-v2. For each card:
1. Read the printed `effectText` in `shared/data/cards.json`.
2. Verify the spec (`effectSpecV2`) encodes that printed text correctly across 5 axes (text faithfulness, triggers, conditions, actions, replacements).
3. Verify the engine-v2 actually PLAYS the spec correctly by writing a per-card semantic test.
4. Fix anything wrong (spec, engine, OR test path).
5. Independent audit. Move on.

This is **not** a V1 test port. The V1 tests at `shared/engine/__tests__/cards/` are out of scope; ignore them.

---

## Source of truth

- **Printed text:** `cards.json` `effectText` field per card. This is what the card says.
- **Spec:** `cards.json` `effectSpecV2` field — must encode the printed text faithfully.
- **Engine:** `shared/engine-v2/**` — must execute the spec correctly.
- **Test:** `shared/engine-v2/__tests__/cards/<ID>.test.ts` — must assert the printed-text outcome happens when the spec is dispatched.

---

## Per-card workflow (numbered steps — do not skip)

For each card in order:

### Step 1 — Locate
- Read the card entry in `shared/data/cards.json` (use `python3` or `Read` with offset).
- Capture: `id`, `name`, `kind`, `cost`, `power`, `counterValue`, `colors`, `traits`, `keywords`, `effectText`, `effectSpecV2`.

### Step 2 — Read the printed effectText
- This is the source of truth for what the card does.
- Note: `[Activate: Main]`, `[On Play]`, `[On Your Opponent's Attack]`, `[When Attacking]`, `[Trigger]`, `[Counter]`, `[Blocker]`, `[Rush]`, `[DON!! x N]`, `[Once Per Turn]`, `(if X)`, `until end of turn`, `during this turn`, `until your next turn` — every printed token has a spec equivalent.

### Step 3 — 5-axis spec verification (per `TRACK_STATE.md:73-87`)
For each printed line of `effectText`:
1. **Trigger axis** — `[On Play]` → `trigger: "on_play"`; `[Activate: Main]` → `trigger: "activate_main"`; `[When Attacking]` → `trigger: "when_attacking"`; etc. Mismatch = spec bug.
2. **Condition axis** — printed conditionals (`"If your Leader has X"`, `"If you have N or more rested DON"`) map to `condition.type`. Combine with `and`/`or`/`not` per Plan §3.2.
3. **Magnitude axis** — printed numbers (+1000 power, KO ≤ cost 4, draw 2, etc.) match `magnitude` field. Unit conversions correct (e.g., 1-10 scale vs 0-100).
4. **Target axis** — `"your character"` → `target.kind: "your_character"`; `"opp character"` → `"opp_character"`; `"any character"` → `"any_character"`. Filter fields (`trait`, `costMax`, `costMin`, `kind`, `color`, `nameIs`, `nameExcludes`) match printed restrictions.
5. **Duration/scope axis** — `"during this turn"` → `duration: "this_turn"`; `"until the start of your next turn"` → `duration: "opp_next_turn"`; `"permanently"` → `"permanent"`; `[Once Per Turn]` → `opt: true`.

**If the spec is wrong:** DO NOT FIX. Log the gap in `BUGS_FOUND.md` (card ID, file:line, expected per printed text, actual in spec, primitive(s) involved). Continue the audit assuming the current spec is what the engine sees.

### Step 4 — Read every V2 handler the card uses
Trace each `action.kind`, `condition.type`, `target.kind`, `cost.<key>`, `continuous.action.kind`, `replacement.trigger` to its registered handler in `shared/engine-v2/registry/handlers/*.ts`. Confirm:
- Registration exists.
- Handler implementation is correct for the printed semantic.
- Field reads (`inst.attachedDon` vs `inst.attachedDonRested` etc.) match V2's split schema per `shared/engine-v2/state/types.ts`.

**If a handler is missing or buggy:** DO NOT FIX. Log the gap in `BUGS_FOUND.md` (card ID, file:line of the missing/buggy handler, expected behavior per printed text, actual implementation). Continue the audit. Engine fixes happen AFTER all 250 cards are read + audited — a separate pass against the consolidated bug list.

### Step 5 — Write the per-card semantic test
File path: `shared/engine-v2/__tests__/cards/<ID>.test.ts`. If a test file already exists from a prior session, **overwrite** it — prior session may have shortcutted.

Use `shared/engine-v2/__tests__/cards/_fixtures.ts` `buildState` for setup. Pattern:

```ts
import { buildState } from './_fixtures.js';
import { ContinuousManager } from '../../effects/ContinuousManager.js';
import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import { CostPayer } from '../../effects/CostPayer.js';
import { PhaseScheduler } from '../../phases/PhaseScheduler.js';
import { actionHandlers, targetResolvers, conditionHandlers } from '../../registry/types.js';
// ...
```

Test cases must include:
- **Positive cases** — when the printed condition holds, the effect fires AND the state mutation matches the printed outcome (specific values, not `toBeDefined`).
- **Negative cases** — when a printed gate fails (no DON attached, wrong leader trait, opp life ≥ threshold), the effect does NOT fire.
- **Boundary cases** — at the cost cap, at the power threshold, at the life threshold.
- **Duration cases** — buffs clear at the correct moment per `duration` (run `PhaseScheduler.enterEnd` or transition to verify).
- **OPT cases** if applicable — second dispatch in same turn must not fire.

Always prefer dispatching through the highest-level engine entry point that exercises the spec:
- `EffectDispatcher.dispatch(state, ctx, trigger)` for clause triggers — this runs condition + target resolver + cost + action in the right order.
- `ContinuousManager.refold(state)` for continuous effects — confirms gate + magnitude.
- `CostPayer.canPay` / `CostPayer.pay` for cost handlers — only when isolating cost behavior.
- `actionHandlers.get(kind)(state, ctx, action, targets)` only when intentionally bypassing the resolver for an isolated handler test.

### Step 6 — Run the test
```
npx vitest run shared/engine-v2/__tests__/cards/<ID>.test.ts --reporter=verbose
```

Must pass. **If anything fails:**

### Step 7 — Failure handling (NO SHORTCUTS — read this every time)

Per `feedback_no_shortcuts_on_failing_tests.md`. When a test fails:

1. **Diagnose:** read the failing line + the handler/resolver/condition impl at `shared/engine-v2/**`. Cite file:line.
2. **Classify:**
   - **(a) Test assertion is wrong for V2's correct behavior** — e.g., V2 split `attachedDon` into active vs `attachedDonRested`; the V1 assertion `attachedDon.length === 1` needs to become `attachedDonRested.length === 1` per V2 schema. Adjust the assertion + add a 1-line comment in the test explaining why V2's behavior is correct per CR + printed text.
   - **(b) V2 engine has a bug** — handler doesn't fire on_play, formula doesn't compute, condition check is inverted, etc. STOP. Log in `BUGS_FOUND.md` with file:line, expected vs actual, repro from this card. Fix the engine. Re-run.
   - **(c) Wrong entry point** — handler-direct call bypassed the target resolver's filter. Re-write the test to use `EffectDispatcher.dispatch` so the filter actually runs.

3. **Forbidden:**
   - Deleting the failing test
   - Replacing behavioral assertion with `expect(spec.foo).toBe(bar)` spec-shape check
   - `it.todo` / `it.skip` / commented-out blocks
   - Lowering threshold from `.toBe(1000)` to `.toBeDefined()` or `.toBeGreaterThan(0)`
   - "Deferred for follow-up" comments
   - Skipping the card "because it's complex" — complex cards are exactly the ones that need this audit

4. **After fix:** re-run vitest. If pass, proceed. If fail, loop steps 1-3.

### Step 8 — Audit the test
Launch an independent **Code Reviewer** sub-agent (Read tool only) to audit the new test file. The audit must verify:
- Test assertions match the printed `effectText` semantics.
- Edge cases (boundary, negative, duration, OPT) are covered.
- No prohibited shortcuts (per step 7 banned list).
- V2 entry points used correctly.

Audit must return `AUDIT PASSED`. If `AUDIT FAILED`, apply the audit's fix list and re-audit until clean.

### Step 9 — Done with this card
Move to the next card in `cards.json` order. **Do not commit per card.** Owner controls commit timing.

---

## Output deliverables (across the run)

- **N new/overwritten files:** `shared/engine-v2/__tests__/cards/<ID>.test.ts` (one per card #1-250).
- **`BUGS_FOUND.md`** (new in repo root if not present) — chronological log of engine + spec bugs surfaced during the audit. Each entry: card ID that surfaced it, file:line of the bug, expected vs actual, fix applied, before/after test result.
- **`TASK_PHASE4_PER_CARD.md` progress footer** (updated after every 10 cards) — current card index, count of clean audits, count of bugs filed.
- **No commits** unless owner explicitly says "commit". The agent's job is to produce the work; commit is owner-controlled.

---

## Constraints

- **NO SHORTCUTS** per memory `feedback_no_shortcuts_on_failing_tests.md`. Owner will catch any.
- **NO V1 test reading** — V1 tests are out of scope. Use `effectText` as source of truth.
- **Permission hook** — Bash/Edit/Write tool calls may require relay-back per `feedback_always_ask_before_agent.md` and CLAUDE.md §0b. Adapt by working in batches per turn where possible.
- **Existing engine state** — the 24 engine fixes shipped 2026-06-02 (commits `ba25147`, `91092c9`) are baseline. Do NOT revert. They are what the tests verify against.
- **Existing fixtures** at `shared/engine-v2/__tests__/cards/_fixtures.ts` — reuse. Extend if needed (and audit the extension).

---

## Progress tracking

Update this section after each batch of 10 cards.

- **Cards audited clean:** 0 / 250
- **Cards in progress:** —
- **Bugs filed (cumulative):** 0
- **Last card touched:** —

---

## Stop conditions

- All 250 cards audit-clean → notify owner; await direction (continue to 2489 OR stop).
- 5+ engine bugs accumulate without a clear fix path → notify owner; await triage.
- A card cannot be verified without owner clarification on printed text intent → log + skip with a TODO; notify owner; continue.

---

## Why this exists

Owner caught two shortcuts in the prior session (EB01-013 and EB01-014) where failing tests were replaced with spec-shape assertions instead of investigating the engine. This document removes ambiguity: the rule is now durable in the repo, not just in chat context. Future sessions and agents read this before touching any per-card test.
