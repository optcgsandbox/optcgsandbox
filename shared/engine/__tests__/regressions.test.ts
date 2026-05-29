// Regressions caught by the 2026-05-28 audit. Each test pins a fix.
import { describe, expect, it } from 'vitest';
import { applyAction } from '../applyAction';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import { getLegalActions } from '../rules/legality';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import { setDonActive, attachDonCount, advanceOneFullCycle } from './_donHelpers';

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
    setDonActive(s, 'B', 5);
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
    setDonActive(s, 'B', 5);
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
    setDonActive(s, 'A', 5);
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
    s = advanceOneFullCycle(s); // D2: skip first-turn-no-attack window.
    attachDonCount(s, 'B', s.players.B.leader.instanceId, 1); // 6000 > 5000

    // declare → SKIP_BLOCKER → SKIP_COUNTER → resolve
    const r1 = applyAction(s, 'B', { type: 'DECLARE_ATTACK', attackerInstanceId: s.players.B.leader.instanceId, targetInstanceId: s.players.A.leader.instanceId });
    expect(r1.events.some((e) => e.type === 'ATTACK_DECLARED')).toBe(true);

    const r2 = applyAction(r1.state, 'A', { type: 'SKIP_BLOCKER' });
    const r3 = applyAction(r2.state, 'A', { type: 'SKIP_COUNTER' });
    expect(r3.events.some((e) => e.type === 'LIFE_TAKEN')).toBe(true);
  });

  it('blocker redirects attack and rests blocker', () => {
    const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`, 2, 3000));
    let s = initialState({ seed: 5, decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } } });
    s = setupGame(s);
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s = advanceOneFullCycle(s); // D2: skip first-turn-no-attack window.
    setDonActive(s, 'B', 2);
    attachDonCount(s, 'B', s.players.B.leader.instanceId, 1);

    // Inject a Blocker character on A's field that A controls.
    const blockerCard = makeChar('Blocker1', 2, 4000, 'red', ['blocker']);
    s.cardLibrary['Blocker1'] = blockerCard;
    const blockerInst = { instanceId: 'B-INST', cardId: 'Blocker1', controller: 'A' as const, rested: false, attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false };
    s.instances['B-INST'] = blockerInst;
    s.players.A.field.push(blockerInst);

    const lifeBefore = s.players.A.life.length;
    let st = applyAction(s, 'B', { type: 'DECLARE_ATTACK', attackerInstanceId: s.players.B.leader.instanceId, targetInstanceId: s.players.A.leader.instanceId }).state;
    expect(st.phase).toBe('block_window');
    st = applyAction(st, 'A', { type: 'DECLARE_BLOCKER', blockerInstanceId: 'B-INST' }).state;
    expect(st.pendingAttack?.targetInstanceId).toBe('B-INST');
    st = applyAction(st, 'A', { type: 'SKIP_COUNTER' }).state;
    // 6000 attacker >= 4000 blocker → blocker KO'd, leader life untouched.
    expect(st.players.A.life.length).toBe(lifeBefore);
    expect(st.players.A.field.find((i) => i.instanceId === 'B-INST')).toBeUndefined();
    expect(st.players.A.trash).toContain('B-INST');
  });

  it('counter boost saves the leader from lethal', () => {
    const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`, 2, 3000));
    let s = initialState({ seed: 6, decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } } });
    s = setupGame(s);
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s = advanceOneFullCycle(s); // D2: skip first-turn-no-attack window.
    attachDonCount(s, 'B', s.players.B.leader.instanceId, 1); // 6000 attacker
    // A has a counter card in hand
    const counterCard = makeChar('Counter2k', 2, 1000, 'red');
    counterCard.counterValue = 2000;
    s.cardLibrary['Counter2k'] = counterCard;
    const cInst = { instanceId: 'C-INST', cardId: 'Counter2k', controller: 'A' as const, rested: false, attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false };
    s.instances['C-INST'] = cInst;
    s.players.A.hand.push('C-INST');

    const lifeBefore = s.players.A.life.length;
    let st = applyAction(s, 'B', { type: 'DECLARE_ATTACK', attackerInstanceId: s.players.B.leader.instanceId, targetInstanceId: s.players.A.leader.instanceId }).state;
    st = applyAction(st, 'A', { type: 'SKIP_BLOCKER' }).state;
    st = applyAction(st, 'A', { type: 'PLAY_COUNTER', instanceId: 'C-INST' }).state;
    expect(st.pendingAttack?.counterBoost).toBe(2000);
    st = applyAction(st, 'A', { type: 'SKIP_COUNTER' }).state;
    // 6000 attacker vs 5000+2000=7000 defender → fizzle, life untouched.
    expect(st.players.A.life.length).toBe(lifeBefore);
    expect(st.players.A.trash).toContain('C-INST');
  });
});
