/**
 * parseClientMessage — structural validator for inbound socket frames.
 *
 * Pure unit tests. No engine, no MatchRoom — just shape checks.
 */

import { describe, expect, it } from 'vitest';

import { parseClientMessage } from '../transport/parseClientMessage.js';

describe('parseClientMessage — happy paths', () => {
  it('accepts a valid join frame as JSON string', () => {
    const raw = JSON.stringify({ type: 'join', player: 'A', clientId: 'c1' });
    const res = parseClientMessage(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.message.type).toBe('join');
      if (res.message.type === 'join') {
        expect(res.message.player).toBe('A');
        expect(res.message.clientId).toBe('c1');
      }
    }
  });

  it('accepts a valid submit_action frame', () => {
    const raw = JSON.stringify({
      type: 'submit_action',
      clientId: 'c1',
      clientSeq: 1,
      action: { type: 'END_TURN' },
    });
    const res = parseClientMessage(raw);
    expect(res.ok).toBe(true);
    if (res.ok && res.message.type === 'submit_action') {
      expect(res.message.action.type).toBe('END_TURN');
      expect(res.message.clientSeq).toBe(1);
    }
  });

  it('accepts request_snapshot and leave frames', () => {
    const r1 = parseClientMessage({ type: 'request_snapshot', clientId: 'c1' });
    const r2 = parseClientMessage({ type: 'leave', clientId: 'c1' });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it('accepts already-parsed object (non-string input)', () => {
    const res = parseClientMessage({
      type: 'join',
      player: 'B',
      clientId: 'c2',
    });
    expect(res.ok).toBe(true);
  });
});

describe('parseClientMessage — rejection paths', () => {
  it('rejects invalid JSON string', () => {
    const res = parseClientMessage('{ not json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_json');
  });

  it('rejects non-object payload', () => {
    expect(parseClientMessage(42).ok).toBe(false);
    expect(parseClientMessage(null).ok).toBe(false);
    expect(parseClientMessage('"a-string"').ok).toBe(false);
  });

  it('rejects payload with missing type', () => {
    const r = parseClientMessage({ clientId: 'c1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_type');
  });

  it('rejects unknown message type', () => {
    const r = parseClientMessage({ type: 'evolve_pokemon', clientId: 'c1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unknown_message_type/);
  });

  it('rejects join with invalid player', () => {
    const r = parseClientMessage({ type: 'join', player: 'C', clientId: 'c1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_player');
  });

  it('rejects join with empty clientId', () => {
    const r = parseClientMessage({ type: 'join', player: 'A', clientId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_clientId');
  });

  it('rejects submit_action with non-integer clientSeq', () => {
    const r = parseClientMessage({
      type: 'submit_action',
      clientId: 'c1',
      clientSeq: 1.5,
      action: { type: 'END_TURN' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_clientSeq');
  });

  it('rejects submit_action with unknown action type', () => {
    const r = parseClientMessage({
      type: 'submit_action',
      clientId: 'c1',
      clientSeq: 1,
      action: { type: 'SUMMON_RANCOR' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^unknown_action_type/);
  });

  it('rejects submit_action with missing action object', () => {
    const r = parseClientMessage({
      type: 'submit_action',
      clientId: 'c1',
      clientSeq: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_action');
  });
});
