import { describe, expect, it } from 'vitest';
import { EasyAi } from '../ai/EasyAi';
import { applyAction } from '../applyAction';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';

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
  s = endTurn(s);                              // → B's turn
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  s.players.B.donActive = 6;                   // plenty
  return s;
}

describe('EasyAi', () => {
  it('returns a legal action', async () => {
    const ai = new EasyAi(123);
    const s = bootMainPhase();
    const action = await ai.chooseAction(s, 'B', 100);
    const { state: s2 } = applyAction(s, 'B', action);
    expect(s2).toBeDefined();
    expect(s2.history.length).toBeGreaterThanOrEqual(s.history.length);
  });

  it('is deterministic per seed', async () => {
    const a = new EasyAi(7);
    const b = new EasyAi(7);
    const s = bootMainPhase();
    const aAction = await a.chooseAction(s, 'B', 100);
    const bAction = await b.chooseAction(s, 'B', 100);
    expect(aAction).toEqual(bAction);
  });

  it('declines a clearly losing leader attack', async () => {
    // Build a state where B leader's effective power < A leader's power.
    let s = bootMainPhase();
    s.players.B.donActive = 0;
    s.players.B.leader.attachedDon = 0;
    (s.cardLibrary['LB'] as LeaderCard).power = 3000;     // attacker 3000
    (s.cardLibrary['LA'] as LeaderCard).power = 5000;     // target 5000

    const ai = new EasyAi(99);
    // Loop enough times to be confident: pick should never be a leader-on-leader suicide.
    for (let i = 0; i < 30; i++) {
      const action = await new EasyAi(i * 13 + 1).chooseAction(s, 'B', 100);
      if (action.type === 'DECLARE_ATTACK') {
        // Must NOT be 3000 attacking 5000.
        const att = s.instances[action.attackerInstanceId];
        const tgt = s.instances[action.targetInstanceId];
        const aPow = (s.cardLibrary[att.cardId] as LeaderCard).power + att.attachedDon * 1000;
        const tPow = (s.cardLibrary[tgt.cardId] as LeaderCard).power + tgt.attachedDon * 1000;
        expect(aPow).toBeGreaterThanOrEqual(tPow);
      }
    }
    void ai;
  });

  it('falls back to END_TURN when only RESIGN-style options remain', async () => {
    // Force an empty hand + no DON + leader rested → only END_TURN should be in the pool.
    const ai = new EasyAi(5);
    let s = bootMainPhase();
    s.players.B.hand = [];
    s.players.B.donActive = 0;
    s.players.B.leader.rested = true;
    s.players.B.leader.perTurn.hasAttacked = true;
    const action = await ai.chooseAction(s, 'B', 100);
    expect(action.type === 'END_TURN' || action.type === 'RESIGN').toBe(true);
  });
});
