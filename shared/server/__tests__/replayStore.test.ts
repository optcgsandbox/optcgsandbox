/**
 * MemoryReplayStore — Phase F-2.
 *
 * Validates the persistence boundary contract: save/load/delete/list,
 * structural validation on save, defensive copies on save+load, and the
 * "list returns metadata only" invariant.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from '../../engine-v2/__tests__/fixtures.js';
import { MatchSession } from '../MatchSession.js';
import {
  serializeReplay,
  validateReplay,
  type MatchReplayV1,
} from '../serialize.js';
import { MemoryReplayStore } from '../storage/MemoryReplayStore.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

function buildReplay(): MatchReplayV1 {
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

describe('MemoryReplayStore — save/load/delete/list', () => {
  let store: MemoryReplayStore;
  beforeEach(() => {
    store = new MemoryReplayStore();
  });

  it('saves a valid replay and returns a non-empty id', async () => {
    const replay = buildReplay();
    const res = await store.save(replay);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(typeof res.id).toBe('string');
      expect(res.id.length).toBeGreaterThan(0);
    }
  });

  it('rejects an invalid replay without storing it', async () => {
    const bad = { schemaVersion: 999 } as unknown as MatchReplayV1;
    const res = await store.save(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/unsupported_schema_version/);

    expect((await store.list()).length).toBe(0);
  });

  it('loads a previously-saved replay by id', async () => {
    const replay = buildReplay();
    const save = await store.save(replay);
    if (!save.ok) throw new Error('save failed');
    const load = await store.load(save.id);
    expect(load.ok).toBe(true);
    if (load.ok) {
      expect(load.replay.finalHash).toBe(replay.finalHash);
      expect(load.replay.actionLog.length).toBe(replay.actionLog.length);
      expect(load.replay.schemaVersion).toBe(replay.schemaVersion);
    }
  });

  it('load with an unknown id returns ok:false with reason not_found', async () => {
    const load = await store.load('definitely-not-an-id');
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason).toBe('not_found');
  });

  it('delete removes a saved replay', async () => {
    const replay = buildReplay();
    const save = await store.save(replay);
    if (!save.ok) throw new Error('save failed');

    const del = await store.delete(save.id);
    expect(del.ok).toBe(true);

    const load = await store.load(save.id);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason).toBe('not_found');
  });

  it('delete with unknown id returns ok:false with reason not_found', async () => {
    const del = await store.delete('definitely-not-an-id');
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.reason).toBe('not_found');
  });

  it('list returns metadata only — no full replay payload', async () => {
    await store.save(buildReplay());
    await store.save(buildReplay());

    const list = await store.list();
    expect(list.length).toBe(2);
    for (const entry of list) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.finalHash).toBe('string');
      // No leak of full artifact.
      expect((entry as unknown as { initialState?: unknown }).initialState).toBeUndefined();
      expect((entry as unknown as { actionLog?: unknown }).actionLog).toBeUndefined();
    }
  });

  it('ids are unique across multiple saves (even of the same replay)', async () => {
    const replay = buildReplay();
    const a = await store.save(replay);
    const b = await store.save(replay);
    const c = await store.save(replay);
    if (!a.ok || !b.ok || !c.ok) throw new Error('save failed');

    const ids = new Set([a.id, b.id, c.id]);
    expect(ids.size).toBe(3);
  });

  it('finalHash in list metadata matches the saved replay.finalHash', async () => {
    const replay = buildReplay();
    const save = await store.save(replay);
    if (!save.ok) throw new Error('save failed');

    const list = await store.list();
    const meta = list.find((m) => m.id === save.id);
    expect(meta).toBeDefined();
    expect(meta!.finalHash).toBe(replay.finalHash);
    expect(meta!.createdAt).toBe(replay.createdAt);
  });
});

describe('MemoryReplayStore — defensive copies (no mutation leaks)', () => {
  let store: MemoryReplayStore;
  beforeEach(() => {
    store = new MemoryReplayStore();
  });

  it('mutating the original replay AFTER save does not affect the stored copy', async () => {
    const replay = buildReplay();
    const save = await store.save(replay);
    if (!save.ok) throw new Error('save failed');

    // Mutate the caller's copy.
    (replay as { finalHash: string }).finalHash = 'tampered';
    (replay.actionLog as unknown[]).push({ player: 'A', action: { type: 'END_TURN' } });

    const load = await store.load(save.id);
    expect(load.ok).toBe(true);
    if (load.ok) {
      expect(load.replay.finalHash).not.toBe('tampered');
      // Same number of actions as the original sample (2: PLAY_CARD + END_TURN).
      expect(load.replay.actionLog.length).toBe(2);
    }
  });

  it('mutating a loaded replay does not affect the stored copy', async () => {
    const replay = buildReplay();
    const save = await store.save(replay);
    if (!save.ok) throw new Error('save failed');

    const firstLoad = await store.load(save.id);
    if (!firstLoad.ok) throw new Error('first load failed');
    // Tamper with the loaded copy.
    (firstLoad.replay as { finalHash: string }).finalHash = 'mutated_by_caller';
    (firstLoad.replay.actionLog as unknown[]).push({ player: 'B', action: { type: 'CONCEDE' } });

    const secondLoad = await store.load(save.id);
    expect(secondLoad.ok).toBe(true);
    if (secondLoad.ok) {
      expect(secondLoad.replay.finalHash).toBe(replay.finalHash);
      expect(secondLoad.replay.actionLog.length).toBe(2);
    }
  });

  it('a loaded replay still validates cleanly (hash parity preserved)', async () => {
    const replay = buildReplay();
    const save = await store.save(replay);
    if (!save.ok) throw new Error('save failed');

    const load = await store.load(save.id);
    if (!load.ok) throw new Error('load failed');

    const result = validateReplay(load.replay);
    expect(result.ok).toBe(true);
  });

  it('saving an object whose interior was already deep-cloned still works', async () => {
    const replay = buildReplay();
    const cloned = structuredClone(replay);
    const save = await store.save(cloned);
    expect(save.ok).toBe(true);
  });
});
