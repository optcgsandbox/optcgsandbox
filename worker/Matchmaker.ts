// Matchmaker — single global Durable Object that pairs players into GameRooms.
// Per backend-architecture.md §3 matchmaking.
//
// FIFO queue (v0). When 2 players are queued, mint a new GameRoom DO, return
// { roomId, token, player } to both clients.

import type { Env } from './index';

interface Waiting {
  sessionId: string;
  joinedAt: number;
}

export class Matchmaker {
  private queue: Waiting[] = [];

  constructor(private state: DurableObjectState, private env: Env) {
    this.state.blockConcurrencyWhile(async () => {
      this.queue = (await state.storage.get<Waiting[]>('queue')) ?? [];
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/api/join') {
      return new Response('not found', { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
    const sessionId = body.sessionId ?? crypto.randomUUID();

    // Pair with head of queue, else enqueue.
    const peer = this.queue.shift();
    if (peer) {
      await this.state.storage.put('queue', this.queue);
      const roomId = this.env.GAME_ROOM.newUniqueId().toString();
      // Tokens are opaque to the client; the GameRoom checks them on /ws connect.
      const tokenA = crypto.randomUUID();
      const tokenB = crypto.randomUUID();

      // Tell the GameRoom which sessions own which seat.
      const roomStub = this.env.GAME_ROOM.get(this.env.GAME_ROOM.idFromString(roomId));
      await roomStub.fetch('https://internal/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed: Math.floor(Math.random() * 0xffffffff),
          playerA: { sessionId: peer.sessionId, token: tokenA },
          playerB: { sessionId, token: tokenB },
        }),
      });

      // Respond to THIS request (the second player).
      return Response.json({
        status: 'PAIRED',
        roomId,
        you: 'B',
        token: tokenB,
        // The first player polls / re-attempts join; in v0 they receive 'PAIRED' via
        // a separate pending-poll endpoint. v0.1: server-sent events.
      });
    }

    this.queue.push({ sessionId, joinedAt: Date.now() });
    await this.state.storage.put('queue', this.queue);
    return Response.json({ status: 'QUEUED', sessionId, queueLen: this.queue.length });
  }
}
