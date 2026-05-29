// Trigger-window tests (rules-reference.md §1.7 + applyAction.ts:235–349).
//
// When a life card with the `trigger` effect tag is flipped during damage
// resolution, damage processing SUSPENDS:
//   - state.phase becomes 'trigger_window'
//   - state.pendingTrigger is populated with { lifeCardInstanceId, controller, resumePhase }
//
// The controller dispatches RESOLVE_TRIGGER with `activate: true | false`.
//   - activate=true  → life card goes to trash, pendingTrigger cleared, phase = resumePhase
//   - activate=false → life card goes to hand,  pendingTrigger cleared, phase = resumePhase

import { describe, expect, it } from 'vitest';
import { applyAction } from '../applyAction';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import { attachDonCount } from './_donHelpers';

function makeLeader(id: string, color: 'red' | 'blue' = 'red'): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: [color], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}

/** Build a deck where every card has `'trigger'` in effectTags, so whichever
 *  card lands on top of the life pile will fire the trigger window. */
function makeTriggerChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost: 2, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: ['trigger'],
  };
}

/** Standard setup: B's leader attacks A's leader with +1 DON (6000 > 5000).
 *  Returns the state at the start of B's turn with the attached DON ready. */
function setupAttackScenario(seed: number) {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeTriggerChar(`C${i}`));
  let s = initialState({
    seed,
    decks: {
      A: { leader: makeLeader('LA'), cards },
      B: { leader: makeLeader('LB'), cards },
    },
  });
  s = setupGame(s);
  s = endTurn(s); // hand turn to B
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  attachDonCount(s, 'B', s.players.B.leader.instanceId, 1); // 6000 attacker
  return s;
}

describe('Trigger window (applyAction.ts:235–349)', () => {
  it('flipping a life card with [Trigger] suspends damage and opens trigger_window', () => {
    let s = setupAttackScenario(101);
    const expectedLifeId = s.players.A.life[0];

    // declare → SKIP_BLOCKER → SKIP_COUNTER (resolveDamage)
    s = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    }).state;
    s = applyAction(s, 'A', { type: 'SKIP_BLOCKER' }).state;
    const { state: afterCounter, events } = applyAction(s, 'A', { type: 'SKIP_COUNTER' });

    expect(afterCounter.phase).toBe('trigger_window');
    expect(afterCounter.pendingTrigger).not.toBeNull();
    expect(afterCounter.pendingTrigger?.lifeCardInstanceId).toBe(expectedLifeId);
    expect(afterCounter.pendingTrigger?.controller).toBe('A');
    expect(afterCounter.pendingTrigger?.resumePhase).toBe('main');
    // Life was removed from A's life zone, but NOT yet added to hand or trash.
    expect(afterCounter.players.A.life).not.toContain(expectedLifeId);
    expect(afterCounter.players.A.hand).not.toContain(expectedLifeId);
    expect(afterCounter.players.A.trash).not.toContain(expectedLifeId);
    // Event tape includes LIFE_TAKEN + TRIGGER_FLIPPED + PHASE_CHANGED(trigger_window).
    expect(events.some((e) => e.type === 'LIFE_TAKEN')).toBe(true);
    expect(events.some((e) => e.type === 'TRIGGER_FLIPPED')).toBe(true);
    expect(events.some((e) => e.type === 'PHASE_CHANGED' && e.phase === 'trigger_window')).toBe(true);
  });

  it('RESOLVE_TRIGGER activate=true consumes the trigger card to trash and resumes main phase', () => {
    let s = setupAttackScenario(202);
    const lifeId = s.players.A.life[0];

    s = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    }).state;
    s = applyAction(s, 'A', { type: 'SKIP_BLOCKER' }).state;
    s = applyAction(s, 'A', { type: 'SKIP_COUNTER' }).state;
    expect(s.phase).toBe('trigger_window');
    expect(s.pendingTrigger?.lifeCardInstanceId).toBe(lifeId);

    const { state: resolved, events } = applyAction(s, 'A', { type: 'RESOLVE_TRIGGER', targetInstanceId: null, activate: true });

    expect(resolved.pendingTrigger).toBeNull();
    expect(resolved.phase).toBe('main');
    // v0 activation path: card goes to trash, NOT to hand.
    expect(resolved.players.A.trash).toContain(lifeId);
    expect(resolved.players.A.hand).not.toContain(lifeId);
    expect(events.some((e) => e.type === 'TRIGGER_RESOLVED' && e.activated === true)).toBe(true);
    expect(events.some((e) => e.type === 'PHASE_CHANGED' && e.phase === 'main')).toBe(true);
  });

  it('RESOLVE_TRIGGER activate=false declines the trigger and life card goes to hand', () => {
    let s = setupAttackScenario(303);
    const lifeId = s.players.A.life[0];

    s = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    }).state;
    s = applyAction(s, 'A', { type: 'SKIP_BLOCKER' }).state;
    s = applyAction(s, 'A', { type: 'SKIP_COUNTER' }).state;
    expect(s.phase).toBe('trigger_window');

    const { state: resolved, events } = applyAction(s, 'A', { type: 'RESOLVE_TRIGGER', targetInstanceId: null, activate: false });

    expect(resolved.pendingTrigger).toBeNull();
    expect(resolved.phase).toBe('main');
    // Decline path: card goes to hand (standard "life taken" outcome).
    expect(resolved.players.A.hand).toContain(lifeId);
    expect(resolved.players.A.trash).not.toContain(lifeId);
    expect(events.some((e) => e.type === 'TRIGGER_RESOLVED' && e.activated === false)).toBe(true);
    expect(events.some((e) => e.type === 'PHASE_CHANGED' && e.phase === 'main')).toBe(true);
  });

  it('RESOLVE_TRIGGER from the non-controller is a no-op (only the life owner decides)', () => {
    let s = setupAttackScenario(404);
    s = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    }).state;
    s = applyAction(s, 'A', { type: 'SKIP_BLOCKER' }).state;
    s = applyAction(s, 'A', { type: 'SKIP_COUNTER' }).state;
    expect(s.phase).toBe('trigger_window');

    // B (the attacker) tries to resolve A's trigger — should be ignored.
    const { state: ignored } = applyAction(s, 'B', { type: 'RESOLVE_TRIGGER', targetInstanceId: null, activate: true });
    expect(ignored.phase).toBe('trigger_window');
    expect(ignored.pendingTrigger).not.toBeNull();
  });
});
