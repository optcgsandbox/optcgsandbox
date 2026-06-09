// Online-lobby state machine (Zustand).
//
// Owns the lobby state transitions:
//
//   idle → submitting → queued → paired → connecting → connected
//                                           ↘             ↘
//                                            error         error
//
// Polling, retry, and WebSocket lifecycle are encapsulated here so the
// UI component stays declarative.

import { create } from 'zustand';

import {
  apiJoin,
  apiPoll,
  wsUrl,
  type DeckPayload,
  type ApiJoinResponse,
  type ApiPollResponse,
} from './api';
import { openOnlineSocket, type OnlineSocket } from './wsClient';
import { buildOnlineDeck, type DeckColor } from './buildDeck';
import type {
  ClientMessage,
  ServerMessage,
} from '@shared/server/transport/protocol';
import type { Action } from '@shared/engine-v2/protocol/actions';
import type { PublicGameState } from '@shared/server/publicProjection';

type LobbyPhase =
  | 'idle'
  | 'submitting'
  | 'queued'
  | 'paired'
  | 'connecting'
  | 'connected'
  | 'error';

interface PairedInfo {
  readonly roomId: string;
  readonly you: 'A' | 'B';
  readonly clientId: string;
  readonly token: string;
  readonly leaderA: { id: string; name: string };
  readonly leaderB: { id: string; name: string };
}

type LastActionResult =
  | { readonly kind: 'accepted'; readonly clientSeq: number; readonly serverSeq: number }
  | { readonly kind: 'rejected'; readonly clientSeq: number; readonly reason: string }
  | null;

interface OnlineState {
  // public state surface
  phase: LobbyPhase;
  sessionId: string;
  color: DeckColor;
  queueLen: number;
  paired: PairedInfo | null;
  errorReason: string | null;
  lastServerMessage: ServerMessage | null;

  // F-7d: server-authoritative state mirror
  currentState: PublicGameState | null;
  currentHash: string | null;
  serverSeq: number;
  clientSeq: number;
  lastActionResult: LastActionResult;

  // F-7e: server-supplied viewer-specific legal actions.
  // The client NEVER computes legality itself.
  currentLegalActions: ReadonlyArray<Action>;

  // actions
  setSessionId(id: string): void;
  setColor(c: DeckColor): void;
  findMatch(): Promise<void>;
  disconnect(): void;
  sendAction(action: Action): void;
  requestSnapshot(): void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let socket: OnlineSocket | null = null;

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function closeSocket() {
  if (socket !== null) {
    socket.close();
    socket = null;
  }
}

export const useOnlineMatch = create<OnlineState>((set, get) => ({
  phase: 'idle',
  sessionId:
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : 'session-' + Math.random().toString(36).slice(2),
  color: 'red',
  queueLen: 0,
  paired: null,
  errorReason: null,
  lastServerMessage: null,
  currentState: null,
  currentHash: null,
  serverSeq: 0,
  clientSeq: 0,
  lastActionResult: null,
  currentLegalActions: [],

  setSessionId(id) {
    set({ sessionId: id });
  },
  setColor(c) {
    set({ color: c });
  },

  async findMatch() {
    const { sessionId, color } = get();
    set({
      phase: 'submitting',
      errorReason: null,
      paired: null,
      lastServerMessage: null,
    });

    let deck: DeckPayload;
    try {
      const built = buildOnlineDeck(color);
      deck = {
        leaderId: built.leaderId,
        mainDeckIds: built.mainDeckIds.slice(),
        name: `Dev ${color} (${built.leaderName})`,
      };
    } catch (err) {
      set({
        phase: 'error',
        errorReason: `deck_build_failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const joinRes: ApiJoinResponse = await apiJoin({ sessionId, deck });
    if (joinRes.status === 'QUEUED') {
      set({ phase: 'queued', queueLen: joinRes.queueLen });
      startPolling(set, get);
      return;
    }
    if (joinRes.status === 'PAIRED') {
      handlePaired(set, get, {
        roomId: joinRes.roomId,
        you: joinRes.you,
        clientId: joinRes.clientId,
        token: joinRes.token,
        leaderA: joinRes.leaderA,
        leaderB: joinRes.leaderB,
      });
      return;
    }
    if (joinRes.status === 'deck_invalid') {
      set({ phase: 'error', errorReason: `deck_invalid: ${joinRes.reason}` });
      return;
    }
    if (joinRes.status === 'init_failed') {
      set({
        phase: 'error',
        errorReason: `init_failed (HTTP ${joinRes.upstreamStatus}): ${joinRes.upstreamBody}`,
      });
      return;
    }
    set({ phase: 'error', errorReason: `transport_error: ${joinRes.reason}` });
  },

  disconnect() {
    stopPolling();
    closeSocket();
    set({
      phase: 'idle',
      paired: null,
      errorReason: null,
      lastServerMessage: null,
      queueLen: 0,
      currentState: null,
      currentHash: null,
      serverSeq: 0,
      clientSeq: 0,
      lastActionResult: null,
      currentLegalActions: [],
    });
  },

  sendAction(action: Action) {
    if (socket === null) {
      set({ lastActionResult: { kind: 'rejected', clientSeq: get().clientSeq, reason: 'socket_not_open' } });
      return;
    }
    const nextClientSeq = get().clientSeq + 1;
    const paired = get().paired;
    if (paired === null) {
      set({ lastActionResult: { kind: 'rejected', clientSeq: nextClientSeq, reason: 'not_paired' } });
      return;
    }
    const msg: ClientMessage = {
      type: 'submit_action',
      clientId: paired.clientId,
      action,
      clientSeq: nextClientSeq,
    };
    set({ clientSeq: nextClientSeq });
    socket.send(msg);
  },

  requestSnapshot() {
    const paired = get().paired;
    if (socket === null || paired === null) return;
    socket.send({ type: 'request_snapshot', clientId: paired.clientId });
  },
}));

function startPolling(
  set: (partial: Partial<OnlineState>) => void,
  get: () => OnlineState,
): void {
  stopPolling();
  pollTimer = setInterval(async () => {
    const { sessionId, phase } = get();
    if (phase !== 'queued') {
      stopPolling();
      return;
    }
    const poll: ApiPollResponse = await apiPoll(sessionId);
    if (poll.status === 'QUEUED') {
      set({ queueLen: poll.queueLen });
      return;
    }
    if (poll.status === 'PAIRED') {
      handlePaired(set, get, {
        roomId: poll.roomId,
        you: poll.you,
        clientId: poll.clientId,
        token: poll.token,
        leaderA: poll.leaderA,
        leaderB: poll.leaderB,
      });
      return;
    }
    if (poll.status === 'unknown_session') {
      stopPolling();
      set({
        phase: 'error',
        errorReason: 'unknown_session (server lost queue?)',
      });
      return;
    }
    // transport_error → keep polling silently
  }, 2000);
}

function handlePaired(
  set: (partial: Partial<OnlineState>) => void,
  get: () => OnlineState,
  info: PairedInfo,
): void {
  stopPolling();
  set({ phase: 'paired', paired: info });
  // Open WebSocket immediately.
  set({ phase: 'connecting' });
  const url = wsUrl(info.roomId, info.token);
  socket = openOnlineSocket(url, {
    onOpen: () => {
      set({ phase: 'connected' });
      socket?.send({
        type: 'join',
        player: info.you,
        clientId: info.clientId,
      });
    },
    onMessage: (msg) => {
      // F-7d: mirror server-authoritative state into the store. The
      // client NEVER applies actions locally — every state change
      // arrives via a ServerMessage from `MatchRoom`.
      set({ lastServerMessage: msg });
      if (msg.type === 'joined') {
        set({
          currentState: msg.state,
          currentHash: msg.hash,
          serverSeq: 0,
          currentLegalActions: msg.legalActions,
        });
      } else if (msg.type === 'snapshot') {
        set({
          currentState: msg.state,
          currentHash: msg.hash,
          serverSeq: msg.serverSeq,
          currentLegalActions: msg.legalActions,
        });
      } else if (msg.type === 'action_accepted') {
        set({
          currentState: msg.state,
          currentHash: msg.hash,
          serverSeq: msg.serverSeq,
          currentLegalActions: msg.legalActions,
          lastActionResult: {
            kind: 'accepted',
            clientSeq: msg.clientSeq,
            serverSeq: msg.serverSeq,
          },
        });
      } else if (msg.type === 'action_rejected') {
        set({
          currentState: msg.state,
          currentHash: msg.hash,
          currentLegalActions: msg.legalActions,
          lastActionResult: {
            kind: 'rejected',
            clientSeq: msg.clientSeq,
            reason: msg.reason,
          },
        });
      }
    },
    onClose: (code, reason) => {
      const { phase } = get();
      if (phase === 'connecting' || phase === 'connected') {
        set({
          phase: 'error',
          errorReason: `socket_closed (${code}): ${reason || '(no reason)'}`,
        });
      }
    },
    onError: (reason) => {
      set({ phase: 'error', errorReason: `socket_error: ${reason}` });
    },
  });
}
