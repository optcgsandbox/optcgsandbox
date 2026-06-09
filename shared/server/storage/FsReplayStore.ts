/// <reference types="node" />
// FsReplayStore — first real async-I/O backend for ReplayStore.
//
// The triple-slash directive above is intentional: this is the first
// non-test file in `shared/server/` that touches `node:*` modules, and
// the app's `tsconfig.app.json` declares `"types": ["vite/client"]`
// (no node). Rather than widen the project config and pull node types
// into every browser-bound file, we scope the dependency to this file
// only. Anything that imports FsReplayStore is implicitly node-only.
//
// Phase F-3b. Persists each replay as one JSON file under a configured
// root directory. Atomic writes (write-temp + rename) protect rule A of
// the F-3a concurrency contract even under concurrent writers.
//
// Scope: local-dev / test backend. NOT a production multi-instance
// solution — there's no cross-host locking, no replication, no LRU. The
// purpose is to exercise the contract against real async I/O so any
// concurrency gaps surface here, BEFORE a production backend (Cloudflare
// KV, Supabase storage, …) is built against the same interface.
//
// Format:
//   <rootDir>/<id>.json        — committed artifact (one per save)
//   <rootDir>/<id>.json.tmp    — in-flight write; never visible after success
//
// Metadata for `list()` is derived from the file contents — there is no
// separate index file. The cost of re-reading every file on `list()` is
// acceptable for the F-3b scope; a production backend that needs cheap
// enumeration will maintain its own index.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { validateReplay, type MatchReplayV1 } from '../serialize.js';
import type {
  DeleteResult,
  LoadResult,
  ReplayMetadata,
  ReplayStore,
  SaveResult,
} from './ReplayStore.js';

/**
 * Whitelist for IDs. We mint our own ids in `save()`, but `load()` /
 * `delete()` accept arbitrary caller strings — so the regex is also our
 * defense against path traversal (`..`, `/`, `\\`, leading `.`).
 *
 * Allowed: letters, digits, `-`, `_`. Bounded length keeps pathological
 * caller input from filling kernel buffers.
 */
const ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

const FILE_EXT = '.json';
const TMP_SUFFIX = '.tmp';

export class FsReplayStore implements ReplayStore {
  private readonly rootDir: string;
  private rootEnsured = false;
  private counter = 0;

  constructor(rootDir: string) {
    if (typeof rootDir !== 'string' || rootDir.length === 0) {
      throw new Error('FsReplayStore: rootDir must be a non-empty string');
    }
    this.rootDir = rootDir;
  }

  // ─────────────────────────────────────────────────────────────────
  // Public ReplayStore impl
  // ─────────────────────────────────────────────────────────────────

  async save(replay: MatchReplayV1): Promise<SaveResult> {
    const validation = validateReplay(replay);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason };
    }

    await this.ensureRoot();
    const id = this.mintId();
    const finalPath = this.filePath(id);
    const tmpPath = finalPath + TMP_SUFFIX;

    // Defensive clone so caller can mutate `replay` after save without
    // affecting what we serialize. Sorted-key canonical JSON is NOT
    // required at the storage layer (the hash is computed independently),
    // so a plain stringify is correct + cheaper.
    const serialized = JSON.stringify(replay);

    try {
      await fs.writeFile(tmpPath, serialized, 'utf8');
      // POSIX rename is atomic within the same filesystem. Windows
      // tolerates rename-to-nonexistent-target since the id is unique.
      await fs.rename(tmpPath, finalPath);
    } catch (err) {
      // Best-effort cleanup of leftover .tmp; ignore unlink failure.
      try {
        await fs.unlink(tmpPath);
      } catch {
        /* swallow — nothing else to do */
      }
      return {
        ok: false,
        reason: `write_failed: ${(err as Error).message}`,
      };
    }

    return { ok: true, id };
  }

  async load(id: string): Promise<LoadResult> {
    if (!isValidId(id)) {
      return { ok: false, reason: 'invalid_id' };
    }
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(id), 'utf8');
    } catch (err) {
      if (isNotFound(err)) return { ok: false, reason: 'not_found' };
      return {
        ok: false,
        reason: `read_failed: ${(err as Error).message}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'corrupt_json' };
    }
    return { ok: true, replay: parsed as MatchReplayV1 };
  }

  async delete(id: string): Promise<DeleteResult> {
    if (!isValidId(id)) {
      return { ok: false, reason: 'invalid_id' };
    }
    try {
      await fs.unlink(this.filePath(id));
      return { ok: true };
    } catch (err) {
      if (isNotFound(err)) return { ok: false, reason: 'not_found' };
      return {
        ok: false,
        reason: `unlink_failed: ${(err as Error).message}`,
      };
    }
  }

  async list(): Promise<ReadonlyArray<ReplayMetadata>> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.rootDir);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    const out: ReplayMetadata[] = [];
    for (const entry of entries) {
      // Skip in-flight writes and anything not a .json artifact.
      if (entry.endsWith(TMP_SUFFIX)) continue;
      if (!entry.endsWith(FILE_EXT)) continue;
      const id = entry.slice(0, -FILE_EXT.length);
      // Defensive: skip any filename that wouldn't pass our id validator.
      if (!isValidId(id)) continue;

      let parsed: unknown;
      try {
        const raw = await fs.readFile(path.join(this.rootDir, entry), 'utf8');
        parsed = JSON.parse(raw);
      } catch {
        // Documented behavior: list() SKIPS malformed/corrupt files. The
        // alternative — failing the whole call — punishes the caller for
        // one bad file. Operators discover corruption via the metadata
        // count + per-id `load()` errors.
        continue;
      }
      if (parsed === null || typeof parsed !== 'object') continue;
      const p = parsed as Partial<MatchReplayV1>;
      if (typeof p.finalHash !== 'string') continue;
      const meta: ReplayMetadata = {
        id,
        finalHash: p.finalHash,
        ...(typeof p.createdAt === 'string' ? { createdAt: p.createdAt } : {}),
      };
      out.push(meta);
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────

  private async ensureRoot(): Promise<void> {
    if (this.rootEnsured) return;
    // `recursive: true` is idempotent — concurrent ensureRoot calls do
    // not race here.
    await fs.mkdir(this.rootDir, { recursive: true });
    this.rootEnsured = true;
  }

  /**
   * Stable monotonic + entropic id. Counter alone is sufficient to
   * guarantee uniqueness within a single process; the timestamp + random
   * suffix add legibility (sortable by save time) and cross-process
   * uniqueness if a future variant ever shares a directory.
   */
  private mintId(): string {
    this.counter += 1;
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 10).padStart(8, '0');
    return `fs-${ts}-${this.counter}-${rand}`;
  }

  private filePath(id: string): string {
    return path.join(this.rootDir, `${id}${FILE_EXT}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Free helpers
// ─────────────────────────────────────────────────────────────────────

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && ID_REGEX.test(id);
}

function isNotFound(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
