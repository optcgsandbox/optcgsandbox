// GameRoom — one Durable Object per match. Authoritative engine state lives here.
//
// Uses Cloudflare's WebSocket Hibernation API (state.acceptWebSocket) per
// backend-architecture.md §4 + security-architecture.md §5 — critical for cost:
// `ws.accept()` bills duration for entire connection lifetime; Hibernation API
// only bills while JS is actively running.

import type { Env } from './index';
import { applyAction } from '@shared/engine/applyAction';
import { initialState } from '@shared/engine/GameState';
import { setupGame } from '@shared/engine/phases/setup';
import { runDonPhase, runDrawPhase, runRefreshPhase } from '@shared/engine/phases/turn';
import { getLegalActions } from '@shared/engine/rules/legality';
import { ClientMessage } from '@shared/protocol/envelope';
import type { Action } from '@shared/protocol/actions';
import type { GameState, PlayerId } from '@shared/engine/GameState';

interface SeatBinding {
  sessionId: string;
  token: string;
  ws: WebSocket | null;
}

export class GameRoom {
  private gameState: GameState | null = null;
  private seats: Record<PlayerId, SeatBinding> | null = null;
  private seq = 0;

  constructor(private state: DurableObjectState, private _env: Env) {
    void this._env;
    this.state.blockConcurrencyWhile(async () => {
      this.gameState = (await this.state.storage.get<GameState>('state')) ?? null;
      this.seats = (await this.state.storage.get<Record<PlayerId, SeatBinding>>('seats')) ?? null;
      this.seq = (await this.state.storage.get<number>('seq')) ?? 0;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/init' && req.method === 'POST') {
      const { seed, playerA, playerB } = (await req.json()) as {
        seed: number;
        playerA: { sessionId: string; token: string };
        playerB: { sessionId: string; token: string };
      };
      // TODO v0.1: real deck supplied by client. For v0 the worker doesn't have
      // card definitions yet — engine init requires decks. Stub for now.
      this.seats = {
        A: { sessionId: playerA.sessionId, token: playerA.token, ws: null },
        B: { sessionId: playerB.sessionId, token: playerB.token, ws: null },
      };
      // Engine state will be built on first /ws connect once we have decks plumbed.
      this.gameState = null;
      await this.state.storage.put('seats', this.seats);
      await this.state.storage.put('seed', seed);
      await this.state.storage.put('seq', this.seq);
      return new Response('ok');
    }

    if (url.pathname === '/ws') {
      const token = url.searchParams.get('token');
      if (!token || !this.seats) return new Response('unauthorized', { status: 401 });
      const seat = this.seats.A.token === token ? 'A' : this.seats.B.token === token ? 'B' : null;
      if (!seat) return new Response('bad token', { status: 401 });

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      // Hibernation API: do NOT call server.accept(). state.acceptWebSocket bills
      // duration only while JS executes. See security-architecture.md §5.
      this.state.acceptWebSocket(server, [seat]);
      this.seats[seat].ws = server;
      await this.state.storage.put('seats', this.seats);

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    const parsed = ClientMessage.safeParse(JSON.parse(message));
    if (!parsed.success) {
      ws.send(JSON.stringify({ type: 'ERROR', reason: 'schema', retryable: false }));
      return;
    }
    const msg = parsed.data;
    const tags = (this.state.getTags(ws) ?? []) as string[];
    const seat = tags[0] as PlayerId | undefined;
    if (!seat) return;

    if (msg.type === 'ACTION') {
      if (!this.gameState) {
        ws.send(JSON.stringify({ type: 'ERROR', reason: 'no_state', retryable: true }));
        return;
      }
      // Server-authoritative validation per security-architecture.md §2.
      const legal = getLegalActions(this.gameState, seat);
      const isLegal = legal.some((a) => actionsEqual(a, msg.action));
      if (!isLegal) {
        ws.send(JSON.stringify({ type: 'ERROR', reason: 'illegal_action', retryable: false }));
        return;
      }
      const { state: next, events } = applyAction(this.gameState, seat, msg.action);
      this.gameState = next;
      this.seq += 1;
      await this.state.storage.put('state', next);
      await this.state.storage.put('seq', this.seq);
      this.broadcastDelta(events);

      if (next.result) {
        const winner = next.result.winner;
        this.broadcast({ type: 'GAME_OVER', winner });
      }
    } else if (msg.type === 'REQUEST_SNAPSHOT') {
      this.sendSnapshot(ws, seat);
    } else if (msg.type === 'HEARTBEAT') {
      // No-op; presence is implicit in active socket.
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    if (!this.seats) return;
    for (const seat of ['A', 'B'] as PlayerId[]) {
      if (this.seats[seat].ws === ws) {
        this.seats[seat].ws = null;
        await this.state.storage.put('seats', this.seats);
        // v0.1: start grace timer, alarm() to award walkover.
      }
    }
  }

  private broadcastDelta(events: unknown[]): void {
    if (!this.seats) return;
    const payload = JSON.stringify({ type: 'DELTA', seq: this.seq, eventsJson: JSON.stringify(events) });
    for (const seat of ['A', 'B'] as PlayerId[]) {
      const ws = this.seats[seat].ws;
      if (ws) {
        try { ws.send(payload); } catch { /* socket closed */ }
      }
    }
  }

  private broadcast(msg: unknown): void {
    if (!this.seats) return;
    const payload = JSON.stringify(msg);
    for (const seat of ['A', 'B'] as PlayerId[]) {
      const ws = this.seats[seat].ws;
      if (ws) { try { ws.send(payload); } catch { /* swallow */ } }
    }
  }

  private sendSnapshot(ws: WebSocket, seat: PlayerId): void {
    if (!this.gameState) return;
    // v0.1: per-seat filtered state (hide opponent's hand). For now send full state.
    void seat;
    const payload = JSON.stringify({
      type: 'SNAPSHOT',
      seq: this.seq,
      stateJson: JSON.stringify(this.gameState),
    });
    ws.send(payload);
  }
}

function actionsEqual(a: Action, b: Action): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Phase advance helpers (unused for now; v0.1 wires into round transitions).
void setupGame; void initialState; void runRefreshPhase; void runDrawPhase; void runDonPhase;
