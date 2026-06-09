/**
 * ReplayStore contract — driver test file.
 *
 * Loads the engine + a real sample-replay factory, then runs the reusable
 * `runReplayStoreContractSuite` against `MemoryReplayStore`. Future
 * backends (e.g. Cloudflare KV, Supabase storage, filesystem) MUST add
 * their own driver file here and pass this exact contract before being
 * wired into the rest of the system.
 */

import { beforeAll } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from '../../engine-v2/__tests__/fixtures.js';
import { MatchSession } from '../MatchSession.js';
import { serializeReplay, type MatchReplayV1 } from '../serialize.js';
import { MemoryReplayStore } from '../storage/MemoryReplayStore.js';
import { runReplayStoreContractSuite } from '../storage/replayStoreContract.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

/**
 * Builds a fresh, valid replay each call. The engine fixtures reset
 * instance ids per build so the resulting `MatchReplayV1` is structurally
 * distinct per call (no accidental dedupe).
 */
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

runReplayStoreContractSuite({
  name: 'MemoryReplayStore',
  makeStore: () => new MemoryReplayStore(),
  makeValidReplay,
});
