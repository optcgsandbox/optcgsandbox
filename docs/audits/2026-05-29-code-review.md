# Code Review Audit — Phase A engine refactor + Phase B UI

- Commits: `5ec8114` (Phase A) + `937eb34` (Phase B)
- Scope: DON-as-CardInstance[], trigger window state machine, UI wiring
- Criteria: only real bugs / correctness / type-contract / engine-vs-rules mismatches introduced by Phase A or B. No style. No v0.2.

---

## BLOCKER

- **`src/components/PlayfieldStage.tsx:146` and `:157` — DON deck count renders the array, not its length.**
  - Phase A changed `donDeck` from `number` to `string[]` on `PlayerZones` (`shared/engine/GameState.ts:58`).
  - Line 146 (`ariaLabel`): `` `…DON deck, ${zones.donDeck} left` `` interpolates a `string[]`, so screen readers hear comma-joined instance IDs (e.g. `"DON deck, i12,i13,i14,… left"`).
  - Line 157 (`<span>{zones.donDeck}</span>`): React renders each array element back-to-back, displaying `i12i13i14i15i16i17i18i19` in the DON readout instead of the count.
  - Fix: `zones.donDeck.length` in both places. This is the only call site of the Phase A array rename that wasn't migrated — every other UI consumer uses `.length` or `.map`.
  - Severity: BLOCKER because the DON readout is one of the six grid-row primary readouts on the playfield — onscreen since playfield mount, visible to both players.

---

## MAJOR

- **`shared/engine/applyAction.ts:330–333` — RESOLVE_TRIGGER activate=true silently trashes the life card without running any effect.**
  - The docstring (`applyAction.ts:307–315`) and the test (`__tests__/trigger.test.ts:101`) acknowledge this is a v0 stub. Documented and tested — so per audit criteria not an engine bug.
  - BUT the public `Action` type and UI both already speak the `RESOLVE_TRIGGER` vocabulary. A user clicking "Activate" sees their card disappear into trash with no observable effect — there is no UI affordance signalling "trigger effect not yet wired." This will read as a bug to anyone who plays the prompt.
  - Recommendation (UI-side fix, not engine): `TriggerPrompt.tsx` should disable Activate or show "Effect: (not implemented yet)" for cards whose `effectTags` include `'trigger'` but have no registered handler. Currently the prompt shows `effectText` and an enabled Activate button, implying the effect will fire.
  - Severity: MAJOR usability regression introduced by Phase B wiring; engine path is honest about being a stub but the UI is not.

- **`shared/engine/applyAction.ts:235–304` — `resolveDamage` only handles ONE life card per attack; Double Attack interaction with triggers is broken.**
  - The handler does a single `defenderSide.life.shift()` then returns to main / trigger_window. Per rules-reference §1.8 the `double_attack` keyword takes 2 life on a leader hit. `Card.ts:16` lists `double_attack` as a recognised keyword and `effectivePower` is the only place attacker keywords get read — Double Attack is not consulted in damage.
  - Pre-Phase A `resolveDamage` was equally single-life; Phase A is the moment that path was modified, and the trigger branch makes it newly load-bearing: a Double Attack card KO'ing a leader at 2 life with trigger on the first card → engine flips card 1, opens trigger window, on RESOLVE_TRIGGER returns to `main`, never flips card 2, never declares lethal.
  - `pendingTrigger.resumePhase` is hardcoded to `'main'` (`applyAction.ts:266`) — there is no resume hook for "continue damaging this leader."
  - Severity: MAJOR — Phase A introduced the trigger suspend point without a resume-into-damage hook. Single-life is fine for v0.1 BUT must be flagged before the first Double Attack card lands or the engine will silently under-damage.

- **`shared/engine/__tests__/trigger.test.ts` — test gap: trigger window after a blocked attack is not covered.**
  - All 4 tests run `DECLARE_ATTACK → SKIP_BLOCKER → SKIP_COUNTER` (`trigger.test.ts:60–65, 87–92, 112–117, 134–140`). None exercise:
    - Trigger that fires after blocker absorbs the hit then dies and damage continues — N/A because blocker redirect ends the attack on character, not leader; correct.
    - Trigger after counter was played but failed to save (counter raised target power but not enough). Block-counter-resolve-trigger chain is unverified.
    - `activePlayer` continuity after RESOLVE_TRIGGER — no assertion that `getLegalActions(state, activePlayer)` returns main-phase actions on resume.
    - Life pile reaching zero with trigger on the last card.
  - Severity: MAJOR coverage gap on a state machine that branches into a new phase. Recommend at least one test for "counter played, still resolves, trigger fires."

---

## MINOR

- **`shared/engine/applyAction.ts:79 + :126` — `p.donCostArea.shift()` is FIFO (oldest DON spent first).** Confirmed correct per OPTCG: dealt DON enters the back of the cost area, players spend from the front. Not a bug.

- **`shared/engine/applyAction.ts:266` — `pendingTrigger.resumePhase: 'main'` hardcoded at every write site.** The struct field exists so future suspending effects can resume mid-flow, but every write site sets it to `'main'`. Currently fine; flag for the engine work that introduces mid-attack suspending effects.

- **`shared/engine/rules/legality.ts:17–23` — trigger_window legal actions emit RESOLVE_TRIGGER with `targetInstanceId: null` for both activate=true and activate=false.** Matches `ActionSchema` (`shared/protocol/actions.ts:48–53`). When effect templates land, the `activate=true` branch will need to enumerate target choices instead of one tuple. Document so it isn't missed.

- **`src/components/TriggerPrompt.tsx:53–70` — focus trap relies on exactly two refs.** Breaks silently if a third focusable element (target picker, "more info" link) is added inside the dialog. Acceptable for v0.1's two-button modal.

- **`src/components/PlayfieldStage.tsx:146` aria-label "DON deck, … left"** — even after fixing the array bug, "left" reads awkwardly at 0 or 1. Suggest "DON deck, N remaining". Pre-existing wording, not Phase A/B-introduced.

---

## NO FINDING

- DON detach on KO (`applyAction.ts:88–94, 289–296`): attached DON returns to `defenderSide.donRested` correctly per §1.5. Same handling in `playCard` replace path and `endTurn` (`turn.ts:81–88`). Three paths consistent.
- Refresh phase (`turn.ts:11–28`): `donRested` drained back to `donCostArea` in FIFO order. Correct.
- Setup phase (`setup.ts:9–30`) + `initialState` (`GameState.ts:141–208`): 10 DON minted as CardInstance per player, all registered in `instances` registry. Correct.
- `cards/Card.ts:47` — `'trigger'` added to `EffectTag` union. Engine reads via `lifeCard.effectTags.includes('trigger')` (`applyAction.ts:260`). Type-safe.
- `donArm.ts` — UI-only Zustand slice, never reaches engine. Dispatch path goes through `ATTACH_DON` action. Correct separation.
- `CostAreaStrip.tsx:109–114` — `interactive` correctly gated to `isYou && activePlayer === playerId && phase === 'main'`. Disarm-on-phase-change effect prevents stale armed state.
- `LifeRevealOverlay.tsx:49` — filter `ev.player === viewAs` correctly hides opponent's life reveals.
- `TriggerPrompt.tsx:36` — `pendingTrigger.controller === viewAs` correctly hides the prompt from the attacker.
- `resolveDamage` single-life path: when life is empty (`defenderSide.life.shift()` returns undefined), lethal is set correctly (`applyAction.ts:281`). Trigger branch correctly skipped on empty life.
- 47/47 engine tests pass per commit message; trigger.test.ts covers the four primary paths (suspend, activate, decline, non-controller rejection).
