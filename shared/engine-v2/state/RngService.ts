/**
 * Engine V2 — deterministic RNG service.
 *
 * Closes V1 collision bug: V1's `new Random(next.seed ^ next.turn ^ 0x91a3f7)`
 * collided across two RNG pulls in the same turn (same `next.turn`).
 *
 * V2: a monotonic counter (`state.rngCounter`) mixed with `state.seed` via
 * Weyl-sequence increment (golden-ratio multiplier 0x9e3779b1). Every pull
 * advances the counter; no two pulls within a game share a seed.
 *
 * Cross-references:
 * - Implementation spec §15
 * - Plan v2 §4.13 (J1)
 */

import type { GameState } from './types.js';

const WEYL_INCREMENT = 0x9e3779b1;

/**
 * Mulberry32 — small, fast, deterministic 32-bit PRNG. Same instance always
 * produces the same sequence; serialization-friendly via a single u32 state.
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [0, max). */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** Fisher-Yates shuffle in place. Mutates `arr`. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }
}

export interface RngPullResult {
  readonly random: Random;
  readonly nextRngCounter: number;
}

export const RngService = {
  /**
   * Pulls a fresh `Random` derived from (state.seed, state.rngCounter), then
   * increments the counter. Mutates state in place.
   */
  pull(state: GameState): Random {
    const counter = state.rngCounter;
    state.rngCounter = counter + 1;
    const mixed = (state.seed + counter * WEYL_INCREMENT) >>> 0;
    return new Random(mixed);
  },

  /**
   * Pure variant: returns the would-be Random + next counter value without
   * mutating state. Caller writes back `nextRngCounter` after committing.
   */
  peek(state: GameState): RngPullResult {
    const counter = state.rngCounter;
    const mixed = (state.seed + counter * WEYL_INCREMENT) >>> 0;
    return { random: new Random(mixed), nextRngCounter: counter + 1 };
  },
} as const;
