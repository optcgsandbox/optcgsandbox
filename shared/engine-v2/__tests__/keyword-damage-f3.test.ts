/**
 * F8A-F3 — [Double Attack] + [Banish] leader-damage correctness.
 *
 * Rules basis (repo rules doc, sourced from the official CR):
 *   - Double Attack: "life-add procedure runs 2×" — CR §10-1-2
 *     (docs/optcg-sim/rules-reference.md:340)
 *   - Banish: "Damage to opp Leader trashes the life card without revealing;
 *     Trigger does NOT fire" — CR §10-1-3 (rules-reference.md:341)
 *   - V1 reference implementation: shared/engine/applyAction.ts:648 (flips)
 *     + D7 (banish→trash + skip trigger window).
 *
 * All cases drive the REAL pipeline: DECLARE_ATTACK → SKIP_BLOCKER →
 * SKIP_COUNTER (→ RESOLVE_TRIGGER where applicable).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { CharacterCard, LeaderCard } from '../cards/Card.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';
import { applyAction } from '../reducers/applyAction.js';
import type { GameState } from '../state/types.js';

import { buildState, makeInst, type BuiltState } from './cards/_fixtures.js';

const LEADER_A: LeaderCard = {
  id: '__F3_LA', name: 'F3 Leader A', kind: 'leader', colors: ['red'],
  cost: null, power: 5000, counterValue: null, traits: [], keywords: [],
  effectTags: [], life: 5,
};
const LEADER_B: LeaderCard = { ...LEADER_A, id: '__F3_LB', name: 'F3 Leader B' };
const VANILLA: CharacterCard = {
  id: '__F3_VAN', name: 'F3 Vanilla', kind: 'character', colors: ['red'],
  cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [],
  effectTags: ['vanilla'],
};
/** Life card with a [Trigger] draw clause — opens the trigger window. */
const TRIGGER_CARD: CharacterCard = {
  ...VANILLA,
  id: '__F3_TRIG',
  name: 'F3 Trigger Card',
  effectTags: ['draw'],
  effectSpecV2: {
    schemaVersion: 2,
    clauses: [{ trigger: 'trigger', action: { kind: 'draw', magnitude: 1 }, verified: 'human-reviewed' }],
    continuous: [],
    replacements: [],
  },
} as unknown as CharacterCard;

function mkAttacker(keywords: string[]): CharacterCard {
  return {
    id: `__F3_ATK_${keywords.join('_') || 'plain'}`, name: 'F3 Attacker',
    kind: 'character', colors: ['red'], cost: 5, power: 7000,
    counterValue: 0, traits: [], keywords: keywords as CharacterCard['keywords'],
    effectTags: [],
  };
}

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

/** Build a state where A's field char attacks B's leader; B has `lifeCards`
 *  (top of life = first array element). Returns post-SKIP_COUNTER state. */
function runAttack(opts: {
  attackerKeywords: string[];
  lifeCards: CharacterCard[];
  grantOneShot?: string[];
}): { st: GameState; built: BuiltState; attackerId: string } {
  const attacker = mkAttacker(opts.attackerKeywords);
  const built = buildState({ leaderA: LEADER_A, leaderB: LEADER_B, charsA: [attacker] });
  const s = built.state;
  s.activePlayer = 'A';
  const atk = built.fieldA[0]!;
  atk.summoningSick = false;
  if (opts.grantOneShot !== undefined) {
    atk.grantedKeywordsOneShot = opts.grantOneShot.map((kw) => ({ keyword: kw, until: 'this_turn' }));
  }
  for (const lc of opts.lifeCards) {
    s.cardLibrary[lc.id] = lc;
    const li = makeInst(lc.id, 'B');
    s.instances[li.instanceId] = li;
    s.players.B.life.push(li.instanceId);
  }
  // deck card for B so a [Trigger] draw can resolve
  s.cardLibrary[VANILLA.id] = VANILLA;
  const dk = makeInst(VANILLA.id, 'B');
  s.instances[dk.instanceId] = dk;
  s.players.B.deck.push(dk.instanceId);

  let st = applyAction(s, 'A', {
    type: 'DECLARE_ATTACK',
    attackerInstanceId: atk.instanceId,
    targetInstanceId: built.leaderInstB.instanceId,
  }, { checkInvariants: false }).state;
  st = applyAction(st, 'B', { type: 'SKIP_BLOCKER' }, { checkInvariants: false }).state;
  st = applyAction(st, 'B', { type: 'SKIP_COUNTER' }, { checkInvariants: false }).state;
  return { st, built, attackerId: atk.instanceId };
}

describe('F8A-F3 — required case 6: non-keyword baseline', () => {
  it('plain attacker removes exactly 1 life, to HAND', () => {
    const { st } = runAttack({ attackerKeywords: [], lifeCards: [VANILLA, { ...VANILLA, id: '__F3_V2' }] });
    expect(st.players.B.life.length).toBe(1);
    expect(st.players.B.hand.length).toBe(1);
    expect(st.players.B.trash.length).toBe(0);
    expect(st.phase).toBe('main');
    expect(st.result).toBeNull();
  });
});

describe('F8A-F3 — required case 1: Double Attack vs 2+ life', () => {
  it('defender loses exactly 2 life (both to hand)', () => {
    const { st } = runAttack({
      attackerKeywords: ['double_attack'],
      lifeCards: [VANILLA, { ...VANILLA, id: '__F3_V2' }, { ...VANILLA, id: '__F3_V3' }],
    });
    expect(st.players.B.life.length).toBe(1);
    expect(st.players.B.hand.length).toBe(2);
    expect(st.result).toBeNull();
    expect(st.phase).toBe('main');
  });
});

describe('F8A-F3 — required case 2: Double Attack vs exactly 1 life', () => {
  it('removes the last life, then the second damage step ends the game (life empty)', () => {
    const { st, built } = runAttack({
      attackerKeywords: ['double_attack'],
      lifeCards: [VANILLA],
    });
    expect(st.players.B.life.length).toBe(0);
    expect(st.players.B.hand.length).toBe(1); // the one available life card was taken
    expect(st.result).toEqual({ loser: 'B', reason: 'life_zero' });
    expect(built.leaderInstB.instanceId).toBeTruthy();
  });
});

describe('F8A-F3 — required case 3: Double Attack with Trigger on first life', () => {
  it('first damage opens the trigger window; declining continues the second damage', () => {
    const { st } = runAttack({
      attackerKeywords: ['double_attack'],
      lifeCards: [TRIGGER_CARD, { ...VANILLA, id: '__F3_V2' }, { ...VANILLA, id: '__F3_V3' }],
    });
    // suspended after flip 1
    expect(st.phase).toBe('trigger_window');
    expect(st.pending?.kind).toBe('trigger');
    expect(
      st.pending?.kind === 'trigger' ? st.pending.pendingTrigger.remainingLifeFlips : -1,
    ).toBe(1);
    expect(st.players.B.life.length).toBe(2); // only flip 1 has happened

    const after = applyAction(st, 'B', {
      type: 'RESOLVE_TRIGGER', targetInstanceId: null, activate: false,
    }, { checkInvariants: false }).state;
    expect(after.players.B.life.length).toBe(1); // flip 2 continued
    expect(after.players.B.hand.length).toBe(2);
    expect(after.pending).toBeNull();
    expect(after.phase).toBe('main');
  });

  it('activating the trigger (draw 1) also continues the second damage', () => {
    const { st } = runAttack({
      attackerKeywords: ['double_attack'],
      lifeCards: [TRIGGER_CARD, { ...VANILLA, id: '__F3_V2' }, { ...VANILLA, id: '__F3_V3' }],
    });
    const handBefore = st.players.B.hand.length; // 1 (flip 1 already in hand)
    const after = applyAction(st, 'B', {
      type: 'RESOLVE_TRIGGER', targetInstanceId: null, activate: true,
    }, { checkInvariants: false }).state;
    expect(after.players.B.life.length).toBe(1); // flip 2 happened
    // +1 trigger draw, +1 second life card
    expect(after.players.B.hand.length).toBe(handBefore + 2);
    expect(after.pending).toBeNull();
  });
});

describe('F8A-F3 — required case 4: Banish', () => {
  it('damaged life card goes to TRASH, not hand — and a Trigger life card does NOT open a window', () => {
    const { st } = runAttack({
      attackerKeywords: ['banish'],
      lifeCards: [TRIGGER_CARD, { ...VANILLA, id: '__F3_V2' }],
    });
    expect(st.players.B.life.length).toBe(1);
    expect(st.players.B.trash.length).toBe(1); // banished
    expect(st.players.B.hand.length).toBe(0);
    expect(st.pending).toBeNull(); // CR §10-1-3: Trigger does not fire
    expect(st.phase).toBe('main');
  });
});

describe('F8A-F3 — required case 5: Double Attack + Banish together', () => {
  it('two life cards go to trash; no trigger windows; game continues', () => {
    const { st } = runAttack({
      attackerKeywords: ['double_attack', 'banish'],
      lifeCards: [TRIGGER_CARD, { ...TRIGGER_CARD, id: '__F3_TRIG2' }, { ...VANILLA, id: '__F3_V3' }],
    });
    expect(st.players.B.life.length).toBe(1);
    expect(st.players.B.trash.length).toBe(2);
    expect(st.players.B.hand.length).toBe(0);
    expect(st.pending).toBeNull();
    expect(st.result).toBeNull();
  });

  it('lethal: 1 life + double attack + banish → 1 trashed, game ends on the second step', () => {
    const { st } = runAttack({
      attackerKeywords: ['double_attack', 'banish'],
      lifeCards: [VANILLA],
    });
    expect(st.players.B.trash.length).toBe(1);
    expect(st.result).toEqual({ loser: 'B', reason: 'life_zero' });
  });
});

describe('F8A-F3 — required case 7: effect-GRANTED keywords are honored', () => {
  it('one-shot granted double_attack deals 2 damage (printed keywords empty)', () => {
    const { st } = runAttack({
      attackerKeywords: [],
      grantOneShot: ['double_attack'],
      lifeCards: [VANILLA, { ...VANILLA, id: '__F3_V2' }, { ...VANILLA, id: '__F3_V3' }],
    });
    expect(st.players.B.life.length).toBe(1);
    expect(st.players.B.hand.length).toBe(2);
  });

  it('one-shot granted banish trashes the life card (printed keywords empty)', () => {
    const { st } = runAttack({
      attackerKeywords: [],
      grantOneShot: ['banish'],
      lifeCards: [TRIGGER_CARD, { ...VANILLA, id: '__F3_V2' }],
    });
    expect(st.players.B.trash.length).toBe(1);
    expect(st.players.B.hand.length).toBe(0);
    expect(st.pending).toBeNull();
  });
});
