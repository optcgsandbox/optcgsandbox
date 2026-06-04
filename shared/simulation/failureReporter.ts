/**
 * Failure classification + report serialization for the simulation layer.
 *
 * Every detected failure becomes a structured FailureReport that contains
 * enough information for an exact replay from the original seed.
 */

// @ts-expect-error Node built-ins resolve at runtime
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime
import { dirname, resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime
import { fileURLToPath } from 'node:url';

import type { GameState } from '../engine-v2/state/types.js';

import type { ForcedInclusionPlan } from './deckBuilder.js';
import type { InvariantViolation } from './invariantChecks.js';
import type { TraceEntry } from './trace.js';

export type FailureKind = 'crash' | 'invariant_violation' | 'stuck_loop' | 'no_legal_moves' | 'timeout';

export interface StressSignature {
  handSizes: { A: number; B: number };
  boardSizes: { A: number; B: number };
  pendingKind: string | null;
  donRatio: { A: number; B: number }; // active / 10
  phaseDepth: number; // turn # as a stand-in for game depth
}

export interface DecisionTreeEntry {
  weight: number;
  move: unknown;
  reasons: ReadonlyArray<string>;
  selected: boolean;
}

export interface FailureReport {
  readonly kind: FailureKind;
  readonly seed: number;
  readonly plan: ForcedInclusionPlan | null;
  readonly trace: ReadonlyArray<TraceEntry>;
  readonly violations?: ReadonlyArray<InvariantViolation>;
  readonly error?: { message: string; stack?: string };
  readonly terminalPhase: string;
  readonly turn: number;
  readonly failingCardId?: string;
  readonly decisionTreeAtFailure?: ReadonlyArray<DecisionTreeEntry>;
  readonly stressSignature?: StressSignature;
  readonly minStateSnap: {
    phase: string;
    turn: number;
    activePlayer: string;
    pending: unknown;
    handSizes: { A: number; B: number };
    fieldSizes: { A: number; B: number };
    lifeSizes: { A: number; B: number };
    deckSizes: { A: number; B: number };
    instancesCount: number;
  };
}

export function stressSignatureOf(state: GameState): StressSignature {
  return {
    handSizes: { A: state.players.A.hand.length, B: state.players.B.hand.length },
    boardSizes: { A: state.players.A.field.length, B: state.players.B.field.length },
    pendingKind: state.pending?.kind ?? null,
    donRatio: {
      A: state.players.A.donCostArea.length / 10,
      B: state.players.B.donCostArea.length / 10,
    },
    phaseDepth: state.turn,
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const REPORTS_DIR = resolve(__dirname, 'reports');

function minSnap(state: GameState): FailureReport['minStateSnap'] {
  return {
    phase: state.phase,
    turn: state.turn,
    activePlayer: state.activePlayer,
    pending: state.pending,
    handSizes: { A: state.players.A.hand.length, B: state.players.B.hand.length },
    fieldSizes: { A: state.players.A.field.length, B: state.players.B.field.length },
    lifeSizes: { A: state.players.A.life.length, B: state.players.B.life.length },
    deckSizes: { A: state.players.A.deck.length, B: state.players.B.deck.length },
    instancesCount: Object.keys(state.instances).length,
  };
}

/**
 * Best-effort: which cardId caused the failure. Inspect the last trace
 * entry's move for an instanceId, then resolve to its cardId in state.
 */
function deriveFailingCard(state: GameState, trace: ReadonlyArray<TraceEntry>): string | undefined {
  const last = trace[trace.length - 1];
  if (last === undefined) return undefined;
  const m = last.move as { instanceId?: string; attackerInstanceId?: string; targetInstanceId?: string };
  const id = m.instanceId ?? m.attackerInstanceId ?? m.targetInstanceId;
  if (id !== undefined) {
    const inst = state.instances[id];
    return inst?.cardId;
  }
  return undefined;
}

export function reportCrash(
  seed: number,
  plan: ForcedInclusionPlan | null,
  state: GameState,
  trace: ReadonlyArray<TraceEntry>,
  err: unknown,
  decisionTree?: ReadonlyArray<DecisionTreeEntry>,
): FailureReport {
  const e = err as { message?: string; stack?: string };
  return {
    kind: 'crash',
    seed,
    plan,
    trace,
    error: { message: e?.message ?? String(err), stack: e?.stack },
    terminalPhase: state.phase,
    turn: state.turn,
    failingCardId: deriveFailingCard(state, trace),
    decisionTreeAtFailure: decisionTree,
    stressSignature: stressSignatureOf(state),
    minStateSnap: minSnap(state),
  };
}

export function reportInvariant(
  seed: number,
  plan: ForcedInclusionPlan | null,
  state: GameState,
  trace: ReadonlyArray<TraceEntry>,
  violations: ReadonlyArray<InvariantViolation>,
  decisionTree?: ReadonlyArray<DecisionTreeEntry>,
): FailureReport {
  return {
    kind: 'invariant_violation',
    seed,
    plan,
    trace,
    violations,
    terminalPhase: state.phase,
    turn: state.turn,
    failingCardId: deriveFailingCard(state, trace),
    decisionTreeAtFailure: decisionTree,
    stressSignature: stressSignatureOf(state),
    minStateSnap: minSnap(state),
  };
}

export function reportStuck(
  seed: number,
  plan: ForcedInclusionPlan | null,
  state: GameState,
  trace: ReadonlyArray<TraceEntry>,
  reason: string,
  decisionTree?: ReadonlyArray<DecisionTreeEntry>,
): FailureReport {
  return {
    kind: 'stuck_loop',
    seed,
    plan,
    trace,
    error: { message: `stuck-loop: ${reason}` },
    terminalPhase: state.phase,
    turn: state.turn,
    failingCardId: deriveFailingCard(state, trace),
    decisionTreeAtFailure: decisionTree,
    stressSignature: stressSignatureOf(state),
    minStateSnap: minSnap(state),
  };
}

export function reportNoLegalMoves(
  seed: number,
  plan: ForcedInclusionPlan | null,
  state: GameState,
  trace: ReadonlyArray<TraceEntry>,
): FailureReport {
  return {
    kind: 'no_legal_moves',
    seed,
    plan,
    trace,
    error: { message: `no-legal-moves in phase ${state.phase}` },
    terminalPhase: state.phase,
    turn: state.turn,
    failingCardId: deriveFailingCard(state, trace),
    minStateSnap: minSnap(state),
  };
}

export function reportTimeout(
  seed: number,
  plan: ForcedInclusionPlan | null,
  state: GameState,
  trace: ReadonlyArray<TraceEntry>,
): FailureReport {
  return {
    kind: 'timeout',
    seed,
    plan,
    trace,
    error: { message: `tick-budget exhausted at turn ${state.turn} phase ${state.phase}` },
    terminalPhase: state.phase,
    turn: state.turn,
    failingCardId: deriveFailingCard(state, trace),
    minStateSnap: minSnap(state),
  };
}

export function writeReportToDisk(report: FailureReport): string {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const filename = `${Date.now()}-${report.kind}-seed${report.seed}.json`;
  const path = resolve(REPORTS_DIR, filename);
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}
