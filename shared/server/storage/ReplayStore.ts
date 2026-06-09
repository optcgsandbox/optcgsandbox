// ReplayStore — abstract persistence boundary for match replay artifacts.
//
// Phase F-2 establishes the CONTRACT that any future replay backend
// (filesystem, KV, SQL, blob storage, …) must satisfy. F-2 itself ships
// only `MemoryReplayStore` for tests/dev. The real persistence backend
// arrives in a later phase under the same interface — call sites never
// need to know which implementation they hold.
//
// Design constraints:
//   - Every operation is Promise-returning. The in-memory store happens
//     to resolve synchronously, but any real backend (fs, db, network)
//     will not. Pinning the interface to Promises now prevents a noisy
//     API rewrite later.
//   - Errors surface as `{ ok: false, reason }` discriminated unions
//     instead of rejected Promises. Callers handle them as data, not
//     as exception-flow.
//   - `list()` returns METADATA only — never the full artifact. Loading
//     thousands of full GameState blobs just to enumerate IDs is the
//     anti-pattern we close off here.
//   - `save()` validates the replay before storing. A broken artifact
//     should never reach disk.

import type { MatchReplayV1 } from '../serialize.js';

export interface ReplayMetadata {
  readonly id: string;
  readonly finalHash: string;
  readonly createdAt?: string;
}

export type SaveResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: string };

export type LoadResult =
  | { readonly ok: true; readonly replay: MatchReplayV1 }
  | { readonly ok: false; readonly reason: string };

export type DeleteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface ReplayStore {
  /**
   * Persist a replay. Implementations MUST call `validateReplay` first and
   * return `{ ok: false, reason }` on any validation failure — a broken
   * artifact never reaches storage. On success, return the stable id by
   * which `load()` and `delete()` will address this artifact.
   */
  save(replay: MatchReplayV1): Promise<SaveResult>;

  /**
   * Retrieve a previously-saved replay. Unknown ids resolve to
   * `{ ok: false, reason: 'not_found' }` — never to a rejected Promise.
   * The returned replay is a defensive copy; mutating it MUST NOT affect
   * the stored copy.
   */
  load(id: string): Promise<LoadResult>;

  /**
   * Remove an artifact. Unknown ids resolve to
   * `{ ok: false, reason: 'not_found' }`. After delete, the same id will
   * never be resurrected — implementations are free to reuse the id only
   * if they can guarantee no client holds a stale reference, which in
   * practice means "never."
   */
  delete(id: string): Promise<DeleteResult>;

  /**
   * Enumerate all stored replays as metadata only. Order is unspecified.
   * Implementations MUST NOT return the full `MatchReplayV1` here; bulk
   * enumeration of full payloads is what `load(id)` is for, called
   * deliberately per artifact.
   */
  list(): Promise<ReadonlyArray<ReplayMetadata>>;
}
