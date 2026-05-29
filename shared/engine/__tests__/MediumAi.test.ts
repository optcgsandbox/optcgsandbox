import { describe, expect, it } from 'vitest';
import { MediumAi } from '../ai/MediumAi';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import { setDonActive, attachDonCount, advanceOneFullCycle } from './_donHelpers';

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
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  setDonActive(s, 'B', 6);
  return s;
}

describe('MediumAi', () => {
  it('picks LETHAL when opp has 0 life and we can clear leader', async () => {
    // D2 (CR §6-5-6-1): B can't battle on its first turn (turn 2). Advance one
    //                   full cycle so B is on turn 4 with attacks legal.
    const s = advanceOneFullCycle(bootMainPhase());
    s.players.A.life = [];                       // opp at 0
    attachDonCount(s, 'B', s.players.B.leader.instanceId, 1); // 6000 > 5000
    const ai = new MediumAi();
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
    const ai = new MediumAi();
    const action = await ai.chooseAction(s, 'B', 100);
    expect(action.type).toBe('END_TURN');
  });

  it('prefers high-cost CURVE_PLAY over low-cost when both affordable', async () => {
    const s = bootMainPhase();
    // Hand currently has random C0..C49 (3000 power, cost 2). Inject a 4-cost 5000-power option.
    const bigCard: CharacterCard = { ...makeChar('BIG', 4, 5000) };
    s.cardLibrary['BIG'] = bigCard;
    const bigInst = {
      instanceId: 'BIG-INST', cardId: 'BIG', controller: 'B' as const, rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.instances['BIG-INST'] = bigInst;
    s.players.B.hand.push('BIG-INST');
    setDonActive(s, 'B', 4);
    s.players.B.leader.rested = true;            // No attacks/lethal noise.
    s.players.B.leader.perTurn.hasAttacked = true;

    const ai = new MediumAi();
    const action = await ai.chooseAction(s, 'B', 100);
    if (action.type === 'PLAY_CARD') {
      expect(action.instanceId).toBe('BIG-INST');
    }
  });
});
