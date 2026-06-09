// Structural parser for F-4b `ClientMessage` frames coming off the wire.
//
// This is the SECURITY boundary between an opaque caller-controlled
// payload and the typed `ClientMessage` discriminated union that
// `MatchRoom.handleMessage` accepts. It does NOT validate engine
// semantics (legality, sequence numbers, seat ownership) — those are
// MatchRoom's job. It only validates SHAPE.
//
// Used by:
//   - `WorkerRoomAdapter` (Cloudflare DO socket adapter)
//   - Any future transport adapter that reads JSON frames

import type { Action, ActionType } from '../../engine-v2/protocol/actions.js';
import type { ClientMessage } from './protocol.js';

export type ParseResult =
  | { readonly ok: true; readonly message: ClientMessage }
  | { readonly ok: false; readonly reason: string };

const VALID_PLAYERS = new Set(['A', 'B']);
const VALID_ACTION_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  'ROLL_DICE',
  'CHOOSE_FIRST',
  'CHOOSE_SECOND',
  'MULLIGAN',
  'KEEP_HAND',
  'PLAY_CARD',
  'PLAY_STAGE',
  'ATTACH_DON',
  'ACTIVATE_MAIN',
  'DECLARE_ATTACK',
  'DECLARE_BLOCKER',
  'PLAY_COUNTER',
  'SKIP_COUNTER',
  'SKIP_BLOCKER',
  'RESOLVE_TRIGGER',
  'RESOLVE_PEEK',
  'RESOLVE_DISCARD',
  'RESOLVE_CHOOSE_ONE',
  'RESOLVE_TARGET_PICK',
  'END_TURN',
  'CONCEDE',
]);

/**
 * Parse a `ClientMessage` from a raw inbound payload. Accepts either:
 *   - a JSON string (transport delivered bytes), or
 *   - a pre-parsed `unknown` (for tests / non-string transports).
 *
 * Always returns a discriminated result — never throws.
 */
export function parseClientMessage(raw: string | unknown): ParseResult {
  let obj: unknown;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'invalid_json' };
    }
  } else {
    obj = raw;
  }

  if (obj === null || typeof obj !== 'object') {
    return { ok: false, reason: 'not_an_object' };
  }
  const head = obj as { type?: unknown };
  if (typeof head.type !== 'string') {
    return { ok: false, reason: 'missing_type' };
  }

  switch (head.type) {
    case 'join': {
      const m = obj as {
        type: 'join';
        player?: unknown;
        clientId?: unknown;
      };
      if (typeof m.player !== 'string' || !VALID_PLAYERS.has(m.player)) {
        return { ok: false, reason: 'invalid_player' };
      }
      if (typeof m.clientId !== 'string' || m.clientId.length === 0) {
        return { ok: false, reason: 'invalid_clientId' };
      }
      return {
        ok: true,
        message: {
          type: 'join',
          player: m.player as 'A' | 'B',
          clientId: m.clientId,
        },
      };
    }

    case 'submit_action': {
      const m = obj as {
        type: 'submit_action';
        clientId?: unknown;
        action?: unknown;
        clientSeq?: unknown;
      };
      if (typeof m.clientId !== 'string' || m.clientId.length === 0) {
        return { ok: false, reason: 'invalid_clientId' };
      }
      if (
        typeof m.clientSeq !== 'number' ||
        !Number.isFinite(m.clientSeq) ||
        m.clientSeq < 0 ||
        !Number.isInteger(m.clientSeq)
      ) {
        return { ok: false, reason: 'invalid_clientSeq' };
      }
      if (m.action === null || typeof m.action !== 'object') {
        return { ok: false, reason: 'invalid_action' };
      }
      const a = m.action as { type?: unknown };
      if (typeof a.type !== 'string' || !VALID_ACTION_TYPES.has(a.type as ActionType)) {
        return { ok: false, reason: `unknown_action_type: ${String(a.type)}` };
      }
      return {
        ok: true,
        message: {
          type: 'submit_action',
          clientId: m.clientId,
          action: m.action as Action,
          clientSeq: m.clientSeq,
        },
      };
    }

    case 'request_snapshot': {
      const m = obj as { type: 'request_snapshot'; clientId?: unknown };
      if (typeof m.clientId !== 'string' || m.clientId.length === 0) {
        return { ok: false, reason: 'invalid_clientId' };
      }
      return { ok: true, message: { type: 'request_snapshot', clientId: m.clientId } };
    }

    case 'leave': {
      const m = obj as { type: 'leave'; clientId?: unknown };
      if (typeof m.clientId !== 'string' || m.clientId.length === 0) {
        return { ok: false, reason: 'invalid_clientId' };
      }
      return { ok: true, message: { type: 'leave', clientId: m.clientId } };
    }

    default:
      return { ok: false, reason: `unknown_message_type: ${head.type}` };
  }
}
