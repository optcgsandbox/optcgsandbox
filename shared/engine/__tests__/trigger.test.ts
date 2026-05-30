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
import { getLegalActions } from '../rules/legality';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard, Keyword, EffectTag } from '../cards/Card';
import { closeMulliganKeepBoth, attachDonCount, advanceOneFullCycle } from './_donHelpers';

function makeLeader(id: string, color: 'red' | 'blue' = 'red', overrides: Partial<LeaderCard> = {}): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: [color], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
    ...overrides,
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

/** Build a non-trigger filler character so we can shape the life pile
 *  deterministically when we only want a trigger on specific positions. */
function makeNonTriggerChar(id: string, effectTags: EffectTag[] = ['vanilla']): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost: 2, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags,
  };
}

/** Standard setup: B's leader attacks A's leader with +1 DON (6000 > 5000).
 *  Returns the state at the start of B's turn with the attached DON ready. */
function setupAttackScenario(seed: number, leaderOverrides: { B?: Partial<LeaderCard> } = {}) {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeTriggerChar(`C${i}`));
  let s = initialState({
    seed,
    decks: {
      A: { leader: makeLeader('LA'), cards },
      B: { leader: makeLeader('LB', 'red', leaderOverrides.B), cards },
    },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s); // D10: skip past the mulligan window.
  s = endTurn(s); // hand turn to B
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  // D2 (CR §6-5-6-1): B can't battle on its first turn (turn 2). Advance one
  //                   full cycle so B is back on its main phase on turn 4
  //                   with attacks legal.
  s = advanceOneFullCycle(s);
  attachDonCount(s, 'B', s.players.B.leader.instanceId, 1); // 6000 attacker
  return s;
}

/** Shape A's life pile so that positions in `triggerPositions` have the
 *  `'trigger'` effect tag and all others do not. Useful for testing
 *  Double-Attack interactions where we want the first flip to trigger but the
 *  second flip to be a vanilla life-to-hand. Mutates state in place. */
function shapeLifePile(
  s: ReturnType<typeof setupAttackScenario>,
  defender: 'A' | 'B',
  triggerPositions: number[],
) {
  const triggerSet = new Set(triggerPositions);
  const life = s.players[defender].life;
  life.forEach((instanceId, idx) => {
    const inst = s.instances[instanceId];
    if (!inst) return;
    // Create a fresh per-position card definition + rewire the instance to it
    // so we never mutate a shared cardLibrary entry that other life cards
    // reference.
    const shapedCardId = `LIFESHAPE-${defender}-${idx}`;
    const shapedCard: CharacterCard = triggerSet.has(idx)
      ? { ...makeTriggerChar(shapedCardId) }
      : { ...makeNonTriggerChar(shapedCardId) };
    s.cardLibrary[shapedCardId] = shapedCard;
    inst.cardId = shapedCardId;
  });
}

/** Mark B's leader as having Double Attack via the cardLibrary. */
function giveBLeaderDoubleAttack(s: ReturnType<typeof setupAttackScenario>) {
  const leaderCard = s.cardLibrary['LB'] as LeaderCard;
  const keywords: Keyword[] = [...leaderCard.keywords, 'double_attack'];
  s.cardLibrary['LB'] = { ...leaderCard, keywords };
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

  // === New regressions for audit 2026-05-29 ===

  it('counter→trigger: PLAY_COUNTER then SKIP_COUNTER then trigger window opens on life flip', () => {
    // Setup: B attacks A's leader; A plays one counter card from hand but the
    // boost isn't enough to save them (B is 6000, leader 5000, counter 1000 →
    // tie at 6000, attacker wins ties per §1.6 — life still flips). Then the
    // top life card has [trigger] (all cards in this deck do), so we end up
    // in the trigger window with TRIGGER_FLIPPED in the tape.
    let s = setupAttackScenario(505);
    // Add a second DON to B so the attack power is 7000 (clean win over a
    // 6000 boosted leader, regardless of tie semantics).
    attachDonCount(s, 'B', s.players.B.leader.instanceId, 1);

    s = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    }).state;
    s = applyAction(s, 'A', { type: 'SKIP_BLOCKER' }).state;

    // A plays a single counter from hand (every card has counterValue 1000).
    const counterCardId = s.players.A.hand[0];
    expect(counterCardId).toBeDefined();
    const handBefore = s.players.A.hand.length;
    s = applyAction(s, 'A', { type: 'PLAY_COUNTER', instanceId: counterCardId }).state;

    expect(s.phase).toBe('counter_window');
    expect(s.pendingAttack?.counterBoost).toBe(1000);
    expect(s.players.A.hand.length).toBe(handBefore - 1);
    expect(s.players.A.trash).toContain(counterCardId);

    // A ends counter window → resolveDamage → trigger flips.
    const { state: afterResolve, events } = applyAction(s, 'A', { type: 'SKIP_COUNTER' });
    expect(afterResolve.phase).toBe('trigger_window');
    expect(afterResolve.pendingTrigger).not.toBeNull();
    expect(events.some((e) => e.type === 'COUNTER_PLAYED')).toBe(false); // already consumed in prior step
    expect(events.some((e) => e.type === 'LIFE_TAKEN')).toBe(true);
    expect(events.some((e) => e.type === 'TRIGGER_FLIPPED')).toBe(true);
  });

  it('legal actions after RESOLVE_TRIGGER (v0, no double attack) include END_TURN', () => {
    let s = setupAttackScenario(606);
    s = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    }).state;
    s = applyAction(s, 'A', { type: 'SKIP_BLOCKER' }).state;
    s = applyAction(s, 'A', { type: 'SKIP_COUNTER' }).state;
    expect(s.phase).toBe('trigger_window');

    // A resolves the trigger (decline path → card to hand).
    s = applyAction(s, 'A', { type: 'RESOLVE_TRIGGER', targetInstanceId: null, activate: false }).state;
    expect(s.phase).toBe('main');
    expect(s.pendingTrigger).toBeNull();

    // Active player is still B (didn't end turn yet). Legal actions for B
    // must include END_TURN and RESIGN.
    const legal = getLegalActions(s, 'B');
    expect(legal.some((a) => a.type === 'END_TURN')).toBe(true);
    expect(legal.some((a) => a.type === 'RESIGN')).toBe(true);
  });

  it('last-life trigger: declining a trigger on the last life card adds it to hand without ending the game', () => {
    let s = setupAttackScenario(707);
    // Drop A to a single life card (the top of the current life pile, which
    // is a trigger card per the trigger-deck setup).
    const lastLifeId = s.players.A.life[0];
    s.players.A.life = [lastLifeId];

    s = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    }).state;
    s = applyAction(s, 'A', { type: 'SKIP_BLOCKER' }).state;
    s = applyAction(s, 'A', { type: 'SKIP_COUNTER' }).state;

    expect(s.phase).toBe('trigger_window');
    expect(s.players.A.life.length).toBe(0); // last life popped into pendingTrigger
    expect(s.result).toBeNull(); // game NOT over yet — trigger choice pending

    // Decline → card to hand, NOT lethal (the leader still has 0 life but is
    // not yet attacked again; lethal is only declared when an attack lands
    // with the life pile already empty).
    const resolved = applyAction(s, 'A', { type: 'RESOLVE_TRIGGER', targetInstanceId: null, activate: false }).state;
    expect(resolved.result).toBeNull();
    expect(resolved.players.A.hand).toContain(lastLifeId);
    expect(resolved.phase).toBe('main');

    // A subsequent attack with no life left → lethal.
    let next = endTurn(resolved);
    next = runDonPhase(runDrawPhase(runRefreshPhase(next)));
    next = applyAction(next, 'A', { type: 'END_TURN' }).state;
    next = runDonPhase(runDrawPhase(runRefreshPhase(next)));
    const finalAttack = applyAction(next, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: next.players.B.leader.instanceId,
      targetInstanceId: next.players.A.leader.instanceId,
    }).state;
    const afterSkipBlocker = applyAction(finalAttack, 'A', { type: 'SKIP_BLOCKER' }).state;
    const afterSkipCounter = applyAction(afterSkipBlocker, 'A', { type: 'SKIP_COUNTER' }).state;
    expect(afterSkipCounter.result?.reason).toBe('lethal');
    expect(afterSkipCounter.result?.winner).toBe('B');
  });

  it('Double Attack: trigger on first flip suspends; after RESOLVE the second life card flips', () => {
    // Build a scenario where:
    //   - B's leader has Double Attack
    //   - A's life position 0 is a trigger card, position 1 is NOT
    //   - Power: B leader 5000 + 1 DON = 6000; A leader 5000 → first flip
    //     opens trigger window, resume → second flip lands as life-to-hand.
    let s = setupAttackScenario(808);
    giveBLeaderDoubleAttack(s);
    shapeLifePile(s, 'A', [0]); // only the top card has trigger

    const firstLifeId = s.players.A.life[0];
    const secondLifeId = s.players.A.life[1];
    const handBefore = s.players.A.hand.length;
    const trashBefore = s.players.A.trash.length;

    s = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    }).state;
    s = applyAction(s, 'A', { type: 'SKIP_BLOCKER' }).state;
    const afterCounter = applyAction(s, 'A', { type: 'SKIP_COUNTER' }).state;

    // Suspended on first life-card trigger; second flip is deferred.
    expect(afterCounter.phase).toBe('trigger_window');
    expect(afterCounter.pendingTrigger?.lifeCardInstanceId).toBe(firstLifeId);
    expect(afterCounter.pendingTrigger?.controller).toBe('A');
    expect(afterCounter.pendingTrigger?.remainingLifeFlips).toBe(1);
    expect(afterCounter.pendingTrigger?.resumePhase).toBe('damage_resolution');
    expect(afterCounter.players.A.life).not.toContain(firstLifeId);
    expect(afterCounter.players.A.life[0]).toBe(secondLifeId);

    // Activate trigger → first card to trash, then second life card flips.
    // Second card has no trigger → goes to hand, phase returns to 'main'.
    const { state: resolved, events } = applyAction(afterCounter, 'A', {
      type: 'RESOLVE_TRIGGER',
      targetInstanceId: null,
      activate: true,
    });

    expect(resolved.pendingTrigger).toBeNull();
    expect(resolved.phase).toBe('main');
    expect(resolved.players.A.trash.length).toBe(trashBefore + 1);
    expect(resolved.players.A.trash).toContain(firstLifeId);
    expect(resolved.players.A.hand.length).toBe(handBefore + 1);
    expect(resolved.players.A.hand).toContain(secondLifeId);
    // Resume tape includes a damage_resolution phase change before returning to main.
    expect(events.some((e) => e.type === 'PHASE_CHANGED' && e.phase === 'damage_resolution')).toBe(true);
    expect(events.filter((e) => e.type === 'LIFE_TAKEN')).toHaveLength(1); // second flip only (first happened pre-resolve)
    expect(events.some((e) => e.type === 'PHASE_CHANGED' && e.phase === 'main')).toBe(true);
  });
});
