import { describe, expect, it } from 'vitest';
import { HardAi, evaluateForPlayer } from '../ai/HardAi';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import { closeMulliganKeepBoth, setDonActive, attachDonCount, advanceOneFullCycle } from './_donHelpers';

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

function bootMainPhase() {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  setDonActive(s, 'B', 6);
  return s;
}

describe('HardAi', () => {
  it('picks lethal swing on opp leader when opp has 0 life and we have lethal power', async () => {
    const s = advanceOneFullCycle(bootMainPhase());
    s.players.A.life = [];
    attachDonCount(s, 'B', s.players.B.leader.instanceId, 1); // 6000 > 5000
    const ai = new HardAi();
    const action = await ai.chooseAction(s, 'B', 100);
    expect(action.type).toBe('DECLARE_ATTACK');
    if (action.type === 'DECLARE_ATTACK') {
      expect(action.targetInstanceId).toBe(s.players.A.leader.instanceId);
    }
  });

  it('falls back to END_TURN when no useful options', async () => {
    const s = bootMainPhase();
    s.players.B.hand = [];
    setDonActive(s, 'B', 0);
    s.players.B.leader.rested = true;
    s.players.B.leader.perTurn.hasAttacked = true;
    const ai = new HardAi();
    const action = await ai.chooseAction(s, 'B', 100);
    expect(action.type).toBe('END_TURN');
  });

  it('evaluateForPlayer favors higher life over lower life', () => {
    const s = bootMainPhase();
    const baseline = evaluateForPlayer(s, 'B');
    s.players.B.life = s.players.B.life.slice(0, -1);
    const worse = evaluateForPlayer(s, 'B');
    expect(baseline).toBeGreaterThan(worse);
  });

  it('evaluateForPlayer returns 1_000_000 on win, -1_000_000 on loss', () => {
    const s = bootMainPhase();
    const won = { ...s, result: { winner: 'B' as const, reason: 'lethal' as const } };
    expect(evaluateForPlayer(won, 'B')).toBe(1_000_000);
    const lost = { ...s, result: { winner: 'A' as const, reason: 'lethal' as const } };
    expect(evaluateForPlayer(lost, 'B')).toBe(-1_000_000);
  });
});
