import { describe, expect, it } from 'vitest';
import { evaluateConditionV2 } from '../effectSpec/runner-v2';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import { closeMulliganKeepBoth, setDonActive } from './_donHelpers';

function makeLeader(id: string, name = id, opts: { colors?: ('red'|'blue'|'green')[]; traits?: string[]; power?: number } = {}): LeaderCard {
  return {
    id, name, kind: 'leader', colors: (opts.colors as LeaderCard['colors']) ?? ['red'],
    cost: null, power: opts.power ?? 5000,
    life: 5, counterValue: null, traits: opts.traits ?? ['Straw Hat Crew'],
    keywords: [], effectTags: [],
  };
}
function makeChar(id: string, cost = 2, name = id): CharacterCard {
  return {
    id, name, kind: 'character', colors: ['red'], cost, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  };
}
function boot(leaderA?: LeaderCard) {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  let s = initialState({
    seed: 1,
    decks: {
      A: { leader: leaderA ?? makeLeader('LA', 'Luffy'), cards },
      B: { leader: makeLeader('LB', 'Buggy'), cards },
    },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

describe('EffectSpec v2 — evaluateConditionV2', () => {
  it('undefined condition → true (defaults to always)', () => {
    const s = boot();
    expect(evaluateConditionV2(s, 'A', undefined)).toBe(true);
  });

  it('always → true', () => {
    const s = boot();
    expect(evaluateConditionV2(s, 'A', { type: 'always' })).toBe(true);
  });

  // ── Leader identity ────────────────────────────────────────────
  it('if_leader_is matches', () => {
    const s = boot();
    expect(evaluateConditionV2(s, 'A', { type: 'if_leader_is', name: 'Luffy' })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_leader_is', name: 'Sugar' })).toBe(false);
  });

  it('if_leader_has_trait matches', () => {
    const s = boot();
    expect(evaluateConditionV2(s, 'A', { type: 'if_leader_has_trait', trait: 'Straw Hat Crew' })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_leader_has_trait', trait: 'Marine' })).toBe(false);
  });

  it('if_leader_has_type matches via substring', () => {
    const s = boot(makeLeader('Custom', 'Custom', { traits: ['Whitebeard Pirates'] }));
    expect(evaluateConditionV2(s, 'A', { type: 'if_leader_has_type', typeString: 'Whitebeard' })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_leader_has_type', typeString: 'Marine' })).toBe(false);
  });

  it('if_leader_multicolored is true only with 2+ colors', () => {
    const single = boot();
    expect(evaluateConditionV2(single, 'A', { type: 'if_leader_multicolored' })).toBe(false);
    const multi = boot(makeLeader('Multi', 'Multi', { colors: ['red', 'green'] }));
    expect(evaluateConditionV2(multi, 'A', { type: 'if_leader_multicolored' })).toBe(true);
  });

  it('if_leader_power_max checks effective leader power', () => {
    const s = boot();
    expect(evaluateConditionV2(s, 'A', { type: 'if_leader_power_max', n: 5000 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_leader_power_max', n: 4999 })).toBe(false);
  });

  // ── Resource counts ───────────────────────────────────────────
  it('if_don_min / if_don_max', () => {
    const s = boot();
    setDonActive(s, 'A', 4);
    expect(evaluateConditionV2(s, 'A', { type: 'if_don_min', n: 4 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_don_min', n: 5 })).toBe(false);
    expect(evaluateConditionV2(s, 'A', { type: 'if_don_max', n: 4 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_don_max', n: 3 })).toBe(false);
  });

  it('if_own_don_le_opp', () => {
    const s = boot();
    setDonActive(s, 'A', 2);
    setDonActive(s, 'B', 4);
    expect(evaluateConditionV2(s, 'A', { type: 'if_own_don_le_opp' })).toBe(true);
    expect(evaluateConditionV2(s, 'B', { type: 'if_own_don_le_opp' })).toBe(false);
  });

  it('if_own_life_max / if_own_life_min', () => {
    const s = boot();
    s.players.A.life = ['l1', 'l2'];
    expect(evaluateConditionV2(s, 'A', { type: 'if_own_life_max', n: 2 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_own_life_max', n: 1 })).toBe(false);
    expect(evaluateConditionV2(s, 'A', { type: 'if_own_life_min', n: 2 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_own_life_min', n: 3 })).toBe(false);
  });

  it('if_opp_life_max / if_opp_life_min', () => {
    const s = boot();
    s.players.B.life = ['l1'];
    expect(evaluateConditionV2(s, 'A', { type: 'if_opp_life_max', n: 1 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_opp_life_max', n: 0 })).toBe(false);
    expect(evaluateConditionV2(s, 'A', { type: 'if_opp_life_min', n: 1 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_opp_life_min', n: 2 })).toBe(false);
  });

  it('if_hand_max / if_hand_min', () => {
    const s = boot();
    s.players.A.hand = ['h1', 'h2', 'h3'];
    expect(evaluateConditionV2(s, 'A', { type: 'if_hand_max', n: 3 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_hand_max', n: 2 })).toBe(false);
    expect(evaluateConditionV2(s, 'A', { type: 'if_hand_min', n: 3 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_hand_min', n: 4 })).toBe(false);
  });

  it('if_opp_hand_min / if_opp_hand_max', () => {
    const s = boot();
    s.players.B.hand = ['x', 'x', 'x', 'x', 'x', 'x'];
    expect(evaluateConditionV2(s, 'A', { type: 'if_opp_hand_min', n: 6 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_opp_hand_min', n: 7 })).toBe(false);
    expect(evaluateConditionV2(s, 'A', { type: 'if_opp_hand_max', n: 6 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_opp_hand_max', n: 5 })).toBe(false);
  });

  it('if_trash_min / if_trash_max', () => {
    const s = boot();
    s.players.A.trash = ['t1', 't2', 't3', 't4', 't5'];
    expect(evaluateConditionV2(s, 'A', { type: 'if_trash_min', n: 5 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_trash_min', n: 6 })).toBe(false);
    expect(evaluateConditionV2(s, 'A', { type: 'if_trash_max', n: 5 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_trash_max', n: 4 })).toBe(false);
  });

  // ── Field state ────────────────────────────────────────────────
  it('if_own_chars_min counts only character instances on field', () => {
    const s = boot();
    s.cardLibrary['CHX'] = makeChar('CHX', 2);
    s.instances['ix1'] = {
      instanceId: 'ix1', cardId: 'CHX', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['ix1']);
    expect(evaluateConditionV2(s, 'A', { type: 'if_own_chars_min', n: 1 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_own_chars_min', n: 2 })).toBe(false);
  });

  it('if_own_chars_min_cost filters by cost threshold', () => {
    const s = boot();
    s.cardLibrary['CH5'] = makeChar('CH5', 5);
    s.instances['ix2'] = {
      instanceId: 'ix2', cardId: 'CH5', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['ix2']);
    expect(evaluateConditionV2(s, 'A', { type: 'if_own_chars_min_cost', n: 1, minCost: 5 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_own_chars_min_cost', n: 1, minCost: 6 })).toBe(false);
  });

  it('if_owned_other_with_name + if_no_other_with_name', () => {
    const s = boot();
    s.cardLibrary['NAMED'] = makeChar('NAMED', 2, 'Nami');
    s.instances['ix3'] = {
      instanceId: 'ix3', cardId: 'NAMED', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['ix3']);
    expect(evaluateConditionV2(s, 'A', { type: 'if_owned_other_with_name', name: 'Nami' })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_no_other_with_name', name: 'Nami' })).toBe(false);
    expect(evaluateConditionV2(s, 'A', { type: 'if_no_other_with_name', name: 'Zoro' })).toBe(true);
  });

  it('if_played_this_turn returns false in V0 (heuristic placeholder)', () => {
    const s = boot();
    expect(evaluateConditionV2(s, 'A', { type: 'if_played_this_turn' })).toBe(false);
  });

  it('if_have_given_don_min counts opp attached DON', () => {
    const s = boot();
    s.players.B.leader.attachedDon = ['d1', 'd2'];
    expect(evaluateConditionV2(s, 'A', { type: 'if_have_given_don_min', n: 2 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_have_given_don_min', n: 3 })).toBe(false);
  });

  it('if_field_total_cost_min sums own field costs', () => {
    const s = boot();
    s.cardLibrary['CC3'] = makeChar('CC3', 3);
    s.cardLibrary['CC4'] = makeChar('CC4', 4);
    s.instances['cc3-i'] = {
      instanceId: 'cc3-i', cardId: 'CC3', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.instances['cc4-i'] = {
      instanceId: 'cc4-i', cardId: 'CC4', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['cc3-i'], s.instances['cc4-i']);
    expect(evaluateConditionV2(s, 'A', { type: 'if_field_total_cost_min', n: 7 })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_field_total_cost_min', n: 8 })).toBe(false);
  });

  it('if_attacker_has_attribute returns false with no pending attack', () => {
    const s = boot();
    expect(evaluateConditionV2(s, 'A', { type: 'if_attacker_has_attribute', attribute: 'slash' })).toBe(false);
  });

  it('if_attacker_has_attribute reads pendingAttack.attackerInstanceId', () => {
    const s = boot();
    s.cardLibrary['ATK'] = { ...makeChar('ATK', 4), attribute: 'slash' };
    s.instances['atk-i'] = {
      instanceId: 'atk-i', cardId: 'ATK', controller: 'B', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.pendingAttack = { attackerInstanceId: 'atk-i', targetInstanceId: 'x', counterBoost: 0 };
    expect(evaluateConditionV2(s, 'A', { type: 'if_attacker_has_attribute', attribute: 'slash' })).toBe(true);
    expect(evaluateConditionV2(s, 'A', { type: 'if_attacker_has_attribute', attribute: 'strike' })).toBe(false);
  });

  // ── Composite ──────────────────────────────────────────────────
  it('and short-circuits + returns false when any fails', () => {
    const s = boot();
    expect(evaluateConditionV2(s, 'A', {
      type: 'and',
      conditions: [{ type: 'always' }, { type: 'if_leader_is', name: 'Luffy' }],
    })).toBe(true);
    expect(evaluateConditionV2(s, 'A', {
      type: 'and',
      conditions: [{ type: 'always' }, { type: 'if_leader_is', name: 'Buggy' }],
    })).toBe(false);
  });

  it('or returns true when any passes', () => {
    const s = boot();
    expect(evaluateConditionV2(s, 'A', {
      type: 'or',
      conditions: [{ type: 'if_leader_is', name: 'Buggy' }, { type: 'always' }],
    })).toBe(true);
  });

  it('not inverts', () => {
    const s = boot();
    expect(evaluateConditionV2(s, 'A', {
      type: 'not',
      condition: { type: 'if_leader_is', name: 'Buggy' },
    })).toBe(true);
    expect(evaluateConditionV2(s, 'A', {
      type: 'not',
      condition: { type: 'always' },
    })).toBe(false);
  });

  it('nested composites resolve correctly', () => {
    const s = boot();
    s.players.A.life = ['l1', 'l2'];
    expect(evaluateConditionV2(s, 'A', {
      type: 'and',
      conditions: [
        { type: 'if_leader_is', name: 'Luffy' },
        { type: 'or', conditions: [
          { type: 'if_own_life_max', n: 1 },
          { type: 'if_own_life_max', n: 2 },
        ]},
      ],
    })).toBe(true);
  });
});
