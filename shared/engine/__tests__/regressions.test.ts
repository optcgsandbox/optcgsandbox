// Regressions caught by the 2026-05-28 audit. Each test pins a fix.
import { describe, expect, it } from 'vitest';
import { applyAction } from '../applyAction';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import { getLegalActions } from '../rules/legality';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';

function makeLeader(id: string, color: 'red' | 'blue' = 'red'): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: [color], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}
function makeChar(id: string, cost: number, power: number, color: 'red' | 'blue' = 'red', keywords: ('rush'|'blocker')[] = []): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: [color], cost, power,
    counterValue: 1000, traits: [], keywords, effectTags: ['vanilla'],
  };
}

describe('Summoning sickness (legality.ts + applyAction.ts)', () => {
  it('a character played this turn cannot attack', () => {
    const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`, 2, 3000));
    let s = initialState({ seed: 1, decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } } });
    s = setupGame(s);
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s.players.B.donActive = 5;
    const handCard = s.players.B.hand[0];
    const { state: s2 } = applyAction(s, 'B', { type: 'PLAY_CARD', instanceId: handCard, replaceTargetId: null });
    const newInst = s2.players.B.field.find((i) => i.instanceId === handCard);
    expect(newInst?.summoningSick).toBe(true);
    const attackActions = getLegalActions(s2, 'B').filter((a) => a.type === 'DECLARE_ATTACK' && a.attackerInstanceId === handCard);
    expect(attackActions).toEqual([]);
  });

  it('refresh phase clears summoning sickness', () => {
    const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`, 2, 3000));
    let s = initialState({ seed: 2, decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } } });
    s = setupGame(s);
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s.players.B.donActive = 5;
    const handCard = s.players.B.hand[0];
    let s2 = applyAction(s, 'B', { type: 'PLAY_CARD', instanceId: handCard, replaceTargetId: null }).state;
    s2 = endTurn(s2);                 // A's turn
    s2 = endTurn(runDonPhase(runDrawPhase(runRefreshPhase(s2)))); // back to B
    s2 = runRefreshPhase(s2);          // B's refresh — should clear
    const inst = s2.players.B.field.find((i) => i.instanceId === handCard);
    expect(inst?.summoningSick).toBe(false);
  });
});

describe('Color rules (legality.ts)', () => {
  it('cannot play a blue card with a red leader', () => {
    const cards: Card[] = [makeChar('blueGuy', 1, 2000, 'blue'), ...Array.from({ length: 49 }, (_, i) => makeChar(`C${i}`, 2, 3000, 'red'))];
    let s = initialState({ seed: 3, decks: { A: { leader: makeLeader('LA', 'red'), cards }, B: { leader: makeLeader('LB', 'red'), cards } } });
    s = setupGame(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s.players.A.donActive = 5;
    // Inject blueGuy into hand directly so we can test the gating.
    const blueInstId = Object.values(s.instances).find((i) => i.controller === 'A' && s.cardLibrary[i.cardId].colors[0] === 'blue')?.instanceId;
    if (blueInstId && !s.players.A.hand.includes(blueInstId)) {
      s.players.A.hand.push(blueInstId);
    }
    const playable = getLegalActions(s, 'A').filter((a) => a.type === 'PLAY_CARD' && a.instanceId === blueInstId);
    expect(playable).toEqual([]);
  });
});

describe('resolveAttack returns events from history slice (applyAction.ts)', () => {
  it('events array is non-empty after a successful leader attack', () => {
    const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`, 2, 3000));
    let s = initialState({ seed: 4, decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } } });
    s = setupGame(s);
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s.players.B.leader.attachedDon = 1; // 6000 > 5000

    const { events } = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'ATTACK_DECLARED')).toBe(true);
    expect(events.some((e) => e.type === 'LIFE_TAKEN')).toBe(true);
  });
});
