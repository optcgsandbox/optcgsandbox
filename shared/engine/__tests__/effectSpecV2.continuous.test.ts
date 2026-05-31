import { describe, expect, it } from 'vitest';
import { applyContinuousEffectsV2ToInstance } from '../effectSpec/continuous-v2';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import type { ContinuousEffectV2 } from '../effectSpec/types-v2';
import { closeMulliganKeepBoth } from './_donHelpers';

function makeLeader(id: string): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}
function makeChar(id: string, opts: { cost?: number; power?: number; name?: string; traits?: string[] } = {}): CharacterCard {
  return {
    id, name: opts.name ?? id, kind: 'character', colors: ['red'],
    cost: opts.cost ?? 2, power: opts.power ?? 3000,
    counterValue: 1000, traits: opts.traits ?? [], keywords: [], effectTags: ['vanilla'],
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

describe('EffectSpec v2 — applyContinuousEffectsV2ToInstance', () => {
  it('self_power_buff with numeric magnitude adds to source.powerModifier', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('SP1'), 'sp1');
    const effects: ContinuousEffectV2[] = [
      { action: { kind: 'self_power_buff', magnitude: 2000 } },
    ];
    applyContinuousEffectsV2ToInstance(s, 'sp1', effects);
    expect(s.instances['sp1'].powerModifier).toBe(2000);
  });

  it('self_power_buff with read_state(own_trash_count) reads dynamic count', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('SP2'), 'sp2');
    s.players.A.trash = ['t1', 't2', 't3', 't4'];
    const effects: ContinuousEffectV2[] = [
      { action: { kind: 'self_power_buff', magnitude: { kind: 'read_state', source: 'own_trash_count' } } },
    ];
    applyContinuousEffectsV2ToInstance(s, 'sp2', effects);
    expect(s.instances['sp2'].powerModifier).toBe(4);
  });

  it('self_power_buff respects condition (skipped when false)', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('SP3'), 'sp3');
    const effects: ContinuousEffectV2[] = [
      {
        condition: { type: 'if_trash_min', n: 5 }, // life starts empty/small
        action: { kind: 'self_power_buff', magnitude: 1000 },
      },
    ];
    applyContinuousEffectsV2ToInstance(s, 'sp3', effects);
    expect(s.instances['sp3'].powerModifier).toBeUndefined();
  });

  it('aura_power_buff buffs friendly chars matching filter (excludes self)', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('SRC', { traits: ['Aura'] }), 'src');
    placeOnField(s, 'A', makeChar('CH1', { traits: ['Pirate'] }), 'ch1');
    placeOnField(s, 'A', makeChar('CH2', { traits: ['Pirate'] }), 'ch2');
    placeOnField(s, 'A', makeChar('CH3', { traits: ['Marine'] }), 'ch3');
    const effects: ContinuousEffectV2[] = [
      { action: { kind: 'aura_power_buff', filter: { trait: 'Pirate' }, magnitude: 1000 } as any },
    ];
    applyContinuousEffectsV2ToInstance(s, 'src', effects);
    expect(s.instances['ch1'].powerModifier).toBe(1000);
    expect(s.instances['ch2'].powerModifier).toBe(1000);
    expect(s.instances['ch3'].powerModifier).toBeUndefined();
    expect(s.instances['src'].powerModifier).toBeUndefined(); // self excluded
  });

  it('aura_cost_modifier shifts cost on matching friendlies', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('ACS'), 'acs');
    placeOnField(s, 'A', makeChar('AC1', { cost: 4, traits: ['Marine'] }), 'ac1');
    placeOnField(s, 'A', makeChar('AC2', { cost: 4 }), 'ac2');
    const effects: ContinuousEffectV2[] = [
      { action: { kind: 'aura_cost_modifier', filter: { trait: 'Marine' }, delta: 1 } as any },
    ];
    applyContinuousEffectsV2ToInstance(s, 'acs', effects);
    expect(s.instances['ac1'].costModifier).toBe(1);
    expect(s.instances['ac2'].costModifier).toBeUndefined();
  });

  it('self_immune_to_opp_effects sets immunity', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('IMS'), 'ims');
    const effects: ContinuousEffectV2[] = [
      { action: { kind: 'self_immune_to_opp_effects' } },
    ];
    applyContinuousEffectsV2ToInstance(s, 'ims', effects);
    expect(s.instances['ims'].immunity).toEqual({ against: 'opp_effects' });
  });

  it('grant_keyword_to_self appends keyword + dedupes', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('KWS'), 'kws');
    const effects: ContinuousEffectV2[] = [
      { action: { kind: 'grant_keyword_to_self', keyword: 'blocker' } },
    ];
    applyContinuousEffectsV2ToInstance(s, 'kws', effects);
    applyContinuousEffectsV2ToInstance(s, 'kws', effects);
    expect(s.instances['kws'].grantedKeywords).toEqual(['blocker']);
  });

  it('restrict_self_attack sets attackLocked', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('RSA'), 'rsa');
    const effects: ContinuousEffectV2[] = [
      { action: { kind: 'restrict_self_attack' } },
    ];
    applyContinuousEffectsV2ToInstance(s, 'rsa', effects);
    expect(s.instances['rsa'].attackLocked).toBe(true);
  });

  it('cost_modifier_in_hand only fires when source is in controllers hand', () => {
    const s = boot();
    // Plant a card in hand.
    s.cardLibrary['CMH'] = makeChar('CMH', { cost: 5 });
    s.instances['cmh'] = {
      instanceId: 'cmh', cardId: 'CMH', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.hand.push('cmh');
    const effects: ContinuousEffectV2[] = [
      { action: { kind: 'cost_modifier_in_hand', delta: -1 } },
    ];
    applyContinuousEffectsV2ToInstance(s, 'cmh', effects);
    expect(s.instances['cmh'].costModifier).toBe(-1);
  });

  it('cost_modifier_in_hand is no-op when source is on field (not in hand)', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('CMF', { cost: 5 }), 'cmf');
    const effects: ContinuousEffectV2[] = [
      { action: { kind: 'cost_modifier_in_hand', delta: -2 } },
    ];
    applyContinuousEffectsV2ToInstance(s, 'cmf', effects);
    expect(s.instances['cmf'].costModifier).toBeUndefined();
  });

  it('multiple continuous effects on one instance compose', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('MULTI'), 'mu');
    const effects: ContinuousEffectV2[] = [
      { action: { kind: 'self_power_buff', magnitude: 1000 } },
      { action: { kind: 'grant_keyword_to_self', keyword: 'rush' } },
      { action: { kind: 'self_immune_to_opp_effects' } },
    ];
    applyContinuousEffectsV2ToInstance(s, 'mu', effects);
    expect(s.instances['mu'].powerModifier).toBe(1000);
    expect(s.instances['mu'].grantedKeywords).toEqual(['rush']);
    expect(s.instances['mu'].immunity).toBeDefined();
  });

  it('unknown sourceInstanceId returns state unchanged', () => {
    const s = boot();
    const before = JSON.stringify(s);
    applyContinuousEffectsV2ToInstance(s, 'no-such-id', [
      { action: { kind: 'self_power_buff', magnitude: 1000 } },
    ]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('self_power_buff with read_state on own_life_count', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('LF'), 'lf');
    s.players.A.life = ['l1', 'l2', 'l3'];
    const effects: ContinuousEffectV2[] = [
      { action: { kind: 'self_power_buff', magnitude: { kind: 'read_state', source: 'own_life_count' } } },
    ];
    applyContinuousEffectsV2ToInstance(s, 'lf', effects);
    expect(s.instances['lf'].powerModifier).toBe(3);
  });

  it('aura excludes self even with broad filter', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('AS'), 'as1');
    placeOnField(s, 'A', makeChar('AT'), 'at1');
    const effects: ContinuousEffectV2[] = [
      { action: { kind: 'aura_power_buff', filter: {}, magnitude: 500 } as any },
    ];
    applyContinuousEffectsV2ToInstance(s, 'as1', effects);
    expect(s.instances['at1'].powerModifier).toBe(500);
    expect(s.instances['as1'].powerModifier).toBeUndefined();
  });

  it('match_opp_don magnitude reads opp DON count', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('MD'), 'md');
    s.players.B.donCostArea = ['x', 'y', 'z', 'w'];
    const effects: ContinuousEffectV2[] = [
      { action: { kind: 'self_power_buff', magnitude: { kind: 'match_opp_don' } as any } },
    ];
    applyContinuousEffectsV2ToInstance(s, 'md', effects);
    expect(s.instances['md'].powerModifier).toBe(4);
  });
});
