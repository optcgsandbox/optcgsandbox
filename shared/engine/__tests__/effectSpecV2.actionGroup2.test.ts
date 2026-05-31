import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../effectSpec/runner-v2';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import { closeMulliganKeepBoth, setDonActive } from './_donHelpers';

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
function placeOnField(state: any, controller: 'A' | 'B', card: CharacterCard, instanceId: string) {
  state.cardLibrary[card.id] = card;
  state.instances[instanceId] = {
    instanceId, cardId: card.id, controller,
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  state.players[controller].field.push(state.instances[instanceId]);
}
function boot() {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}
const CTX = { sourceInstanceId: 'src', controller: 'A' as const };

describe('EffectSpec v2 — applyActionV2 group 2 (power/cost/lock/restrict)', () => {
  it('power_buff +2000 stacks on target.powerModifier with per-zone mirror', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('CH1', 2, 3000), 'i1');
    applyActionV2(s, CTX, { kind: 'power_buff', magnitude: 2000, duration: 'this_turn' }, ['i1']);
    expect(s.instances['i1'].powerModifier).toBe(2000);
    expect(s.players.A.field[0].powerModifier).toBe(2000);
  });

  it('set_power_zero sets modifier to neutralize current effective power', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('CH2', 2, 4000), 'i2');
    applyActionV2(s, CTX, { kind: 'set_power_zero' }, ['i2']);
    expect(s.instances['i2'].powerModifier).toBe(-4000);
  });

  it('set_base_power writes basePowerOverride and mirrors per-zone', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('CH3', 2, 3000), 'i3');
    applyActionV2(s, CTX, { kind: 'set_base_power', magnitude: 7000, duration: 'this_turn' }, ['i3']);
    expect(s.instances['i3'].basePowerOverride).toBe(7000);
    expect(s.players.A.field[0].basePowerOverride).toBe(7000);
  });

  it('set_base_power_copy_from opp_leader sets target.basePowerOverride to opp leader power', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('CH4', 2, 3000), 'i4');
    applyActionV2(s, CTX, {
      kind: 'set_base_power_copy_from', source: 'opp_leader', duration: 'this_turn',
    }, ['i4']);
    expect(s.instances['i4'].basePowerOverride).toBe(5000);
  });

  it('cost_reduction subtracts from nextPlayCostModifier', () => {
    const s = boot();
    applyActionV2(s, CTX, { kind: 'cost_reduction', magnitude: 2 }, []);
    expect(s.players.A.nextPlayCostModifier).toBe(-2);
  });

  it('cost_reduction stacks', () => {
    const s = boot();
    applyActionV2(s, CTX, { kind: 'cost_reduction', magnitude: 1 }, []);
    applyActionV2(s, CTX, { kind: 'cost_reduction', magnitude: 2 }, []);
    expect(s.players.A.nextPlayCostModifier).toBe(-3);
  });

  it('removal_cost_reduce reduces target.costModifier', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('CH5', 5, 5000), 'i5');
    applyActionV2(s, CTX, { kind: 'removal_cost_reduce', magnitude: 3, duration: 'this_turn' }, ['i5']);
    expect(s.instances['i5'].costModifier).toBe(-3);
    expect(s.players.B.field[0].costModifier).toBe(-3);
  });

  it('rest_target rests the target on both maps', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('CH6', 2, 3000), 'i6');
    applyActionV2(s, CTX, { kind: 'rest_target' }, ['i6']);
    expect(s.instances['i6'].rested).toBe(true);
    expect(s.players.B.field[0].rested).toBe(true);
  });

  it('set_active flips rested → active', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('CH7', 2, 3000), 'i7');
    s.instances['i7'].rested = true;
    s.players.A.field[0].rested = true;
    applyActionV2(s, CTX, { kind: 'set_active' }, ['i7']);
    expect(s.instances['i7'].rested).toBe(false);
    expect(s.players.A.field[0].rested).toBe(false);
  });

  it('rest_opp_don moves N opp DON to opp rested', () => {
    const s = boot();
    setDonActive(s, 'B', 4);
    applyActionV2(s, CTX, { kind: 'rest_opp_don', magnitude: 2 }, []);
    expect(s.players.B.donCostArea.length).toBe(2);
    expect(s.players.B.donRested.length).toBe(2);
  });

  it('attack_lock_until_phase sets attackLocked + mirrors', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('CH8', 2, 3000), 'i8');
    applyActionV2(s, CTX, { kind: 'attack_lock_until_phase', until: 'opp_next_end_phase' }, ['i8']);
    expect(s.instances['i8'].attackLocked).toBe(true);
    expect(s.players.B.field[0].attackLocked).toBe(true);
  });

  it('rest_lock_until_phase sets restLocked + mirrors', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('CH9', 2, 3000), 'i9');
    applyActionV2(s, CTX, { kind: 'rest_lock_until_phase', until: 'opp_next_turn' }, ['i9']);
    expect(s.instances['i9'].restLocked).toBe(true);
    expect(s.players.B.field[0].restLocked).toBe(true);
  });

  it('restrict_opp_attack sets player restriction flag', () => {
    const s = boot();
    applyActionV2(s, CTX, { kind: 'restrict_opp_attack', unless: { discardN: 2 } }, []);
    expect(s.players.B.restrictions?.oppAttackUnlessDiscard).toBe(2);
  });

  it('restrict_play_self_this_turn with kind filter', () => {
    const s = boot();
    applyActionV2(s, CTX, { kind: 'restrict_play_self_this_turn', kind_filter: 'character' }, []);
    expect(s.players.A.restrictions?.cantPlayKind).toBe('character');
  });

  it('restrict_play_self_this_turn without filter defaults to undefined kind', () => {
    const s = boot();
    applyActionV2(s, CTX, { kind: 'restrict_play_self_this_turn' }, []);
    expect(s.players.A.restrictions).toBeDefined();
  });

  it('restrict_effect_type sets cantUseEffectType', () => {
    const s = boot();
    applyActionV2(s, CTX, { kind: 'restrict_effect_type', effectKind: 'character_set_active' }, []);
    expect(s.players.A.restrictions?.cantUseEffectType).toBe('character_set_active');
  });

  it('power_buff on opp_leader still mirrors to opp.leader struct', () => {
    const s = boot();
    applyActionV2(s, CTX, { kind: 'power_buff', magnitude: -2000, duration: 'this_turn' }, [s.players.B.leader.instanceId]);
    expect(s.players.B.leader.powerModifier).toBe(-2000);
  });

  it('attack_lock + rest_lock are independent (different fields)', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('CHA', 2, 3000), 'ia');
    applyActionV2(s, CTX, { kind: 'attack_lock_until_phase', until: 'this_turn' }, ['ia']);
    expect(s.instances['ia'].attackLocked).toBe(true);
    expect(s.instances['ia'].restLocked).toBeUndefined();
    applyActionV2(s, CTX, { kind: 'rest_lock_until_phase', until: 'this_turn' }, ['ia']);
    expect(s.instances['ia'].restLocked).toBe(true);
  });

  it('power_buff with formula read_state uses dynamic count', () => {
    const s = boot();
    s.players.A.trash = ['t1', 't2', 't3'];
    placeOnField(s, 'A', makeChar('CHB', 2, 3000), 'ib');
    applyActionV2(s, CTX, {
      kind: 'power_buff',
      magnitude: { kind: 'read_state', source: 'own_trash_count' } as any,
      duration: 'this_turn',
    }, ['ib']);
    expect(s.instances['ib'].powerModifier).toBe(3);
  });
});
