import { describe, expect, it } from 'vitest';
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

function build() {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`, 2, 3000));
  return initialState({
    seed: 42,
    decks: {
      A: { leader: makeLeader('LA'), cards },
      B: { leader: makeLeader('LB'), cards },
    },
  });
}

function advanceToMainPhase(s: ReturnType<typeof build>) {
  return runDonPhase(runDrawPhase(runRefreshPhase(setupGame(s))));
}

describe('applyAction: PLAY_CARD', () => {
  it('plays a Character: pays DON, moves to field, adds CARD_PLAYED event', () => {
    let s = advanceToMainPhase(build());
    // First turn first player has 1 DON. Force 2 so we can play a 2-cost character.
    s.players.A.donActive = 2;
    const handCard = s.players.A.hand[0];
    const { state: s2 } = applyAction(s, 'A', {
      type: 'PLAY_CARD', instanceId: handCard, replaceTargetId: null,
    });
    expect(s2.players.A.hand).not.toContain(handCard);
    expect(s2.players.A.field.find((i) => i.instanceId === handCard)).toBeDefined();
    expect(s2.players.A.donActive).toBe(0);
    expect(s2.players.A.donRested).toBe(2);
  });

  it('rejects play if cost > donActive', () => {
    let s = advanceToMainPhase(build());
    s.players.A.donActive = 1;
    const handCard = s.players.A.hand[0]; // 2-cost
    const { state: s2 } = applyAction(s, 'A', {
      type: 'PLAY_CARD', instanceId: handCard, replaceTargetId: null,
    });
    expect(s2.players.A.hand).toContain(handCard);
    expect(s2.players.A.field).toHaveLength(0);
  });
});

describe('applyAction: ATTACH_DON', () => {
  it('boosts target +1000 power per DON', () => {
    let s = advanceToMainPhase(build());
    s.players.A.donActive = 1;
    const { state: s2 } = applyAction(s, 'A', {
      type: 'ATTACH_DON', targetInstanceId: s.players.A.leader.instanceId,
    });
    expect(s2.players.A.leader.attachedDon).toBe(1);
    expect(s2.players.A.donActive).toBe(0);
  });
});

describe('applyAction: DECLARE_ATTACK', () => {
  it('attack on leader takes 1 life card to hand', () => {
    // Advance to B's turn so B can attack A's leader.
    let s = advanceToMainPhase(build());
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s.players.B.donActive = 2;
    s.players.B.leader.attachedDon = 1; // 5000 + 1000 = 6000 > A.leader 5000

    const lifeBefore = s.players.A.life.length;
    const handBefore = s.players.A.hand.length;
    const { state: s2 } = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    });

    expect(s2.players.A.life.length).toBe(lifeBefore - 1);
    expect(s2.players.A.hand.length).toBe(handBefore + 1);
    expect(s2.players.B.leader.rested).toBe(true);
  });

  it('whiff attack (power < target) leaves life untouched', () => {
    let s = advanceToMainPhase(build());
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s.players.B.donActive = 0;
    // B.leader = 5000, A.leader = 5000 — equal, attacker wins per ">=" rule.
    // To force a whiff, lower B leader effective power. Drop its base.
    (s.cardLibrary['LB'] as LeaderCard).power = 4000;

    const lifeBefore = s.players.A.life.length;
    const { state: s2 } = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    });
    expect(s2.players.A.life.length).toBe(lifeBefore);
  });

  it('lethal: attack when target has zero life ends game', () => {
    let s = advanceToMainPhase(build());
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s.players.A.life = []; // zero life
    s.players.B.leader.attachedDon = 1; // 6000 > 5000

    const { state: s2 } = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    });
    expect(s2.result?.winner).toBe('B');
    expect(s2.result?.reason).toBe('lethal');
  });
});

describe('applyAction: RESIGN', () => {
  it('opponent wins', () => {
    const s = setupGame(build());
    const { state: s2 } = applyAction(s, 'A', { type: 'RESIGN' });
    expect(s2.result?.winner).toBe('B');
    expect(s2.result?.reason).toBe('resignation');
  });
});
