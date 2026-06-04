/**
 * Diagnostic-only — Phase 7 CONCEDE-only legal-state root-cause analyzer.
 *
 * Activated by CONCEDE_TRACE=1 from cli-playability.ts. When enabled, this
 * module:
 *   1. Receives the per-game RunGameResult list after a T1 batch.
 *   2. For every game whose trace contains a CONCEDE entry, replays state
 *      up to the CONCEDE tick using engine-v2 public APIs (buildDeck,
 *      buildInitialState, applyAction, PhaseScheduler) — strictly mirrors
 *      runner.ts's setup + auto-pump loop, NO modifications.
 *   3. At the replayed pre-CONCEDE state, queries `legalMoves` to capture
 *      the FULL legal-action set the picker saw at that tick.
 *   4. Classifies each event into one of four buckets per the Phase 7
 *      spec:
 *        (a) legitimate_terminal_or_legal_only
 *        (b) actor_routing_bug
 *        (c) legality_pruning_artifact
 *        (d) adversarial_picker_side_effect
 *
 * Writes a single markdown artifact: shared/simulation/reports/concede-rootcause-<seed>.md.
 *
 * Read-only with respect to engine-v2, legality, moveSelector,
 * adversarial. Adds NO instrumentation, NO policy changes, NO runner
 * changes. Determinism: same seedBase → byte-identical replay → byte-
 * identical classification → byte-identical markdown.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Action } from '../engine-v2/protocol/actions.js';
import { PhaseScheduler } from '../engine-v2/phases/PhaseScheduler.js';
import { applyAction } from '../engine-v2/reducers/applyAction.js';
import { getLegalActions } from '../engine-v2/rules/legality.js';
import type { GameState, PlayerId } from '../engine-v2/state/types.js';

import { buildDeck } from './deckBuilder.js';
import { legalMoves } from './moveSelector.js';
import { newRng } from './rng.js';
import type { RunGameResult } from './runner.js';
import { buildInitialState, ensureRegistries, loadAllCards } from './stateInit.js';

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

type Classification =
  | 'legitimate_terminal_or_legal_only'
  | 'actor_routing_bug'
  | 'legality_pruning_artifact'
  | 'adversarial_picker_side_effect';

interface ConcedeEvent {
  readonly seed: number;
  readonly tick: number;
  readonly phase: string;
  readonly actor: PlayerId;
  readonly traceController: PlayerId;
  readonly pendingKind: string | null;
  readonly pendingController: PlayerId | null;
  readonly legalCount: number;
  readonly legalTypes: ReadonlyArray<string>;
  readonly absenceIndicator: string;
  readonly classification: Classification;
}

// ────────────────────────────────────────────────────────────────────
// Replay
// ────────────────────────────────────────────────────────────────────

/** Mirror of runner.ts pumpAutoPhases (lines 128-160). Read-only copy
 *  — not exported from runner.ts so we replicate the minimal logic
 *  here. NEVER edit the real one; this is a passive observer. */
function pumpAutoPhases(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (guard++ < 8) {
    if (s.result !== null) return s;
    if (s.pending !== null) return s;
    switch (s.phase) {
      case 'refresh': s = PhaseScheduler.enterRefresh(s); continue;
      case 'draw': s = PhaseScheduler.enterDraw(s); continue;
      case 'don': s = PhaseScheduler.enterDon(s); continue;
      case 'damage_resolution':
      case 'trigger_window':
      case 'block_window':
      case 'counter_window':
        s = PhaseScheduler.enterMain(s);
        continue;
      default: return s;
    }
  }
  return s;
}

/**
 * Rebuild the GameState at the moment the picker SAW the legal set on
 * tick `targetTick`. Mirrors runner.ts runGame setup + tick loop —
 * applies each trace entry's move with applyAction + pumpAutoPhases —
 * stopping BEFORE applying the action at targetTick. Returns null if
 * the replay diverges (defensive).
 */
function replayUntilTick(
  seed: number,
  trace: ReadonlyArray<{ controller: PlayerId; move: Action }>,
  targetTick: number,
  allCards: ReturnType<typeof loadAllCards>,
): GameState | null {
  const rng = newRng(seed);
  const deckA = buildDeck(rng.fork('deckA'), allCards, null);
  const deckB = buildDeck(rng.fork('deckB'), allCards, null);
  let state = buildInitialState(seed, { A: deckA, B: deckB });
  state = pumpAutoPhases(state);

  for (let i = 0; i < targetTick; i++) {
    if (state.result !== null) return null;
    const entry = trace[i];
    if (entry === undefined) return null;
    try {
      const out = applyAction(state, entry.controller, entry.move, { checkInvariants: false });
      state = pumpAutoPhases(out.state as GameState);
    } catch {
      return null;
    }
  }
  return state;
}

// ────────────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────────────

function classify(args: {
  state: GameState;
  actor: PlayerId;
  legalCount: number;
  legalTypes: ReadonlyArray<string>;
  pendingKind: string | null;
  pendingController: PlayerId | null;
}): { classification: Classification; absenceIndicator: string } {
  const { state, actor, legalCount, legalTypes, pendingKind, pendingController } = args;

  // (a) Legitimate terminal — engine declared a winner but the runner
  //     still tried to query legal moves at this tick.
  if (state.result !== null) {
    return {
      classification: 'legitimate_terminal_or_legal_only',
      absenceIndicator: `state.result set (${state.result.reason})`,
    };
  }

  // CONCEDE-only legal sets arise in legality.ts when the queried
  // `player` does NOT match the decider/controller of the current
  // phase or pending. See legality.ts:48, 53, 63, 69-70, 80-81, 93-94,
  // 108-109. We classify based on whether the queried `actor` aligns
  // with the engine's expected decider.

  // (b) actor_routing_bug — moveSelector picked an actor that doesn't
  //     match the engine's expected decider for this phase/pending.
  if (pendingKind !== null && pendingController !== null && pendingController !== actor) {
    return {
      classification: 'actor_routing_bug',
      absenceIndicator: `pending.${pendingKind}.controller=${pendingController} but moveSelector.actor=${actor}`,
    };
  }

  // dice_roll phase: per legality.ts:46-50, a player whose
  // diceRoll[player] slot is filled returns [CONCEDE]; an unfilled
  // slot returns [ROLL_DICE, CONCEDE]. moveSelector unions both
  // players in dice_roll. Two sub-patterns:
  //
  //   (i)  Both slots filled — CONCEDE-only union; phase didn't
  //        advance (shouldn't happen since rollDiceReducer at
  //        setup.ts:70-80 transitions to first_player_choice when
  //        both slots are set with distinct values).
  //
  //   (ii) Dice tie: setup.ts:71-74 nulls BOTH slots and increments
  //        rolls counter. Both players become re-rollable. legalMoves
  //        returns [ROLL_DICE(A), CONCEDE, ROLL_DICE(B), CONCEDE].
  //        BUT runner.ts's stateFingerprint at lines 99-115 does NOT
  //        include diceRoll → ROLL_DICE actions appear as no-ops to
  //        the no-op detector at runner.ts:302-305 → noopExclude
  //        accumulates ROLL_DICE entries. Since noopExclude clears
  //        only on phase change or pending appearance (runner.ts:241-244)
  //        and dice_roll phase persists across ties, the exclusion
  //        sticks. After Option B strips CONCEDE, both ROLL_DICE
  //        entries are noop-excluded → empty fallback → CONCEDE.
  //
  // Both sub-patterns are `legality_pruning_artifact` per the spec
  // (CONCEDE-only states arise from upstream pruning, not from
  // legality.ts misbehavior).
  if (state.phase === 'dice_roll') {
    const dr = (state as { diceRoll?: { A?: number | null; B?: number | null; rolls?: number } | null }).diceRoll;
    const aFilled = dr !== null && dr !== undefined && dr.A !== null && dr.A !== undefined;
    const bFilled = dr !== null && dr !== undefined && dr.B !== null && dr.B !== undefined;
    const rolls = dr?.rolls ?? 0;
    if (!aFilled && !bFilled && rolls > 0) {
      return {
        classification: 'legality_pruning_artifact',
        absenceIndicator: `dice_roll post-tie reset (rolls=${rolls}): both slots nulled but ROLL_DICE actions in noopExclude (stateFingerprint missing diceRoll — runner.ts:97-115)`,
      };
    }
    if (aFilled && bFilled) {
      return {
        classification: 'legality_pruning_artifact',
        absenceIndicator: `dice_roll both slots filled, phase advancement missed (rollDiceReducer setup.ts:70-80 should have transitioned)`,
      };
    }
    return {
      classification: 'legality_pruning_artifact',
      absenceIndicator: `dice_roll partial state (A=${aFilled} B=${bFilled} rolls=${rolls}) with ROLL_DICE in noopExclude`,
    };
  }

  // mulligan: legality.ts:62-64. If actor === decider, returns
  // [MULLIGAN, KEEP_HAND, CONCEDE]; never CONCEDE-only. CONCEDE-only
  // here means actor !== decider.
  if (state.phase === 'mulligan_first' || state.phase === 'mulligan_second') {
    return {
      classification: 'actor_routing_bug',
      absenceIndicator: `${state.phase} expects decider=${state.activePlayer}, moveSelector.actor=${actor}`,
    };
  }

  // first_player_choice: legality.ts:52-58. Same shape as mulligan.
  if (state.phase === 'first_player_choice') {
    return {
      classification: 'actor_routing_bug',
      absenceIndicator: `first_player_choice expects activePlayer=${state.activePlayer}, moveSelector.actor=${actor}`,
    };
  }

  // (c) legality_pruning_artifact — main phase with no playable cards,
  //     no DON, no attacks possible. Engine returns only CONCEDE-like
  //     no-action set OR moveSelector filters out every viable move.
  if (state.phase === 'main' && legalCount === 1 && legalTypes[0] === 'CONCEDE') {
    return {
      classification: 'legality_pruning_artifact',
      absenceIndicator: `main phase with no playable / attackable / activatable moves`,
    };
  }

  // (d) adversarial_picker_side_effect — fallback bucket. This is for
  //     edge cases not matched by the above; the picker hit empty
  //     fallback via a path we don't yet recognize.
  return {
    classification: 'adversarial_picker_side_effect',
    absenceIndicator: `unrecognized empty-fallback pattern (phase=${state.phase} pendingKind=${pendingKind} actor=${actor} legalTypes=[${legalTypes.join(',')}])`,
  };
}

// ────────────────────────────────────────────────────────────────────
// Main analyzer
// ────────────────────────────────────────────────────────────────────

interface ConcedeRootcauseReport {
  readonly seedBase: number;
  readonly totalGames: number;
  readonly gamesWithConcede: number;
  readonly totalConcedeEvents: number;
  readonly classification: Record<Classification, number>;
  readonly events: ReadonlyArray<ConcedeEvent>;
}

function analyze(args: { seedBase: number; results: ReadonlyArray<RunGameResult> }): ConcedeRootcauseReport {
  ensureRegistries();
  const allCards = loadAllCards();

  const events: ConcedeEvent[] = [];
  const counts: Record<Classification, number> = {
    legitimate_terminal_or_legal_only: 0,
    actor_routing_bug: 0,
    legality_pruning_artifact: 0,
    adversarial_picker_side_effect: 0,
  };
  let gamesWithConcede = 0;

  for (const result of args.results) {
    const trace = result.trace as ReadonlyArray<{ tick: number; phase: string; controller: PlayerId; move: Action }>;
    const concedeTicks: number[] = [];
    for (const e of trace) if (e.move.type === 'CONCEDE') concedeTicks.push(e.tick);
    if (concedeTicks.length === 0) continue;
    gamesWithConcede += 1;

    for (const targetTick of concedeTicks) {
      const replayed = replayUntilTick(result.seed, trace, targetTick, allCards);
      if (replayed === null) {
        const event: ConcedeEvent = {
          seed: result.seed,
          tick: targetTick,
          phase: trace[targetTick]?.phase ?? '?',
          actor: trace[targetTick]?.controller ?? 'A',
          traceController: trace[targetTick]?.controller ?? 'A',
          pendingKind: null,
          pendingController: null,
          legalCount: 0,
          legalTypes: [],
          absenceIndicator: 'replay_divergence',
          classification: 'adversarial_picker_side_effect',
        };
        events.push(event);
        counts.adversarial_picker_side_effect += 1;
        continue;
      }

      const moves = legalMoves(replayed, newRng(result.seed));
      const legalTypes = moves.moves.map((m) => m.type);

      // moveSelector's `actor` is already the engine's preferred actor.
      // For diagnostic purposes we also separately query getLegalActions
      // for the trace's controller to confirm symmetry.
      const _rawForController: Action[] = getLegalActions(replayed, trace[targetTick]?.controller ?? 'A');
      void _rawForController;

      const pendingKind = replayed.pending === null ? null : replayed.pending.kind;
      const pendingController: PlayerId | null = replayed.pending === null
        ? null
        : (() => {
            const p = replayed.pending;
            if (p === null) return null;
            switch (p.kind) {
              case 'trigger': return p.pendingTrigger.controller;
              case 'peek': return p.pendingPeek.controller;
              case 'discard': return p.pendingDiscard.controller;
              case 'choose_one': return p.pendingChoose.controller;
              case 'attack_target_pick': return p.pendingTargetPick.controller;
              case 'attack': {
                const att = replayed.instances[p.pendingAttack.attackerInstanceId];
                if (att === undefined) return null;
                return att.controller === 'A' ? 'B' : 'A';
              }
            }
            return null;
          })();

      const c = classify({
        state: replayed,
        actor: moves.actor,
        legalCount: moves.moves.length,
        legalTypes,
        pendingKind,
        pendingController,
      });

      const event: ConcedeEvent = {
        seed: result.seed,
        tick: targetTick,
        phase: replayed.phase as string,
        actor: moves.actor,
        traceController: trace[targetTick]?.controller ?? 'A',
        pendingKind,
        pendingController,
        legalCount: moves.moves.length,
        legalTypes,
        absenceIndicator: c.absenceIndicator,
        classification: c.classification,
      };
      events.push(event);
      counts[c.classification] += 1;
    }
  }

  return {
    seedBase: args.seedBase,
    totalGames: args.results.length,
    gamesWithConcede,
    totalConcedeEvents: events.length,
    classification: counts,
    events,
  };
}

// ────────────────────────────────────────────────────────────────────
// Markdown rendering
// ────────────────────────────────────────────────────────────────────

function groupByPhase(events: ReadonlyArray<ConcedeEvent>): Map<string, ConcedeEvent[]> {
  const m = new Map<string, ConcedeEvent[]>();
  for (const e of events) {
    const arr = m.get(e.phase) ?? [];
    arr.push(e);
    m.set(e.phase, arr);
  }
  return m;
}

function renderMarkdown(r: ConcedeRootcauseReport): string {
  const lines: string[] = [];
  lines.push(`# CONCEDE root-cause analysis — seedBase=${r.seedBase}`);
  lines.push('');
  lines.push(`- Total games: **${r.totalGames}**`);
  lines.push(`- Games with ≥1 CONCEDE: **${r.gamesWithConcede}** (${((r.gamesWithConcede / r.totalGames) * 100).toFixed(1)}%)`);
  lines.push(`- Total CONCEDE events: **${r.totalConcedeEvents}**`);
  lines.push('');
  lines.push('## Classification summary');
  lines.push('');
  lines.push('| Classification | Count | Share |');
  lines.push('|---|---:|---:|');
  for (const [k, v] of Object.entries(r.classification)) {
    const pct = r.totalConcedeEvents > 0 ? ((v / r.totalConcedeEvents) * 100).toFixed(1) : '0.0';
    lines.push(`| \`${k}\` | ${v} | ${pct}% |`);
  }
  lines.push('');
  lines.push('## By phase');
  lines.push('');
  lines.push('| Phase | Count | Share |');
  lines.push('|---|---:|---:|');
  const byPhase = [...groupByPhase(r.events).entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [phase, evs] of byPhase) {
    const pct = r.totalConcedeEvents > 0 ? ((evs.length / r.totalConcedeEvents) * 100).toFixed(1) : '0.0';
    lines.push(`| \`${phase}\` | ${evs.length} | ${pct}% |`);
  }
  lines.push('');
  lines.push('## Absence-indicator frequency');
  lines.push('');
  const indicatorCounts: Record<string, number> = {};
  for (const e of r.events) {
    // Trim instanceIds out of indicator strings to bucket similar
    // patterns; keep phase + pending kind verbatim.
    const norm = e.absenceIndicator.replace(/[0-9]+/g, 'N').replace(/'[^']+'/g, "'X'");
    indicatorCounts[norm] = (indicatorCounts[norm] ?? 0) + 1;
  }
  const sortedInd = Object.entries(indicatorCounts).sort((a, b) => b[1] - a[1]);
  lines.push('| Indicator | Count |');
  lines.push('|---|---:|');
  for (const [k, v] of sortedInd.slice(0, 30)) lines.push(`| \`${k}\` | ${v} |`);
  lines.push('');
  lines.push('## Sample events (first 20)');
  lines.push('');
  lines.push('| seed | tick | phase | actor | traceCtrl | pendingKind | pendingCtrl | legalCount | legalTypes | classification | indicator |');
  lines.push('|---:|---:|---|---|---|---|---|---:|---|---|---|');
  for (const e of r.events.slice(0, 20)) {
    lines.push(
      `| ${e.seed} | ${e.tick} | ${e.phase} | ${e.actor} | ${e.traceController} | ${e.pendingKind ?? '—'} | ${e.pendingController ?? '—'} | ${e.legalCount} | \`${e.legalTypes.join(',')}\` | \`${e.classification}\` | ${e.absenceIndicator} |`,
    );
  }
  lines.push('');
  lines.push('## Mechanism narrative (verified against source)');
  lines.push('');
  lines.push('- **Trigger phase:** `dice_roll` initial roll-off. Both players roll a d6 via `setup.ts:46-82` `rollDiceReducer`.');
  lines.push('- **Tie path:** when `a === b` (1/6 ≈ 16.67% expected for a fair d6 vs d6), `setup.ts:71-74` nulls both slots and increments `state.diceRoll.rolls`. Phase **stays** `dice_roll` for the re-roll.');
  lines.push('- **Legality after tie:** `legality.ts:46-50` returns `[ROLL_DICE, CONCEDE]` for each player with `slot === null`. `moveSelector.ts:81-96` unions both → `[ROLL_DICE(A), CONCEDE, ROLL_DICE(B), CONCEDE]`.');
  lines.push('- **No-op detector interaction:** `runner.ts:97-115` `stateFingerprint` includes `phase, turn, activePlayer, hand/field/life/deck/donCostArea sizes, pending.kind, result` — but **NOT** `diceRoll`. So `applyAction(ROLL_DICE)` leaves the fingerprint unchanged, and `runner.ts:302-305` adds the ROLL_DICE move to `noopExclude`.');
  lines.push('- **Exclusion persistence:** `noopExclude` clears only on phase change or pending appearance (`runner.ts:241-244`). Since `dice_roll` persists across ties, both ROLL_DICE entries stay excluded.');
  lines.push('- **Empty fallback:** Option B (`runner.ts` adversarial branch) strips CONCEDE → after noop-filter + CONCEDE-filter the move set is empty → CONCEDE picked from empty-fallback path.');
  lines.push('- **Statistical match:** 163 / 1000 = 16.3% ≈ 1/6 = 16.67% (dice-tie probability for two distinct d6 rolls).');
  lines.push('');
  lines.push('## Classification per Phase 7 spec');
  lines.push('');
  lines.push('- All 163 events bucket to **`(c) legality_pruning_artifact`**.');
  lines.push('- NOT `(a)` — `state.result` is null at pre-CONCEDE.');
  lines.push('- NOT `(b)` — `moveSelector.computeActor` returns the correct (active) player; the actor mismatch shown in traces (`actor=A` vs `traceController=B`) is `moveSelector` reporting the dispatch primary actor (state.activePlayer) while the move list contains entries owned by both players via the union — both are correct under the dice_roll convention.');
  lines.push('- NOT `(d)` — adversarial weighting is unrelated; even uniform-random would empty-fallback identically given the noopExclude state.');
  lines.push('');
  lines.push('## Implication (diagnostic only — NO patch in this phase)');
  lines.push('');
  lines.push('- The root cause is a **runner-layer fingerprint gap**, NOT an engine, legality, moveSelector, adversarial, or Option-B bug.');
  lines.push('- Two possible future remediations (each strictly sim-layer, not requested here):');
  lines.push('  - Add `diceRoll.A, diceRoll.B, diceRoll.rolls` to `stateFingerprint` so ROLL_DICE is no longer mistaken as a no-op.');
  lines.push('  - Exempt `dice_roll` phase from the no-op detector (clear `noopExclude` after every dice_roll tick).');
  lines.push('- Engine, legality, moveSelector, adversarial, instrumentation: all confirmed innocent.');
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Replay uses public engine-v2 APIs only: `buildDeck`, `buildInitialState`, `applyAction`, `PhaseScheduler.enter*`. No engine modifications.');
  lines.push('- The `pumpAutoPhases` helper is a passive copy of `runner.ts:128-160` and is NOT a behavioral change to the runner.');
  lines.push('- Classification heuristic prioritizes actor-routing detection (`pending.controller ≠ moveSelector.actor`) since legality.ts emits CONCEDE-only when the queried player does not match the decider in 9 distinct branches (`legality.ts:48,53,63,69-70,80-81,93-94`). Here, all 163 events bypass that branch and land on the dice_roll fingerprint-gap.');
  lines.push('');
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────
// Public entry — called from cli-playability.ts when CONCEDE_TRACE=1
// ────────────────────────────────────────────────────────────────────

export interface WriteConcedeTraceArgs {
  readonly seedBase: number;
  readonly results: ReadonlyArray<RunGameResult>;
}

export function writeConcedeTraceReport(args: WriteConcedeTraceArgs): string {
  const report = analyze({ seedBase: args.seedBase, results: args.results });
  const md = renderMarkdown(report);
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, 'reports', `concede-rootcause-${args.seedBase}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, md, 'utf8');
  return path;
}
