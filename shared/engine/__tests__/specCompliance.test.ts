// Spec-compliance regressions for the 2026-05-29 BLOCKER divergences from
// rules-reference.md §15.1 + §15.2.
//
// Coverage:
//   D1 — Stage Area is its own single-slot zone; PLAY_STAGE handles replace
//   D2 — First-turn-no-attack applies to BOTH players (turn 1 for A, turn 2 for B)
//   D3 — Event counter cards playable in Counter Step (pay cost + trash event)
//   D4 — `[Once Per Turn]` is per-card per-effect, not a global instance flag
//   D8 — `[Unblockable]` attacker cannot be blocked by Blocker
//
// All tests build the same minimal red-deck shape used by existing suites
// (50 vanilla characters, two 5000-power leaders) and inject the spec-relevant
// card/keyword into hand or field directly.

import { describe, expect, it } from 'vitest';
import { applyAction } from '../applyAction';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import { getLegalActions } from '../rules/legality';
import type { CardInstance } from '../GameState';
import type {
  Card,
  CharacterCard,
  EventCard,
  LeaderCard,
  StageCard,
} from '../cards/Card';
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
function makeStage(id: string, cost = 1): StageCard {
  return {
    id, name: id, kind: 'stage', colors: ['red'], cost, power: null,
    counterValue: null, traits: [], keywords: [], effectTags: ['vanilla'],
  };
}
function makeCounterEvent(id: string, cost: number, boost: number): EventCard {
  return {
    id, name: id, kind: 'event', colors: ['red'], cost, power: null,
    counterValue: null, counterEventBoost: boost,
    traits: [], keywords: [], effectTags: ['counter_event'],
  };
}

function build(seed = 1) {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  return initialState({
    seed,
    decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } },
  });
}

function advanceToMain(s: ReturnType<typeof build>) {
  return runDonPhase(runDrawPhase(runRefreshPhase(setupGame(s))));
}

/** Inject a fresh CardInstance into `player`'s hand referencing `cardId`. */
function injectInHand(
  s: ReturnType<typeof build>,
  player: 'A' | 'B',
  cardId: string,
  instanceId: string,
) {
  const inst: CardInstance = {
    instanceId, cardId, controller: player, rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.instances[instanceId] = inst;
  s.players[player].hand.push(instanceId);
}

/** Inject a fresh CardInstance onto `player`'s field. */
function injectOnField(
  s: ReturnType<typeof build>,
  player: 'A' | 'B',
  cardId: string,
  instanceId: string,
  overrides: Partial<CardInstance> = {},
) {
  const inst: CardInstance = {
    instanceId, cardId, controller: player, rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    ...overrides,
  };
  s.instances[instanceId] = inst;
  s.players[player].field.push(inst);
}

// ─────────────────────────────────────────────────────────────────────────────
// D1 — Stage Area as a separate zone (CR §3-8)
// ─────────────────────────────────────────────────────────────────────────────
describe('D1: Stage Area (CR §3-8)', () => {
  it('PLAY_STAGE places the stage card in the stage slot (not on field) and pays cost', () => {
    const s = advanceToMain(build(1001));
    setDonActive(s, 'A', 2);

    // Inject a 1-cost stage card into A's hand.
    s.cardLibrary['STAGE1'] = makeStage('STAGE1', 1);
    injectInHand(s, 'A', 'STAGE1', 'STAGE-INST-1');

    expect(s.players.A.stage).toBeNull();
    const fieldBefore = s.players.A.field.length;
    const donBefore = s.players.A.donCostArea.length;

    const { state: s2 } = applyAction(s, 'A', { type: 'PLAY_STAGE', instanceId: 'STAGE-INST-1' });

    expect(s2.players.A.stage?.instanceId).toBe('STAGE-INST-1');
    expect(s2.players.A.field).toHaveLength(fieldBefore); // characters-only field unchanged
    expect(s2.players.A.hand).not.toContain('STAGE-INST-1');
    expect(s2.players.A.donCostArea.length).toBe(donBefore - 1);
    expect(s2.players.A.donRested.length).toBe(1);
  });

  it('PLAY_STAGE replaces an existing stage by trashing the previous one (CR §3-8-5-1)', () => {
    const s = advanceToMain(build(1002));
    setDonActive(s, 'A', 4); // enough to play stage twice (1 + 1 cost)

    s.cardLibrary['STAGE_A'] = makeStage('STAGE_A', 1);
    s.cardLibrary['STAGE_B'] = makeStage('STAGE_B', 1);
    injectInHand(s, 'A', 'STAGE_A', 'STAGE-INST-A');
    injectInHand(s, 'A', 'STAGE_B', 'STAGE-INST-B');

    let s2 = applyAction(s, 'A', { type: 'PLAY_STAGE', instanceId: 'STAGE-INST-A' }).state;
    expect(s2.players.A.stage?.instanceId).toBe('STAGE-INST-A');
    expect(s2.players.A.trash).not.toContain('STAGE-INST-A');

    s2 = applyAction(s2, 'A', { type: 'PLAY_STAGE', instanceId: 'STAGE-INST-B' }).state;
    expect(s2.players.A.stage?.instanceId).toBe('STAGE-INST-B');
    expect(s2.players.A.trash).toContain('STAGE-INST-A');
  });

  it('legality emits PLAY_STAGE (not PLAY_CARD) for a playable stage card', () => {
    const s = advanceToMain(build(1003));
    setDonActive(s, 'A', 2);

    s.cardLibrary['STAGE_LEGAL'] = makeStage('STAGE_LEGAL', 1);
    injectInHand(s, 'A', 'STAGE_LEGAL', 'STAGE-LEGAL-INST');

    const legal = getLegalActions(s, 'A');
    const playStage = legal.filter((a) => a.type === 'PLAY_STAGE' && a.instanceId === 'STAGE-LEGAL-INST');
    const playCardStage = legal.filter((a) => a.type === 'PLAY_CARD' && a.instanceId === 'STAGE-LEGAL-INST');
    expect(playStage).toHaveLength(1);
    expect(playCardStage).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D2 — First-turn-no-attack for BOTH players (CR §6-5-6-1)
// ─────────────────────────────────────────────────────────────────────────────
describe('D2: First-turn-no-attack for both players (CR §6-5-6-1)', () => {
  it('player A on turn 1 has no DECLARE_ATTACK in legal actions', () => {
    const s = advanceToMain(build(2001));
    const legal = getLegalActions(s, 'A');
    expect(legal.some((a) => a.type === 'DECLARE_ATTACK')).toBe(false);
  });

  it("player B on turn 2 (B's first turn) has no DECLARE_ATTACK in legal actions", () => {
    let s = advanceToMain(build(2002));
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s))); // B turn 2 main
    expect(s.turn).toBe(2);
    expect(s.activePlayer).toBe('B');
    const legal = getLegalActions(s, 'B');
    expect(legal.some((a) => a.type === 'DECLARE_ATTACK')).toBe(false);
  });

  it('player B on turn 4 (second time around) CAN attack', () => {
    let s = advanceToMain(build(2003));
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s))); // B turn 2 main
    s = advanceOneFullCycle(s); // → B turn 4 main
    expect(s.turn).toBe(4);
    expect(s.activePlayer).toBe('B');
    attachDonCount(s, 'B', s.players.B.leader.instanceId, 1);
    const legal = getLegalActions(s, 'B');
    expect(legal.some((a) => a.type === 'DECLARE_ATTACK')).toBe(true);
  });

  it("declareAttack handler rejects B's attack on turn 2 even if dispatched directly", () => {
    let s = advanceToMain(build(2004));
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    attachDonCount(s, 'B', s.players.B.leader.instanceId, 1);

    const { state: s2 } = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    });
    // State unchanged: still on main, no pendingAttack.
    expect(s2.phase).toBe('main');
    expect(s2.pendingAttack).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D3 — Event counter cards (CR §7-1-3-2-2)
// ─────────────────────────────────────────────────────────────────────────────
describe('D3: Event counter cards (CR §7-1-3-2-2)', () => {
  /** Build a state where B is attacking A's leader during counter window,
   *  and A has the named counter event in hand + at least `donAvailable` DON. */
  function attackInCounterWindow(seed: number, donAvailableForDefender: number) {
    const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
    let s = initialState({
      seed, decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } },
    });
    s = setupGame(s);
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s = advanceOneFullCycle(s); // D2: B can now attack on turn 4.
    attachDonCount(s, 'B', s.players.B.leader.instanceId, 1); // 6000 attacker
    setDonActive(s, 'A', donAvailableForDefender);

    s = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    }).state;
    s = applyAction(s, 'A', { type: 'SKIP_BLOCKER' }).state;
    return s;
  }

  it('defender plays an Event counter: pays cost, trashes event, boost applied to pendingAttack', () => {
    const s = attackInCounterWindow(3001, /* DON */ 2);
    s.cardLibrary['EVENT_C2K'] = makeCounterEvent('EVENT_C2K', /* cost */ 1, /* boost */ 2000);
    injectInHand(s, 'A', 'EVENT_C2K', 'EVENT-INST-1');

    const donBefore = s.players.A.donCostArea.length;
    const handBefore = s.players.A.hand.length;

    const { state: after } = applyAction(s, 'A', { type: 'PLAY_COUNTER', instanceId: 'EVENT-INST-1' });

    expect(after.pendingAttack?.counterBoost).toBe(2000);
    expect(after.players.A.donCostArea.length).toBe(donBefore - 1);
    expect(after.players.A.donRested.length).toBeGreaterThan(0);
    expect(after.players.A.hand.length).toBe(handBefore - 1);
    expect(after.players.A.trash).toContain('EVENT-INST-1');
  });

  it('Event counter is blocked when defender lacks DON to pay the cost', () => {
    const s = attackInCounterWindow(3002, /* DON */ 0);
    s.cardLibrary['EVENT_C2K'] = makeCounterEvent('EVENT_C2K', /* cost */ 1, /* boost */ 2000);
    injectInHand(s, 'A', 'EVENT_C2K', 'EVENT-INST-2');

    // Legality must NOT include the counter event when cost is unpayable.
    const legal = getLegalActions(s, 'A');
    expect(legal.some((a) => a.type === 'PLAY_COUNTER' && a.instanceId === 'EVENT-INST-2')).toBe(false);

    // And dispatching the action directly is a no-op (event stays in hand).
    const { state: after } = applyAction(s, 'A', { type: 'PLAY_COUNTER', instanceId: 'EVENT-INST-2' });
    expect(after.pendingAttack?.counterBoost).toBe(0);
    expect(after.players.A.hand).toContain('EVENT-INST-2');
    expect(after.players.A.trash).not.toContain('EVENT-INST-2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D4 — Per-card per-effect `[Once Per Turn]` tracking (CR §10-2-13)
// ─────────────────────────────────────────────────────────────────────────────
describe('D4: Per-card per-effect tracking (CR §10-2-13)', () => {
  it('different cards track effectsUsed independently — using one OPT effect does not lock another card', () => {
    const s = advanceToMain(build(4001));
    // Two fresh OPT-bearing characters on B's field.
    s.cardLibrary['OPT_A'] = makeChar('OPT_A');
    s.cardLibrary['OPT_B'] = makeChar('OPT_B');
    injectOnField(s, 'B', 'OPT_A', 'OPT-INST-A');
    injectOnField(s, 'B', 'OPT_B', 'OPT-INST-B');

    // Simulate firing `activate_main` on card A only.
    const cardA = s.players.B.field.find((i) => i.instanceId === 'OPT-INST-A')!;
    cardA.perTurn.effectsUsed.push('activate_main');

    const after = structuredClone(s);
    const aAfter = after.players.B.field.find((i) => i.instanceId === 'OPT-INST-A')!;
    const bAfter = after.players.B.field.find((i) => i.instanceId === 'OPT-INST-B')!;

    expect(aAfter.perTurn.effectsUsed).toContain('activate_main');
    expect(bAfter.perTurn.effectsUsed).not.toContain('activate_main');
    // Multiple distinct effects on the SAME card stack independently.
    aAfter.perTurn.effectsUsed.push('on_play_searcher');
    expect(aAfter.perTurn.effectsUsed).toEqual(['activate_main', 'on_play_searcher']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D8 — Unblockable attacker (CR §10-1-7)
// ─────────────────────────────────────────────────────────────────────────────
describe('D8: Unblockable attacker (CR §10-1-7)', () => {
  it("defender's blocker is not offered against an [Unblockable] attacker", () => {
    let s = advanceToMain(build(8001));
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s = advanceOneFullCycle(s); // D2: B can attack on turn 4.
    attachDonCount(s, 'B', s.players.B.leader.instanceId, 1);

    // Make B's leader Unblockable.
    const leaderB = s.cardLibrary['LB'] as LeaderCard;
    s.cardLibrary['LB'] = { ...leaderB, keywords: [...leaderB.keywords, 'unblockable'] };

    // Inject a Blocker on A's field — would be legal blocker but for D8.
    s.cardLibrary['BLOCK1'] = {
      ...makeChar('BLOCK1', 2, 4000),
      keywords: ['blocker'],
    };
    injectOnField(s, 'A', 'BLOCK1', 'BLOCK-INST');

    s = applyAction(s, 'B', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.B.leader.instanceId,
      targetInstanceId: s.players.A.leader.instanceId,
    }).state;
    expect(s.phase).toBe('block_window');

    const legal = getLegalActions(s, 'A');
    expect(legal.some((a) => a.type === 'DECLARE_BLOCKER')).toBe(false);
    // SKIP_BLOCKER must still be the only block-window action available.
    expect(legal.some((a) => a.type === 'SKIP_BLOCKER')).toBe(true);
  });
});
