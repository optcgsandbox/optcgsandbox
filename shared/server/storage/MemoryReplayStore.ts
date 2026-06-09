// MemoryReplayStore — in-memory `ReplayStore` for tests/dev.
//
// NOT a production persistence layer. It loses everything on process exit
// and lives entirely in a single Map. Its purpose is to:
//
//   1. Verify the `ReplayStore` interface is implementable.
//   2. Give upstream tests (replay viewer, reconnect drills) a real
//      backend they can drive without filesystem or network setup.
//   3. Anchor the contract — any real backend (sqlite, kv, s3, …) lands
//      under this same interface in a later phase.
//
// Defensive copies are aggressive: both `save` and `load` deep-clone the
// payload. The cost (a structuredClone of a GameState + log) is small
// compared to the bugs that ref-sharing would create when downstream code
// inevitably mutates "its own" copy.

import { validateReplay, type MatchReplayV1 } from '../serialize.js';
import type {
  DeleteResult,
  LoadResult,
  ReplayMetadata,
  ReplayStore,
  SaveResult,
} from './ReplayStore.js';

interface StoredEntry {
  readonly id: string;
  readonly replay: MatchReplayV1;
}

export class MemoryReplayStore implements ReplayStore {
  private readonly entries = new Map<string, StoredEntry>();
  private counter = 0;

  async save(replay: MatchReplayV1): Promise<SaveResult> {
    const validation = validateReplay(replay);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason };
    }

    const id = this.mintId();
    // Deep clone so that subsequent mutations to the caller's `replay`
    // object cannot leak into the stored copy.
    const stored: StoredEntry = {
      id,
      replay: structuredClone(replay),
    };
    this.entries.set(id, stored);
    return { ok: true, id };
  }

  async load(id: string): Promise<LoadResult> {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return { ok: false, reason: 'not_found' };
    }
    // Deep clone so that the caller can mutate the returned object freely
    // without touching our stored copy.
    return { ok: true, replay: structuredClone(entry.replay) };
  }

  async delete(id: string): Promise<DeleteResult> {
    if (!this.entries.has(id)) {
      return { ok: false, reason: 'not_found' };
    }
    this.entries.delete(id);
    return { ok: true };
  }

  async list(): Promise<ReadonlyArray<ReplayMetadata>> {
    const out: ReplayMetadata[] = [];
    for (const { id, replay } of this.entries.values()) {
      const meta: ReplayMetadata = {
        id,
        finalHash: replay.finalHash,
        ...(replay.createdAt !== undefined ? { createdAt: replay.createdAt } : {}),
      };
      out.push(meta);
    }
    return out;
  }

  /**
   * Stable monotonic id generator. Format: `mem-<counter>-<finalHash-prefix>`
   * — no collisions within a process, easy to grep in logs. We deliberately
   * avoid `crypto.randomUUID()` here so MemoryReplayStore stays
   * dependency-free across browser + Node + workerd test runners.
   */
  private mintId(): string {
    this.counter += 1;
    return `mem-${this.counter}`;
  }
}
