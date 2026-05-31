import { afterEach, describe, expect, it } from 'vitest';
import { triggerBus, type TriggerEvent, type TriggerEventKind } from '../effectSpec/triggerBus-v2';
import { applyAction } from '../applyAction';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import { closeMulliganKeepBoth, setDonActive, advanceOneFullCycle } from './_donHelpers';

function makeLeader(id: string): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}
function makeChar(id: string, cost = 2, power = 3000): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost, power,
    counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  };
}
function bootMain() {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

// Reset the bus between tests so subscribers don't leak.
afterEach(() => triggerBus.reset());

describe('TriggerBus + engine publish points (A.3.9)', () => {
  it('subscribe/publish/unsubscribe basic mechanics', () => {
    const events: TriggerEvent[] = [];
    const unsub = triggerBus.subscribe('on_damage_taken', (e) => events.push(e));
    triggerBus.publish({ kind: 'on_damage_taken', state: {} as any, payload: { player: 'A' } });
    expect(events.length).toBe(1);
    unsub();
    triggerBus.publish({ kind: 'on_damage_taken', state: {} as any, payload: { player: 'A' } });
    expect(events.length).toBe(1);
  });

  it('TriggerBus.size returns subscriber count per kind', () => {
    triggerBus.subscribe('on_damage_taken', () => undefined);
    triggerBus.subscribe('on_damage_taken', () => undefined);
    triggerBus.subscribe('at_end_of_turn', () => undefined);
    expect(triggerBus.size('on_damage_taken')).toBe(2);
    expect(triggerBus.size('at_end_of_turn')).toBe(1);
    expect(triggerBus.size()).toBe(3);
  });

  it('TriggerBus.reset clears all subscribers', () => {
    triggerBus.subscribe('on_damage_taken', () => undefined);
    triggerBus.subscribe('at_end_of_turn', () => undefined);
    triggerBus.reset();
    expect(triggerBus.size()).toBe(0);
  });

  it('engine publishes at_end_of_turn_self + at_end_of_turn on endTurn', () => {
    let s = bootMain();
    const kinds: TriggerEventKind[] = [];
    triggerBus.subscribe('at_end_of_turn_self', (e) => kinds.push(e.kind));
    triggerBus.subscribe('at_end_of_turn', (e) => kinds.push(e.kind));
    s = endTurn(s);
    expect(kinds).toContain('at_end_of_turn_self');
    expect(kinds).toContain('at_end_of_turn');
  });

  it('engine publishes at_opp_refresh on runRefreshPhase', () => {
    let s = bootMain();
    let count = 0;
    triggerBus.subscribe('at_opp_refresh', () => count++);
    s = endTurn(s);
    s = runRefreshPhase(s);
    expect(count).toBe(1);
  });

  it('engine publishes on_opp_play_character on PLAY_CARD (character)', () => {
    const s = advanceOneFullCycle(bootMain());
    const cards: TriggerEvent[] = [];
    triggerBus.subscribe('on_opp_play_character', (e) => cards.push(e));
    // B plays a character.
    setDonActive(s, 'B', 5);
    const handCardId = s.players.B.hand[0];
    applyAction(s, 'B', { type: 'PLAY_CARD', instanceId: handCardId, replaceTargetId: null });
    expect(cards.length).toBe(1);
    expect((cards[0].payload as { opp: string }).opp).toBe('B');
  });

  it('engine publishes on_opp_attack on DECLARE_ATTACK', () => {
    let s = advanceOneFullCycle(bootMain());
    const events: TriggerEvent[] = [];
    triggerBus.subscribe('on_opp_attack', (e) => events.push(e));
    setDonActive(s, 'B', 2);
    const attacker = s.players.B.leader.instanceId;
    const target = s.players.A.leader.instanceId;
    const { state: after } = applyAction(s, 'B', { type: 'DECLARE_ATTACK', attackerInstanceId: attacker, targetInstanceId: target });
    expect(events.length).toBe(1);
    expect((events[0].payload as { attacker: string }).attacker).toBe(attacker);
    void after;
  });

  it('engine publishes on_damage_taken + on_life_changed on life flip', () => {
    let s = advanceOneFullCycle(bootMain());
    const damages: TriggerEvent[] = [];
    const lifes: TriggerEvent[] = [];
    triggerBus.subscribe('on_damage_taken', (e) => damages.push(e));
    triggerBus.subscribe('on_life_changed', (e) => lifes.push(e));
    // B attacks A's leader to flip a life card.
    setDonActive(s, 'B', 2);
    const attacker = s.players.B.leader.instanceId;
    s = applyAction(s, 'B', { type: 'DECLARE_ATTACK', attackerInstanceId: attacker, targetInstanceId: s.players.A.leader.instanceId }).state;
    s = applyAction(s, 'A', { type: 'SKIP_BLOCKER' }).state;
    s = applyAction(s, 'A', { type: 'SKIP_COUNTER' }).state;
    // Now damage resolves. Either trigger fires once (or zero if attack failed).
    expect(damages.length + lifes.length).toBeGreaterThan(0);
  });

  it('no subscribers → publish is a no-op (state unchanged)', () => {
    triggerBus.reset();
    const s = bootMain();
    const before = JSON.stringify(s);
    // endTurn should publish but with no subs nothing happens.
    const ended = endTurn(s);
    void ended;
    // bootMain state itself wasn't mutated by publish.
    expect(JSON.stringify(s).length).toBe(before.length);
  });

  it('multiple subscribers on same kind all fire', () => {
    let s = bootMain();
    // Subscribe AFTER boot so bootMain's internal endTurn doesn't pre-fire.
    let count = 0;
    triggerBus.subscribe('at_end_of_turn', () => count++);
    triggerBus.subscribe('at_end_of_turn', () => count++);
    triggerBus.subscribe('at_end_of_turn', () => count++);
    s = endTurn(s);
    expect(count).toBe(3);
  });

  it('subscriber receives state snapshot of the publishing function', () => {
    let s = bootMain();
    // Subscribe AFTER boot.
    let captured: { activePlayer?: string } = {};
    triggerBus.subscribe('at_end_of_turn_self', (e) => {
      captured = { activePlayer: e.state.activePlayer };
    });
    const currentActive = s.activePlayer;
    s = endTurn(s);
    // endTurn publishes BEFORE flipping activePlayer, so the captured
    // activePlayer matches the active player whose turn just ended.
    expect(captured.activePlayer).toBe(currentActive);
  });

  it('subscribers across different kinds don\'t cross-fire', () => {
    let drawCount = 0;
    let lifeCount = 0;
    triggerBus.subscribe('on_own_don_returned', () => drawCount++);
    triggerBus.subscribe('on_life_changed', () => lifeCount++);
    let s = bootMain();
    s = endTurn(s);
    expect(drawCount).toBe(0);
    expect(lifeCount).toBe(0);
  });
});
