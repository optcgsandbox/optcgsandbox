// Worker router. Per docs/optcg-sim/backend-architecture.md §4.
//
// Routes:
//   POST /api/join           → Matchmaker DO (queues player, returns roomId + token)
//   GET  /ws?room=&token=    → GameRoom DO   (upgrades to WebSocket via Hibernation API)

export { GameRoom } from './GameRoom';
export { Matchmaker } from './Matchmaker';

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
  ENV: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') ?? '';

    // Origin allowlist per security-architecture.md §3.
    const ALLOWED = [
      'https://optcgsandbox.com',
      'https://www.optcgsandbox.com',
      'https://optcgsandbox.pages.dev',
    ];
    // Localhost dev origins are allowed ONLY when the worker is NOT in
    // production mode (env.ENV !== 'production'). Local Vite (5174) +
    // Playwright auto-vite (5173) need this for the lobby to fetch
    // /api/join + open /ws without CORS rejection.
    const isLocalDev =
      env.ENV !== 'production' &&
      /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    const isAllowed =
      ALLOWED.includes(origin) ||
      origin.endsWith('.pages.dev') ||
      isLocalDev;

    const corsHeaders: HeadersInit = {
      'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === '/api/join' && req.method === 'POST') {
      const mmId = env.MATCHMAKER.idFromName('global');
      const mm = env.MATCHMAKER.get(mmId);
      const resp = await mm.fetch(req);
      // Re-inject CORS for the client.
      const merged = new Headers(resp.headers);
      for (const [k, v] of Object.entries(corsHeaders)) merged.set(k, v);
      return new Response(resp.body, { status: resp.status, headers: merged });
    }

    if (url.pathname === '/api/poll' && req.method === 'GET') {
      // F-7b: forward to the Matchmaker DO. The Matchmaker holds both
      // the queue + paired_results in a single DO instance keyed by
      // 'global', so polling and pairing share a consistent view.
      const mmId = env.MATCHMAKER.idFromName('global');
      const mm = env.MATCHMAKER.get(mmId);
      const resp = await mm.fetch(req);
      const merged = new Headers(resp.headers);
      for (const [k, v] of Object.entries(corsHeaders)) merged.set(k, v);
      return new Response(resp.body, { status: resp.status, headers: merged });
    }

    if (url.pathname === '/ws') {
      const roomId = url.searchParams.get('room');
      if (!roomId) return new Response('missing room', { status: 400 });
      const doId = env.GAME_ROOM.idFromString(roomId);
      const room = env.GAME_ROOM.get(doId);
      return room.fetch(req);
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, env: env.ENV }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response('not found', { status: 404, headers: corsHeaders });
  },
};
