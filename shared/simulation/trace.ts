/**
 * Game trace — append-only log of (tick, phase, controller, move).
 *
 * Used by the runner to record every move applied to state; by the
 * failureReporter for replayable bug dumps; by the loop detector.
 *
 * Lightweight — no engine state copied here; just the actions.
 */

import type { Action } from '../engine-v2/protocol/actions.js';
import type { Phase, PlayerId } from '../engine-v2/state/types.js';

export interface TraceEntry {
  readonly tick: number;
  readonly phase: Phase;
  readonly controller: PlayerId;
  readonly move: Action;
  /** Short fingerprint of the post-state for replay verification. */
  readonly postHash: string;
}

export class Trace {
  private entries: TraceEntry[] = [];

  push(entry: TraceEntry): void {
    this.entries.push(entry);
  }

  length(): number {
    return this.entries.length;
  }

  last(): TraceEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  toArray(): ReadonlyArray<TraceEntry> {
    return this.entries;
  }
}

/**
 * Fast non-cryptographic 32-bit hash; used only for short fingerprints in
 * trace + loop detection. Deterministic per state shape.
 */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}
