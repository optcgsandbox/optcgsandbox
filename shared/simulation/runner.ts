/**
 * Game runner — single-game + batch driver for the simulation layer.
 *
 * runGame(seed, plan) executes a full game with random-but-legal moves,
 * applying engine-v2 reducers only. runBatch(opts) loops runGame while
 * driving coverage scheduling and aggregating failure stats.
 */

import { applyAction } from '../engine-v2/reducers/applyAction.js';
import { PhaseScheduler } from '../engine-v2/phases/PhaseScheduler.js';
import type { Card } from '../engine-v2/cards/Card.js';
import type { Action } from '../engine-v2/protocol/actions.js';
import type { GameState } from '../engine-v2/state/types.js';

import { pickAdversarial, type WeightedMove } from './adversarial.js';
import { computeCardMeta, topByComplexity, type CardMeta } from './cardMeta.js';
import { CoverageTracker } from './coverageTracker.js';
import { buildDeck, type ForcedInclusionPlan } from './deckBuilder.js';
import { ExposureTracker } from './exposureTracker.js';
import {
  reportCrash,
  reportInvariant,
  reportNoLegalMoves,
  reportStuck,
  reportTimeout,
  writeReportToDisk,
  type DecisionTreeEntry,
  type FailureKind,
  type FailureReport,
} from './failureReporter.js';
import { resetInvariantChecks, runInvariantChecks } from './invariantChecks.js';
import { legalMoves } from './moveSelector.js';
import { newRng, type Rng } from './rng.js';
import { buildInitialState, loadAllCards, ensureRegistries } from './stateInit.js';
import { Trace, shortHash } from './trace.js';

const MAX_TICKS = 1000;
const STUCK_WINDOW = 32;
const STUCK_HASH_WINDOW = 64;

export interface RunGameResult {
  readonly seed: number;
  readonly result: 'completed' | 'failed' | 'timeout';
  readonly trace: ReadonlyArray<unknown>;
  readonly finalState: GameState;
  readonly failure?: FailureReport;
  readonly ticks: number;
  readonly turn: number;
}

export interface RunBatchOptions {
  readonly games: number;
  readonly seedBase: number;
  readonly coverage: boolean;
  readonly stopOnFailure: boolean;
  readonly writeReports: boolean;
  /** Enable adversarial weighted move selection + focus-card rotation. */
  readonly adversarial?: boolean;
  /** Every N games, inject the top-K complex cards into the deck. */
  readonly focusEveryN?: number;
  readonly focusK?: number;
  readonly onProgress?: (i: number, total: number, tracker: CoverageTracker, failures: number) => void;
}

export interface RunBatchSummary {
  readonly totalGames: number;
  readonly totalTicks: number;
  readonly corpusSize: number;
  readonly coveredCount: number;
  readonly coveragePercent: number;
  readonly uncoveredCards: ReadonlyArray<string>;
  readonly failures: number;
  readonly failureByKind: Record<FailureKind, number>;
  readonly failureSeeds: ReadonlyArray<number>;
  readonly reportPaths: ReadonlyArray<string>;
  readonly exposureTop20: ReadonlyArray<{ cardId: string; depth: number }>;
  readonly exposureBottom20: ReadonlyArray<{ cardId: string; depth: number }>;
}

/**
 * Trim a weighted-move list down to the top 10 alternatives (by weight) for
 * the failure report's decision tree. Marks the actually-picked move.
 */
function decisionTreeSnapshot(
  weighted: ReadonlyArray<WeightedMove> | null,
  picked: Action,
): ReadonlyArray<DecisionTreeEntry> | undefined {
  if (weighted === null) return undefined;
  const sorted = [...weighted].sort((a, b) => b.weight - a.weight).slice(0, 10);
  return sorted.map((w) => ({
    weight: Math.round(w.weight * 100) / 100,
    move: w.move,
    reasons: w.reasons,
    selected: JSON.stringify(w.move) === JSON.stringify(picked),
  }));
}

function stateFingerprint(state: GameState): string {
  // Short, structural fingerprint covering things that change tick-to-tick.
  // R1 hardening: include diceRoll.{A,B,rolls} so ROLL_DICE actions are no
  // longer classified as no-ops by the loop detector at lines 302-305 — see
  // shared/simulation/reports/system-behavior-summary.md §3 and
  // shared/simulation/release/engine-behavior-spec.md §5 for the prior
  // dice-tie + noopExclude artifact this corrects.
  const dr = (state as { diceRoll?: { A?: number | null; B?: number | null; rolls?: number } | null }).diceRoll;
  const parts = [
    state.phase,
    state.turn,
    state.activePlayer,
    state.players.A.hand.length,
    state.players.B.hand.length,
    state.players.A.field.length,
    state.players.B.field.length,
    state.players.A.life.length,
    state.players.B.life.length,
    state.players.A.deck.length,
    state.players.B.deck.length,
    state.players.A.donCostArea.length,
    state.players.B.donCostArea.length,
    state.pending === null ? '0' : state.pending.kind,
    state.result === null ? '0' : `R:${state.result.loser}`,
    `dr:${dr?.A ?? '_'}:${dr?.B ?? '_'}:${dr?.rolls ?? 0}`,
  ];
  return shortHash(parts.join('|'));
}

function isTerminal(state: GameState): boolean {
  return state.result !== null;
}

/**
 * Drive non-interactive phases (refresh → draw → don) forward to main.
 * The host (real UI) calls these manually for pacing; the simulator wants
 * them to advance instantly.
 */
function pumpAutoPhases(state: GameState): GameState {
  let s = state;
  // Engine sets phase='refresh' on END_TURN; drive R/D/D until 'main' or pending.
  // Also handles post-attack phases (damage_resolution / trigger_window / etc.)
  // that the engine leaves stale after clearPendingAttack — host normally
  // does this transition; simulator replicates it via enterMain.
  let guard = 0;
  while (guard++ < 8) {
    if (s.result !== null) return s;
    if (s.pending !== null) return s;
    switch (s.phase) {
      case 'refresh':
        s = PhaseScheduler.enterRefresh(s);
        continue;
      case 'draw':
        s = PhaseScheduler.enterDraw(s);
        continue;
      case 'don':
        s = PhaseScheduler.enterDon(s);
        continue;
      case 'damage_resolution':
      case 'trigger_window':
      case 'block_window':
      case 'counter_window':
        // Post-battle: pending is null, attack finished; resume main.
        s = PhaseScheduler.enterMain(s);
        continue;
      default:
        return s;
    }
  }
  return s;
}

/**
 * After an action: refold continuous + push to pumpAutoPhases if engine
 * landed us on refresh/draw/don.
 */
function postActionPump(state: GameState): GameState {
  return pumpAutoPhases(state);
}

interface LoopWindow {
  readonly hashes: string[];
  readonly fingerprints: string[];
}

function detectStuck(window: LoopWindow): string | null {
  if (window.hashes.length < STUCK_WINDOW) return null;
  // Same fingerprint repeats across STUCK_WINDOW ticks with no progress.
  const recent = window.fingerprints.slice(-STUCK_WINDOW);
  const last = recent[recent.length - 1]!;
  const allSame = recent.every((f) => f === last);
  if (allSame) return `fingerprint stable for ${STUCK_WINDOW} ticks`;
  // Hash repeats across half-window with fingerprint repeat
  const repeats = new Set(window.hashes.slice(-STUCK_HASH_WINDOW));
  if (repeats.size <= STUCK_HASH_WINDOW / 8) return `state-hash cycling: ${repeats.size} unique in last ${STUCK_HASH_WINDOW}`;
  return null;
}

export interface RunGameOptions {
  readonly adversarial?: boolean;
  readonly cardMeta?: Map<string, CardMeta>;
  readonly exposureTracker?: ExposureTracker;
}

export function runGame(
  seed: number,
  plan: ForcedInclusionPlan | null,
  tracker: CoverageTracker | null,
  allCards: ReadonlyArray<Card>,
  options: RunGameOptions = {},
): RunGameResult {
  ensureRegistries();
  resetInvariantChecks();
  const rng = newRng(seed);

  // 1. Build decks
  const deckA = buildDeck(rng.fork('deckA'), allCards, plan);
  const deckB = buildDeck(rng.fork('deckB'), allCards, null);
  if (tracker) {
    tracker.markDeck(deckA.cardIds);
    tracker.markDeck(deckB.cardIds);
    // Leaders: participated in this game (counted toward coverage criterion).
    tracker.markCardSeen(deckA.leader.id, 'seenInDeck');
    tracker.markGameParticipation(deckA.leader.id);
    tracker.markCardSeen(deckB.leader.id, 'seenInDeck');
    tracker.markGameParticipation(deckB.leader.id);
  }

  // 2. Initialize engine-v2 state
  let state = buildInitialState(seed, { A: deckA, B: deckB });
  const trace = new Trace();
  const loopWindow: LoopWindow = { hashes: [], fingerprints: [] };

  // 3. Move loop
  // Per-phase no-op exclusion: a move that produced zero state change is
  // tagged here and excluded from the next legal-move set until the phase
  // changes. Engine is authoritative; simulator just stops re-trying.
  const noopExclude = new Set<string>();
  let lastPhase: string = state.phase;
  function moveKey(m: Action): string { return JSON.stringify(m); }
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    if (isTerminal(state)) {
      return { seed, result: 'completed', trace: trace.toArray(), finalState: state, ticks: tick, turn: state.turn };
    }

    // If engine left us in a phase we should auto-pump
    state = postActionPump(state);
    if (isTerminal(state)) {
      return { seed, result: 'completed', trace: trace.toArray(), finalState: state, ticks: tick, turn: state.turn };
    }

    if (state.phase !== lastPhase || state.pending !== null) {
      // Phase changed or a pending appeared — flush no-op exclusions
      noopExclude.clear();
      lastPhase = state.phase;
    }

    // 3a. Enumerate legal moves via engine's getLegalActions (single source
    // of truth). Apply no-op exclusion (loop-safety, not legality). Never
    // let the filter wipe out all moves — fall back to raw legal set if so.
    const { actor: primaryActor, moves: rawMoves, moveActors: rawActors } = legalMoves(state, rng);
    const filteredPairs = rawMoves
      .map((m, i) => ({ m, a: rawActors[i] ?? primaryActor }))
      .filter(({ m }) => !noopExclude.has(moveKey(m)));
    const pairs = filteredPairs.length > 0
      ? filteredPairs
      : rawMoves.map((m, i) => ({ m, a: rawActors[i] ?? primaryActor }));
    const moves = pairs.map((p) => p.m);
    const actors = pairs.map((p) => p.a);
    if (moves.length === 0) {
      const failure = reportNoLegalMoves(seed, plan, state, trace.toArray());
      return { seed, result: 'failed', trace: trace.toArray(), finalState: state, failure, ticks: tick, turn: state.turn };
    }

    // 3b. Pick + apply — adversarial weighted or uniform random over engine-
    // supplied legal moves. NO simulation-side legality decisions.
    const tickRng = rng.fork(`tick:${tick}`);
    let move: Action;
    let pickedIdx: number;
    let weighted: ReadonlyArray<WeightedMove> | null = null;
    if (options.adversarial === true && options.cardMeta !== undefined) {
      // Policy-layer filter: the simulator (like EasyAi.ts:44, MediumAi.ts:53,
      // HardAi.ts:33) never voluntarily concedes. CONCEDE in legality.ts is
      // a UI/safety affordance, not a policy choice. We filter at the policy
      // boundary so adversarial.ts stays a pure weighting engine and
      // moveSelector / legality stay untouched. Empty-fallback preserves
      // dispatch in the theoretical CONCEDE-only legal set (not observed in
      // the 1000-game baseline but possible by construction).
      const policyIdxs: number[] = [];
      const policyMoves: Action[] = [];
      for (let i = 0; i < moves.length; i++) {
        if (moves[i]!.type !== 'CONCEDE') {
          policyIdxs.push(i);
          policyMoves.push(moves[i]!);
        }
      }
      if (policyMoves.length === 0) {
        const picked = pickAdversarial(state, moves as ReadonlyArray<Action>, options.cardMeta, tickRng);
        move = picked.picked;
        pickedIdx = picked.pickedIndex;
        weighted = picked.weighted;
      } else {
        const picked = pickAdversarial(state, policyMoves, options.cardMeta, tickRng);
        move = picked.picked;
        pickedIdx = policyIdxs[picked.pickedIndex]!;
        weighted = picked.weighted;
      }
    } else {
      pickedIdx = tickRng.range(moves.length);
      move = moves[pickedIdx]!;
    }
    const moveActor = actors[pickedIdx] ?? primaryActor;
    let prev = state;
    let next: GameState;
    try {
      const out = applyAction(state, moveActor, move, { checkInvariants: false });
      next = out.state as GameState;
    } catch (err) {
      const dt = decisionTreeSnapshot(weighted, move);
      const failure = reportCrash(seed, plan, state, trace.toArray(), err, dt);
      return { seed, result: 'failed', trace: trace.toArray(), finalState: state, failure, ticks: tick, turn: state.turn };
    }

    // 3c. Coverage + exposure update
    if (tracker) tracker.updateFromTransition(prev, next);
    if (options.exposureTracker) options.exposureTracker.updateFromTransition(prev, next, move);

    // 3d. Trace
    const fp = stateFingerprint(next);
    trace.push({ tick, phase: prev.phase, controller: moveActor, move, postHash: fp });

    // No-op detection: if state fingerprint unchanged AND no pending appeared,
    // engine silently rejected this move. Exclude from future picks in this
    // phase to avoid loop traps.
    const prevFp = stateFingerprint(prev);
    if (fp === prevFp && next.pending === prev.pending) {
      noopExclude.add(moveKey(move));
    }

    // 3e. Invariant check
    const violations = runInvariantChecks(next);
    if (violations.length > 0) {
      const dt = decisionTreeSnapshot(weighted, move);
      const failure = reportInvariant(seed, plan, next, trace.toArray(), violations, dt);
      return { seed, result: 'failed', trace: trace.toArray(), finalState: next, failure, ticks: tick, turn: next.turn };
    }

    // 3f. Stuck detection
    loopWindow.hashes.push(fp);
    loopWindow.fingerprints.push(fp);
    if (loopWindow.hashes.length > STUCK_HASH_WINDOW) {
      loopWindow.hashes.shift();
      loopWindow.fingerprints.shift();
    }
    const stuckReason = detectStuck(loopWindow);
    if (stuckReason !== null) {
      const dt = decisionTreeSnapshot(weighted, move);
      const failure = reportStuck(seed, plan, next, trace.toArray(), stuckReason, dt);
      return { seed, result: 'failed', trace: trace.toArray(), finalState: next, failure, ticks: tick, turn: next.turn };
    }

    state = next;
  }

  // Tick budget exhausted
  const failure = reportTimeout(seed, plan, state, trace.toArray());
  return { seed, result: 'timeout', trace: trace.toArray(), finalState: state, failure, ticks: MAX_TICKS, turn: state.turn };
}

// ─────────────────────────────────────────────────────────────────
// Batch driver
// ─────────────────────────────────────────────────────────────────

export function runBatch(opts: RunBatchOptions): RunBatchSummary {
  const allCards = loadAllCards();
  const tracker = new CoverageTracker(
    allCards.map((c) => ({ id: c.id, kind: (c as { kind: string }).kind })),
  );
  if (opts.coverage) tracker.loadFromDisk();

  const adversarial = opts.adversarial === true;
  const focusEveryN = opts.focusEveryN ?? 25;
  const focusK = opts.focusK ?? 4;

  // Pre-compute card metadata for adversarial weighting + focus rotation.
  const cardMeta = adversarial ? computeCardMeta(allCards) : new Map();
  const focusPool = adversarial ? topByComplexity(cardMeta, 200) : [];
  const exposureTracker = adversarial
    ? new ExposureTracker(allCards.map((c) => c.id))
    : null;

  const failureByKind: Record<FailureKind, number> = {
    crash: 0,
    invariant_violation: 0,
    stuck_loop: 0,
    no_legal_moves: 0,
    timeout: 0,
  };
  const failureSeeds: number[] = [];
  const reportPaths: string[] = [];
  let failures = 0;
  let totalTicks = 0;

  for (let i = 0; i < opts.games; i++) {
    // Coverage scheduling: pull a slate of uncovered cards if any remain.
    // Adversarial focus rotation: every focusEveryN games, blend in top-K
    // complex cards.
    const uncovered = opts.coverage ? tracker.getUncoveredCards(focusK) : [];
    const focusInjection =
      adversarial && i > 0 && i % focusEveryN === 0
        ? focusPool.slice((i / focusEveryN * focusK) % Math.max(1, focusPool.length - focusK), focusK)
        : [];
    const combinedForced = [...new Set([...uncovered, ...focusInjection])];
    const plan: ForcedInclusionPlan | null = combinedForced.length > 0
      ? { forcedCards: combinedForced, forcedLeader: null }
      : null;
    const seed = opts.seedBase + i;

    let result: RunGameResult;
    try {
      result = runGame(seed, plan, tracker, allCards, {
        adversarial,
        cardMeta: adversarial ? cardMeta : undefined,
        exposureTracker: exposureTracker ?? undefined,
      });
    } catch (err) {
      const e = err as { message?: string };
      console.error(`[runner-internal-crash seed=${seed}] ${e?.message ?? String(err)}`);
      throw err;
    }

    totalTicks += result.ticks;

    if (result.failure) {
      failures += 1;
      failureByKind[result.failure.kind] = (failureByKind[result.failure.kind] ?? 0) + 1;
      failureSeeds.push(seed);
      if (opts.writeReports) {
        reportPaths.push(writeReportToDisk(result.failure));
      }
      if (opts.stopOnFailure) {
        opts.onProgress?.(i + 1, opts.games, tracker, failures);
        break;
      }
    }

    tracker.incrementRunCounter();

    if ((i + 1) % 50 === 0) {
      opts.onProgress?.(i + 1, opts.games, tracker, failures);
    }
  }

  if (opts.coverage) tracker.saveToDisk();

  const exposureTop20 = exposureTracker !== null ? exposureTracker.rank('desc', 20) : [];
  const exposureBottom20 = exposureTracker !== null ? exposureTracker.rank('asc', 20) : [];

  return {
    totalGames: failureSeeds.length > 0 && opts.stopOnFailure ? failureSeeds.length : opts.games,
    totalTicks,
    corpusSize: tracker.totalCards(),
    coveredCount: tracker.coveredCount(),
    coveragePercent: tracker.coveragePercent(),
    uncoveredCards: tracker.getUncoveredCards(),
    failures,
    failureByKind,
    failureSeeds,
    reportPaths,
    exposureTop20,
    exposureBottom20,
  };
}
