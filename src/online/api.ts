// Lobby fetch wrappers.
//
// The worker dev origin is read from `VITE_workerOrigin()` if present,
// otherwise defaults to the same-origin worker. Local-dev value:
// `http://127.0.0.1:8789` (whatever port `wrangler dev` is on).

/**
 * Resolve the worker origin at call-time so Playwright can inject a
 * dev-time override via `window.__workerOrigin()__` using
 * `page.addInitScript`. Resolution order:
 *   1. `(globalThis as any).__workerOrigin()__` — runtime override for tests
 *   2. `import.meta.env.VITE_workerOrigin()` — build-time env from Vite
 *   3. `''` — same-origin fallback (production deployment)
 */
function workerOrigin(): string {
  if (typeof globalThis !== 'undefined') {
    const override = (globalThis as { __WORKER_ORIGIN__?: unknown }).__WORKER_ORIGIN__;
    if (typeof override === 'string' && override.length > 0) return override;
  }
  const envValue = (import.meta.env as Record<string, string | undefined>)['VITE_WORKER_ORIGIN'];
  return typeof envValue === 'string' ? envValue : '';
}

export interface DeckPayload {
  readonly leaderId: string;
  readonly mainDeckIds: ReadonlyArray<string>;
  readonly name?: string;
}

export interface ApiJoinRequest {
  readonly sessionId: string;
  readonly deck: DeckPayload;
}

export type ApiJoinResponse =
  | { readonly status: 'QUEUED'; readonly sessionId: string; readonly queueLen: number }
  | {
      readonly status: 'PAIRED';
      readonly roomId: string;
      readonly you: 'A' | 'B';
      readonly clientId: string;
      readonly token: string;
      readonly leaderA: { id: string; name: string };
      readonly leaderB: { id: string; name: string };
    }
  | { readonly status: 'deck_invalid'; readonly reason: string }
  | { readonly status: 'init_failed'; readonly upstreamStatus: number; readonly upstreamBody: string }
  | { readonly status: 'transport_error'; readonly reason: string };

export type ApiPollResponse =
  | { readonly status: 'QUEUED'; readonly sessionId: string; readonly queueLen: number }
  | {
      readonly status: 'PAIRED';
      readonly roomId: string;
      readonly you: 'A' | 'B';
      readonly clientId: string;
      readonly token: string;
      readonly leaderA: { id: string; name: string };
      readonly leaderB: { id: string; name: string };
    }
  | { readonly status: 'unknown_session' }
  | { readonly status: 'transport_error'; readonly reason: string };

export async function apiJoin(req: ApiJoinRequest): Promise<ApiJoinResponse> {
  try {
    const r = await fetch(`${workerOrigin()}/api/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    const json = (await r.json().catch(() => ({}))) as ApiJoinResponse;
    return json;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: 'transport_error', reason };
  }
}

export async function apiPoll(sessionId: string): Promise<ApiPollResponse> {
  try {
    const r = await fetch(
      `${workerOrigin()}/api/poll?sessionId=${encodeURIComponent(sessionId)}`,
    );
    const json = (await r.json().catch(() => ({}))) as ApiPollResponse;
    return json;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: 'transport_error', reason };
  }
}

export function wsUrl(roomId: string, token: string): string {
  // `workerOrigin()` may include the http scheme. Swap to ws/wss as needed.
  const base = workerOrigin() === '' ? '' : workerOrigin();
  const scheme = base.startsWith('https://')
    ? 'wss://'
    : base.startsWith('http://')
      ? 'ws://'
      : (typeof window !== 'undefined' && window.location.protocol === 'https:'
        ? 'wss://'
        : 'ws://');
  const host = base === ''
    ? typeof window !== 'undefined'
      ? window.location.host
      : ''
    : base.replace(/^https?:\/\//, '');
  return `${scheme}${host}/ws?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`;
}
