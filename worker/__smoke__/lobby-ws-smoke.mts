// F-7c local smoke — Node WebSocket client that:
//   1. Submits two valid decks via /api/join
//   2. Opens two WebSockets (A + B) with the per-seat tokens
//   3. Confirms the server-side /ws upgrade auto-dispatches `join`
//      and the client receives `joined`
//   4. Confirms B's connect triggers A's `opponent_joined` broadcast
//   5. Sends `request_snapshot` from A and verifies hidden-info
//      projection (B's hand hidden, A's hand visible)
//   6. Sends a malformed frame from A and asserts an `error` response
//
// Run AFTER booting:
//   cd worker
//   npx wrangler dev --port 8793 --local --var DEV_AUTH:1 --var ENV:dev
//
// Then:
//   PORT=8793 npx tsx worker/__smoke__/lobby-ws-smoke.mts

import cardsRaw from '/Users/minamakar/Developer/optcgsandbox/shared/data/cards.json' with { type: 'json' };
import type { Card, LeaderCard } from '/Users/minamakar/Developer/optcgsandbox/shared/engine-v2/cards/Card.ts';

const PORT = Number(process.env.PORT ?? 8793);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const WS_ORIGIN = `ws://127.0.0.1:${PORT}`;

const corpus = cardsRaw as unknown as Card[];

function makeDeck(color: string) {
  const leader = corpus.find(
    (c): c is LeaderCard =>
      c.kind === 'leader' && c.colors.length === 1 && c.colors[0] === color,
  );
  if (!leader) throw new Error(`no ${color} leader`);
  const pool = corpus.filter(
    (c) => c.kind !== 'leader' && c.colors.includes(color as never),
  );
  const ids: string[] = [];
  const counts = new Map<string, number>();
  let i = 0;
  while (ids.length < 50 && i < pool.length * 4) {
    const c = pool[i % pool.length]!;
    const cur = counts.get(c.id) ?? 0;
    if (cur < 4) {
      ids.push(c.id);
      counts.set(c.id, cur + 1);
    }
    i += 1;
  }
  return { leaderId: leader.id, mainDeckIds: ids };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await r.json()) as T;
}

/**
 * BufferedSocket: attaches a message listener BEFORE the open event so
 * server-pushed frames (like `joined`, dispatched from inside the /ws
 * upgrade handler) never race the consumer's `await`.
 */
class BufferedSocket {
  private readonly buffer: unknown[] = [];
  private readonly waiters: Array<(m: unknown) => void> = [];
  readonly ws: WebSocket;
  private openResolved = false;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(
          typeof ev.data === 'string' ? ev.data : String(ev.data),
        );
        const w = this.waiters.shift();
        if (w !== undefined) w(parsed);
        else this.buffer.push(parsed);
      } catch {
        /* ignore non-JSON */
      }
    });
  }

  async waitOpen(timeoutMs = 4_000): Promise<void> {
    if (this.openResolved) return;
    if (this.ws.readyState === WebSocket.OPEN) {
      this.openResolved = true;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('open timeout')), timeoutMs);
      this.ws.addEventListener('open', () => {
        this.openResolved = true;
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('open error'));
      });
    });
  }

  async next<T>(
    matcher: (m: unknown) => m is T,
    timeoutMs = 4_000,
  ): Promise<T> {
    // Check buffer first.
    for (let i = 0; i < this.buffer.length; i++) {
      const m = this.buffer[i]!;
      if (matcher(m)) {
        this.buffer.splice(i, 1);
        return m;
      }
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`next() timeout after ${timeoutMs}ms`)),
        timeoutMs,
      );
      const handler = (m: unknown): void => {
        if (matcher(m)) {
          clearTimeout(timer);
          resolve(m);
        } else {
          // not the message we want; re-buffer and re-queue
          this.buffer.push(m);
          this.waiters.push(handler);
        }
      };
      this.waiters.push(handler);
    });
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }
  close(): void {
    this.ws.close();
  }
}

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}`, detail ?? '');
  }
}

async function main(): Promise<void> {
  console.log('--- A. /health ---');
  const health = await fetch(`${ORIGIN}/health`).then((r) => r.json());
  check('health ok', (health as { ok: boolean }).ok === true, health);

  console.log('--- B. /api/join alice ---');
  const aliceRes = (await postJson('/api/join', {
    sessionId: 'alice',
    deck: makeDeck('red'),
  })) as Record<string, unknown>;
  check('alice QUEUED', aliceRes.status === 'QUEUED', aliceRes);

  console.log('--- C. /api/join bob ---');
  const bobRes = (await postJson('/api/join', {
    sessionId: 'bob',
    deck: makeDeck('blue'),
  })) as {
    status: string;
    roomId?: string;
    token?: string;
    you?: string;
  };
  check('bob PAIRED', bobRes.status === 'PAIRED', bobRes);
  if (bobRes.status !== 'PAIRED') {
    process.exit(1);
  }
  const roomId = bobRes.roomId!;
  const bobToken = bobRes.token!;

  console.log('--- D. /api/poll alice ---');
  const alicePoll = (await fetch(
    `${ORIGIN}/api/poll?sessionId=alice`,
  ).then((r) => r.json())) as {
    status: string;
    token?: string;
    you?: string;
  };
  check('alice PAIRED via poll', alicePoll.status === 'PAIRED', alicePoll);
  const aliceToken = alicePoll.token!;

  console.log('--- E. open WS A ---');
  const wsA = new BufferedSocket(
    `${WS_ORIGIN}/ws?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(aliceToken)}`,
  );
  await wsA.waitOpen();
  check('WS A open', wsA.ws.readyState === WebSocket.OPEN);
  // /ws upgrade auto-dispatches `join` server-side → expect `joined`.
  const aJoined = await wsA.next((m): m is {
    type: 'joined';
    legalActions: Array<{ type: string }>;
  } => (m as { type?: string }).type === 'joined');
  check('A received joined', aJoined.type === 'joined');
  // F-7e: legalActions present on joined.
  check(
    'A joined.legalActions is an array',
    Array.isArray(aJoined.legalActions),
  );
  check(
    'A joined.legalActions includes CONCEDE',
    aJoined.legalActions.some((a) => a.type === 'CONCEDE'),
  );

  console.log('--- F. open WS B ---');
  const wsB = new BufferedSocket(
    `${WS_ORIGIN}/ws?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(bobToken)}`,
  );
  await wsB.waitOpen();
  check('WS B open', wsB.ws.readyState === WebSocket.OPEN);

  const [bJoined, aOpponent] = await Promise.all([
    wsB.next((m): m is { type: 'joined' } => (m as { type?: string }).type === 'joined'),
    wsA.next((m): m is { type: 'opponent_joined' } =>
      (m as { type?: string }).type === 'opponent_joined',
    ),
  ]);
  check('B received joined', bJoined.type === 'joined');
  check(
    'A received opponent_joined',
    aOpponent.type === 'opponent_joined',
  );

  console.log('--- G. request_snapshot from A ---');
  wsA.send({ type: 'request_snapshot', clientId: 'ignored-server-overwrites' });
  const aSnap = await wsA.next((m): m is {
    type: 'snapshot';
    state: {
      viewer: string;
      phase: string;
      activePlayer: string;
      players: Record<string, { handHidden: boolean }>;
    };
    legalActions: Array<{ type: string }>;
  } => (m as { type?: string }).type === 'snapshot');
  check('A received snapshot', aSnap.type === 'snapshot');
  check('A snapshot viewer=A', aSnap.state.viewer === 'A');
  check('A snapshot: B hand hidden', aSnap.state.players['B']!.handHidden === true);
  check('A snapshot: A hand visible', aSnap.state.players['A']!.handHidden === false);
  // F-7e: legalActions on snapshot.
  check('A snapshot.legalActions is an array', Array.isArray(aSnap.legalActions));
  check(
    'A snapshot.legalActions non-empty',
    aSnap.legalActions.length > 0,
  );
  // F-7g: assert worker reaches a playable main phase, not refresh.
  check('A snapshot phase === main', aSnap.state.phase === 'main', aSnap.state.phase);
  check('A snapshot activePlayer === A', aSnap.state.activePlayer === 'A');
  const aNonConcede = aSnap.legalActions.filter((a) => a.type !== 'CONCEDE');
  check(
    'A snapshot legalActions includes at least one non-CONCEDE action',
    aNonConcede.length > 0,
    aSnap.legalActions.map((a) => a.type),
  );

  console.log('--- H. malformed frame from A ---');
  wsA.ws.send('{ not json');
  const aErr = await wsA.next((m): m is { type: 'error'; reason: string } =>
    (m as { type?: string }).type === 'error',
  );
  check('A received error', aErr.type === 'error');
  check(
    'A error.reason starts with bad_frame',
    aErr.reason.startsWith('bad_frame'),
    aErr.reason,
  );

  // F-7g: pick the first non-CONCEDE legal action and submit it.
  // Before F-7g the worker started at phase='refresh' so END_TURN was
  // illegal; now we start at phase='main' so real gameplay actions
  // are present. We submit the first non-CONCEDE action verbatim
  // (mirroring how `OnlinePlayfield` button onClick passes the
  // server-supplied Action object to `sendAction`).
  console.log('--- H2. F-7g: A submits first non-CONCEDE legal action ---');
  const firstNonConcede = aSnap.legalActions.find((a) => a.type !== 'CONCEDE');
  if (firstNonConcede === undefined) {
    console.log('  ✗ no non-CONCEDE legal action available — F-7g failed');
    process.exit(1);
  }
  const preHash = aSnap.state ? aSnap.state : null; // for reference only
  const aActionAcceptedP = wsA.next((m): m is {
    type: 'action_accepted';
    clientSeq: number;
    serverSeq: number;
    hash: string;
    state: { phase: string; activePlayer: string };
    legalActions: Array<{ type: string }>;
  } => (m as { type?: string }).type === 'action_accepted');
  const bRealBroadcastP = wsB.next((m): m is {
    type: 'snapshot';
    hash: string;
    serverSeq: number;
    state: { phase: string };
  } => (m as { type?: string }).type === 'snapshot');
  wsA.send({
    type: 'submit_action',
    clientId: 'server-overwrites',
    action: firstNonConcede,
    clientSeq: 1,
  });
  const [aAcceptedFirst, bRealBroadcast] = await Promise.all([
    aActionAcceptedP,
    bRealBroadcastP,
  ]);
  check(
    `A first non-CONCEDE action accepted (type=${firstNonConcede.type})`,
    aAcceptedFirst.type === 'action_accepted',
  );
  check(
    'A first action clientSeq=1',
    aAcceptedFirst.clientSeq === 1,
  );
  check(
    'A first action serverSeq=1',
    aAcceptedFirst.serverSeq === 1,
  );
  check(
    'A first action hash is non-empty',
    typeof aAcceptedFirst.hash === 'string' && aAcceptedFirst.hash.length > 0,
  );
  check(
    'B received broadcast snapshot for A first action',
    bRealBroadcast.type === 'snapshot' &&
      bRealBroadcast.serverSeq === aAcceptedFirst.serverSeq,
  );
  check(
    'A action_accepted.legalActions is an array',
    Array.isArray(aAcceptedFirst.legalActions),
  );
  void preHash;

  // F-7d: submit a CONCEDE from A as a final cleanup. Use the exact
  // CONCEDE object from the most recent server-supplied legalActions
  // list (per F-7e.2). clientSeq=2 because the first non-CONCEDE
  // action above consumed clientSeq=1; serverSeq=2 because that
  // action was accepted (bumping the server seq).
  console.log('--- I. F-7d: A submits CONCEDE ---');
  const aAcceptedP = wsA.next((m): m is {
    type: 'action_accepted';
    clientSeq: number;
    serverSeq: number;
    hash: string;
    state: { result?: { loser?: string; reason?: string } | null };
    legalActions: Array<{ type: string }>;
  } => (m as { type?: string }).type === 'action_accepted');
  const bBroadcastP = wsB.next((m): m is {
    type: 'snapshot';
    state: { result?: { loser?: string; reason?: string } | null };
  } => (m as { type?: string }).type === 'snapshot');

  const concedeAction =
    aAcceptedFirst.legalActions.find((a) => a.type === 'CONCEDE') ??
    { type: 'CONCEDE' };
  wsA.send({
    type: 'submit_action',
    clientId: 'overwritten-by-server',
    action: concedeAction,
    clientSeq: 2,
  });

  const [aAccepted, bBroadcast] = await Promise.all([aAcceptedP, bBroadcastP]);
  check('A received action_accepted', aAccepted.type === 'action_accepted');
  check('A action_accepted carries clientSeq=2', aAccepted.clientSeq === 2);
  check(
    'A action_accepted carries serverSeq=2 (after first action bumped it)',
    aAccepted.serverSeq === 2,
  );
  // F-7e: legalActions on action_accepted (post-action).
  check(
    'A action_accepted.legalActions is an array',
    Array.isArray(aAccepted.legalActions),
  );
  check(
    'A state.result.loser === A (A conceded)',
    aAccepted.state.result?.loser === 'A',
    aAccepted.state.result,
  );
  check(
    'A state.result.reason === concede',
    aAccepted.state.result?.reason === 'concede',
  );
  check(
    'B broadcast snapshot reflects same result',
    bBroadcast.state.result?.loser === 'A' &&
      bBroadcast.state.result?.reason === 'concede',
    bBroadcast.state.result,
  );

  wsA.close();
  wsB.close();

  console.log('\n=== SUMMARY ===');
  console.log(`passed: ${passed}`);
  console.log(`failed: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
