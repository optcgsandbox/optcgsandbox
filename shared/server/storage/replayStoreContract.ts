// ReplayStore contract — Phase F-3a.
//
// A reusable test suite that codifies the multi-backend contract every
// `ReplayStore` implementation must satisfy. Drives MemoryReplayStore
// today; any future backend (Cloudflare KV, Supabase storage, sqlite,
// plain fs, …) reuses this same suite — they pass it BEFORE they are
// allowed to be wired into the rest of the system.
//
// Why a contract file in `storage/` rather than `__tests__/`:
//   - the contract is the LIBRARY surface — it ships with the source so
//     other backends (in this repo or downstream) can import + call it
//     without depending on test-only paths.
//   - the test file under `__tests__/` is the THIN binding that loads the
//     engine, builds a sample replay, and invokes this suite.
//
// Engine-agnostic: the suite accepts a `makeValidReplay` factory so the
// `storage/` layer never imports engine-v2 directly. Future non-OPTCG
// backends would still be testable against this contract.

import { describe, expect, it } from 'vitest';

import {
  validateReplay,
  replayToFinalState,
  type MatchReplayV1,
} from '../serialize.js';
import { computeStateHash } from '../stateHash.js';
import type { ReplayStore } from './ReplayStore.js';

export interface ReplayStoreContractOptions {
  /** Human-readable name surfaced in the test report. */
  readonly name: string;
  /** Fresh store per test — implementations MUST NOT share state across `it()` blocks. */
  readonly makeStore: () => ReplayStore | Promise<ReplayStore>;
  /** Fresh valid replay per call. Should produce a structurally distinct payload each time. */
  readonly makeValidReplay: () => MatchReplayV1 | Promise<MatchReplayV1>;
}

/**
 * Register the full ReplayStore contract suite under a top-level
 * `describe(name, ...)`. Designed to be called inline from a test file:
 *
 *   runReplayStoreContractSuite({
 *     name: 'MemoryReplayStore',
 *     makeStore: () => new MemoryReplayStore(),
 *     makeValidReplay: () => myFactory(),
 *   })
 */
export function runReplayStoreContractSuite(
  options: ReplayStoreContractOptions,
): void {
  const { name, makeStore, makeValidReplay } = options;

  describe(`${name} — ReplayStore contract`, () => {
    // ─────────────────────────────────────────────────────────────
    // A. save() atomicity
    // ─────────────────────────────────────────────────────────────

    describe('A. save() atomicity', () => {
      it('N parallel saves resolve with N unique ids', async () => {
        const store = await makeStore();
        const N = 8;
        const replays = await Promise.all(
          Array.from({ length: N }, () => makeValidReplay()),
        );

        const results = await Promise.all(replays.map((r) => store.save(r)));
        for (const r of results) expect(r.ok).toBe(true);
        const ids = new Set(results.map((r) => (r.ok ? r.id : '')));
        expect(ids.size).toBe(N);
      });

      it('every saved id loads successfully (no lost writes under concurrency)', async () => {
        const store = await makeStore();
        const N = 8;
        const replays = await Promise.all(
          Array.from({ length: N }, () => makeValidReplay()),
        );
        const savedIds: string[] = [];
        for (const r of await Promise.all(replays.map((r) => store.save(r)))) {
          if (!r.ok) throw new Error('save unexpectedly failed');
          savedIds.push(r.id);
        }

        const loads = await Promise.all(savedIds.map((id) => store.load(id)));
        for (const l of loads) expect(l.ok).toBe(true);
      });

      it('list() includes every saved id exactly once', async () => {
        const store = await makeStore();
        const N = 5;
        const savedIds: string[] = [];
        for (let i = 0; i < N; i++) {
          const r = await store.save(await makeValidReplay());
          if (!r.ok) throw new Error('save failed');
          savedIds.push(r.id);
        }

        const meta = await store.list();
        const listedIds = meta.map((m) => m.id);
        expect(meta.length).toBe(N);
        for (const id of savedIds) {
          const occurrences = listedIds.filter((x) => x === id).length;
          expect(occurrences).toBe(1);
        }
      });
    });

    // ─────────────────────────────────────────────────────────────
    // B. delete / load ordering
    // ─────────────────────────────────────────────────────────────

    describe('B. delete/load ordering', () => {
      it('after delete resolves ok, load fails with not_found', async () => {
        const store = await makeStore();
        const save = await store.save(await makeValidReplay());
        if (!save.ok) throw new Error('save failed');

        const del = await store.delete(save.id);
        expect(del.ok).toBe(true);

        const load = await store.load(save.id);
        expect(load.ok).toBe(false);
        if (!load.ok) expect(load.reason).toBe('not_found');
      });

      it('delete unknown id returns ok:false with not_found', async () => {
        const store = await makeStore();
        const del = await store.delete('not-a-real-id');
        expect(del.ok).toBe(false);
        if (!del.ok) expect(del.reason).toBe('not_found');
      });

      it('repeated delete on same id: first ok:true, second ok:false', async () => {
        const store = await makeStore();
        const save = await store.save(await makeValidReplay());
        if (!save.ok) throw new Error('save failed');

        const d1 = await store.delete(save.id);
        const d2 = await store.delete(save.id);
        expect(d1.ok).toBe(true);
        expect(d2.ok).toBe(false);
        if (!d2.ok) expect(d2.reason).toBe('not_found');
      });
    });

    // ─────────────────────────────────────────────────────────────
    // C. load defensive copy
    // ─────────────────────────────────────────────────────────────

    describe('C. load defensive copy', () => {
      it('mutating a loaded replay does not affect the stored copy', async () => {
        const store = await makeStore();
        const original = await makeValidReplay();
        const save = await store.save(original);
        if (!save.ok) throw new Error('save failed');

        const first = await store.load(save.id);
        if (!first.ok) throw new Error('first load failed');
        (first.replay as { finalHash: string }).finalHash = 'mutated';
        (first.replay.actionLog as unknown[]).push({
          player: 'B',
          action: { type: 'CONCEDE' },
        });

        const second = await store.load(save.id);
        if (!second.ok) throw new Error('second load failed');
        expect(second.replay.finalHash).toBe(original.finalHash);
        expect(second.replay.actionLog.length).toBe(original.actionLog.length);
      });
    });

    // ─────────────────────────────────────────────────────────────
    // D. save defensive copy
    // ─────────────────────────────────────────────────────────────

    describe('D. save defensive copy', () => {
      it('mutating the original replay AFTER save does not affect the stored copy', async () => {
        const store = await makeStore();
        const original = await makeValidReplay();
        const originalHash = original.finalHash;
        const originalLogLen = original.actionLog.length;
        const save = await store.save(original);
        if (!save.ok) throw new Error('save failed');

        // Caller scribbles on its copy.
        (original as { finalHash: string }).finalHash = 'mutated';
        (original.actionLog as unknown[]).push({
          player: 'A',
          action: { type: 'CONCEDE' },
        });

        const load = await store.load(save.id);
        if (!load.ok) throw new Error('load failed');
        expect(load.replay.finalHash).toBe(originalHash);
        expect(load.replay.actionLog.length).toBe(originalLogLen);
      });
    });

    // ─────────────────────────────────────────────────────────────
    // E. list consistency
    // ─────────────────────────────────────────────────────────────

    describe('E. list consistency', () => {
      it('list() returns metadata only — no full payload leakage', async () => {
        const store = await makeStore();
        await store.save(await makeValidReplay());
        await store.save(await makeValidReplay());

        const meta = await store.list();
        expect(meta.length).toBe(2);
        for (const m of meta) {
          expect(typeof m.id).toBe('string');
          expect(typeof m.finalHash).toBe('string');
          const leak = m as unknown as {
            initialState?: unknown;
            actionLog?: unknown;
          };
          expect(leak.initialState).toBeUndefined();
          expect(leak.actionLog).toBeUndefined();
        }
      });

      it('list() after delete excludes the deleted id', async () => {
        const store = await makeStore();
        const a = await store.save(await makeValidReplay());
        const b = await store.save(await makeValidReplay());
        const c = await store.save(await makeValidReplay());
        if (!a.ok || !b.ok || !c.ok) throw new Error('save failed');

        const del = await store.delete(b.id);
        expect(del.ok).toBe(true);

        const meta = await store.list();
        const ids = meta.map((m) => m.id);
        expect(ids).toContain(a.id);
        expect(ids).toContain(c.id);
        expect(ids).not.toContain(b.id);
        expect(meta.length).toBe(2);
      });
    });

    // ─────────────────────────────────────────────────────────────
    // F. validation
    // ─────────────────────────────────────────────────────────────

    describe('F. validation', () => {
      it('save() of an invalid replay returns ok:false and does not store', async () => {
        const store = await makeStore();
        const bad = { schemaVersion: 999 } as unknown as MatchReplayV1;
        const res = await store.save(bad);
        expect(res.ok).toBe(false);

        const meta = await store.list();
        expect(meta.length).toBe(0);
      });

      it('failed save leaves list() unchanged', async () => {
        const store = await makeStore();
        const okSave = await store.save(await makeValidReplay());
        if (!okSave.ok) throw new Error('save failed');

        const before = (await store.list()).length;
        const bad = { actionLog: 'nope' } as unknown as MatchReplayV1;
        const failed = await store.save(bad);
        expect(failed.ok).toBe(false);

        const after = (await store.list()).length;
        expect(after).toBe(before);
      });
    });

    // ─────────────────────────────────────────────────────────────
    // G. replay validity after load
    // ─────────────────────────────────────────────────────────────

    describe('G. replay validity after load', () => {
      it('every loaded replay validates cleanly', async () => {
        const store = await makeStore();
        const saved: string[] = [];
        for (let i = 0; i < 3; i++) {
          const r = await store.save(await makeValidReplay());
          if (!r.ok) throw new Error('save failed');
          saved.push(r.id);
        }
        for (const id of saved) {
          const l = await store.load(id);
          if (!l.ok) throw new Error('load failed');
          const v = validateReplay(l.replay);
          expect(v.ok).toBe(true);
        }
      });

      it('replayToFinalState matches stored metadata finalHash for every artifact', async () => {
        const store = await makeStore();
        const ids: string[] = [];
        for (let i = 0; i < 3; i++) {
          const r = await store.save(await makeValidReplay());
          if (!r.ok) throw new Error('save failed');
          ids.push(r.id);
        }

        const meta = await store.list();
        for (const m of meta) {
          const l = await store.load(m.id);
          if (!l.ok) throw new Error('load failed');
          const finalState = replayToFinalState(l.replay);
          expect(computeStateHash(finalState)).toBe(m.finalHash);
        }
      });
    });

    // ─────────────────────────────────────────────────────────────
    // H. concurrent mixed operations
    // ─────────────────────────────────────────────────────────────

    describe('H. concurrent mixed operations', () => {
      it('parallel saves + delete one + load the rest behaves correctly', async () => {
        const store = await makeStore();
        const N = 6;
        const replays = await Promise.all(
          Array.from({ length: N }, () => makeValidReplay()),
        );
        const saveResults = await Promise.all(
          replays.map((r) => store.save(r)),
        );
        const ids = saveResults.map((r) => {
          if (!r.ok) throw new Error('save failed');
          return r.id;
        });

        // Delete the middle id.
        const middle = ids[Math.floor(N / 2)]!;
        const remaining = ids.filter((id) => id !== middle);

        // Concurrent mixed: delete + parallel loads of the others.
        const [del, ...loads] = await Promise.all([
          store.delete(middle),
          ...remaining.map((id) => store.load(id)),
        ]);
        expect(del.ok).toBe(true);
        for (const l of loads) expect(l.ok).toBe(true);

        // Post-delete: load(middle) fails.
        const lost = await store.load(middle);
        expect(lost.ok).toBe(false);
        if (!lost.ok) expect(lost.reason).toBe('not_found');

        // list() reflects exactly the remaining set.
        const meta = await store.list();
        const listedIds = meta.map((m) => m.id).sort();
        const expectedIds = [...remaining].sort();
        expect(listedIds).toEqual(expectedIds);
      });
    });
  });
}
