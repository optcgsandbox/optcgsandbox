/**
 * labelAction — pure-function unit tests. Phase F-7e.2 + F-7k BUG-009.
 *
 * No engine boot, no DOM. Synthetic minimal PublicGameState built
 * inline.
 */

import { describe, expect, it } from 'vitest';

import {
  actionGroup,
  actionResolvesCleanly,
  ACTION_GROUP_ORDER,
  labelAction,
  type ActionGroup,
} from './labelAction';
import type { Action } from '@shared/engine-v2/protocol/actions';
import type { PublicGameState } from '@shared/server/publicProjection';

function makeState(): PublicGameState {
  const cardLibrary = {
    'C-HERO': { id: 'C-HERO', name: 'Test Hero', kind: 'character' },
    'C-VILLAIN': { id: 'C-VILLAIN', name: 'Test Villain', kind: 'character' },
    'C-EVENT': { id: 'C-EVENT', name: 'Test Event', kind: 'event' },
    'C-STAGE': { id: 'C-STAGE', name: 'Test Stage', kind: 'stage' },
  } as unknown as PublicGameState['cardLibrary'];

  const instances = {
    'inst-A-leader': { instanceId: 'inst-A-leader', cardId: 'C-HERO' },
    'inst-A-char': { instanceId: 'inst-A-char', cardId: 'C-HERO' },
    'inst-A-event': { instanceId: 'inst-A-event', cardId: 'C-EVENT' },
    'inst-A-stage': { instanceId: 'inst-A-stage', cardId: 'C-STAGE' },
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

describe('labelAction — id resolution + card kind', () => {
  it('PLAY_CARD on a CHARACTER → "Play Character: name"', () => {
    const label = labelAction(
      { type: 'PLAY_CARD', instanceId: 'inst-A-char', replaceTargetId: null },
      makeState(),
    );
    expect(label).toBe('Play Character: Test Hero (C-HERO)');
  });

  it('PLAY_CARD on an EVENT → "Play Event: name"', () => {
    const label = labelAction(
      { type: 'PLAY_CARD', instanceId: 'inst-A-event', replaceTargetId: null },
      makeState(),
    );
    expect(label).toBe('Play Event: Test Event (C-EVENT)');
  });

  it('PLAY_STAGE → "Play Stage: name"', () => {
    const label = labelAction(
      { type: 'PLAY_STAGE', instanceId: 'inst-A-stage' },
      makeState(),
    );
    expect(label).toBe('Play Stage: Test Stage (C-STAGE)');
  });

  it('ACTIVATE_MAIN → "Activate: name"', () => {
    const label = labelAction(
      { type: 'ACTIVATE_MAIN', instanceId: 'inst-A-char' },
      makeState(),
    );
    expect(label).toBe('Activate: Test Hero (C-HERO)');
  });

  it('DECLARE_BLOCKER → "Block with: name"', () => {
    const label = labelAction(
      { type: 'DECLARE_BLOCKER', blockerInstanceId: 'inst-A-char' },
      makeState(),
    );
    expect(label).toBe('Block with: Test Hero (C-HERO)');
  });

  it('PLAY_COUNTER → "Counter with: name"', () => {
    const label = labelAction(
      { type: 'PLAY_COUNTER', instanceId: 'inst-A-event' },
      makeState(),
    );
    expect(label).toBe('Counter with: Test Event (C-EVENT)');
  });

  it('RESOLVE_TRIGGER activate=true → "Activate trigger"', () => {
    const label = labelAction(
      {
        type: 'RESOLVE_TRIGGER',
        activate: true,
        targetInstanceId: null,
      },
      makeState(),
    );
    expect(label).toBe('Activate trigger');
  });

  it('RESOLVE_TRIGGER activate=false → "Decline trigger"', () => {
    const label = labelAction(
      {
        type: 'RESOLVE_TRIGGER',
        activate: false,
        targetInstanceId: null,
      },
      makeState(),
    );
    expect(label).toBe('Decline trigger');
  });

  it('RESOLVE_DISCARD → "Discard: name"', () => {
    const label = labelAction(
      { type: 'RESOLVE_DISCARD', pickedId: 'inst-A-char' },
      makeState(),
    );
    expect(label).toBe('Discard: Test Hero (C-HERO)');
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
    expect(label).toBe(
      'Play Character: Test Hero (C-HERO) (replace Test Hero (C-HERO))',
    );
  });
});

describe('labelAction — unresolved-id fallback', () => {
  it('PLAY_CARD with unknown instance falls back to raw id (no crash)', () => {
    const label = labelAction(
      { type: 'PLAY_CARD', instanceId: 'unknown-id', replaceTargetId: null },
      makeState(),
    );
    // kind unknown → fallback verb 'Play'
    expect(label).toBe('Play: unknown-id');
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
    (state.cardLibrary as Record<string, unknown>)['C-HERO'] = {
      id: 'C-HERO',
      kind: 'character',
    };
    expect(
      labelAction(
        { type: 'PLAY_CARD', instanceId: 'inst-A-char', replaceTargetId: null },
        state,
      ),
    ).toBe('Play Character: C-HERO');
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
      { type: 'PLAY_STAGE', instanceId: 'inst-A-stage' },
      { type: 'ATTACH_DON', targetInstanceId: 'inst-A-leader' },
      { type: 'ACTIVATE_MAIN', instanceId: 'inst-A-char' },
      {
        type: 'DECLARE_ATTACK',
        attackerInstanceId: 'inst-A-char',
        targetInstanceId: 'inst-B-leader',
      },
      { type: 'DECLARE_BLOCKER', blockerInstanceId: 'inst-A-char' },
      { type: 'PLAY_COUNTER', instanceId: 'inst-A-event' },
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

// F-7k BUG-009 — action grouping for human UI panel.
describe('actionGroup — classifier', () => {
  const s = makeState();
  const cases: ReadonlyArray<[ActionGroup, Action]> = [
    ['Turn', { type: 'END_TURN' }],
    ['Play Characters', { type: 'PLAY_CARD', instanceId: 'inst-A-char', replaceTargetId: null }],
    ['Play Events', { type: 'PLAY_CARD', instanceId: 'inst-A-event', replaceTargetId: null }],
    ['Play Stage', { type: 'PLAY_STAGE', instanceId: 'inst-A-stage' }],
    ['Attach DON', { type: 'ATTACH_DON', targetInstanceId: 'inst-A-leader' }],
    ['Attack', { type: 'DECLARE_ATTACK', attackerInstanceId: 'inst-A-char', targetInstanceId: 'inst-B-leader' }],
    ['Card Effects', { type: 'ACTIVATE_MAIN', instanceId: 'inst-A-char' }],
    ['Blocker Response', { type: 'DECLARE_BLOCKER', blockerInstanceId: 'inst-A-char' }],
    ['Blocker Response', { type: 'SKIP_BLOCKER' }],
    ['Counter Response', { type: 'PLAY_COUNTER', instanceId: 'inst-A-event' }],
    ['Counter Response', { type: 'SKIP_COUNTER' }],
    ['Trigger Response', { type: 'RESOLVE_TRIGGER', activate: true, targetInstanceId: null }],
    ['Trigger Response', { type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null }],
    ['Discard', { type: 'RESOLVE_DISCARD', pickedId: 'inst-A-char' }],
    ['Choose', { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 }],
    ['Choose', { type: 'RESOLVE_PEEK', pickedIds: [] }],
    ['Choose', { type: 'RESOLVE_TARGET_PICK', pickedId: 'inst-A-char' }],
    ['Setup', { type: 'ROLL_DICE', player: 'A' }],
    ['Setup', { type: 'CHOOSE_FIRST' }],
    ['Setup', { type: 'CHOOSE_SECOND' }],
    ['Setup', { type: 'MULLIGAN' }],
    ['Setup', { type: 'KEEP_HAND' }],
    ['Concede', { type: 'CONCEDE' }],
  ];

  for (const [expected, action] of cases) {
    it(`${action.type} → ${expected}`, () => {
      expect(actionGroup(action, s)).toBe(expected);
    });
  }

  it('ACTION_GROUP_ORDER lists every ActionGroup', () => {
    const groups = new Set<ActionGroup>(ACTION_GROUP_ORDER);
    expect(groups.size).toBe(ACTION_GROUP_ORDER.length);
    // Verify every classified action's group appears in the order.
    for (const [expected] of cases) {
      expect(groups.has(expected)).toBe(true);
    }
  });
});
