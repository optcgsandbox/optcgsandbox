import { describe, expect, it } from 'vitest';
import { applyAction } from '../applyAction';
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
  // D10: close the mulligan window first so refresh runs in the correct phase.
  return runDonPhase(runDrawPhase(runRefreshPhase(closeMulliganKeepBoth(setupGame(s)))));
}

describe('applyAction: PLAY_CARD', () => {
  it('plays a Character: pays DON, moves to field, adds CARD_PLAYED event', () => {
    let s = advanceToMainPhase(build());
    // First turn first player has 1 DON. Force 2 so we can play a 2-cost character.
    setDonActive(s, 'A', 2);
    const handCard = s.players.A.hand[0];
    const { state: s2 } = applyAction(s, 'A', {
      type: 'PLAY_CARD', instanceId: handCard, replaceTargetId: null,
    });
    expect(s2.players.A.hand).not.toContain(handCard);
    expect(s2.players.A.field.find((i) => i.instanceId === handCard)).toBeDefined();
    expect(s2.players.A.donCostArea.length).toBe(0);
    expect(s2.players.A.donRested.length).toBe(2);
  });

  it('rejects play if cost > donCostArea', () => {
    let s = advanceToMainPhase(build());
    setDonActive(s, 'A', 1);
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
    setDonActive(s, 'A', 1);
    const { state: s2 } = applyAction(s, 'A', {
      type: 'ATTACH_DON', targetInstanceId: s.players.A.leader.instanceId,
    });
    expect(s2.players.A.leader.attachedDon.length).toBe(1);
    expect(s2.players.A.donCostArea.length).toBe(0);
  });
});

describe('applyAction: DECLARE_ATTACK', () => {
  /** Helper: drive the 3-stage attack flow through declare → skip blocker → skip counter. */
  function runAttack(s: ReturnType<typeof build>, attackerInstanceId: string, targetInstanceId: string) {
    let next = applyAction(s, 'B', { type: 'DECLARE_ATTACK', attackerInstanceId, targetInstanceId }).state;
    next = applyAction(next, 'A', { type: 'SKIP_BLOCKER' }).state;
    next = applyAction(next, 'A', { type: 'SKIP_COUNTER' }).state;
    return next;
  }

  it('attack on leader takes 1 life card to hand', () => {
    let s = advanceToMainPhase(build());
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    // D2 (CR §6-5-6-1): B's first turn is turn 2 → cannot battle. Advance one
    //                   full cycle so B is on turn 4 with attacks unlocked.
    s = advanceOneFullCycle(s);
    setDonActive(s, 'B', 2);
    attachDonCount(s, 'B', s.players.B.leader.instanceId, 1);

    const lifeBefore = s.players.A.life.length;
    const handBefore = s.players.A.hand.length;
    const s2 = runAttack(s, s.players.B.leader.instanceId, s.players.A.leader.instanceId);

    expect(s2.players.A.life.length).toBe(lifeBefore - 1);
    expect(s2.players.A.hand.length).toBe(handBefore + 1);
    expect(s2.players.B.leader.rested).toBe(true);
    expect(s2.pendingAttack).toBeNull();
    expect(s2.phase).toBe('main');
  });

  it('whiff attack (power < target) leaves life untouched', () => {
    let s = advanceToMainPhase(build());
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s = advanceOneFullCycle(s); // D2: skip first-turn-no-attack window.
    setDonActive(s, 'B', 0);
    (s.cardLibrary['LB'] as LeaderCard).power = 4000;

    const lifeBefore = s.players.A.life.length;
    const s2 = runAttack(s, s.players.B.leader.instanceId, s.players.A.leader.instanceId);
    expect(s2.players.A.life.length).toBe(lifeBefore);
  });

  it('lethal: attack when target has zero life ends game', () => {
    let s = advanceToMainPhase(build());
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s = advanceOneFullCycle(s); // D2: skip first-turn-no-attack window.
    s.players.A.life = [];
    attachDonCount(s, 'B', s.players.B.leader.instanceId, 1);

    const s2 = runAttack(s, s.players.B.leader.instanceId, s.players.A.leader.instanceId);
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

// Phase E / D9: [Rush: Character]
import { getLegalActions } from '../rules/legality';
import type { Keyword } from '../cards/Card';

function plantCharOnB(
  s: ReturnType<typeof build>,
  cardId: string,
  keywords: Keyword[],
  opts: { rested?: boolean; summoningSick?: boolean } = {},
): string {
  const card: CharacterCard = {
    id: cardId, name: cardId, kind: 'character', colors: ['red'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords, effectTags: ['vanilla'],
  };
  s.cardLibrary[cardId] = card;
  const instanceId = `${cardId}-inst-B`;
  s.instances[instanceId] = {
    instanceId, cardId, controller: 'B', rested: opts.rested ?? false,
    summoningSick: opts.summoningSick ?? true, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] },
  };
  s.players.B.field.push(s.instances[instanceId]);
  return instanceId;
}
function plantCharOnAasRested(s: ReturnType<typeof build>, cardId: string): string {
  const card: CharacterCard = {
    id: cardId, name: cardId, kind: 'character', colors: ['red'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  };
  s.cardLibrary[cardId] = card;
  const instanceId = `${cardId}-inst-A`;
  s.instances[instanceId] = {
    instanceId, cardId, controller: 'A', rested: true, summoningSick: false,
    attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] },
  };
  s.players.A.field.push(s.instances[instanceId]);
  return instanceId;
}

describe('legality.attackActions: D9 [Rush:Character]', () => {
  it('rush_character summoning-sick may attack opp rested character but NOT opp leader', () => {
    let s = advanceToMainPhase(build());
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s = advanceOneFullCycle(s); // turn 4: B can attack
    const attacker = plantCharOnB(s, 'RCHAR', ['rush_character'], { summoningSick: true });
    const target = plantCharOnAasRested(s, 'TARGETCHAR');

    const legal = getLegalActions(s, 'B');
    const targetIds = legal
      .filter((a) => a.type === 'DECLARE_ATTACK' && a.attackerInstanceId === attacker)
      .map((a) => (a as { targetInstanceId: string }).targetInstanceId);
    expect(targetIds).toContain(target);
    expect(targetIds).not.toContain(s.players.A.leader.instanceId);
  });

  it('plain rush summoning-sick may attack BOTH opp character and opp leader', () => {
    let s = advanceToMainPhase(build());
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s = advanceOneFullCycle(s);
    const attacker = plantCharOnB(s, 'RUSHCHAR', ['rush'], { summoningSick: true });
    const target = plantCharOnAasRested(s, 'OPPCHAR2');

    const legal = getLegalActions(s, 'B');
    const targetIds = legal
      .filter((a) => a.type === 'DECLARE_ATTACK' && a.attackerInstanceId === attacker)
      .map((a) => (a as { targetInstanceId: string }).targetInstanceId);
    expect(targetIds).toContain(target);
    expect(targetIds).toContain(s.players.A.leader.instanceId);
  });

  it('rush_character that is no longer summoning-sick may attack opp leader', () => {
    let s = advanceToMainPhase(build());
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s = advanceOneFullCycle(s);
    const attacker = plantCharOnB(s, 'RCHAR2', ['rush_character'], { summoningSick: false });

    const legal = getLegalActions(s, 'B');
    const targetIds = legal
      .filter((a) => a.type === 'DECLARE_ATTACK' && a.attackerInstanceId === attacker)
      .map((a) => (a as { targetInstanceId: string }).targetInstanceId);
    expect(targetIds).toContain(s.players.A.leader.instanceId);
  });
});
