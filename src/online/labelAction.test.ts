/**
 * labelAction — pure-function unit tests. Phase F-7e.2.
 *
 * No engine boot, no DOM. Synthetic minimal PublicGameState built
 * inline.
 */

import { describe, expect, it } from 'vitest';

import { actionResolvesCleanly, labelAction } from './labelAction';
import type { Action } from '@shared/engine-v2/protocol/actions';
import type { PublicGameState } from '@shared/server/publicProjection';

function makeState(): PublicGameState {
  const cardLibrary = {
    'C-HERO': { id: 'C-HERO', name: 'Test Hero' },
    'C-VILLAIN': { id: 'C-VILLAIN', name: 'Test Villain' },
  } as unknown as PublicGameState['cardLibrary'];

  const instances = {
    'inst-A-leader': { instanceId: 'inst-A-leader', cardId: 'C-HERO' },
    'inst-A-char': { instanceId: 'inst-A-char', cardId: 'C-HERO' },
    'inst-B-leader': { instanceId: 'inst-B-leader', cardId: 'C-VILLAIN' },
  } as unknown as PublicGameState['instances'];

  return {
    phase: 'main',
    turn: 3,
    activePlayer: 'A',
    firstPlayer: 'A',
    pending: null,
    result: null,
    players: {} as PublicGameState['players'],
    instances,
    cardLibrary,
    viewer: 'A',
  };
}

describe('labelAction — literal labels', () => {
  it('CONCEDE → "Concede"', () => {
    expect(labelAction({ type: 'CONCEDE' }, makeState())).toBe('Concede');
  });
  it('END_TURN → "End Turn"', () => {
    expect(labelAction({ type: 'END_TURN' }, makeState())).toBe('End Turn');
  });
  it('SKIP_BLOCKER / SKIP_COUNTER labels', () => {
    const s = makeState();
    expect(labelAction({ type: 'SKIP_BLOCKER' }, s)).toBe('Skip blocker');
    expect(labelAction({ type: 'SKIP_COUNTER' }, s)).toBe('Skip counter');
  });
});

describe('labelAction — id resolution', () => {
  it('PLAY_CARD resolves card name from instances + cardLibrary', () => {
    const label = labelAction(
      { type: 'PLAY_CARD', instanceId: 'inst-A-char', replaceTargetId: null },
      makeState(),
    );
    expect(label).toBe('Play Test Hero (C-HERO)');
  });

  it('DECLARE_ATTACK includes attacker + target names', () => {
    const label = labelAction(
      {
        type: 'DECLARE_ATTACK',
        attackerInstanceId: 'inst-A-char',
        targetInstanceId: 'inst-B-leader',
      },
      makeState(),
    );
    expect(label).toBe('Test Hero (C-HERO) → Test Villain (C-VILLAIN)');
  });

  it('ATTACH_DON shows target name', () => {
    const label = labelAction(
      { type: 'ATTACH_DON', targetInstanceId: 'inst-A-leader' },
      makeState(),
    );
    expect(label).toBe('Attach DON → Test Hero (C-HERO)');
  });

  it('PLAY_CARD with replaceTargetId surfaces both sides', () => {
    const label = labelAction(
      {
        type: 'PLAY_CARD',
        instanceId: 'inst-A-char',
        replaceTargetId: 'inst-A-leader',
      },
      makeState(),
    );
    expect(label).toBe('Play Test Hero (C-HERO) (replace Test Hero (C-HERO))');
  });
});

describe('labelAction — unresolved-id fallback', () => {
  it('PLAY_CARD with unknown instance falls back to raw id (no crash)', () => {
    const label = labelAction(
      { type: 'PLAY_CARD', instanceId: 'unknown-id', replaceTargetId: null },
      makeState(),
    );
    expect(label).toBe('Play unknown-id');
  });

  it('DECLARE_ATTACK with unknown attacker keeps target resolution', () => {
    const label = labelAction(
      {
        type: 'DECLARE_ATTACK',
        attackerInstanceId: 'unknown-attacker',
        targetInstanceId: 'inst-B-leader',
      },
      makeState(),
    );
    expect(label).toBe('unknown-attacker → Test Villain (C-VILLAIN)');
  });

  it('cardLibrary lookup returning raw cardId when name absent', () => {
    const state = makeState();
    (state.cardLibrary as Record<string, unknown>)['C-HERO'] = { id: 'C-HERO' };
    expect(
      labelAction(
        { type: 'PLAY_CARD', instanceId: 'inst-A-char', replaceTargetId: null },
        state,
      ),
    ).toBe('Play C-HERO');
  });
});

describe('labelAction — every Action type returns non-empty', () => {
  it('exhausts the union', () => {
    const s = makeState();
    const samples: ReadonlyArray<Action> = [
      { type: 'ROLL_DICE', player: 'A' },
      { type: 'CHOOSE_FIRST' },
      { type: 'CHOOSE_SECOND' },
      { type: 'MULLIGAN' },
      { type: 'KEEP_HAND' },
      { type: 'PLAY_CARD', instanceId: 'inst-A-char', replaceTargetId: null },
      { type: 'PLAY_STAGE', instanceId: 'inst-A-char' },
      { type: 'ATTACH_DON', targetInstanceId: 'inst-A-leader' },
      { type: 'ACTIVATE_MAIN', instanceId: 'inst-A-char' },
      {
        type: 'DECLARE_ATTACK',
        attackerInstanceId: 'inst-A-char',
        targetInstanceId: 'inst-B-leader',
      },
      { type: 'DECLARE_BLOCKER', blockerInstanceId: 'inst-A-char' },
      { type: 'PLAY_COUNTER', instanceId: 'inst-A-char' },
      { type: 'SKIP_COUNTER' },
      { type: 'SKIP_BLOCKER' },
      { type: 'RESOLVE_TRIGGER', activate: true, targetInstanceId: 'inst-A-char' },
      { type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null },
      { type: 'RESOLVE_PEEK', pickedIds: ['x'] },
      { type: 'RESOLVE_DISCARD', pickedId: 'inst-A-char' },
      { type: 'RESOLVE_DISCARD', pickedId: null },
      { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 },
      { type: 'RESOLVE_TARGET_PICK', pickedId: 'inst-A-char' },
      { type: 'END_TURN' },
      { type: 'CONCEDE' },
    ];
    for (const a of samples) {
      const label = labelAction(a, s);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('actionResolvesCleanly', () => {
  it('returns true when every instanceId is present', () => {
    expect(
      actionResolvesCleanly(
        { type: 'ATTACH_DON', targetInstanceId: 'inst-A-leader' },
        makeState(),
      ),
    ).toBe(true);
  });

  it('returns false when an instanceId is unknown', () => {
    expect(
      actionResolvesCleanly(
        { type: 'ATTACH_DON', targetInstanceId: 'unknown' },
        makeState(),
      ),
    ).toBe(false);
  });

  it('returns true for actions with no instanceIds', () => {
    expect(actionResolvesCleanly({ type: 'CONCEDE' }, makeState())).toBe(true);
    expect(actionResolvesCleanly({ type: 'END_TURN' }, makeState())).toBe(true);
  });
});
