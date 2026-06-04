/**
 * Per-card exposure depth tracker.
 *
 * exposureDepth(cardId) = weighted sum of:
 *   • unique game phases the card was a participant in
 *   • unique zone transitions involving the card
 *   • clause indices that fired
 *   • pending kinds the card sourced
 *
 * Distinct from CoverageTracker (which is a binary "covered or not" metric).
 * Exposure depth surfaces cards that get LITTLE rule-space exercise vs heavy
 * exercise — useful for guiding adversarial focus-card injection.
 */

import type { Action } from '../engine-v2/protocol/actions.js';
import type { GameState } from '../engine-v2/state/types.js';

export interface CardExposure {
  phases: Set<string>;
  zoneTransitions: Set<string>;
  clauseFired: Set<number>;
  pendingsParticipated: Set<string>;
  ticksParticipated: number;
}

function emptyExposure(): CardExposure {
  return {
    phases: new Set(),
    zoneTransitions: new Set(),
    clauseFired: new Set(),
    pendingsParticipated: new Set(),
    ticksParticipated: 0,
  };
}

export class ExposureTracker {
  private byCard = new Map<string, CardExposure>();

  constructor(allCardIds: ReadonlyArray<string>) {
    for (const id of allCardIds) this.byCard.set(id, emptyExposure());
  }

  /**
   * Diff zone membership before/after to detect transitions. Heuristic: per
   * player, snapshot which zone each instance is in; produce edges where it
   * changed.
   */
  updateFromTransition(prev: GameState, next: GameState, move: Action): void {
    const prevZone = locationMap(prev);
    const nextZone = locationMap(next);
    // Zone-transition edges
    for (const [instId, prevLoc] of prevZone.entries()) {
      const nextLoc = nextZone.get(instId);
      if (nextLoc !== undefined && nextLoc !== prevLoc) {
        const inst = next.instances[instId];
        if (inst === undefined) continue;
        const exp = this.byCard.get(inst.cardId);
        if (exp === undefined) continue;
        exp.zoneTransitions.add(`${prevLoc}->${nextLoc}`);
      }
    }

    // Phase: every card on board (any zone) gets the current phase added.
    // Bounded — only count primary-source card (the move's target if any).
    const cardId = moveCardId(next, move);
    if (cardId !== undefined) {
      const exp = this.byCard.get(cardId);
      if (exp !== undefined) {
        exp.phases.add(next.phase);
        exp.ticksParticipated += 1;
        if (next.pending !== null) exp.pendingsParticipated.add(next.pending.kind);
      }
    }

    // Clause firings — scan new history events for CLAUSE_FIRED.
    const newEvents = next.history.slice(prev.history.length);
    for (const evt of newEvents) {
      const e = evt as { type?: string; sourceInstanceId?: string; clauseIndex?: number };
      if (e.type !== 'CLAUSE_FIRED' || typeof e.sourceInstanceId !== 'string') continue;
      const inst = next.instances[e.sourceInstanceId];
      if (inst === undefined) continue;
      const exp = this.byCard.get(inst.cardId);
      if (exp === undefined) continue;
      if (typeof e.clauseIndex === 'number') exp.clauseFired.add(e.clauseIndex);
    }
  }

  /** Aggregate exposure depth = weighted sum across axes. */
  depthOf(cardId: string): number {
    const e = this.byCard.get(cardId);
    if (e === undefined) return 0;
    return (
      e.phases.size * 1 +
      e.zoneTransitions.size * 2 +
      e.clauseFired.size * 3 +
      e.pendingsParticipated.size * 4 +
      Math.log2(Math.max(1, e.ticksParticipated))
    );
  }

  exposureOf(cardId: string): CardExposure | undefined {
    return this.byCard.get(cardId);
  }

  /** Returns [cardId, depth] arrays sorted ascending or descending. */
  rank(direction: 'asc' | 'desc', limit: number): Array<{ cardId: string; depth: number }> {
    const out = [...this.byCard.keys()].map((id) => ({ cardId: id, depth: this.depthOf(id) }));
    out.sort((a, b) => direction === 'asc' ? a.depth - b.depth : b.depth - a.depth);
    return out.slice(0, limit);
  }
}

function locationMap(state: GameState): Map<string, string> {
  const m = new Map<string, string>();
  for (const pid of ['A', 'B'] as const) {
    const pl = state.players[pid];
    m.set(pl.leader.instanceId, `${pid}:leader`);
    for (const id of pl.hand) m.set(id, `${pid}:hand`);
    for (const id of pl.deck) m.set(id, `${pid}:deck`);
    for (const id of pl.trash) m.set(id, `${pid}:trash`);
    for (const id of pl.life) m.set(id, `${pid}:life`);
    for (const id of pl.exile) m.set(id, `${pid}:exile`);
    for (const inst of pl.field) m.set(inst.instanceId, `${pid}:field`);
    if (pl.stage !== null) m.set(pl.stage.instanceId, `${pid}:stage`);
  }
  return m;
}

function moveCardId(state: GameState, move: Action): string | undefined {
  const m = move as { instanceId?: string; attackerInstanceId?: string };
  const id = m.instanceId ?? m.attackerInstanceId;
  if (id === undefined) return undefined;
  return state.instances[id]?.cardId;
}
