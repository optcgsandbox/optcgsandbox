/**
 * Adversarial move-selection: weighted (not uniform) picking from the legal
 * move set.
 *
 * Weight = base × edgeState × interactionComplexity × cardRareness.
 * Deterministic: takes an Rng; same RNG state + same state + same moves =
 * same pick.
 *
 * Designed for "systematic adversarial exploration" — biases toward pendings,
 * complex card moves, edge-states (low life, full board, empty hand, no DON).
 */

import type { Action } from '../engine-v2/protocol/actions.js';
import type { GameState, PlayerId } from '../engine-v2/state/types.js';

import type { CardMeta } from './cardMeta.js';
import type { Rng } from './rng.js';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

export interface WeightedMove {
  readonly move: Action;
  readonly weight: number;
  readonly reasons: ReadonlyArray<string>;
}

function actorOf(state: GameState): PlayerId {
  if (state.pending !== null) {
    const p = state.pending;
    if (p.kind === 'attack') {
      const attacker = state.instances[p.pendingAttack.attackerInstanceId];
      return attacker !== undefined && attacker.controller === 'A' ? 'B' : 'A';
    }
    if (p.kind === 'trigger') return p.pendingTrigger.controller;
    if (p.kind === 'peek') return p.pendingPeek.controller;
    if (p.kind === 'discard') return p.pendingDiscard.controller;
    if (p.kind === 'choose_one') return p.pendingChoose.controller;
    if (p.kind === 'attack_target_pick') return p.pendingTargetPick.controller;
  }
  return state.activePlayer;
}

interface EdgeFactors {
  readonly amp: number;
  readonly reasons: ReadonlyArray<string>;
}

function edgeStateAmp(state: GameState): EdgeFactors {
  const reasons: string[] = [];
  let amp = 1;

  if (state.pending !== null) {
    amp *= 5;
    reasons.push(`pending:${state.pending.kind}×5`);
  }

  for (const pid of ['A', 'B'] as PlayerId[]) {
    const pl = state.players[pid];
    if (pl.life.length <= 1) {
      amp *= 3;
      reasons.push(`life≤1[${pid}]×3`);
    } else if (pl.life.length <= 2) {
      amp *= 1.5;
      reasons.push(`life≤2[${pid}]×1.5`);
    }
  }

  const active = state.activePlayer;
  const ap = state.players[active];
  if (ap.hand.length <= 1) {
    amp *= 2;
    reasons.push(`hand≤1×2`);
  }
  if (ap.field.length >= 4) {
    amp *= 1.7;
    reasons.push(`field≥4×1.7`);
  }
  if (ap.donCostArea.length === 0) {
    amp *= 1.5;
    reasons.push('don=0×1.5');
  }

  return { amp, reasons };
}

function moveCardId(state: GameState, move: Action): string | undefined {
  const m = move as { instanceId?: string; attackerInstanceId?: string };
  const id = m.instanceId ?? m.attackerInstanceId;
  if (id === undefined) return undefined;
  const inst = state.instances[id];
  return inst?.cardId;
}

function moveTypeBaseWeight(move: Action): number {
  switch (move.type) {
    case 'END_TURN': return 0.4;        // downweight: let games progress
    case 'SKIP_BLOCKER': return 0.5;
    case 'SKIP_COUNTER': return 0.5;
    case 'ROLL_DICE': return 1;
    case 'CHOOSE_FIRST':
    case 'CHOOSE_SECOND': return 1;
    case 'KEEP_HAND': return 1;
    case 'MULLIGAN': return 0.6;
    case 'PLAY_CARD':
    case 'PLAY_STAGE': return 1.5;       // upweight: state-changing
    case 'ACTIVATE_MAIN': return 2;      // strong upweight: complex effects
    case 'PLAY_COUNTER': return 1.6;
    case 'DECLARE_ATTACK': return 1.4;
    case 'DECLARE_BLOCKER': return 1.4;
    case 'ATTACH_DON': return 0.9;
    case 'RESOLVE_TRIGGER': return 1.3;
    case 'RESOLVE_PEEK': return 1.2;
    case 'RESOLVE_DISCARD': return 1.2;
    case 'RESOLVE_CHOOSE_ONE': return 1.3;
    case 'RESOLVE_TARGET_PICK': return 1.3;
    case 'CONCEDE': return 0.05;         // almost never (still legal in principle)
  }
  return 1;
}

function cardInteractionWeight(meta: CardMeta | undefined): { factor: number; reasons: string[] } {
  const reasons: string[] = [];
  let factor = 1;
  if (meta === undefined) return { factor, reasons };
  if (meta.hasBinding) { factor *= 4; reasons.push('hasBinding×4'); }
  if (meta.hasSequence) { factor *= 3; reasons.push('hasSequence×3'); }
  if (meta.hasPlayForFree) { factor *= 3; reasons.push('hasPlayForFree×3'); }
  if (meta.hasRecursion) { factor *= 2.5; reasons.push('hasRecursion×2.5'); }
  if (meta.hasSearcher) { factor *= 2; reasons.push('hasSearcher×2'); }
  if (meta.hasCostBind) { factor *= 3; reasons.push('hasCostBind×3'); }
  if (meta.hasConditional) { factor *= 1.6; reasons.push('hasConditional×1.6'); }
  if (meta.clauseCount >= 2) { factor *= 1.8; reasons.push('clauses≥2×1.8'); }
  if (meta.continuousCount >= 1) { factor *= 1.4; reasons.push('continuous≥1×1.4'); }
  if (meta.replacementCount >= 1) { factor *= 2; reasons.push('replacement≥1×2'); }
  if (meta.uniqueZones >= 3) { factor *= 1.5; reasons.push('zones≥3×1.5'); }
  return { factor, reasons };
}

/** Compute the weight for one legal move. */
export function weightMove(
  state: GameState,
  move: Action,
  cardMeta: Map<string, CardMeta>,
  edge: EdgeFactors,
): WeightedMove {
  const base = moveTypeBaseWeight(move);
  const reasons: string[] = [`type:${move.type}@${base}`];

  const cardId = moveCardId(state, move);
  const meta = cardId !== undefined ? cardMeta.get(cardId) : undefined;
  const ci = cardInteractionWeight(meta);
  reasons.push(...ci.reasons);
  reasons.push(...edge.reasons);

  const weight = base * ci.factor * edge.amp;
  return { move, weight, reasons };
}

/**
 * Weight every move, then pick one proportional to weight using the supplied
 * RNG. Returns the picked move and the full weighted list (for failure
 * enrichment).
 */
export function pickAdversarial(
  state: GameState,
  moves: ReadonlyArray<Action>,
  cardMeta: Map<string, CardMeta>,
  rng: Rng,
): { picked: Action; pickedIndex: number; weighted: ReadonlyArray<WeightedMove> } {
  const edge = edgeStateAmp(state);
  const weighted = moves.map((m) => weightMove(state, m, cardMeta, edge));
  // Quantize to integer for deterministic accumulation
  const totals = weighted.map((w) => Math.max(1, Math.floor(w.weight * 1000)));
  let sum = 0;
  for (const t of totals) sum += t;
  const r = rng.range(sum);
  let acc = 0;
  for (let i = 0; i < totals.length; i++) {
    acc += totals[i]!;
    if (r < acc) return { picked: moves[i]!, pickedIndex: i, weighted };
  }
  // Defensive fallback (shouldn't hit)
  return { picked: moves[moves.length - 1]!, pickedIndex: moves.length - 1, weighted };
}

export { edgeStateAmp, actorOf };
