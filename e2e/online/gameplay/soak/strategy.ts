/**
 * F-7k BUG-007 — Pure action-picker for the gameplay soak harness.
 *
 * Given a snapshot of a page's rendered legalAction buttons (data-action-type
 * attribute strings only — NO server state, NO mutation), returns the index
 * of the button to click next.
 *
 * Strict invariants:
 *   - Only clicks actions the server has surfaced as legal.
 *   - Never invents action shapes (no synthesizing instanceId etc.).
 *   - Priority order is the one F-7k BUG-007 task spec mandates:
 *
 *       1. DECLARE_ATTACK   (lethal-when-possible by enumeration order:
 *                            engine puts leader→leader first in
 *                            `shared/engine-v2/rules/legality.ts:234,239-247`,
 *                            so first-attack = game-progressing).
 *       2. PLAY_CARD
 *       3. ATTACH_DON
 *       4. PLAY_COUNTER     (defender on B-side during counter_window)
 *       5. DECLARE_BLOCKER  (defender during block_window)
 *       6. RESOLVE_TRIGGER  (prefer activate=true if available, then any)
 *       7. RESOLVE_DISCARD  (drain hand-size limit window —
 *                            `shared/engine-v2/phases/PhaseScheduler.ts:331-348`)
 *       8. SKIP_COUNTER     (no counter to play → skip)
 *       9. SKIP_BLOCKER     (no blocker to play → skip)
 *      10. END_TURN
 *      11. CONCEDE          (last resort — only used by the deadlock guard
 *                            in gameplay-soak.spec.ts, never by this picker).
 *
 * Skip actions outrank END_TURN because pending windows must resolve
 * before a turn can end. (The legality enumerator at line 130-138 emits
 * SKIP_* only when active player is the inactive party; an active player
 * never sees SKIP_BLOCKER/COUNTER, so the priority is unambiguous.)
 */

export interface RenderedButton {
  readonly index: number;
  readonly type: string;
  /** Title attr — used to disambiguate RESOLVE_TRIGGER activate=true vs false. */
  readonly title: string | null;
}

export interface PickResult {
  readonly index: number;
  readonly type: string;
  /** Reason this action was picked, for diagnostics. */
  readonly reason: string;
}

const ACTIVE_PRIORITY: ReadonlyArray<string> = [
  'DECLARE_ATTACK',
  'PLAY_CARD',
  'ATTACH_DON',
];

// F-7k soak v3 finding — picker was counter-happy: prioritizing
// PLAY_COUNTER above everything made defenders counter EVERY attack,
// producing stalemate matches that hit turn-cap. PLAY_COUNTER is
// demoted below SKIP_COUNTER so the picker only counters when no
// skip exists (which never happens — the engine always emits
// SKIP_COUNTER in counter_window). DECLARE_BLOCKER stays above
// SKIP_BLOCKER because saving life cards via blockers is the more
// game-progressing defender behavior.
//
// Click-path coverage for PLAY_COUNTER is preserved by:
//   shared/server/__tests__/blockerCounter.online.test.ts (deterministic)
//   e2e/online/gameplay/blocker-counter-flow.spec.ts (browser probe)
const REACTIVE_PRIORITY: ReadonlyArray<string> = [
  'DECLARE_BLOCKER',
];

const RESOLVE_PRIORITY: ReadonlyArray<string> = [
  // F-7k BUG-007.A — RESOLVE_CHOOSE_ONE / RESOLVE_PEEK / RESOLVE_TARGET_PICK
  // pending windows must be drained before any non-resolve action is legal
  // (the engine emits only the resolve action + CONCEDE for the holder
  // during these windows — see `shared/engine-v2/rules/legality.ts:107-128`).
  // First-discovered soak deadlocks (yellow / purple / red-vs-yellow seeds)
  // all surfaced this exact pattern: B with `RESOLVE_CHOOSE_ONE×2 + CONCEDE`,
  // A with `[CONCEDE]`. Without these in the picker, the soak deadlocks.
  'RESOLVE_TRIGGER',
  'RESOLVE_DISCARD',
  'RESOLVE_CHOOSE_ONE',
  'RESOLVE_PEEK',
  'RESOLVE_TARGET_PICK',
];

const SKIP_PRIORITY: ReadonlyArray<string> = [
  'SKIP_COUNTER',
  'SKIP_BLOCKER',
];

/**
 * Pick the next action a soaking player should click. Returns null if the
 * only available legalAction is CONCEDE — that's a no-op signal (the
 * orchestrator handles it).
 */
export function pickNextAction(
  buttons: ReadonlyArray<RenderedButton>,
): PickResult | null {
  const nonConcede = buttons.filter((b) => b.type !== 'CONCEDE');
  if (nonConcede.length === 0) return null;

  // 1. Active-player offensive actions (DECLARE_ATTACK / PLAY_CARD / ATTACH_DON).
  for (const t of ACTIVE_PRIORITY) {
    const btn = nonConcede.find((b) => b.type === t);
    if (btn !== undefined) {
      return { index: btn.index, type: t, reason: `active:${t}` };
    }
  }

  // 2. Reactive-defender actions (PLAY_COUNTER / DECLARE_BLOCKER).
  for (const t of REACTIVE_PRIORITY) {
    const btn = nonConcede.find((b) => b.type === t);
    if (btn !== undefined) {
      return { index: btn.index, type: t, reason: `reactive:${t}` };
    }
  }

  // 3. Pending-window resolutions.
  //    RESOLVE_TRIGGER: prefer activate=true if both variants present.
  //    The button title encodes the action type but not activate; legality
  //    enumerates two RESOLVE_TRIGGER actions, the first with activate=true
  //    (per `shared/engine-v2/rules/legality.ts:71-73`). So just pick the
  //    FIRST RESOLVE_TRIGGER button.
  for (const t of RESOLVE_PRIORITY) {
    const btn = nonConcede.find((b) => b.type === t);
    if (btn !== undefined) {
      return { index: btn.index, type: t, reason: `resolve:${t}` };
    }
  }

  // 4. SKIP_* before END_TURN — pending windows must resolve first.
  for (const t of SKIP_PRIORITY) {
    const btn = nonConcede.find((b) => b.type === t);
    if (btn !== undefined) {
      return { index: btn.index, type: t, reason: `skip:${t}` };
    }
  }

  // 5. END_TURN.
  const end = nonConcede.find((b) => b.type === 'END_TURN');
  if (end !== undefined) {
    return { index: end.index, type: 'END_TURN', reason: 'end_turn' };
  }

  // No actionable legal action surfaced other than CONCEDE. The orchestrator
  // treats this as a soft-lock signal.
  return null;
}
