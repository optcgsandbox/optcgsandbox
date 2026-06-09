// Thin WebSocket client wrapping `globalThis.WebSocket`.
//
// Speaks F-4b `ClientMessage` / `ServerMessage` JSON frames. Does NOT
// know about the engine; the lobby owns interpretation. Stays under
// 100 lines deliberately — wrapping a WebSocket should look like one.

import type {
  ClientMessage,
  ServerMessage,
} from '@shared/server/transport/protocol';

export interface OnlineSocketHandlers {
  onOpen?: () => void;
  onMessage: (msg: ServerMessage) => void;
  onClose: (code: number, reason: string) => void;
  onError: (reason: string) => void;
}

export interface OnlineSocket {
  send(msg: ClientMessage): void;
  close(): void;
  readonly state: () => 'connecting' | 'open' | 'closing' | 'closed';
}

export function openOnlineSocket(
  url: string,
  handlers: OnlineSocketHandlers,
): OnlineSocket {
  const ws = new WebSocket(url);

  ws.addEventListener('open', () => handlers.onOpen?.());
  ws.addEventListener('message', (ev: MessageEvent) => {
    if (typeof ev.data !== 'string') {
      handlers.onError('binary_frame_unexpected');
      return;
    }
    let parsed: ServerMessage;
    try {
      parsed = JSON.parse(ev.data) as ServerMessage;
    } catch {
      handlers.onError('invalid_json');
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      handlers.onError('malformed_server_message');
      return;
    }
    handlers.onMessage(parsed);
  });
  ws.addEventListener('close', (ev: CloseEvent) =>
    handlers.onClose(ev.code, ev.reason),
  );
  ws.addEventListener('error', () => handlers.onError('socket_error'));

  return {
    send: (msg) => ws.send(JSON.stringify(msg)),
    close: () => ws.close(),
    state: () => {
      switch (ws.readyState) {
        case WebSocket.CONNECTING:
          return 'connecting';
        case WebSocket.OPEN:
          return 'open';
        case WebSocket.CLOSING:
          return 'closing';
        default:
          return 'closed';
      }
    },
  };
}
