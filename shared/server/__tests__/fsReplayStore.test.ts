/**
 * FsReplayStore — Phase F-3b.
 *
 * Drives the full F-3a `ReplayStore` contract against the filesystem
 * backend, then adds Fs-specific tests that the in-memory store can't
 * meaningfully cover: persistence on disk, atomic write, path-traversal
 * defense, corrupt-file handling.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from '../../engine-v2/__tests__/fixtures.js';
import { MatchSession } from '../MatchSession.js';
import { serializeReplay, type MatchReplayV1 } from '../serialize.js';
import { FsReplayStore } from '../storage/FsReplayStore.js';
import { runReplayStoreContractSuite } from '../storage/replayStoreContract.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

// Track every temp dir created during this file's tests so we can clean
// them up in afterAll. Failure to clean up is non-fatal — `os.tmpdir()`
// is the OS-managed sweep target.
const createdTempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-replay-store-'));
  createdTempDirs.push(dir);
  return dir;
}

async function makeStore(): Promise<FsReplayStore> {
  const dir = await makeTempDir();
  return new FsReplayStore(dir);
}

function makeValidReplay(): MatchReplayV1 {
  const initial = buildBasicGameState();
  const handId = moveTopOfDeckToHand(initial, 'A');
  const session = new MatchSession(initial);
  session.applyPlayerAction('A', {
    type: 'PLAY_CARD',
    instanceId: handId,
    replaceTargetId: null,
  });
  session.applyPlayerAction('A', { type: 'END_TURN' });
  return serializeReplay(session);
}

afterAll(async () => {
  await Promise.all(
    createdTempDirs.map((d) =>
      fs.rm(d, { recursive: true, force: true }).catch(() => undefined),
    ),
  );
});

// ─────────────────────────────────────────────────────────────────────
// Full F-3a contract — must pass identically against real async I/O.
// ─────────────────────────────────────────────────────────────────────

runReplayStoreContractSuite({
  name: 'FsReplayStore',
  makeStore,
  makeValidReplay,
});

// ─────────────────────────────────────────────────────────────────────
// Filesystem-specific tests
// ─────────────────────────────────────────────────────────────────────

describe('FsReplayStore — filesystem-specific behavior', () => {
  it('creates rootDir lazily on first save if missing', async () => {
    const root = path.join(
      os.tmpdir(),
      `fs-replay-store-uncreated-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    createdTempDirs.push(root);
    // Sanity: dir does not exist beforehand.
    await expect(fs.stat(root)).rejects.toMatchObject({ code: 'ENOENT' });

    const store = new FsReplayStore(root);
    const res = await store.save(makeValidReplay());
    expect(res.ok).toBe(true);

    const stat = await fs.stat(root);
    expect(stat.isDirectory()).toBe(true);
  });

  it('saved replay is persisted as a <id>.json file on disk', async () => {
    const dir = await makeTempDir();
    const store = new FsReplayStore(dir);
    const save = await store.save(makeValidReplay());
    if (!save.ok) throw new Error('save failed');

    const expectedPath = path.join(dir, `${save.id}.json`);
    const stat = await fs.stat(expectedPath);
    expect(stat.isFile()).toBe(true);

    const raw = await fs.readFile(expectedPath, 'utf8');
    const parsed = JSON.parse(raw) as MatchReplayV1;
    expect(parsed.schemaVersion).toBe(1);
    expect(typeof parsed.finalHash).toBe('string');
  });

  it('leaves no .tmp file behind after a successful save', async () => {
    const dir = await makeTempDir();
    const store = new FsReplayStore(dir);
    const save = await store.save(makeValidReplay());
    expect(save.ok).toBe(true);

    const entries = await fs.readdir(dir);
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });

  it('rejects path-traversal ids on load with invalid_id', async () => {
    const store = await makeStore();
    const r1 = await store.load('../escape');
    const r2 = await store.load('foo/bar');
    const r3 = await store.load('..\\windows');
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe('invalid_id');
    if (!r2.ok) expect(r2.reason).toBe('invalid_id');
    if (!r3.ok) expect(r3.reason).toBe('invalid_id');
  });

  it('rejects path-traversal ids on delete with invalid_id', async () => {
    const store = await makeStore();
    const r1 = await store.delete('../escape');
    const r2 = await store.delete('foo/bar');
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe('invalid_id');
    if (!r2.ok) expect(r2.reason).toBe('invalid_id');
  });

  it('load() of a file containing corrupt JSON returns ok:false corrupt_json', async () => {
    const dir = await makeTempDir();
    const store = new FsReplayStore(dir);
    // Plant a corrupt file with an id-shaped name. The id must satisfy
    // ID_REGEX so the load() pass-through reaches the JSON parser.
    const id = 'corrupt-fixture-1';
    await fs.writeFile(path.join(dir, `${id}.json`), '{ not valid json ', 'utf8');

    const load = await store.load(id);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason).toBe('corrupt_json');
  });

  it('list() SKIPS malformed/corrupt files (does not fail the whole call)', async () => {
    const dir = await makeTempDir();
    const store = new FsReplayStore(dir);

    // Drop one valid replay.
    const save = await store.save(makeValidReplay());
    if (!save.ok) throw new Error('save failed');

    // Plant a corrupt sibling.
    await fs.writeFile(path.join(dir, 'malformed-fixture.json'), '<<not json>>', 'utf8');
    // And an irrelevant file extension to make sure list ignores it.
    await fs.writeFile(path.join(dir, 'notes.txt'), 'ignore me', 'utf8');

    const meta = await store.list();
    expect(meta.length).toBe(1);
    expect(meta[0]!.id).toBe(save.id);
  });

  it('delete() removes the underlying file from disk', async () => {
    const dir = await makeTempDir();
    const store = new FsReplayStore(dir);
    const save = await store.save(makeValidReplay());
    if (!save.ok) throw new Error('save failed');
    const filePath = path.join(dir, `${save.id}.json`);

    await expect(fs.stat(filePath)).resolves.toBeDefined();

    const del = await store.delete(save.id);
    expect(del.ok).toBe(true);

    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('list() ignores .tmp sibling files', async () => {
    const dir = await makeTempDir();
    const store = new FsReplayStore(dir);
    const save = await store.save(makeValidReplay());
    if (!save.ok) throw new Error('save failed');

    // Plant a leftover .tmp file as if a crashed write was in progress.
    await fs.writeFile(
      path.join(dir, 'stale-write-fixture.json.tmp'),
      '{}',
      'utf8',
    );

    const meta = await store.list();
    const ids = meta.map((m) => m.id);
    expect(ids).toEqual([save.id]);
  });
});
