/**
 * Deterministic mulberry32 PRNG for the simulation layer.
 *
 * Every randomness consumer in the simulation pulls from a forked Rng so a
 * single 32-bit seed reproduces the entire game. Forks derive their child
 * state via a stable hash of (parent state, label), keeping streams
 * independent across concerns (deck shuffle vs move selection vs ...).
 */

export interface Rng {
  /** Returns next uint32 and advances state. */
  next(): number;
  /** Uniform random integer in [0, n). */
  range(n: number): number;
  /** Random element from a non-empty array. */
  pick<T>(arr: ReadonlyArray<T>): T;
  /** Fisher–Yates shuffle returning a new array. */
  shuffle<T>(arr: ReadonlyArray<T>): T[];
  /** Derive a child Rng tied to `label`. */
  fork(label: string): Rng;
  /** Get the raw 32-bit state (for replay metadata). */
  state(): number;
}

function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

function hashLabel(parent: number, label: string): number {
  let h = parent ^ 0x9e3779b9;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function newRng(seed: number): Rng {
  const seedU32 = seed >>> 0;
  let raw = mulberry32(seedU32);
  let stateCounter = seedU32;

  const rng: Rng = {
    next() {
      const v = raw();
      stateCounter = (stateCounter + 1) >>> 0;
      return v;
    },
    range(n: number) {
      if (n <= 0) return 0;
      return this.next() % n;
    },
    pick<T>(arr: ReadonlyArray<T>): T {
      return arr[this.range(arr.length)]!;
    },
    shuffle<T>(arr: ReadonlyArray<T>): T[] {
      const out = arr.slice() as T[];
      for (let i = out.length - 1; i > 0; i--) {
        const j = this.range(i + 1);
        const tmp = out[i]!;
        out[i] = out[j]!;
        out[j] = tmp;
      }
      return out;
    },
    fork(label: string) {
      return newRng(hashLabel(stateCounter, label));
    },
    state() {
      return stateCounter;
    },
  };
  return rng;
}
